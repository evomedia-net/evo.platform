// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { BillingService } from './billing.service';

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

function makePrisma(access: Record<string, unknown> | null = { ...baseAccess }) {
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(baseTenant),
      update: jest.fn().mockResolvedValue(baseTenant),
    },
    appTenant: {
      findUnique: jest.fn().mockResolvedValue(access),
      findFirst: jest.fn().mockResolvedValue(access),
      create: jest.fn().mockResolvedValue({ ...baseAccess }),
      update: jest.fn().mockResolvedValue({ ...baseAccess }),
    },
  };
}

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const app = {
  id: 'a1',
  clientId: 'app_demo',
  stripePriceId: 'price_app',
  callbackUrls: ['https://app.test/cb'],
};

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

  it("uses the calling app's registered price and tags the subscription", async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma(), stripe);
    const out = await svc.checkout(dto, app);
    expect(out.url).toBe('https://stripe.test/c');
    const session = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(session.line_items[0].price).toBe('price_app');
    expect(session.subscription_data.metadata).toMatchObject({ tenantId: 't1', appId: 'a1' });
  });

  it("rejects a priceId that is not the app's registered price", async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma(), stripe);
    await expect(svc.checkout({ ...dto, priceId: 'price_other_app' }, app)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('still accepts a priceId that names the registered price (wire compat)', async () => {
    const stripe = fakeStripe();
    await makeSvc(makePrisma(), stripe).checkout({ ...dto, priceId: 'price_app' }, app);
    expect(stripe.checkout.sessions.create.mock.calls[0][0].line_items[0].price).toBe('price_app');
  });

  it('refuses checkout for a tenant the app has no relationship with', async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma(null), stripe);
    await expect(svc.checkout(dto, app)).rejects.toBeInstanceOf(ForbiddenException);
    // Refused before any Stripe call — no customer is created as a side effect.
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('rejects redirect URLs whose origin is not a registered callback URL', async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma(), stripe);
    await expect(
      svc.checkout({ ...dto, successUrl: 'https://evil.test/ok' }, app),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.checkout({ ...dto, cancelUrl: 'https://evil.test/no' }, app),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('an app with no registered callback URLs cannot mint redirects at all', async () => {
    const svc = makeSvc(makePrisma(), fakeStripe());
    await expect(svc.checkout(dto, { ...app, callbackUrls: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400s when the app has no price configured', async () => {
    const svc = makeSvc(makePrisma(), fakeStripe());
    await expect(svc.checkout(dto, { ...app, stripePriceId: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates and stores a customer when the tenant has none', async () => {
    const stripe = fakeStripe();
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ ...baseTenant, stripeCustomerId: null });
    await makeSvc(prisma, stripe).checkout(dto, app);
    expect(stripe.customers.create).toHaveBeenCalled();
    expect(prisma.tenant.update.mock.calls[0][0].data.stripeCustomerId).toBe('cus_new');
  });

  it('reports billing unconfigured when no key and no client are present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new BillingService(makePrisma() as any, audit as any);
    await expect(svc.checkout(dto, app)).rejects.toBeInstanceOf(ServiceUnavailableException);
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
