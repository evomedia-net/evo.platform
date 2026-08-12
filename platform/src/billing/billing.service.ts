// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { AppTenant, AppTenantStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';
import { CheckoutDto, PortalDto } from './dto';

/** The fields of a Stripe Price that are immutable, and so safe to store. */
export interface PriceFacts {
  stripeProductId: string;
  productName: string;
  unitAmount: number;
  currency: string;
  /** once | day | week | month | year */
  interval: string;
  intervalCount: number;
}

/** A one-time price bills in Stripe's payment mode and never renews. */
export const ONCE = 'once';

/** The calling app, as attached to the request by ClientGuard. */
export interface CallingApp {
  id: string;
  clientId: string;
  callbackUrls: string[];
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
   * Confirm a Price exists and is active before it is saved on an app, and
   * return the facts worth storing alongside it. Without this a mistyped id is
   * stored happily and only fails at checkout — in front of a paying customer,
   * which is the worst place to discover it.
   *
   * The returned amount/currency/interval are safe to persist because Stripe
   * Prices are immutable in exactly those fields: changing what something
   * costs means archiving the price and creating a new one, so a stored copy
   * cannot drift from Stripe.
   *
   * Deliberately tolerant when Stripe is unconfigured: a deployment without
   * keys can still record the id it intends to sell on, and checkout already
   * refuses separately when billing isn't set up.
   */
  async describePrice(priceId: string): Promise<PriceFacts> {
    if (!this.stripe) {
      return {
        stripeProductId: '',
        productName: '',
        unitAmount: 0,
        currency: 'usd',
        interval: 'month',
        intervalCount: 1,
      };
    }
    let price: Stripe.Price;
    try {
      price = await this.stripe.prices.retrieve(priceId, { expand: ['product'] });
    } catch {
      throw new BadRequestException(`Stripe has no price "${priceId}"`);
    }
    if (!price.active) {
      throw new BadRequestException(`Stripe price "${priceId}" is archived, so checkout would fail`);
    }
    // A price with no `recurring` block is a one-time charge. Supported, but it
    // is a different product shape: payment mode at checkout, and no renewal,
    // grace or cancellation lifecycle to drive access afterwards.
    const product = price.product as Stripe.Product | Stripe.DeletedProduct | string;
    const productId = typeof product === 'string' ? product : product.id;
    const productName =
      typeof product === 'string' || product.deleted ? '' : (product.name ?? '');
    return {
      stripeProductId: productId,
      productName,
      unitAmount: price.unit_amount ?? 0,
      currency: price.currency,
      interval: price.recurring?.interval ?? ONCE,
      intervalCount: price.recurring?.interval_count ?? 1,
    };
  }

  /** What an app sells, cheapest first — enough for an app to render its own
   *  pricing table without holding any Stripe ids in its own code. */
  listPrices(appId: string) {
    return this.prisma.appPrice.findMany({
      where: { appId, sellable: true },
      orderBy: [{ sortOrder: 'asc' }, { unitAmount: 'asc' }],
      select: {
        stripePriceId: true,
        stripeProductId: true,
        productName: true,
        tier: true,
        unitAmount: true,
        currency: true,
        interval: true,
        intervalCount: true,
        trialDays: true,
      },
    });
  }

  /**
   * The calling app may only transact for tenants it already has a
   * relationship with. Rows are created by signup, auto-enroll, or a console
   * grant — never by a billing call — so requiring one here keeps an app from
   * enabling itself onto a workspace that never asked for it, and keeps one
   * app's credentials from reaching another app's customers.
   */
  private async requireRelationship(tenantId: string, app: CallingApp): Promise<AppTenant> {
    const access = await this.prisma.appTenant.findUnique({
      where: { tenantId_appId: { tenantId, appId: app.id } },
    });
    if (!access) throw new ForbiddenException('App is not enabled for this workspace');
    return access;
  }

  /**
   * A redirect target must share an origin with one of the app's registered
   * callback URLs — otherwise checkout/portal are an open redirect wearing
   * Stripe's (or the platform's) domain: "stripe.com sent me here" is exactly
   * the trust a phishing page wants to borrow.
   */
  private assertRedirectAllowed(url: string, app: CallingApp): void {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new BadRequestException(`Invalid redirect URL "${url}"`);
    }
    const allowed = (app.callbackUrls ?? []).some((cb) => {
      try {
        return new URL(cb).origin === origin;
      } catch {
        return false;
      }
    });
    if (!allowed) {
      throw new BadRequestException(
        `Redirect origin ${origin} is not registered as a callback URL for this app`,
      );
    }
  }

  /**
   * The tenant's standing on the CALLING app: status, plan, deadlines, and
   * whether a login would be admitted right now. A pure DB read — no Stripe
   * round-trip — so apps can call it per page load to render trial countdowns
   * and past-due banners, and it answers even when Stripe is unconfigured.
   *
   * `enabled` mirrors AuthService.assertAppEnabled — keep the two in lockstep,
   * or the banner will disagree with the door.
   */
  async entitlement(tenantId: string, app: CallingApp) {
    const access = await this.prisma.appTenant.findUnique({
      where: { tenantId_appId: { tenantId, appId: app.id } },
    });
    if (!access) {
      // No relationship. Answered softly (not 403/404) so an app can render
      // "not enabled" without treating the platform's answer as an error.
      return {
        enabled: false,
        status: null,
        plan: null,
        trialEndsAt: null,
        graceUntil: null,
        daysLeft: null,
      };
    }
    const now = new Date();
    const trialExpired =
      access.status === 'TRIAL' && access.trialEndsAt != null && access.trialEndsAt < now;
    const graceExpired =
      access.status === 'PAST_DUE' && access.graceUntil != null && access.graceUntil < now;
    const enabled = access.status !== 'SUSPENDED' && !trialExpired && !graceExpired;
    // The one deadline that currently threatens access, as a countdown.
    const deadline =
      access.status === 'TRIAL'
        ? access.trialEndsAt
        : access.status === 'PAST_DUE'
          ? access.graceUntil
          : null;
    const daysLeft = deadline
      ? Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000))
      : null;
    return {
      enabled,
      status: access.status,
      plan: access.plan,
      trialEndsAt: access.trialEndsAt,
      graceUntil: access.graceUntil,
      daysLeft,
    };
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

  /**
   * Resolve which of the app's prices a checkout is for. Either a priceId the
   * app already registered, or a (tier, interval) pair — the latter lets an
   * app say "pro, yearly" and never hold a Stripe id in its own code, so
   * repricing is a console edit rather than a redeploy of every app.
   *
   * Whichever route, the answer must be a row belonging to THIS app: that is
   * what stops a compromised app selling another product, or selling at a
   * price nobody vetted.
   */
  private async resolvePrice(dto: CheckoutDto, app: CallingApp) {
    const prices = await this.prisma.appPrice.findMany({ where: { appId: app.id } });
    if (!prices.length) {
      throw new BadRequestException('This app has no Stripe prices configured');
    }
    if (dto.priceId) {
      const match = prices.find((p) => p.stripePriceId === dto.priceId);
      if (!match) {
        throw new BadRequestException("priceId is not one of this app's registered prices");
      }
      return match;
    }
    if (dto.tier) {
      const interval = dto.interval ?? 'month';
      const count = dto.intervalCount ?? 1;
      const match = prices.find(
        (p) => p.tier === dto.tier && p.interval === interval && p.intervalCount === count,
      );
      if (!match) {
        throw new BadRequestException(
          `This app has no "${dto.tier}" price billed every ${count} ${interval}`,
        );
      }
      return match;
    }
    // One price and no selector is unambiguous; more than one is a real
    // choice, and guessing it would silently bill someone the wrong amount.
    if (prices.length > 1) {
      throw new BadRequestException('Specify tier (or priceId): this app sells more than one price');
    }
    return prices[0];
  }

  /** Checkout for the CALLING app's subscription: the price comes from the app
   *  registry, and the subscription is tagged with tenant + app + tier so the
   *  webhook can route it to the right AppTenant row and stamp the plan. */
  async checkout(dto: CheckoutDto, app: CallingApp) {
    const price = await this.resolvePrice(dto, app);
    const priceId = price.stripePriceId;
    await this.requireRelationship(dto.tenantId, app);
    this.assertRedirectAllowed(dto.successUrl, app);
    this.assertRedirectAllowed(dto.cancelUrl, app);
    const customer = await this.ensureCustomer(dto.tenantId);
    const metadata = {
      tenantId: dto.tenantId,
      appId: app.id,
      appClientId: app.clientId,
      tier: price.tier,
    };
    const once = price.interval === ONCE;
    const session = await this.requireStripe().checkout.sessions.create({
      // A one-time price has no subscription to create, so payment mode is not
      // a preference here - subscription mode rejects it outright.
      mode: once ? 'payment' : 'subscription',
      customer,
      line_items: [{ price: priceId, quantity: dto.quantity ?? 1 }],
      success_url: dto.successUrl,
      cancel_url: dto.cancelUrl,
      // Payment mode has no subscription_data, so the routing metadata rides on
      // the session itself; checkout.session.completed is what grants access.
      ...(once
        ? { metadata }
        : {
            subscription_data: {
              metadata,
              ...(price.trialDays > 0 ? { trial_period_days: price.trialDays } : {}),
            },
          }),
    });
    return { url: session.url };
  }

  /** A portal session opens the tenant's whole Stripe customer — invoices,
   *  payment method, every subscription, a cancel button. Only an app with an
   *  existing relationship to the tenant gets to mint one. */
  async portal(dto: PortalDto, app: CallingApp) {
    await this.requireRelationship(dto.tenantId, app);
    this.assertRedirectAllowed(dto.returnUrl, app);
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
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
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

  /**
   * Which tier a subscription is on, read from the price it actually bills.
   * The price is authoritative rather than the checkout metadata: an upgrade
   * done in the Stripe portal changes the price and never revisits our
   * metadata, so trusting the stamp would leave `plan` describing what the
   * customer bought once rather than what they pay for now.
   */
  private async tierOf(sub: Stripe.Subscription): Promise<string | null> {
    const priceId = sub.items?.data?.[0]?.price?.id;
    if (!priceId) return null;
    const price = await this.prisma.appPrice.findUnique({ where: { stripePriceId: priceId } });
    return price?.tier ?? null;
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

    const tier = await this.tierOf(sub);

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
          ...(tier ? { plan: tier } : {}),
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
        data: {
          status,
          graceUntil,
          stripeSubscriptionId: sub.id,
          trialEndsAt: null,
          // Only when the price resolves: an unknown price means the tier is
          // unknown, and blanking a known plan would be worse than keeping it.
          ...(tier ? { plan: tier } : {}),
        },
      });
    }

    await this.audit.record('billing.subscription_synced', {
      tenantId: access.tenantId,
      detail: { appId: access.appId, stripeStatus: sub.status, status, plan: access.plan },
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

  /**
   * A completed one-time purchase. Subscription checkouts are ignored here —
   * customer.subscription.created already handled those, and acting twice
   * would race it. A perpetual purchase has no renewal to watch, so the row is
   * simply ACTIVE with no subscription id, grace or trial hanging off it.
   */
  private async onCheckoutCompleted(session: Stripe.Checkout.Session) {
    if (session.mode !== 'payment' || session.payment_status !== 'paid') {
      return { handled: false };
    }
    const meta = (session.metadata ?? {}) as { tenantId?: string; appId?: string; tier?: string };
    if (!meta.tenantId || !meta.appId) return { handled: false };

    await this.prisma.appTenant.upsert({
      where: { tenantId_appId: { tenantId: meta.tenantId, appId: meta.appId } },
      create: {
        tenantId: meta.tenantId,
        appId: meta.appId,
        status: 'ACTIVE',
        ...(meta.tier ? { plan: meta.tier } : {}),
      },
      update: {
        status: 'ACTIVE',
        graceUntil: null,
        trialEndsAt: null,
        ...(meta.tier ? { plan: meta.tier } : {}),
      },
    });
    await this.audit.record('billing.purchase_completed', {
      tenantId: meta.tenantId,
      detail: { appId: meta.appId, plan: meta.tier ?? null, mode: 'payment' },
    });
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
