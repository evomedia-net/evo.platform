import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { config } from '../config';
import { EmailService } from '../email/email.service';

export type StripeHealthState = 'ok' | 'stripe_down' | 'network_down' | 'unconfigured';

export interface StripeHealth {
  state: StripeHealthState;
  /** What Stripe's own status page reports, when we could reach it. */
  stripeStatusIndicator: string | null;
  stripeStatusUrl: string;
  checkedAt: string;
  detail: string;
}

const STRIPE_STATUS_API = 'https://status.stripe.com/api/v2/status.json';
export const STRIPE_STATUS_PAGE = 'https://status.stripe.com/';

/**
 * Answers one question two ways: can we bill, and if not, whose fault is it.
 *
 * The probe order is deliberate. A cheap authenticated Stripe API call runs
 * first — if it succeeds, everything downstream may trust Stripe this cycle.
 * If it fails, the question becomes "Stripe, or us?", and Stripe's public
 * status page is the arbiter: reaching it proves our egress works, so the
 * failure is on Stripe's side (their status indicator is attached when they
 * admit it); failing to reach both means the problem is on our side, and
 * pointing an operator at status.stripe.com would misdirect them.
 *
 * Transitions — not states — are emailed, high importance. A poller that
 * mails every failing cycle trains the operator to filter the address; one
 * that mails only ok→down and down→ok is read. In-memory, so a restart
 * re-announces at most once.
 */
@Injectable()
export class StripeHealthService {
  private readonly log = new Logger(StripeHealthService.name);
  private readonly stripe: Stripe | null;
  private lastState: StripeHealthState | null = null;

  constructor(
    private email: EmailService,
    stripeClient?: Stripe,
  ) {
    this.stripe =
      stripeClient ?? (config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null);
  }

  async check(): Promise<StripeHealth> {
    const checkedAt = new Date().toISOString();
    let health: StripeHealth;

    if (!this.stripe) {
      health = {
        state: 'unconfigured',
        stripeStatusIndicator: null,
        stripeStatusUrl: STRIPE_STATUS_PAGE,
        checkedAt,
        detail: 'STRIPE_SECRET_KEY is not set.',
      };
    } else {
      health = await this.probe(checkedAt);
    }

    await this.announceTransition(health);
    return health;
  }

  private async probe(checkedAt: string): Promise<StripeHealth> {
    try {
      // Balance is the cheapest authenticated call: metadata only, no list,
      // no side effects, and it exercises auth — a revoked key fails here
      // rather than surfacing as a mystery further down.
      await this.stripe!.balance.retrieve();
      return {
        state: 'ok',
        stripeStatusIndicator: null,
        stripeStatusUrl: STRIPE_STATUS_PAGE,
        checkedAt,
        detail: 'Stripe API reachable.',
      };
    } catch (apiErr) {
      const indicator = await this.statusPageIndicator();
      if (indicator !== null) {
        return {
          state: 'stripe_down',
          stripeStatusIndicator: indicator,
          stripeStatusUrl: STRIPE_STATUS_PAGE,
          checkedAt,
          detail:
            `Stripe API unreachable but status.stripe.com responds — the ` +
            `problem is on Stripe's side (indicator: ${indicator}). ` +
            `API error: ${(apiErr as Error).message?.slice(0, 200)}`,
        };
      }
      return {
        state: 'network_down',
        stripeStatusIndicator: null,
        stripeStatusUrl: STRIPE_STATUS_PAGE,
        checkedAt,
        detail:
          'Neither the Stripe API nor status.stripe.com is reachable — the ' +
          'problem is most likely on our side (network/DNS/egress), not Stripe.',
      };
    }
  }

  /** Statuspage indicator ("none", "minor", "major", "critical"), or null when
   *  the status page itself cannot be reached. */
  private async statusPageIndicator(): Promise<string | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(STRIPE_STATUS_API, { signal: ctrl.signal });
        if (!res.ok) return null;
        const body = (await res.json()) as { status?: { indicator?: string } };
        return body.status?.indicator ?? 'unknown';
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }

  private async announceTransition(health: StripeHealth): Promise<void> {
    const prev = this.lastState;
    this.lastState = health.state;
    // First observation, no change, or nothing configured to say: stay quiet.
    if (prev === null || prev === health.state) return;
    if (!config.alerts.email) return;

    const wentDown = health.state !== 'ok';
    const subject = wentDown
      ? `[URGENT] Stripe connectivity lost (${health.state})`
      : '[resolved] Stripe connectivity restored';
    try {
      await this.email.send({
        to: config.alerts.email,
        subject,
        text:
          `${health.detail}\n\n` +
          `State: ${prev} -> ${health.state}\n` +
          `Checked: ${health.checkedAt}\n` +
          `Stripe status page: ${STRIPE_STATUS_PAGE}\n\n` +
          (wentDown
            ? 'Billing checkout and revenue figures are affected until this clears. ' +
              'Cached revenue figures remain visible, marked with their fetch time.'
            : 'Normal service. Figures refresh on next load.'),
      });
    } catch (err) {
      // The alert failing must not take the health check down with it —
      // and if SMTP is down for the same network reason, this is expected.
      this.log.error(`Stripe health alert email failed: ${(err as Error).message}`);
    }
  }
}
