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
 */
export class JwksCache {
  private pems = new Map<string, string>();
  private fetchedAt = 0;

  constructor(
    private jwksUrl: string,
    private ttlMs: number = 10 * 60_000,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async getPem(kid: string): Promise<string> {
    const stale = Date.now() - this.fetchedAt > this.ttlMs;
    if (stale || !this.pems.has(kid)) {
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
