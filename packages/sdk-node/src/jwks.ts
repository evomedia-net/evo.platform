// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { createPublicKey } from 'crypto';
import { TokenError } from './errors';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  [key: string]: unknown;
}

/**
 * Caches the platform's JWKS so token verification is local — no per-request
 * platform call. Refreshes on TTL expiry or when an unknown kid appears
 * (covers key rotation).
 *
 * An unknown kid is also something anyone can put in a token, and the JWKS
 * endpoint is deliberately exempt from the platform's throttling. Before
 * `minRefreshMs` every token with a made-up kid forced a fetch, so an
 * unauthenticated caller of any app could multiply requests against the
 * platform. Now an unknown kid triggers at most one refresh per interval; a
 * flood costs the platform one request per interval instead of one per token
 * (#162). Rotation still needs no redeploy: the first token signed with a new
 * key may be refused for up to one interval, then the refresh picks it up.
 */
export class JwksCache {
  private pems = new Map<string, string>();
  private fetchedAt = 0;

  constructor(
    private jwksUrl: string,
    private ttlMs: number = 10 * 60_000,
    private fetchFn: typeof fetch = fetch,
    private minRefreshMs: number = 30_000,
  ) {}

  async getPem(kid: string): Promise<string> {
    const now = Date.now();
    const stale = now - this.fetchedAt > this.ttlMs;
    const unknown = !this.pems.has(kid);
    if (stale || (unknown && now - this.fetchedAt > this.minRefreshMs)) {
      await this.refresh();
    }
    const pem = this.pems.get(kid);
    if (!pem) throw new TokenError(`Unknown signing key: ${kid}`);
    return pem;
  }

  async refresh(): Promise<void> {
    const res = await this.fetchFn(this.jwksUrl);
    if (!res.ok) throw new TokenError(`JWKS fetch failed with status ${res.status}`);
    const body = (await res.json()) as { keys: Jwk[] };
    this.pems.clear();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid) continue;
      const pem = createPublicKey({ key: jwk, format: 'jwk' })
        .export({ type: 'spki', format: 'pem' })
        .toString();
      this.pems.set(jwk.kid, pem);
    }
    this.fetchedAt = Date.now();
  }
}
