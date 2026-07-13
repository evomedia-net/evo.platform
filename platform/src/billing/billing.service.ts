import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';
import { CheckoutDto, PortalDto } from './dto';

/**
 * Stripe subscription billing. The platform owns the Stripe relationship;
 * apps only read the resulting tenant plan/status from JWT-time checks.
 *
 * Status mapping (subscription sync writes tenant.status directly — cancel
 * subscriptions in Stripe, don't fight the webhook):
 *   active/trialing            → ACTIVE
 *   past_due                   → PAST_DUE (+ grace window if not already set)
 *   canceled/unpaid/paused/... → SUSPENDED
 * invoice.paid only lifts PAST_DUE → ACTIVE; it never un-suspends a tenant an
 * admin suspended manually.
 */
@Injectable()
export class BillingService {
  private stripe: Stripe | null;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    @Optional() stripeClient?: Stripe,
  ) {
    this.stripe =
      stripeClient ?? (config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null);
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException('Billing is not configured (STRIPE_SECRET_KEY unset)');
    }
    return this.stripe;
  }

  async ensureCustomer(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.deletedAt) throw new NotFoundException('Tenant not found');
    if (tenant.stripeCustomerId) return tenant.stripeCustomerId;

    const customer = await this.requireStripe().customers.create({
      name: tenant.name,
      metadata: { tenantId: tenant.id, slug: tenant.slug },
    });
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }

  async checkout(dto: CheckoutDto) {
    const customer = await this.ensureCustomer(dto.tenantId);
    const session = await this.requireStripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: dto.priceId, quantity: dto.quantity ?? 1 }],
      success_url: dto.successUrl,
      cancel_url: dto.cancelUrl,
      subscription_data: { metadata: { tenantId: dto.tenantId } },
    });
    return { url: session.url };
  }

  async portal(dto: PortalDto) {
    const customer = await this.ensureCustomer(dto.tenantId);
    const session = await this.requireStripe().billingPortal.sessions.create({
      customer,
      return_url: dto.returnUrl,
    });
    return { url: session.url };
  }

  // ---- webhook ----

  verifyAndParseEvent(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    secret: string | undefined = config.stripe.webhookSecret,
  ): Stripe.Event {
    if (!secret) {
      throw new ServiceUnavailableException('Billing webhook is not configured');
    }
    if (!rawBody || !signature) throw new BadRequestException('Invalid webhook signature');
    try {
      return this.requireStripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  async handleEvent(event: Stripe.Event): Promise<{ handled: boolean }> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.syncSubscription(event.data.object as Stripe.Subscription);
      case 'invoice.paid':
        return this.onInvoicePaid(event.data.object as Stripe.Invoice);
      case 'invoice.payment_failed':
        return this.onPaymentFailed(event.data.object as Stripe.Invoice);
      default:
        return { handled: false };
    }
  }

  private customerId(ref: string | { id: string } | null): string | null {
    return typeof ref === 'string' ? ref : (ref?.id ?? null);
  }

  private async syncSubscription(sub: Stripe.Subscription) {
    const customerId = this.customerId(sub.customer);
    const tenant = customerId
      ? await this.prisma.tenant.findFirst({ where: { stripeCustomerId: customerId } })
      : null;
    if (!tenant) return { handled: false };

    let status: TenantStatus;
    let graceUntil: Date | null;
    if (sub.status === 'active' || sub.status === 'trialing') {
      status = 'ACTIVE';
      graceUntil = null;
    } else if (sub.status === 'past_due') {
      status = 'PAST_DUE';
      graceUntil = tenant.graceUntil ?? this.graceDeadline();
    } else {
      status = 'SUSPENDED';
      graceUntil = null;
    }

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { stripeSubscriptionId: sub.id, status, graceUntil },
    });
    await this.audit.record('billing.subscription_synced', {
      tenantId: tenant.id,
      detail: { stripeStatus: sub.status, status },
    });
    return { handled: true };
  }

  private async onInvoicePaid(invoice: Stripe.Invoice) {
    const customerId = this.customerId(invoice.customer);
    const tenant = customerId
      ? await this.prisma.tenant.findFirst({ where: { stripeCustomerId: customerId } })
      : null;
    if (!tenant) return { handled: false };
    // Only lift billing-driven PAST_DUE; never un-suspend a manual suspension.
    if (tenant.status === 'PAST_DUE') {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE', graceUntil: null },
      });
      await this.audit.record('billing.payment_recovered', { tenantId: tenant.id });
    }
    return { handled: true };
  }

  private async onPaymentFailed(invoice: Stripe.Invoice) {
    const customerId = this.customerId(invoice.customer);
    const tenant = customerId
      ? await this.prisma.tenant.findFirst({ where: { stripeCustomerId: customerId } })
      : null;
    if (!tenant) return { handled: false };
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: 'PAST_DUE',
        graceUntil: tenant.graceUntil ?? this.graceDeadline(),
      },
    });
    await this.audit.record('billing.payment_failed', {
      tenantId: tenant.id,
      detail: { graceDays: config.stripe.graceDays },
    });
    return { handled: true };
  }

  private graceDeadline(): Date {
    return new Date(Date.now() + config.stripe.graceDays * 86_400_000);
  }
}
