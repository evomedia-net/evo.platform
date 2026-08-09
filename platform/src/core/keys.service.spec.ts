// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { KeysService } from './keys.service';

describe('KeysService', () => {
  const svc = new KeysService();

  beforeAll(() => {
    svc.loadOrGenerate(mkdtempSync(join(tmpdir(), 'evokeys-')));
  });

  it('signs and verifies a token round-trip', () => {
    const token = svc.sign({ sub: 'user-1', tenant_id: 'tenant-1' }, 60);
    const claims = svc.verify<{ sub: string; tenant_id: string; iss: string }>(token);
    expect(claims.sub).toBe('user-1');
    expect(claims.tenant_id).toBe('tenant-1');
    expect(claims.iss).toBe('evoplatform');
  });

  it('rejects tampered tokens', () => {
    const token = svc.sign({ sub: 'user-1' }, 60);
    expect(() => svc.verify(token.slice(0, -3) + 'abc')).toThrow();
  });

  it('publishes a JWKS containing the signing kid', () => {
    const jwks = svc.jwks() as { keys: Array<{ kid: string; kty: string; alg: string }> };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kid).toBe(svc.kid);
    expect(jwks.keys[0].kty).toBe('RSA');
    expect(jwks.keys[0].alg).toBe('RS256');
  });

  it('reloads the same key from disk (stable kid)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evokeys-'));
    const first = new KeysService();
    first.loadOrGenerate(dir);
    const second = new KeysService();
    second.loadOrGenerate(dir);
    expect(second.kid).toBe(first.kid);
  });
});
