// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { config } from '../config';

export interface RpContext {
  rpId: string;
  origin: string;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Derive (rpId, expectedOrigin) from the browser's Origin header rather than
 * hardcoding a domain: WebAuthn requires the RP ID to be the page's own host
 * or a registrable-domain suffix of it, so a fixed production domain would
 * make every ceremony fail in local dev. Loopback gets WebAuthn's
 * "potentially trustworthy origin" exemption (plain http works); anything
 * else must suffix-match the configured base-domain allow-list, which makes
 * one passkey work from the apex and any tenant subdomain.
 *
 * Returns null for unrecognized origins — callers must reject the ceremony,
 * never fall back to a guess.
 */
export function deriveRpContext(
  originHeader: string | undefined,
  baseDomains: string[] = config.webauthn.baseDomains,
): RpContext | null {
  if (!originHeader) return null;
  let url: URL;
  try {
    url = new URL(originHeader);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) {
    return { rpId: host.replace(/^\[|\]$/g, ''), origin: url.origin };
  }
  for (const base of baseDomains) {
    if (host === base || host.endsWith('.' + base)) {
      return { rpId: base, origin: url.origin };
    }
  }
  return null;
}
