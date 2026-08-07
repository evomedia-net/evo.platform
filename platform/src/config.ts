// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
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

export const config = {
  port: Number(process.env.PORT ?? 8200),
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
  /** Set behind a reverse proxy so throttling sees the real client IP. */
  trustProxy: process.env.TRUST_PROXY === '1',
  bootstrapAdmin: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  },
  secretKey: process.env.SECRET_KEY ?? 'dev-only-secret-change-me',
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
  },
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME ?? 'EvoPlatform',
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
