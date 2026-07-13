import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
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

function makePrisma(tenant: Record<string, unknown> | null) {
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(tenant),
      findFirst: jest.fn().mockResolvedValue(tenant),
      update: jest.fn().mockResolvedValue(tenant),
    },
  };
}

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const baseTenant = {
  id: 't1',
  slug: 'acme',
  name: 'Acme',
  status: 'ACTIVE',
  stripeCustomerId: 'cus_1',
  graceUntil: null,
  deletedAt: null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any, stripe: any = realStripe) => new BillingService(prisma, audit as any, stripe);

beforeEach(() => jest.clearAllMocks());

describe('webhook signature verification', () => {
  it('accepts a validly signed event', () => {
    const svc = makeSvc(makePrisma(baseTenant));
    const { rawBody, signature } = signedEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    const event = svc.verifyAndParseEvent(rawBody, signature, WEBHOOK_SECRET);
    expect(event.type).toBe('invoice.paid');
  });

  it('rejects a tampered payload', () => {
    const svc = makeSvc(makePrisma(baseTenant));
    const { signature } = signedEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    expect(() =>
      svc.verifyAndParseEvent(Buffer.from('{"tampered":true}'), signature, WEBHOOK_SECRET),
    ).toThrow(BadRequestException);
  });

  it('rejects when the webhook secret is not configured', () => {
    const svc = makeSvc(makePrisma(baseTenant));
    const { rawBody, signature } = signedEvent({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
    expect(() => svc.verifyAndParseEvent(rawBody, signature, undefined)).toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('event handling', () => {
  it('payment_failed marks the tenant PAST_DUE with a ~7 day grace window', async () => {
    const prisma = makePrisma({ ...baseTenant });
    const svc = makeSvc(prisma);
    await svc.handleEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    } as unknown as Stripe.Event);
    const update = prisma.tenant.update.mock.calls[0][0].data;
    expect(update.status).toBe('PAST_DUE');
    const days = (update.graceUntil.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('a repeat payment failure keeps the original grace deadline', async () => {
    const existing = new Date('2026-07-20T00:00:00Z');
    const prisma = makePrisma({ ...baseTenant, status: 'PAST_DUE', graceUntil: existing });
    const svc = makeSvc(prisma);
    await svc.handleEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    } as unknown as Stripe.Event);
    expect(prisma.tenant.update.mock.calls[0][0].data.graceUntil).toBe(existing);
  });

  it('invoice.paid lifts PAST_DUE back to ACTIVE and clears the grace window', async () => {
    const prisma = makePrisma({ ...baseTenant, status: 'PAST_DUE', graceUntil: new Date() });
    const svc = makeSvc(prisma);
    await svc.handleEvent({
      type: 'invoice.paid',
      data: { object: { customer: 'cus_1' } },
    } as unknown as Stripe.Event);
    expect(prisma.tenant.update.mock.calls[0][0].data).toEqual({
      status: 'ACTIVE',
      graceUntil: null,
    });
  });

  it('invoice.paid never un-suspends a manually suspended tenant', async () => {
    const prisma = makePrisma({ ...baseTenant, status: 'SUSPENDED' });
    const svc = makeSvc(prisma);
    const out = await svc.handleEvent({
      type: 'invoice.paid',
      data: { object: { customer: 'cus_1' } },
    } as unknown as Stripe.Event);
    expect(out.handled).toBe(true);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('subscription sync maps stripe statuses onto tenant statuses', async () => {
    for (const [stripeStatus, expected] of [
      ['active', 'ACTIVE'],
      ['trialing', 'ACTIVE'],
      ['past_due', 'PAST_DUE'],
      ['canceled', 'SUSPENDED'],
      ['unpaid', 'SUSPENDED'],
    ] as const) {
      const prisma = makePrisma({ ...baseTenant });
      const svc = makeSvc(prisma);
      await svc.handleEvent({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: stripeStatus } },
      } as unknown as Stripe.Event);
      expect(prisma.tenant.update.mock.calls[0][0].data.status).toBe(expected);
    }
  });

  it('ignores events for unknown customers', async () => {
    const prisma = makePrisma(null);
    const svc = makeSvc(prisma);
    const out = await svc.handleEvent({
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_unknown' } },
    } as unknown as Stripe.Event);
    expect(out.handled).toBe(false);
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
    priceId: 'price_1',
    successUrl: 'https://app.test/ok',
    cancelUrl: 'https://app.test/no',
  };

  it('reuses an existing Stripe customer', async () => {
    const stripe = fakeStripe();
    const svc = makeSvc(makePrisma({ ...baseTenant }), stripe);
    const out = await svc.checkout(dto);
    expect(out.url).toBe('https://stripe.test/c');
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create.mock.calls[0][0].customer).toBe('cus_1');
  });

  it('creates and stores a customer when the tenant has none', async () => {
    const stripe = fakeStripe();
    const prisma = makePrisma({ ...baseTenant, stripeCustomerId: null });
    const svc = makeSvc(prisma, stripe);
    await svc.checkout(dto);
    expect(stripe.customers.create).toHaveBeenCalled();
    expect(prisma.tenant.update.mock.calls[0][0].data.stripeCustomerId).toBe('cus_new');
  });

  it('reports billing unconfigured when no key and no client are present', async () => {
    const svc = new BillingService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makePrisma({ ...baseTenant }) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
    );
    await expect(svc.checkout(dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
