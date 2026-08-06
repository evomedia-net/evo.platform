// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { AppTenantStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';
import { CheckoutDto, PortalDto } from './dto';

/** The calling app, as attached to the request by ClientGuard. */
export interface CallingApp {
  id: string;
  clientId: string;
  stripePriceId: string | null;
}

/**
 * Stripe subscription billing, scoped **per app**: each (tenant, app) pair
 * carries its own subscription, and webhook events drive that pair's
 * AppTenant row — one app's lapse never touches the tenant's other apps.
 * The tenant keeps a single Stripe customer; subscriptions hang off it.
 *
 * Status mapping (sync writes AppTenant.status directly — cancel
 * subscriptions in Stripe, don't fight the webhook):
 *   active/trialing            → ACTIVE
 *   past_due                   → PAST_DUE (+ grace window if not already set)
 *   canceled/unpaid/paused/... → SUSPENDED
 * invoice.paid only lifts PAST_DUE → ACTIVE; it never revives a row an admin
 * suspended manually. Paying for an app that was never enabled creates the
 * row — a completed checkout IS enablement.
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

  /**
   * Confirm a Price exists and is active before it is saved on an app.
   * Without this a mistyped id is stored happily and only fails at checkout —
   * in front of a paying customer, which is the worst place to discover it.
   *
   * Deliberately a no-op when Stripe is unconfigured: a deployment without
   * keys can still record the id it intends to sell on, and checkout already
   * refuses separately when billing isn't set up.
   */
  async assertPriceUsable(priceId: string): Promise<void> {
    if (!this.stripe) return;
    let price: Stripe.Price;
    try {
      price = await this.stripe.prices.retrieve(priceId);
    } catch {
      throw new BadRequestException(`Stripe has no price "${priceId}"`);
    }
    if (!price.active) {
      throw new BadRequestException(`Stripe price "${priceId}" is archived, so checkout would fail`);
    }
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

  /** Checkout for the CALLING app's subscription: the price comes from the app
   *  registry (dto.priceId may override), and the subscription is tagged with
   *  tenant + app so the webhook can route it to the right AppTenant row. */
  async checkout(dto: CheckoutDto, app: CallingApp) {
    const priceId = dto.priceId ?? app.stripePriceId;
    if (!priceId) {
      throw new BadRequestException('This app has no Stripe price configured');
    }
    const customer = await this.ensureCustomer(dto.tenantId);
    const session = await this.requireStripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: priceId, quantity: dto.quantity ?? 1 }],
      success_url: dto.successUrl,
      cancel_url: dto.cancelUrl,
      subscription_data: {
        metadata: { tenantId: dto.tenantId, appId: app.id, appClientId: app.clientId },
      },
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

  /** Invoice → subscription id across Stripe API shapes (pre/post "basil":
   *  `invoice.subscription` vs `invoice.parent.subscription_details`). */
  private invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const inv = invoice as unknown as {
      subscription?: string | { id: string } | null;
      parent?: {
        subscription_details?: { subscription?: string | { id: string } | null } | null;
      } | null;
    };
    const ref = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
    return typeof ref === 'string' ? ref : (ref?.id ?? null);
  }

  private async accessBySubscriptionId(subId: string | null) {
    if (!subId) return null;
    return this.prisma.appTenant.findFirst({ where: { stripeSubscriptionId: subId } });
  }

  private async syncSubscription(sub: Stripe.Subscription) {
    // Prefer the metadata stamped at checkout; fall back to the stored sub id.
    const meta = (sub.metadata ?? {}) as { tenantId?: string; appId?: string };
    let access =
      meta.tenantId && meta.appId
        ? await this.prisma.appTenant.findUnique({
            where: { tenantId_appId: { tenantId: meta.tenantId, appId: meta.appId } },
          })
        : await this.accessBySubscriptionId(sub.id);

    let status: AppTenantStatus;
    let graceUntil: Date | null;
    if (sub.status === 'active' || sub.status === 'trialing') {
      status = 'ACTIVE';
      graceUntil = null;
    } else if (sub.status === 'past_due') {
      status = 'PAST_DUE';
      graceUntil = access?.graceUntil ?? this.graceDeadline();
    } else {
      status = 'SUSPENDED';
      graceUntil = null;
    }

    if (!access) {
      // A subscription for a pair with no row yet: paying IS enablement —
      // but only if the metadata names a real tenant + app.
      if (!meta.tenantId || !meta.appId) return { handled: false };
      access = await this.prisma.appTenant.create({
        data: {
          tenantId: meta.tenantId,
          appId: meta.appId,
          status,
          graceUntil,
          stripeSubscriptionId: sub.id,
        },
      });
    } else {
      // A row already owned by a DIFFERENT subscription ignores terminal
      // events from the old one (upgrade flows replace subscriptions).
      if (
        access.stripeSubscriptionId &&
        access.stripeSubscriptionId !== sub.id &&
        status === 'SUSPENDED'
      ) {
        return { handled: true };
      }
      access = await this.prisma.appTenant.update({
        where: { tenantId_appId: { tenantId: access.tenantId, appId: access.appId } },
        data: { status, graceUntil, stripeSubscriptionId: sub.id, trialEndsAt: null },
      });
    }

    await this.audit.record('billing.subscription_synced', {
      tenantId: access.tenantId,
      detail: { appId: access.appId, stripeStatus: sub.status, status },
    });
    return { handled: true };
  }

  private async onInvoicePaid(invoice: Stripe.Invoice) {
    const access = await this.accessBySubscriptionId(this.invoiceSubscriptionId(invoice));
    if (!access) return { handled: false };
    // Only lift billing-driven PAST_DUE; never revive a manual suspension.
    if (access.status === 'PAST_DUE') {
      await this.prisma.appTenant.update({
        where: { tenantId_appId: { tenantId: access.tenantId, appId: access.appId } },
        data: { status: 'ACTIVE', graceUntil: null },
      });
      await this.audit.record('billing.payment_recovered', {
        tenantId: access.tenantId,
        detail: { appId: access.appId },
      });
    }
    return { handled: true };
  }

  private async onPaymentFailed(invoice: Stripe.Invoice) {
    const access = await this.accessBySubscriptionId(this.invoiceSubscriptionId(invoice));
    if (!access) return { handled: false };
    await this.prisma.appTenant.update({
      where: { tenantId_appId: { tenantId: access.tenantId, appId: access.appId } },
      data: {
        status: 'PAST_DUE',
        graceUntil: access.graceUntil ?? this.graceDeadline(),
      },
    });
    await this.audit.record('billing.payment_failed', {
      tenantId: access.tenantId,
      detail: { appId: access.appId, graceDays: config.stripe.graceDays },
    });
    return { handled: true };
  }

  private graceDeadline(): Date {
    return new Date(Date.now() + config.stripe.graceDays * 86_400_000);
  }
}
