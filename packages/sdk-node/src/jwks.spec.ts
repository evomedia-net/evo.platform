// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { generateKeyPairSync } from 'crypto';
import { TokenError } from './errors';
import { JwksCache } from './jwks';

// The cache's happy path and its refetch throttle are pinned in client.spec.ts
// through verifyToken. These are the document-handling edges: how it answers
// a broken endpoint, a document with no keys, and an entry it cannot use.

const URL = 'http://platform.test/.well-known/jwks.json';
const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1' };

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fetchWith(status: number, body: unknown): typeof fetch {
  return jest.fn(async () => respond(status, body)) as unknown as typeof fetch;
}

describe('JwksCache', () => {
  it('fails clearly when the JWKS endpoint answers non-2xx', async () => {
    const cache = new JwksCache(URL, 60_000, fetchWith(503, { message: 'down' }));
    await expect(cache.getPem('k1')).rejects.toThrow('JWKS fetch failed with status 503');
    await expect(cache.getPem('k1')).rejects.toBeInstanceOf(TokenError);
  });

  it('treats a document with no keys as empty rather than crashing', async () => {
    const cache = new JwksCache(URL, 60_000, fetchWith(200, {}));
    await expect(cache.getPem('k1')).rejects.toThrow('Unknown signing key: k1');
  });

  it('skips entries with no kid and keeps the rest', async () => {
    const { kid: _dropped, ...unnamed } = jwk;
    const cache = new JwksCache(URL, 60_000, fetchWith(200, { keys: [unnamed, jwk] }));
    const pem = await cache.getPem('k1');
    expect(pem).toContain('BEGIN PUBLIC KEY');
    // The unnamed entry was never registered under any kid.
    await expect(cache.getPem('undefined')).rejects.toBeInstanceOf(TokenError);
  });

  it('uses the global fetch when none is injected', async () => {
    const saved = global.fetch;
    global.fetch = fetchWith(200, { keys: [jwk] });
    try {
      const cache = new JwksCache(URL);
      expect(await cache.getPem('k1')).toContain('BEGIN PUBLIC KEY');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = saved;
    }
  });
});
