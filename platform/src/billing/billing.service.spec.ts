// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { BillingService } from './billing.service';
import { config, stripeMode } from '../config';

const WEBHOOK_SECRET = 'whsec_test_secret';
// Real Stripe client (no network calls in these tests) so signature
// verification runs against Stripe's actual constructEvent implementation.
const realStripe = new Stripe('sk_test_dummy');

function signedEvent(event: object): { rawBody: Buffer; signature: string } {
  const payload = JSON.stringify(event);
  const signature = realStripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
  return { rawBody: Buffer.from(payload), signature };
}

const baseTenant = {
  id: 't1',
  slug: 'acme',
  name: 'Acme',
  stripeCustomerId: 'cus_1',
  deletedAt: null,
};

const baseAccess = {
  tenantId: 't1',
  appId: 'a1',
  status: 'ACTIVE',
  plan: 'free',
  trialEndsAt: null as Date | null,
  graceUntil: null as Date | null,
  stripeSubscriptionId: 'sub_1',
};

function makePrisma(access: Record<string, unknown> | null = { ...baseAccess }, prices = PRICES) {
  return {
    appPrice: {
      findMany: jest.fn().mockResolvedValue(prices),
      findUnique: jest.fn(async ({ where }: { where: { stripePriceId: string } }) =>
        prices.find((p) => p.stripePriceId === where.stripePriceId) ?? null,
      ),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue(baseTenant),
      update: jest.fn().mockResolvedValue(baseTenant),
    },
    appTenant: {
      findUnique: jest.fn().mockResolvedValue(access),
      findFirst: jest.fn().mockResolvedValue(access),
      create: jest.fn().mockResolvedValue({ ...baseAccess }),
      update: jest.fn().mockResolvedValue({ ...baseAccess }),
      upsert: jest.fn().mockResolvedValue({ ...baseAccess }),
    },
  };
}

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const app = { id: 'a1', clientId: 'app_demo', callbackUrls: ['https://app.test/cb'] };

// What the app sells. Rows, not a column: two tiers x two billing periods.
const PRICES = [
  { id: 'ap1', appId: 'a1', stripePriceId: 'price_app', tier: 'starter', unitAmount: 1000, currency: 'usd', interval: 'month', intervalCount: 1, livemode: false },
  { id: 'ap2', appId: 'a1', stripePriceId: 'price_pro_m', tier: 'pro', unitAmount: 5000, currency: 'usd', interval: 'month', intervalCount: 1, livemode: false },
  { id: 'ap3', appId: 'a1', stripePriceId: 'price_pro_y', tier: 'pro', unitAmount: 50000, currency: 'usd', interval: 'year', intervalCount: 1, livemode: false },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any, stripe: any = realStripe) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new BillingService(prisma, audit as any, stripe);

const asEvent = (type: string, object: object) => ({ type, data: { object } }) as unknown as Stripe.Event;

beforeEach(() => jest.clearAllMocks());

describe('webhook signature verification', () => {
  it('accepts a validly signed event', () => {
    const svc = makeSvc(makePrisma());
    const { rawBody, signature } = signedEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    expect(svc.verifyAndParseEvent(rawBody, signature, WEBHOOK_SECRET).type).toBe('invoice.paid');
  });

  it('rejects a tampered payload', () => {
    const svc = makeSvc(makePrisma());
    const { signature } = signedEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    expect(() =>
      svc.verifyAndParseEvent(Buffer.from('{"tampered":true}'), signature, WEBHOOK_SECRET),
    ).toThrow(BadRequestException);
  });

  it('rejects when the webhook secret is not configured', () => {
    const svc = makeSvc(makePrisma());
    const { rawBody, signature } = signedEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    expect(() => svc.verifyAndParseEvent(rawBody, signature, undefined)).toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('per-app event handling', () => {
  it('payment_failed marks the APP pair PAST_DUE with a ~7 day grace window', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).handleEvent(
      asEvent('invoice.payment_failed', { subscription: 'sub_1' }),
    );
    const call = prisma.appTenant.update.mock.calls[0][0];
    expect(call.where).toEqual({ tenantId_appId: { tenantId: 't1', appId: 'a1' } });
    expect(call.data.status).toBe('PAST_DUE');
    const days = (call.data.graceUntil.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('resolves the subscription id from the newer invoice.parent shape too', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).handleEvent(
      asEvent('invoice.payment_failed', {
        parent: { subscription_details: { subscription: 'sub_1' } },
      }),
    );
    expect(prisma.appTenant.update).toHaveBeenCalled();
  });

  it('a repeat payment failure keeps the original grace deadline', async () => {
    const existing = new Date('2026-07-25T00:00:00Z');
    const prisma = makePrisma({ ...baseAccess, status: 'PAST_DUE', graceUntil: existing });
    await makeSvc(prisma).handleEvent(
      asEvent('invoice.payment_failed', { subscription: 'sub_1' }),
    );
    expect(prisma.appTenant.update.mock.calls[0][0].data.graceUntil).toBe(existing);
  });

  it('invoice.paid lifts PAST_DUE back to ACTIVE for that app only', async () => {
    const prisma = makePrisma({ ...baseAccess, status: 'PAST_DUE', graceUntil: new Date() });
    await makeSvc(prisma).handleEvent(asEvent('invoice.paid', { subscription: 'sub_1' }));
    expect(prisma.appTenant.update.mock.calls[0][0].data).toEqual({
      status: 'ACTIVE',
      graceUntil: null,
    });
  });

  it('invoice.paid never revives a manually suspended app pair', async () => {
    const prisma = makePrisma({ ...baseAccess, status: 'SUSPENDED' });
    const out = await makeSvc(prisma).handleEvent(
      asEvent('invoice.paid', { subscription: 'sub_1' }),
    );
    expect(out.handled).toBe(true);
    expect(prisma.appTenant.update).not.toHaveBeenCalled();
  });

  it('subscription sync maps stripe statuses onto the AppTenant row', async () => {
    for (const [stripeStatus, expected] of [
      ['active', 'ACTIVE'],
      ['trialing', 'ACTIVE'],
      ['past_due', 'PAST_DUE'],
      ['canceled', 'SUSPENDED'],
      ['unpaid', 'SUSPENDED'],
    ] as const) {
      const prisma = makePrisma();
      await makeSvc(prisma).handleEvent(
        asEvent('customer.subscription.updated', {
          id: 'sub_1',
          status: stripeStatus,
          metadata: { tenantId: 't1', appId: 'a1' },
        }),
      );
      const data = prisma.appTenant.update.mock.calls[0][0].data;
      expect(data.status).toBe(expected);
      expect(data.stripeSubscriptionId).toBe('sub_1');
    }
  });

  it('a paid subscription for a pair with no row CREATES it — paying is enablement', async () => {
    const prisma = makePrisma(null);
    await makeSvc(prisma).handleEvent(
      asEvent('customer.subscription.created', {
        id: 'sub_9',
        status: 'active',
        metadata: { tenantId: 't1', appId: 'a1' },
      }),
    );
    const data = prisma.appTenant.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: 't1',
      appId: 'a1',
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_9',
    });
  });

  it('a sync clears trialEndsAt — the subscription replaces the trial', async () => {
    const prisma = makePrisma({ ...baseAccess, status: 'TRIAL', trialEndsAt: new Date() });
    await makeSvc(prisma).handleEvent(
      asEvent('customer.subscription.created', {
        id: 'sub_1',
        status: 'active',
        metadata: { tenantId: 't1', appId: 'a1' },
      }),
    );
    expect(prisma.appTenant.update.mock.calls[0][0].data.trialEndsAt).toBeNull();
  });

  it('ignores terminal events from a replaced (stale) subscription', async () => {
    const prisma = makePrisma({ ...baseAccess, stripeSubscriptionId: 'sub_NEW' });
    const out = await makeSvc(prisma).handleEvent(
      asEvent('customer.subscription.deleted', {
        id: 'sub_OLD',
        status: 'canceled',
        metadata: { tenantId: 't1', appId: 'a1' },
      }),
    );
    expect(out.handled).toBe(true);
    expect(prisma.appTenant.update).not.toHaveBeenCalled();
  });

  it('acknowledges a subscription naming an unknown tenant instead of 500ing', async () => {
    // A 500 makes Stripe retry the same event for days and eventually disable
    // the endpoint - one orphan must never stop billing sync for everyone.
    const prisma = makePrisma(null);
    const fk = Object.assign(new Error('FK violation'), { code: 'P2003' });
    prisma.appTenant.create.mockRejectedValueOnce(fk);
    const out = await makeSvc(prisma).handleEvent(
      asEvent('customer.subscription.created', {
        id: 'sub_orphan',
        status: 'active',
        metadata: { tenantId: 'purged-tenant', appId: 'a1' },
      }),
    );
    expect(out.handled).toBe(false); // acknowledged (200), not applied
    expect(audit.record).toHaveBeenCalledWith('billing.orphan_subscription', {
      detail: {
        stripeSubscriptionId: 'sub_orphan',
        tenantId: 'purged-tenant',
        appId: 'a1',
        stripeStatus: 'active',
      },
    });
  });

  it('a database failure that is NOT an orphan still throws - Stripe should retry those', async () => {
    const prisma = makePrisma(null);
    prisma.appTenant.create.mockRejectedValueOnce(new Error('connection reset'));
    await expect(
      makeSvc(prisma).handleEvent(
        asEvent('customer.subscription.created', {
          id: 'sub_1',
          status: 'active',
          metadata: { tenantId: 't1', appId: 'a1' },
        }),
      ),
    ).rejects.toThrow('connection reset');
  });

  it('a paid one-time checkout activates the pair and stamps the tier', async () => {
    const prisma = makePrisma(null);
    const out = await makeSvc(prisma).handleEvent(
      asEvent('checkout.session.completed', {
        id: 'cs_1',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { tenantId: 't1', appId: 'a1', tier: 'lifetime' },
      }),
    );
    expect(out.handled).toBe(true);
    const call = prisma.appTenant.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ tenantId: 't1', appId: 'a1', status: 'ACTIVE', plan: 'lifetime' });
    // Re-purchase lifts grace/trial; it never leaves a paid pair suspended.
    expect(call.update).toMatchObject({ status: 'ACTIVE', graceUntil: null, trialEndsAt: null });
  });

  it('an unpaid or subscription-mode checkout.session.completed is ignored', async () => {
    const prisma = makePrisma(null);
    const out = await makeSvc(prisma).handleEvent(
      asEvent('checkout.session.completed', {
        id: 'cs_2',
        mode: 'subscription',
        payment_status: 'paid',
        metadata: { tenantId: 't1', appId: 'a1' },
      }),
    );
    expect(out.handled).toBe(false);
    expect(prisma.appTenant.upsert).not.toHaveBeenCalled();
  });

  it('a one-time purchase for an unknown tenant is acknowledged, not 500ed', async () => {
    const prisma = makePrisma(null);
    prisma.appTenant.upsert.mockRejectedValueOnce(
      Object.assign(new Error('FK violation'), { code: 'P2003' }),
    );
    const out = await makeSvc(prisma).handleEvent(
      asEvent('checkout.session.completed', {
        id: 'cs_3',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { tenantId: 'purged-tenant', appId: 'a1' },
      }),
    );
    expect(out.handled).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      'billing.orphan_subscription',
      expect.objectContaining({ detail: expect.objectContaining({ tenantId: 'purged-tenant' }) }),
    );
  });

  it('ignores events that resolve to no known pair', async () => {
    const prisma = makePrisma(null);
    const out = await makeSvc(prisma).handleEvent(
      asEvent('customer.subscription.updated', { id: 'sub_ghost', status: 'active', metadata: {} }),
    );
    expect(out.handled).toBe(false);
    expect(prisma.appTenant.create).not.toHaveBeenCalled();
  });
});

describe('checkout', () => {
  const fakeStripe = () => ({
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_new' }) },
    checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/c' }) } },
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/p' }) } },
  });

  const dto = {
    tenantId: 't1',
    successUrl: 'https://app.test/ok',
    cancelUrl: 'https://app.test/no',
  };

  it('selects a tier and billing period, and tags the subscription with both', async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma(), stripe);
    const out = await svc.checkout({ ...dto, tier: 'pro', interval: 'year' }, app);
    expect(out.url).toBe('https://stripe.test/c');
    const session = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(session.mode).toBe('subscription');
    expect(session.line_items[0].price).toBe('price_pro_y');
    expect(session.subscription_data.metadata).toMatchObject({
      tenantId: 't1',
      appId: 'a1',
      tier: 'pro',
    });
  });

  it('the same tier at a different period is a different price', async () => {
    const stripe = fakeStripe();
    await makeSvc(makePrisma(), stripe).checkout({ ...dto, tier: 'pro' }, app);
    // No interval given → monthly, not the annual row.
    expect(stripe.checkout.sessions.create.mock.calls[0][0].line_items[0].price).toBe('price_pro_m');
  });

  it('refuses to guess when the app sells more than one price', async () => {
    const stripe = fakeStripe();
    await expect(makeSvc(makePrisma(), stripe).checkout(dto, app)).rejects.toThrow(/Specify tier/);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('a single-price app needs no selector — there is nothing to choose', async () => {
    const stripe = fakeStripe();
    await makeSvc(makePrisma(undefined, [PRICES[0]]), stripe).checkout(dto, app);
    expect(stripe.checkout.sessions.create.mock.calls[0][0].line_items[0].price).toBe('price_app');
  });

  it('rejects a tier the app does not sell', async () => {
    const stripe = fakeStripe();
    await expect(
      makeSvc(makePrisma(), stripe).checkout({ ...dto, tier: 'enterprise' }, app),
    ).rejects.toThrow(/no "enterprise" price/);
  });

  it('a one-time price checks out in payment mode, with metadata on the session', async () => {
    const stripe = fakeStripe();
    const once = {
      ...PRICES[0],
      stripePriceId: 'price_lifetime',
      tier: 'lifetime',
      interval: 'once',
    };
    await makeSvc(makePrisma(undefined, [once]), stripe).checkout(dto, app);
    const session = stripe.checkout.sessions.create.mock.calls[0][0];
    // Subscription mode rejects a non-recurring price outright, so this is
    // not a preference — and payment mode has no subscription_data to carry
    // the routing metadata, hence it riding on the session.
    expect(session.mode).toBe('payment');
    expect(session.subscription_data).toBeUndefined();
    expect(session.metadata).toMatchObject({ tenantId: 't1', appId: 'a1', tier: 'lifetime' });
  });

  it('a tier with a trial passes it to Stripe', async () => {
    const stripe = fakeStripe();
    const trial = { ...PRICES[0], trialDays: 14 };
    await makeSvc(makePrisma(undefined, [trial]), stripe).checkout(dto, app);
    expect(stripe.checkout.sessions.create.mock.calls[0][0].subscription_data.trial_period_days).toBe(14);
  });

  it("rejects a priceId that is not one of the app's registered prices", async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma(), stripe);
    await expect(svc.checkout({ ...dto, priceId: 'price_other_app' }, app)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('accepts any priceId the app does register', async () => {
    const stripe = fakeStripe();
    await makeSvc(makePrisma(), stripe).checkout({ ...dto, priceId: 'price_pro_y' }, app);
    expect(stripe.checkout.sessions.create.mock.calls[0][0].line_items[0].price).toBe('price_pro_y');
  });

  it('refuses checkout for a tenant the app has no relationship with', async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma(null), stripe);
    await expect(svc.checkout({ ...dto, tier: 'starter' }, app)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Refused before any Stripe call — no customer is created as a side effect.
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects redirect URLs whose origin is not a registered callback URL', async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma(), stripe);
    await expect(
      svc.checkout({ ...dto, tier: 'starter', successUrl: 'https://evil.test/ok' }, app),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.checkout({ ...dto, tier: 'starter', cancelUrl: 'https://evil.test/no' }, app),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('an app with no registered callback URLs cannot mint redirects at all', async () => {
    const svc = makeSvc(makePrisma(), fakeStripe());
    await expect(
      svc.checkout({ ...dto, tier: 'starter' }, { ...app, callbackUrls: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s when the app sells nothing at all', async () => {
    const svc = makeSvc(makePrisma(undefined, []), fakeStripe());
    await expect(svc.checkout(dto, app)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates and stores a customer when the tenant has none', async () => {
    const stripe = fakeStripe();
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ ...baseTenant, stripeCustomerId: null });
    await makeSvc(prisma, stripe).checkout({ ...dto, tier: 'starter' }, app);
    expect(stripe.customers.create).toHaveBeenCalled();
    expect(prisma.tenant.update.mock.calls[0][0].data.stripeCustomerId).toBe('cus_new');
  });

  it('reports billing unconfigured when no key and no client are present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new BillingService(makePrisma() as any, audit as any);
    await expect(svc.checkout({ ...dto, tier: 'starter' }, app)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('portal', () => {
  const fakeStripe = () => ({
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_new' }) },
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://stripe.test/p' }) } },
  });

  it('opens the portal for a tenant the app has a relationship with', async () => {
    const stripe = fakeStripe();
    const out = await makeSvc(makePrisma(), stripe).portal(
      { tenantId: 't1', returnUrl: 'https://app.test/billing' },
      app,
    );
    expect(out.url).toBe('https://stripe.test/p');
  });

  it("refuses the portal for another app's tenant — it exposes the whole customer", async () => {
    const stripe = fakeStripe();
    await expect(
      makeSvc(makePrisma(null), stripe).portal({ tenantId: 't1', returnUrl: 'https://app.test/b' }, app),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(stripe.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a returnUrl outside the registered callback origins', async () => {
    await expect(
      makeSvc(makePrisma(), fakeStripe()).portal(
        { tenantId: 't1', returnUrl: 'https://evil.test/b' },
        app,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('entitlement', () => {
  const DAY = 86_400_000;
  // No Stripe client on purpose: entitlement must answer before billing is
  // configured — apps render trial banners long before anyone can pay.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svcFor = (access: Record<string, unknown> | null) =>
    new BillingService(makePrisma(access) as any, audit as any, null as unknown as Stripe);

  it('answers enabled:false with all-null fields when there is no relationship', async () => {
    const out = await svcFor(null).entitlement('t1', app);
    expect(out).toEqual({
      enabled: false,
      status: null,
      plan: null,
      trialEndsAt: null,
      graceUntil: null,
      daysLeft: null,
    });
  });

  it('an ACTIVE pair is enabled with no countdown', async () => {
    const out = await svcFor({ ...baseAccess }).entitlement('t1', app);
    expect(out).toMatchObject({ enabled: true, status: 'ACTIVE', plan: 'free', daysLeft: null });
  });

  it('a live TRIAL counts down the days to trialEndsAt', async () => {
    const ends = new Date(Date.now() + 5 * DAY + 60_000);
    const out = await svcFor({ ...baseAccess, status: 'TRIAL', trialEndsAt: ends }).entitlement(
      't1',
      app,
    );
    expect(out.enabled).toBe(true);
    expect(out.daysLeft).toBe(6); // partial days round UP: "6 days left", not 5.001
  });

  it('an expired TRIAL is disabled — matching the login gate', async () => {
    const out = await svcFor({
      ...baseAccess,
      status: 'TRIAL',
      trialEndsAt: new Date(Date.now() - DAY),
    }).entitlement('t1', app);
    expect(out).toMatchObject({ enabled: false, status: 'TRIAL', daysLeft: 0 });
  });

  it('PAST_DUE inside the grace window stays enabled and counts down', async () => {
    const out = await svcFor({
      ...baseAccess,
      status: 'PAST_DUE',
      graceUntil: new Date(Date.now() + 3 * DAY + 60_000),
    }).entitlement('t1', app);
    expect(out.enabled).toBe(true);
    expect(out.daysLeft).toBe(4);
  });

  it('PAST_DUE past the grace window is disabled', async () => {
    const out = await svcFor({
      ...baseAccess,
      status: 'PAST_DUE',
      graceUntil: new Date(Date.now() - DAY),
    }).entitlement('t1', app);
    expect(out).toMatchObject({ enabled: false, daysLeft: 0 });
  });

  it('SUSPENDED is disabled regardless of any deadline', async () => {
    const out = await svcFor({ ...baseAccess, status: 'SUSPENDED' }).entitlement('t1', app);
    expect(out).toMatchObject({ enabled: false, status: 'SUSPENDED' });
  });
});


// ── Stripe test vs live ──────────────────────────────────────────────────
//
// Going live is not one switch: the keys move first, and every price has to be
// re-registered in the other mode because a test price and a live price are
// different objects with different ids. The window between those two steps is
// where a deployment holds prices from the mode it is no longer in — and the
// only thing worse than checkout failing there is checkout succeeding.

describe('stripeMode', () => {
  it('reads the mode from the key prefix, so the two cannot disagree', () => {
    expect(stripeMode('sk_test_abc')).toBe('test');
    expect(stripeMode('rk_test_abc')).toBe('test');
    expect(stripeMode('sk_live_abc')).toBe('live');
    expect(stripeMode('rk_live_abc')).toBe('live');
  });

  it('reports unset for a missing or unrecognised key rather than guessing', () => {
    expect(stripeMode(undefined)).toBe('unset');
    expect(stripeMode('')).toBe('unset');
    expect(stripeMode('   ')).toBe('unset');
    expect(stripeMode('pk_test_abc')).toBe('unset'); // publishable key, not a secret
  });
});

describe('price mode', () => {
  const original = config.stripe.mode;
  afterEach(() => {
    (config.stripe as { mode: string }).mode = original;
  });
  const setMode = (m: 'test' | 'live' | 'unset') => {
    (config.stripe as { mode: string }).mode = m;
  };

  it('refuses a test price while running live keys, and says which way round', async () => {
    setMode('live');
    const prisma = makePrisma();
    await expect(
      makeSvc(prisma).checkout(
        { priceId: 'price_app', successUrl: 'https://a.test/ok', cancelUrl: 'https://a.test/no' } as never,
        { id: 'a1', clientId: 'c1', name: 'App' } as never,
      ),
    ).rejects.toThrow(/is a test price.*running live keys/s);
  });

  it('refuses a live price while running test keys', async () => {
    setMode('test');
    const live = [{ ...PRICES[0], livemode: true }];
    const prisma = makePrisma({ ...baseAccess }, live);
    await expect(
      makeSvc(prisma).checkout(
        { priceId: 'price_app', successUrl: 'https://a.test/ok', cancelUrl: 'https://a.test/no' } as never,
        { id: 'a1', clientId: 'c1', name: 'App' } as never,
      ),
    ).rejects.toThrow(/is a live price.*running test keys/s);
  });

  // Selecting by tier must be gated too: an app that says "pro, yearly" and
  // never holds a Stripe id is the route this platform recommends.
  it('refuses a cross-mode price selected by tier, not just by id', async () => {
    setMode('live');
    const prisma = makePrisma();
    await expect(
      makeSvc(prisma).checkout(
        { tier: 'pro', interval: 'year', successUrl: 'https://a.test/ok', cancelUrl: 'https://a.test/no' } as never,
        { id: 'a1', clientId: 'c1', name: 'App' } as never,
      ),
    ).rejects.toThrow(/live keys/);
  });

  it('lists only the prices sellable in the current mode', async () => {
    setMode('live');
    const prisma = makePrisma();
    await makeSvc(prisma).listPrices('a1');
    expect(prisma.appPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ livemode: true }) }),
    );
  });

  // An operator registering prices before the key arrives should still see
  // them, and billing already refuses separately when there is no key.
  it('filters nothing when no key is configured', async () => {
    setMode('unset');
    const prisma = makePrisma();
    await makeSvc(prisma).listPrices('a1');
    const where = prisma.appPrice.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('livemode');
  });
});
