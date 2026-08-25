// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import Stripe from 'stripe';
import { RevenueService } from './revenue.service';

/**
 * The properties that are silent if wrong: a failed pull must serve the cache
 * *marked stale* rather than a blank or a fresh-looking copy; currencies must
 * never be summed together; refunds must subtract in the right currency; and
 * "canceled during trial" must mean during, not after.
 */

function asList<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function sub(over: Partial<Record<string, unknown>> = {}, price: Record<string, unknown> = {}) {
  return {
    status: 'active',
    trial_end: null,
    canceled_at: null,
    items: {
      data: [
        {
          price: {
            id: 'price_basic_m',
            nickname: 'Basic',
            recurring: { interval: 'month' },
            ...price,
          },
        },
      ],
    },
    ...over,
  };
}

function invoice(cents: number, currency = 'usd', paidAtSec = 1_754_000_000, tax: number | null = null) {
  return {
    currency,
    amount_paid: cents,
    tax,
    created: paidAtSec,
    status_transitions: { paid_at: paidAtSec },
  };
}

function makeStripe({
  subs = [] as unknown[],
  invoices = [] as unknown[],
  refunds = [] as unknown[],
  failPull = false,
} = {}) {
  return {
    subscriptions: {
      list: failPull
        ? jest.fn(() => {
            throw new Error('api down');
          })
        : jest.fn(() => asList(subs)),
    },
    invoices: { list: jest.fn(() => asList(invoices)) },
    refunds: { list: jest.fn(() => asList(refunds)) },
  } as unknown as Stripe;
}

// What each price sells, as the registry now records it: price -> app + tier.
function makePrisma(
  prices: { name: string; stripePriceId: string; tier?: string }[] = [],
  tenants: unknown[] = [],
) {
  return {
    tenant: { findMany: jest.fn().mockResolvedValue(tenants) },
    appPrice: {
      findMany: jest.fn().mockResolvedValue(
        prices.map((p) => ({
          stripePriceId: p.stripePriceId,
          tier: p.tier ?? 'standard',
          app: { name: p.name },
        })),
      ),
    },
  };
}

function makeHealth(state = 'ok') {
  return { check: jest.fn().mockResolvedValue({ state, stripeStatusUrl: 'https://status.stripe.com/' }) };
}

function service(
  stripe: Stripe,
  prices: { name: string; stripePriceId: string; tier?: string }[] = [],
  health = makeHealth(),
  tenants: unknown[] = [],
) {
  return new RevenueService(makePrisma(prices, tenants) as never, health as never, stripe);
}

describe('RevenueService', () => {
  it('counts plans by app, plan and interval, and totals', async () => {
    const svc = service(
      makeStripe({
        subs: [
          sub(),
          sub({}, { id: 'price_pro_y', nickname: 'Pro', recurring: { interval: 'year' } }),
          sub({ status: 'past_due' }),
        ],
      }),
      [{ name: 'evo.ehs', stripePriceId: 'price_basic_m', tier: 'basic' }],
    );
    const report = await svc.report();
    const s = report.snapshot!.subscriptions;
    expect(s.total).toBe(3);
    expect(s.byStatus).toEqual({ active: 2, past_due: 1 });
    // The registered tier names the plan, not the price's Stripe nickname:
    // the tier is what AppTenant.plan is stamped with, so revenue and
    // entitlements describe a customer the same way.
    expect(s.byPlan['evo.ehs|basic|month']).toBe(2);
    // An unregistered price still counts; it just cannot name a tier, so it
    // falls back to the nickname rather than vanishing from the report.
    expect(s.byPlan['unmapped|Pro|year']).toBe(1);
    expect(s.byInterval).toEqual({ month: 2, year: 1 });
  });

  it('canceled during trial means during, not after', async () => {
    const svc = service(
      makeStripe({
        subs: [
          sub({ status: 'canceled', trial_end: 1000, canceled_at: 999 }), // drop-out
          sub({ status: 'canceled', trial_end: 1000, canceled_at: 1000 }), // boundary: drop-out
          sub({ status: 'canceled', trial_end: 1000, canceled_at: 5000 }), // paid a while, then left
          sub({ status: 'canceled', trial_end: null, canceled_at: 5000 }), // never trialed
        ],
      }),
    );
    const report = await svc.report();
    expect(report.snapshot!.subscriptions.canceledDuringTrial).toBe(2);
  });

  it('never sums across currencies, and nets refunds per currency', async () => {
    const svc = service(
      makeStripe({
        invoices: [invoice(10_000, 'usd'), invoice(5_000, 'eur'), invoice(2_000, 'usd', 1_756_700_000)],
        refunds: [
          { status: 'succeeded', amount: 1_500, currency: 'usd', created: 1_756_700_100 },
          { status: 'failed', amount: 9_999, currency: 'usd', created: 1_756_700_100 },
          { status: 'succeeded', amount: 700, currency: 'gbp', created: 1_756_700_100 },
        ],
      }),
    );
    const b = (await svc.report()).snapshot!.billed;
    expect(b.grossYtd).toEqual({ usd: 12_000, eur: 5_000 });
    expect(b.refundsYtd).toEqual({ usd: 1_500, gbp: 700 });
    // A refund in a currency with no gross still shows, negative — hiding it
    // would overstate net.
    expect(b.netYtd).toEqual({ usd: 10_500, eur: 5_000, gbp: -700 });
  });

  it('tax is recorded as Stripe reported it, never computed', async () => {
    const svc = service(makeStripe({ invoices: [invoice(10_000, 'usd', 1_754_000_000, 825)] }));
    const b = (await svc.report()).snapshot!.billed;
    expect(b.taxYtd).toEqual({ usd: 825 });
    expect(b.refundTreatment).toBe('refund-month');
  });

  it('a failed pull serves the last good snapshot, marked stale', async () => {
    const good = makeStripe({ subs: [sub()] });
    const prisma = makePrisma();
    const health = makeHealth();
    const svc = new RevenueService(prisma as never, health as never, good);
    const first = await svc.report();
    expect(first.stale).toBe(false);

    // Same service instance, Stripe now failing.
    (good.subscriptions.list as jest.Mock).mockImplementation(() => {
      throw new Error('api down');
    });
    const second = await svc.report();
    expect(second.stale).toBe(true);
    expect(second.snapshot).toBe(first.snapshot); // yesterday's figures, labelled
    expect(second.health).toBeDefined(); // and whose fault it is
  });

  it('with no cache and no Stripe, the report says stale with nothing to show', async () => {
    const svc = service(makeStripe({ failPull: true }));
    const report = await svc.report();
    expect(report.stale).toBe(true);
    expect(report.snapshot).toBeNull();
  });

  // Quoting is not a defence against formula injection: Excel and LibreOffice
  // strip the quotes and evaluate a leading = anyway.
  //
  // The by_plan key is built as `${app}|${plan}|${interval}`, so the cell
  // always starts with the APP name - a nickname can never begin it. That
  // makes the app name the realistic trigger, and it is set by a platform
  // admin, so this is defence in depth rather than an attacker path. The
  // exposed one is the audit export, where the `action` column IS the whole
  // cell and any client-credentialed app writes it via POST /events.
  it('csv neutralises a cell that starts with a formula character', async () => {
    const svc = service(makeStripe({ subs: [sub({}, { id: 'price_x' })] }), [
      { name: '=HYPERLINK("https://evil.test","open")', stripePriceId: 'price_x' },
    ]);
    const csv = svc.toCsv(await svc.report());
    // Apostrophe-prefixed so a spreadsheet treats it as text, inside the
    // quoting the commas already required.
    expect(csv).toContain(`"'=HYPERLINK`);
  });

  it('csv flattens without corrupting keys that carry commas or quotes', async () => {
    const svc = service(
      makeStripe({
        subs: [sub({}, { nickname: 'Basic, "Legacy"', id: 'price_x' })],
      }),
    );
    const csv = svc.toCsv(await svc.report());
    expect(csv.split('\n')[0]).toBe('section,key,currency,value');
    expect(csv).toContain('"unmapped|Basic, ""Legacy""|month"');
  });
});


// ── the same money, per tenant ───────────────────────────────────────────
//
// "Who is paying us" is a different question from "what are they on", and the
// answer has to reconcile with the dashboard totals — which it can only do if
// both come from ONE pull of a ledger that moves.

describe('RevenueService.byTenant', () => {
  const TENANT = {
    id: 't1',
    slug: 'acme',
    name: 'Acme',
    stripeCustomerId: 'cus_acme',
    appTenants: [{ plan: 'pro', status: 'ACTIVE', app: { name: 'Shop' } }],
  };

  it('attributes paid invoices to the tenant that owns the customer', async () => {
    const stripe = makeStripe({
      invoices: [
        { currency: 'usd', amount_paid: 5000, created: 1, customer: 'cus_acme', status_transitions: { paid_at: 1 } },
      ],
    });
    const out = await service(stripe, [], makeHealth(), [TENANT]).byTenant();
    expect(out.tenants).toHaveLength(1);
    expect(out.tenants[0]).toMatchObject({ tenantId: 't1', name: 'Acme', slug: 'acme' });
    expect(out.tenants[0].grossYtd).toEqual({ usd: 5000 });
    expect(out.tenants[0].netYtd).toEqual({ usd: 5000 });
    expect(out.tenants[0].subscriptions).toEqual([{ app: 'Shop', plan: 'pro', status: 'ACTIVE' }]);
  });

  it('subtracts refunds from that tenant, not from the pool', async () => {
    const stripe = makeStripe({
      invoices: [
        { currency: 'usd', amount_paid: 5000, created: 1, customer: 'cus_acme', status_transitions: { paid_at: 1 } },
      ],
      refunds: [
        { status: 'succeeded', currency: 'usd', amount: 1500, created: 2, charge: { customer: 'cus_acme' } },
      ],
    });
    const out = await service(stripe, [], makeHealth(), [TENANT]).byTenant();
    expect(out.tenants[0].refundsYtd).toEqual({ usd: 1500 });
    expect(out.tenants[0].netYtd).toEqual({ usd: 3500 });
  });

  // Money that cannot be attributed is the operator's problem to see, not
  // ours to hide by dropping the row.
  it('shows a paying customer with no matching tenant rather than dropping it', async () => {
    const stripe = makeStripe({
      invoices: [
        { currency: 'usd', amount_paid: 900, created: 1, customer: 'cus_ghost', status_transitions: { paid_at: 1 } },
      ],
    });
    const out = await service(stripe, [], makeHealth(), []).byTenant();
    expect(out.tenants).toHaveLength(1);
    expect(out.tenants[0].tenantId).toBe('');
    expect(out.tenants[0].name).toMatch(/no tenant for cus_ghost/);
    expect(out.tenants[0].grossYtd).toEqual({ usd: 900 });
  });

  it('puts the biggest payer first', async () => {
    const stripe = makeStripe({
      invoices: [
        { currency: 'usd', amount_paid: 100, created: 1, customer: 'cus_small', status_transitions: { paid_at: 1 } },
        { currency: 'usd', amount_paid: 9000, created: 1, customer: 'cus_acme', status_transitions: { paid_at: 1 } },
      ],
    });
    const out = await service(stripe, [], makeHealth(), [TENANT]).byTenant();
    expect(out.tenants[0].stripeCustomerId).toBe('cus_acme');
  });

  // An invoice with no customer still counts in the system totals, so the two
  // views legitimately differ — better than inventing an owner for it.
  it('leaves an unattributable invoice out of the per-tenant view', async () => {
    const stripe = makeStripe({
      invoices: [{ currency: 'usd', amount_paid: 700, created: 1, status_transitions: { paid_at: 1 } }],
    });
    const out = await service(stripe, [], makeHealth(), []).byTenant();
    expect(out.tenants).toEqual([]);
  });
});
