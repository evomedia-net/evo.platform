// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Going live is a sequence, not a switch: the keys change, then every price is
 * re-registered in the new mode. Between those two steps checkout is broken in
 * a way nothing surfaces — this is what surfaces it.
 */
import { BillingReadinessService } from './billing-readiness.service';
import { config } from '../config';

const APPS = [
  {
    clientId: 'c_shop',
    name: 'Shop',
    prices: [
      { tier: 'pro', livemode: false, sellable: true, stripeProductId: 'prod_pro' },
      { tier: 'basic', livemode: false, sellable: true, stripeProductId: 'prod_basic' },
    ],
  },
];

function makeSvc(apps: unknown = APPS) {
  const prisma = { app: { findMany: jest.fn().mockResolvedValue(apps) } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { svc: new BillingReadinessService(prisma as any), prisma };
}

const stripe = config.stripe as { mode: string; secretKey?: string; webhookSecret?: string };
const original = { ...stripe };

function setEnv(mode: string, secretKey = 'sk_x', webhookSecret = 'whsec_x') {
  stripe.mode = mode;
  stripe.secretKey = secretKey;
  stripe.webhookSecret = webhookSecret;
}

afterEach(() => Object.assign(stripe, original));

describe('BillingReadinessService', () => {
  it('is ready when keys are set and every price matches the mode', async () => {
    setEnv('test');
    const { svc } = makeSvc();
    const out = await svc.check();
    expect(out.problems).toEqual([]);
    expect(out.mode).toBe('test');
    expect(out.apps[0]).toMatchObject({ sellableHere: 2, strandedOtherMode: 0 });
    expect(out.apps[0].tiers).toEqual(['basic', 'pro']);
  });

  // The go-live failure this exists to catch: keys flipped, prices not yet
  // re-registered, so the app silently cannot be sold.
  it('says an app cannot be sold when all its prices are from the other mode', async () => {
    setEnv('live');
    const { svc } = makeSvc();
    const out = await svc.check();
    expect(out.apps[0].sellableHere).toBe(0);
    expect(out.apps[0].strandedOtherMode).toBe(2);
    expect(out.problems.join(' ')).toMatch(/Shop.*cannot be sold.*live/s);
  });

  it('mentions leftovers from the other mode without calling them a blocker', async () => {
    setEnv('live');
    const { svc } = makeSvc([
      {
        clientId: 'c_shop',
        name: 'Shop',
        prices: [
          { tier: 'pro', livemode: true, sellable: true, stripeProductId: 'prod_pro' },
          { tier: 'pro', livemode: false, sellable: true, stripeProductId: 'prod_pro_t' },
        ],
      },
    ]);
    const out = await svc.check();
    expect(out.apps[0].sellableHere).toBe(1);
    expect(out.problems.join(' ')).toMatch(/Harmless/);
  });

  it('reports a missing key, and a missing webhook secret separately', async () => {
    setEnv('unset', '', '');
    const { svc } = makeSvc();
    const out = await svc.check();
    const joined = out.problems.join(' ');
    expect(joined).toMatch(/STRIPE_SECRET_KEY is not set/);
    expect(joined).toMatch(/STRIPE_WEBHOOK_SECRET is not set/);
  });

  // A publishable key is a classic paste error and produces a key that is set
  // but unusable, which "not set" would not describe.
  it('distinguishes an unrecognised key from a missing one', async () => {
    setEnv('unset', 'pk_test_abc');
    const { svc } = makeSvc();
    const out = await svc.check();
    expect(out.problems.join(' ')).toMatch(/not a recognised secret key/);
  });

  // An app nobody sells is a decision, not a fault.
  it('does not complain about an app with no prices at all', async () => {
    setEnv('test');
    const { svc } = makeSvc([{ clientId: 'c_free', name: 'Free', prices: [] }]);
    const out = await svc.check();
    expect(out.problems).toEqual([]);
  });

  // The production failure this missed entirely (#322): keys and mode both
  // correct, every price registered — and the amounts a placeholder, because
  // the rows predate the key. "No problems" was the wrong answer.
  it('reports a price whose amount was never read from Stripe', async () => {
    setEnv('test');
    const { svc } = makeSvc([
      {
        clientId: 'c_dm',
        name: 'docketmail',
        prices: [{ tier: 'standard', livemode: false, sellable: true, stripeProductId: '' }],
      },
    ]);
    const out = await svc.check();
    expect(out.apps[0].unverified).toBe(1);
    expect(out.problems.join(' ')).toMatch(/docketmail.*never read from Stripe.*Refresh/s);
  });

  // $0.00 is a legitimate price, so the amount can never be the test — only
  // the missing product id separates "free tier" from "never verified".
  it('does not flag a genuine free tier as unverified', async () => {
    setEnv('test');
    const { svc } = makeSvc([
      {
        clientId: 'c_free',
        name: 'Free',
        prices: [{ tier: 'free', livemode: false, sellable: true, stripeProductId: 'prod_free' }],
      },
    ]);
    const out = await svc.check();
    expect(out.apps[0].unverified).toBe(0);
    expect(out.problems).toEqual([]);
  });
});
