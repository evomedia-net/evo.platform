// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { config } from '../config';

export interface AppReadiness {
  clientId: string;
  name: string;
  /** Prices registered in the mode this deployment is running in. */
  sellableHere: number;
  /** Registered, but minted by the OTHER mode — invisible to customers. */
  strandedOtherMode: number;
  tiers: string[];
}

export interface BillingReadiness {
  mode: 'test' | 'live' | 'unset';
  secretKeySet: boolean;
  webhookSecretSet: boolean;
  apps: AppReadiness[];
  /** Empty means ready. Each entry is a sentence an operator can act on. */
  problems: string[];
}

/**
 * "Could this deployment take a real payment right now, and if not, what is
 * missing." Configuration correctness — distinct from StripeHealthService,
 * which answers whether Stripe is reachable and whose fault an outage is.
 *
 * It exists because going live is a sequence, not a switch: keys change, then
 * every price is re-registered in the new mode, and in between the deployment
 * is in a state where checkout is broken in a way nothing surfaces. evo.ehs
 * learned this first and checks its price catalogue at startup
 * (services/plans.py validate_configured_prices); this is the platform's
 * equivalent, on demand rather than at boot because the platform's prices live
 * in the database and change without a restart.
 */
@Injectable()
export class BillingReadinessService {
  constructor(private prisma: PrismaService) {}

  async check(): Promise<BillingReadiness> {
    const mode = config.stripe.mode;
    const secretKeySet = Boolean((config.stripe.secretKey ?? '').trim());
    const webhookSecretSet = Boolean((config.stripe.webhookSecret ?? '').trim());
    const problems: string[] = [];

    if (!secretKeySet) {
      problems.push('STRIPE_SECRET_KEY is not set — every billing route answers 503.');
    } else if (mode === 'unset') {
      problems.push(
        'STRIPE_SECRET_KEY is set but is not a recognised secret key ' +
          '(expected sk_test_/sk_live_/rk_test_/rk_live_). A publishable key will not work.',
      );
    }
    if (!webhookSecretSet) {
      problems.push(
        'STRIPE_WEBHOOK_SECRET is not set — Stripe events are rejected, so a ' +
          'subscription would be paid for and never grant access.',
      );
    }

    const apps = await this.prisma.app.findMany({
      where: { deletedAt: null },
      select: {
        clientId: true,
        name: true,
        prices: { select: { tier: true, livemode: true, sellable: true } },
      },
      orderBy: { name: 'asc' },
    });

    const wantLive = mode === 'live';
    const rows: AppReadiness[] = apps.map((app) => {
      const here = app.prices.filter((p) => mode === 'unset' || p.livemode === wantLive);
      const stranded = mode === 'unset' ? [] : app.prices.filter((p) => p.livemode !== wantLive);
      return {
        clientId: app.clientId,
        name: app.name,
        sellableHere: here.filter((p) => p.sellable).length,
        strandedOtherMode: stranded.length,
        tiers: [...new Set(here.filter((p) => p.sellable).map((p) => p.tier))].sort(),
      };
    });

    for (const app of rows) {
      // An app with no prices at all may simply not be sold — that is a
      // decision, not a fault, so it is only worth saying when the app has
      // prices that this mode cannot see.
      if (app.sellableHere === 0 && app.strandedOtherMode > 0) {
        problems.push(
          `${app.name} has ${app.strandedOtherMode} price(s) registered, but all of them ` +
            `belong to ${wantLive ? 'test' : 'live'} mode — it cannot be sold under the ` +
            `current ${mode} keys until its ${mode} prices are registered.`,
        );
      } else if (app.strandedOtherMode > 0) {
        problems.push(
          `${app.name} has ${app.strandedOtherMode} price(s) from the other Stripe mode. ` +
            'Harmless (they are never offered), but worth removing once the go-live is done.',
        );
      }
    }

    return { mode, secretKeySet, webhookSecretSet, apps: rows, problems };
  }
}
