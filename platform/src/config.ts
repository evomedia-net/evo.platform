// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import 'dotenv/config';

const LOCAL_BASE_URL = 'http://localhost:8200';

/**
 * The base URL every emailed link is built from. Wrong here means verification,
 * reset and invite mail all point somewhere the recipient cannot reach — and
 * nothing else fails, so it stays invisible. Production ran for weeks emailing
 * localhost links because this quietly fell back to the dev default, so
 * production now refuses to start rather than send unusable mail.
 */
/**
 * How many proxy hops to believe in X-Forwarded-For.
 *
 * Every deployment of this platform runs behind a reverse proxy, so on is the
 * useful default. It was previously opt-in via TRUST_PROXY=1, which meant
 * production ran with it off — and the failure is silent in both places it
 * matters: `audit_events` recorded the proxy's container address for every
 * sign-in, and the throttler keyed every client to that same address, so the
 * whole estate shared one rate-limit bucket instead of one per visitor.
 *
 * Returns a hop count, never `true`. X-Forwarded-For is written by the client
 * and appended to by each proxy; trusting the whole chain lets anyone prepend a
 * forged address and choose what lands in the audit log. Trusting exactly one
 * hop means only the address our own proxy appended is believed.
 *
 * TRUST_PROXY overrides: "0" disables it (direct exposure, or local dev); any
 * positive integer sets a deeper chain. Anything unparseable is treated as 0 —
 * a bad value must not silently grant trust.
 */
export function resolveTrustProxy(env: NodeJS.ProcessEnv): number {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (raw === '') return env.NODE_ENV === 'production' ? 1 : 0;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : 0;
}

export function resolvePublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.PUBLIC_BASE_URL?.trim();
  const value = (raw || LOCAL_BASE_URL).replace(/\/+$/, '');
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(value);
  if (env.NODE_ENV === 'production' && isLocal) {
    throw new Error(
      `PUBLIC_BASE_URL is ${raw ? `set to ${value}` : 'not set'} in production. ` +
        'Every verification, reset and invite email would link there and be ' +
        'unreachable for the recipient. Set it to the public URL of this ' +
        'service (e.g. https://platform.example.com).',
    );
  }
  return value;
}

/** The dev-only default. Named so the guard below can recognise it. */
export const DEV_SECRET_KEY = 'dev-only-secret-change-me';

/**
 * The key behind every secret this platform stores at rest.
 *
 * It derives the AES-256-GCM key used by encryptSecret/decryptSecret - i.e.
 * every tenant's SMTP password - and the HMAC behind password-reset tokens.
 *
 * The failure mode is why this is guarded rather than merely documented:
 * unlike PUBLIC_BASE_URL, a wrong value here breaks nothing visible. Mail
 * still sends, resets still work, and the only symptom appears the day
 * someone reads a backup. On top of that, this repository is going public,
 * which turns the dev default into a globally known constant - any
 * deployment that forgot SECRET_KEY would have every stored SMTP credential
 * encrypted under a key printed in its own source tree.
 *
 * So production refuses to start on the default or on anything too short to
 * be a real key, the same way it already refuses to email localhost links.
 */
export function resolveSecretKey(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SECRET_KEY?.trim();
  const value = raw || DEV_SECRET_KEY;
  if (env.NODE_ENV === 'production') {
    if (value === DEV_SECRET_KEY) {
      throw new Error(
        `SECRET_KEY is ${raw ? 'set to the development default' : 'not set'} in production. ` +
          'It encrypts every stored SMTP password and signs password-reset ' +
          'tokens, and this default is published in the public repository. ' +
          'Set it to a long random value (e.g. openssl rand -base64 48). ' +
          'Changing it later makes existing stored secrets undecryptable, so ' +
          'set it once, before first use, and keep it backed up.',
      );
    }
    if (value.length < 32) {
      throw new Error(
        `SECRET_KEY is ${value.length} characters; production requires at least 32. ` +
          'It encrypts every stored SMTP password and signs password-reset tokens. ' +
          'Generate one with: openssl rand -base64 48',
      );
    }
  }
  return value;
}

/** Stripe keys carry their mode in the prefix; read it there rather than
 *  asking the operator to state it twice and risk the two disagreeing. */
export function stripeMode(key: string | undefined): 'test' | 'live' | 'unset' {
  const k = (key ?? '').trim();
  if (k.startsWith('sk_test_') || k.startsWith('rk_test_')) return 'test';
  if (k.startsWith('sk_live_') || k.startsWith('rk_live_')) return 'live';
  return 'unset';
}

export const config = {
  port: Number(process.env.PORT ?? 8200),
  /**
   * Who this installation belongs to. It appears in the footer of every
   * platform email, so a self-hosted instance can say its own name instead of
   * ours - the same need #91 raised, met as deployment config rather than a
   * runtime record, because it changes when an installation is set up and
   * never afterwards. Platform-level only: products are named per app by
   * App.displayName, and neither is per-tenant.
   */
  brand: {
    company: process.env.BRAND_COMPANY ?? 'Evomedia.net LLC',
    /** Platform's own display name, for mail it sends about itself. */
    platformName: process.env.BRAND_PLATFORM_NAME ?? 'evo.platform',
  },
  /** Public URL of this service — used in email links (verify, reset). */
  publicBaseUrl: resolvePublicBaseUrl(),
  signup: {
    /** closed (default) | invite (platform-admin-issued links) | open */
    mode: (process.env.SIGNUP_MODE ?? 'closed') as 'closed' | 'invite' | 'open',
    /** Days of app trial a self-service signup starts with. */
    trialDays: Number(process.env.SIGNUP_TRIAL_DAYS ?? 14),
  },
  rateLimit: {
    /** Per-IP requests per minute, all routes (webhook + JWKS exempt). */
    defaultPerMin: Number(process.env.RATE_LIMIT_PER_MIN ?? 100),
    /** Per-IP requests per minute on the public auth surface. */
    authPerMin: Number(process.env.RATE_LIMIT_AUTH_PER_MIN ?? 30),
  },
  /**
   * Whether to believe X-Forwarded-For, i.e. how many proxy hops to trust.
   *
   * Every deployment of this platform runs behind a reverse proxy, so the
   * useful default is on. It used to be opt-in via TRUST_PROXY=1, which meant
   * production ran with it off - and the failure is silent in both the places
   * it matters: audit_events recorded the proxy's container address for every
   * sign-in, and the throttler keyed every client to that same address, so the
   * whole estate shared one rate-limit bucket instead of one per visitor.
   *
   * Deliberately a hop count, never `true`. X-Forwarded-For is written by the
   * client and appended to by each proxy; trusting the whole chain lets anyone
   * prepend a forged address and choose what lands in the audit log. Trusting
   * exactly one hop means only the address our own proxy appended is believed.
   *
   * TRUST_PROXY overrides: "0" disables it (direct exposure, or local dev),
   * any positive integer sets a different hop count for deeper chains.
   */
  trustProxy: resolveTrustProxy(process.env),
  bootstrapAdmin: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  },
  secretKey: resolveSecretKey(),
  keysDir: process.env.KEYS_DIR ?? './keys',
  jwtIssuer: process.env.JWT_ISSUER ?? 'evoplatform',
  accessTtlSec: Number(process.env.ACCESS_TOKEN_TTL_SEC ?? 900),
  refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  retention: {
    /** Days to keep audit events; 0 = keep forever. */
    auditDays: Number(process.env.RETENTION_AUDIT_DAYS ?? 0),
    /** Days to keep revoked/expired refresh tokens. */
    tokenDays: Number(process.env.RETENTION_TOKEN_DAYS ?? 30),
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    graceDays: Number(process.env.BILLING_GRACE_DAYS ?? 7),
    /**
     * "test" | "live" | "unset", read from the key's own prefix.
     *
     * Nothing configures this separately, so the mode and the key can never
     * disagree — the failure that would matter here is a deployment that
     * believes it is in test while charging real cards. Same approach evo.ehs
     * takes (services/plans.py stripe_mode).
     */
    mode: stripeMode(process.env.STRIPE_SECRET_KEY),
  },
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME ?? 'evo.platform',
    // Registrable base domains allowed for passkey ceremonies (loopback is
    // always allowed for dev). One passkey then works from the apex and any
    // subdomain, mirroring subdomain-per-tenant routing.
    baseDomains: (process.env.WEBAUTHN_BASE_DOMAINS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    challengeTtlSec: Number(process.env.WEBAUTHN_CHALLENGE_TTL_SEC ?? 300),
  },
  alerts: {
    /** Operational alerts (Stripe connectivity, billing failures). Unset =
     *  no emails; the health endpoint still reports. */
    email: process.env.ALERT_EMAIL,
  },
  smtpFallback: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    username: process.env.SMTP_USERNAME,
    password: process.env.SMTP_PASSWORD,
    fromAddress: process.env.SMTP_FROM ?? 'noreply@example.com',
  },
};
