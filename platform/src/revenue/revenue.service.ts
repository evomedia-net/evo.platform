// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../core/prisma.service';
import { config } from '../config';
import { StripeHealth, StripeHealthService } from './stripe-health.service';

/**
 * Revenue figures, pulled from Stripe at read time — never computed and
 * stored here.
 *
 * Stripe is the system of record for money. A locally stored total is a
 * second version of the truth that can only ever disagree in one direction:
 * wrongly. Refunds and disputes restate the past, so a figure computed once
 * goes quietly stale; a figure pulled now is right now. In a dispute or an
 * audit, the defensible number is the processor's — which is also the
 * operator's liability shield: this module presents Stripe's numbers, it does
 * not author numbers of its own.
 *
 * The one concession is a last-good-snapshot cache, kept ONLY so an outage
 * shows yesterday's figures clearly labelled as such, instead of a blank
 * page. A cached figure is always delivered with `stale: true` and its fetch
 * time; it is never passed off as current.
 *
 * Everything is integer minor units, grouped by currency. Totals across
 * currencies are not additive and are never summed here.
 */

interface CurrencyAmounts {
  [currency: string]: number;
}

interface MonthlyAmounts {
  [month: string]: CurrencyAmounts; // "2026-08" -> { usd: 123400 }
}

export interface RevenueSnapshot {
  fetchedAt: string;
  yearStart: string;
  subscriptions: {
    total: number;
    byStatus: Record<string, number>;
    /** "<app name>|<plan nickname or price id>|<interval>" -> count */
    byPlan: Record<string, number>;
    byInterval: Record<string, number>;
    /** Canceled while still inside the trial window — the drop-outs. */
    canceledDuringTrial: number;
  };
  billed: {
    /** Paid invoice totals, gross, by month of payment. */
    grossByMonth: MonthlyAmounts;
    grossYtd: CurrencyAmounts;
    /** Tax portion of those invoices, as Stripe reported it. */
    taxYtd: CurrencyAmounts;
    /** Refunds in the month they were issued (not restated into the original
     *  invoice's month — the dashboard states this). */
    refundsByMonth: MonthlyAmounts;
    refundsYtd: CurrencyAmounts;
    netYtd: CurrencyAmounts;
    refundTreatment: 'refund-month';
  };
}

export interface RevenueReport {
  stale: boolean;
  health: StripeHealth;
  snapshot: RevenueSnapshot | null;
}

function addAmount(bucket: CurrencyAmounts, currency: string, cents: number) {
  bucket[currency] = (bucket[currency] ?? 0) + cents;
}

function addMonthly(bucket: MonthlyAmounts, at: Date, currency: string, cents: number) {
  const key = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  bucket[key] = bucket[key] ?? {};
  addAmount(bucket[key], currency, cents);
}

@Injectable()
export class RevenueService {
  private readonly log = new Logger(RevenueService.name);
  private readonly stripe: Stripe | null;
  private lastGood: RevenueSnapshot | null = null;

  constructor(
    private prisma: PrismaService,
    private health: StripeHealthService,
    // @Optional() is what makes the "?" real to Nest: without it, DI tries to
    // resolve a Stripe provider that is registered nowhere and the WHOLE APP
    // fails to boot — with green unit tests, because specs construct this
    // service by hand. Same pattern as BillingService.
    @Optional() stripeClient?: Stripe,
  ) {
    this.stripe =
      stripeClient ?? (config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null);
  }

  /** The dashboard's one call: figures if possible, cached figures clearly
   *  marked if not, and in either case who is at fault when Stripe is dark. */
  async report(): Promise<RevenueReport> {
    const health = await this.health.check();
    if (health.state === 'unconfigured') {
      throw new ServiceUnavailableException('Stripe is not configured on this deployment.');
    }
    try {
      const snapshot = await this.pull();
      this.lastGood = snapshot;
      return { stale: false, health, snapshot };
    } catch (err) {
      this.log.warn(`Revenue pull failed, serving cache: ${(err as Error).message}`);
      return { stale: true, health, snapshot: this.lastGood };
    }
  }

  private async pull(): Promise<RevenueSnapshot> {
    if (!this.stripe) throw new ServiceUnavailableException('Stripe not configured');
    const now = new Date();
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const since = Math.floor(yearStart.getTime() / 1000);

    // Price id -> app name, so plans are reported by the product an adopter
    // actually sells rather than an opaque price_… id.
    const apps = await this.prisma.app.findMany({
      where: { stripePriceId: { not: null } },
      select: { name: true, stripePriceId: true },
    });
    const appByPrice = new Map(apps.map((a) => [a.stripePriceId as string, a.name]));

    const byStatus: Record<string, number> = {};
    const byPlan: Record<string, number> = {};
    const byInterval: Record<string, number> = {};
    let total = 0;
    let canceledDuringTrial = 0;

    for await (const sub of this.stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      expand: ['data.items.data.price'],
    })) {
      total += 1;
      byStatus[sub.status] = (byStatus[sub.status] ?? 0) + 1;
      for (const item of sub.items.data) {
        const price = item.price;
        const interval = price.recurring?.interval ?? 'one-time';
        const app = appByPrice.get(price.id) ?? 'unmapped';
        const plan = price.nickname ?? price.id;
        byInterval[interval] = (byInterval[interval] ?? 0) + 1;
        byPlan[`${app}|${plan}|${interval}`] = (byPlan[`${app}|${plan}|${interval}`] ?? 0) + 1;
      }
      // Canceled at or before trial end = never converted. `canceled_at`
      // survives on the subscription; `trial_end` is the moment money would
      // first have moved.
      if (
        sub.status === 'canceled' &&
        sub.trial_end !== null &&
        sub.canceled_at !== null &&
        sub.canceled_at <= sub.trial_end
      ) {
        canceledDuringTrial += 1;
      }
    }

    const grossByMonth: MonthlyAmounts = {};
    const grossYtd: CurrencyAmounts = {};
    const taxYtd: CurrencyAmounts = {};
    for await (const invoice of this.stripe.invoices.list({
      status: 'paid',
      created: { gte: since },
      limit: 100,
    })) {
      const paidAt = new Date(
        ((invoice.status_transitions?.paid_at ?? invoice.created) as number) * 1000,
      );
      addMonthly(grossByMonth, paidAt, invoice.currency, invoice.amount_paid);
      addAmount(grossYtd, invoice.currency, invoice.amount_paid);
      // Whatever Stripe reported as tax — this module never computes a tax
      // figure of its own. Older API shapes call it `tax`.
      const tax = (invoice as unknown as { tax: number | null }).tax;
      if (tax) addAmount(taxYtd, invoice.currency, tax);
    }

    const refundsByMonth: MonthlyAmounts = {};
    const refundsYtd: CurrencyAmounts = {};
    for await (const refund of this.stripe.refunds.list({
      created: { gte: since },
      limit: 100,
    })) {
      if (refund.status !== 'succeeded') continue;
      addMonthly(refundsByMonth, new Date(refund.created * 1000), refund.currency, refund.amount);
      addAmount(refundsYtd, refund.currency, refund.amount);
    }

    const netYtd: CurrencyAmounts = {};
    for (const [ccy, cents] of Object.entries(grossYtd)) {
      netYtd[ccy] = cents - (refundsYtd[ccy] ?? 0);
    }
    for (const [ccy, cents] of Object.entries(refundsYtd)) {
      if (!(ccy in netYtd)) netYtd[ccy] = -cents;
    }

    return {
      fetchedAt: now.toISOString(),
      yearStart: yearStart.toISOString(),
      subscriptions: { total, byStatus, byPlan, byInterval, canceledDuringTrial },
      billed: {
        grossByMonth,
        grossYtd,
        taxYtd,
        refundsByMonth,
        refundsYtd,
        netYtd,
        refundTreatment: 'refund-month',
      },
    };
  }

  /** The same figures, flat, for a spreadsheet. */
  toCsv(report: RevenueReport): string {
    const lines: string[] = ['section,key,currency,value'];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const push = (section: string, key: string, currency: string, value: number | string) =>
      lines.push([esc(section), esc(key), esc(currency), String(value)].join(','));

    push('meta', 'stale', '', String(report.stale));
    push('meta', 'health', '', report.health.state);
    const s = report.snapshot;
    if (!s) return lines.join('\n') + '\n';
    push('meta', 'fetched_at', '', s.fetchedAt);
    push('subscriptions', 'total', '', s.subscriptions.total);
    push('subscriptions', 'canceled_during_trial', '', s.subscriptions.canceledDuringTrial);
    for (const [k, v] of Object.entries(s.subscriptions.byStatus))
      push('subscriptions.by_status', k, '', v);
    for (const [k, v] of Object.entries(s.subscriptions.byPlan))
      push('subscriptions.by_plan', k, '', v);
    for (const [k, v] of Object.entries(s.subscriptions.byInterval))
      push('subscriptions.by_interval', k, '', v);
    const monthly = (section: string, bucket: MonthlyAmounts) => {
      for (const [month, per] of Object.entries(bucket))
        for (const [ccy, cents] of Object.entries(per)) push(section, month, ccy, cents);
    };
    monthly('billed.gross_by_month', s.billed.grossByMonth);
    monthly('billed.refunds_by_month', s.billed.refundsByMonth);
    for (const [ccy, cents] of Object.entries(s.billed.grossYtd))
      push('billed.gross_ytd', 'ytd', ccy, cents);
    for (const [ccy, cents] of Object.entries(s.billed.taxYtd))
      push('billed.tax_ytd', 'ytd', ccy, cents);
    for (const [ccy, cents] of Object.entries(s.billed.refundsYtd))
      push('billed.refunds_ytd', 'ytd', ccy, cents);
    for (const [ccy, cents] of Object.entries(s.billed.netYtd))
      push('billed.net_ytd', 'ytd', ccy, cents);
    return lines.join('\n') + '\n';
  }
}
