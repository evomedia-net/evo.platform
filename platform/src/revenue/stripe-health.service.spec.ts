// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import Stripe from 'stripe';
import { StripeHealthService } from './stripe-health.service';
import { config } from '../config';

/**
 * The classification is the feature: "Stripe is down" and "we are down" send
 * an operator to entirely different places, and both failure states look
 * identical from a blank dashboard.
 */

function makeStripe(balanceOk: boolean) {
  return {
    balance: {
      retrieve: balanceOk
        ? jest.fn().mockResolvedValue({ available: [] })
        : jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT')),
    },
  } as unknown as Stripe;
}

function makeEmail() {
  return { send: jest.fn().mockResolvedValue({ ok: true }) };
}

function mockStatusPage(reachable: boolean, indicator = 'major') {
  global.fetch = (reachable
    ? jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: { indicator } }),
      })
    : jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))) as unknown as typeof fetch;
}

describe('StripeHealthService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports ok when the API answers', async () => {
    const svc = new StripeHealthService(makeEmail() as never, makeStripe(true));
    expect((await svc.check()).state).toBe('ok');
  });

  it('blames Stripe when the API fails but their status page answers', async () => {
    mockStatusPage(true, 'major');
    const svc = new StripeHealthService(makeEmail() as never, makeStripe(false));
    const health = await svc.check();
    expect(health.state).toBe('stripe_down');
    expect(health.stripeStatusIndicator).toBe('major');
    expect(health.stripeStatusUrl).toBe('https://status.stripe.com/');
  });

  it('blames our side when nothing Stripe-shaped is reachable', async () => {
    mockStatusPage(false);
    const svc = new StripeHealthService(makeEmail() as never, makeStripe(false));
    const health = await svc.check();
    expect(health.state).toBe('network_down');
    // Pointing at status.stripe.com here would misdirect the operator.
    expect(health.detail).toContain('our side');
  });

  it('says unconfigured rather than pretending an outage', async () => {
    const svc = new StripeHealthService(makeEmail() as never, undefined);
    expect((await svc.check()).state).toBe('unconfigured');
  });

  describe('alert emails', () => {
    const alertTo = 'alerts@evomedia.example';
    beforeEach(() => {
      (config.alerts as { email?: string }).email = alertTo;
    });
    afterEach(() => {
      (config.alerts as { email?: string }).email = undefined;
    });

    it('mails the transition to down, once, not every failing poll', async () => {
      mockStatusPage(true);
      const email = makeEmail();
      const svc = new StripeHealthService(email as never, makeStripe(false));
      await svc.check(); // first observation — nothing to compare against
      expect(email.send).not.toHaveBeenCalled();

      // Flip ok -> down: build a service that first succeeds, then fails.
      const flappy = {
        balance: {
          retrieve: jest
            .fn()
            .mockResolvedValueOnce({ available: [] })
            .mockRejectedValue(new Error('down')),
        },
      } as unknown as Stripe;
      const email2 = makeEmail();
      const svc2 = new StripeHealthService(email2 as never, flappy);
      await svc2.check(); // ok
      await svc2.check(); // ok -> stripe_down: mail
      await svc2.check(); // still down: silence
      expect(email2.send).toHaveBeenCalledTimes(1);
      const sent = email2.send.mock.calls[0][0];
      expect(sent.to).toBe(alertTo);
      expect(sent.subject).toContain('URGENT');
      expect(sent.text).toContain('status.stripe.com');
    });

    it('mails the recovery too', async () => {
      mockStatusPage(true);
      const recovering = {
        balance: {
          retrieve: jest
            .fn()
            .mockResolvedValueOnce({ available: [] })
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValue({ available: [] }),
        },
      } as unknown as Stripe;
      const email = makeEmail();
      const svc = new StripeHealthService(email as never, recovering);
      await svc.check(); // ok
      await svc.check(); // down: mail 1
      await svc.check(); // ok again: mail 2
      expect(email.send).toHaveBeenCalledTimes(2);
      expect(email.send.mock.calls[1][0].subject).toContain('restored');
    });

    it('a failing alert does not take the health check down with it', async () => {
      mockStatusPage(true);
      const email = { send: jest.fn().mockRejectedValue(new Error('SMTP also down')) };
      const flappy = {
        balance: {
          retrieve: jest
            .fn()
            .mockResolvedValueOnce({ available: [] })
            .mockRejectedValue(new Error('down')),
        },
      } as unknown as Stripe;
      const svc = new StripeHealthService(email as never, flappy);
      await svc.check();
      const health = await svc.check(); // transition; alert throws inside
      expect(health.state).toBe('stripe_down');
    });
  });
});
