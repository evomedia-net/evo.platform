// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { UnauthorizedException } from '@nestjs/common';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { KeysService } from '../core/keys.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PasskeysService } from './passkeys.service';
import { deriveRpContext } from './rp';

const keys = new KeysService();
const rp = { rpId: 'localhost', origin: 'http://localhost:3000' };
const user = { id: 'u1', tenantId: 't1', email: 'owner@acme.example', name: 'Owner', deletedAt: null };

function makePrisma() {
  return {
    user: { findFirst: jest.fn().mockResolvedValue(user), findUnique: jest.fn() },
    tenant: { findFirst: jest.fn() },
    passkeyCredential: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'row1',
        createdAt: new Date(),
        lastUsedAt: null,
        ...data,
      })),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

describe('deriveRpContext', () => {
  it('allows loopback with http for dev', () => {
    expect(deriveRpContext('http://localhost:3000', [])).toEqual(rp);
    expect(deriveRpContext('http://127.0.0.1:8080', [])?.rpId).toBe('127.0.0.1');
  });

  it('maps subdomains onto the configured base domain', () => {
    expect(deriveRpContext('https://acme.app.example.com', ['example.com'])).toEqual({
      rpId: 'example.com',
      origin: 'https://acme.app.example.com',
    });
  });

  it('rejects unrecognized hosts instead of guessing', () => {
    expect(deriveRpContext('https://evil.test', ['example.com'])).toBeNull();
    expect(deriveRpContext(undefined, ['example.com'])).toBeNull();
    expect(deriveRpContext('ftp://example.com', ['example.com'])).toBeNull();
  });
});

describe('PasskeysService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let svc: PasskeysService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  beforeAll(() => keys.loadOrGenerate(mkdtempSync(join(tmpdir(), 'evokeys-'))));

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new PasskeysService(prisma as any, keys, audit as any);
    (generateRegistrationOptions as jest.Mock).mockResolvedValue({ challenge: 'chal-reg' });
    (generateAuthenticationOptions as jest.Mock).mockResolvedValue({ challenge: 'chal-auth' });
  });

  it('issues registration options with a purpose-scoped challenge token', async () => {
    const out = await svc.registrationOptions('u1', rp);
    expect(out.options).toEqual({ challenge: 'chal-reg' });
    const claims = keys.verify<Record<string, string>>(out.challengeToken);
    expect(claims.purpose).toBe('webauthn_reg');
    expect(claims.uid).toBe('u1');
    expect(claims.challenge).toBe('chal-reg');
    expect(claims.rp_id).toBe('localhost');
  });

  it('challenge tokens never pass the access-token guard', async () => {
    const { challengeToken } = await svc.registrationOptions('u1', rp);
    const guard = new JwtAuthGuard(keys);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: `Bearer ${challengeToken}` } }),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => guard.canActivate(ctx as any)).toThrow(UnauthorizedException);
  });

  it('stores a verified registration mapped to the platform schema', async () => {
    const { challengeToken } = await svc.registrationOptions('u1', rp);
    (verifyRegistrationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-abc', publicKey: new Uint8Array([1, 2, 3]), counter: 5 },
        aaguid: 'aaguid-1',
      },
    });
    const out = await svc.verifyRegistration(
      'u1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'cred-abc', response: { transports: ['internal', 'hybrid'] } } as any,
      challengeToken,
      '  My Yubikey  ',
    );
    const created = prisma.passkeyCredential.create.mock.calls[0][0].data;
    expect(created.credentialId).toBe('cred-abc');
    expect(created.signCount).toBe(5);
    expect(created.transports).toBe('internal,hybrid');
    expect(created.nickname).toBe('My Yubikey');
    expect(out.nickname).toBe('My Yubikey');
    expect(audit.record).toHaveBeenCalledWith('auth.passkey_registered', expect.anything());
  });

  it('rejects a registration whose challenge token belongs to another user', async () => {
    const { challengeToken } = await svc.registrationOptions('u1', rp);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc.verifyRegistration('other-user', {} as any, challengeToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login with a registration-purpose challenge token', async () => {
    const { challengeToken } = await svc.registrationOptions('u1', rp);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(svc.verifyLogin({ id: 'cred-abc' } as any, challengeToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('hides the passkey option when the user has none', async () => {
    prisma.user.findFirst.mockResolvedValue(user);
    prisma.passkeyCredential.findMany.mockResolvedValue([]);
    const out = await svc.loginOptions(undefined, 'owner@acme.example', rp);
    expect(out).toEqual({ options: null });
  });

  it('rejects a login assertion for a credential not owned by the challenged user', async () => {
    prisma.passkeyCredential.findMany.mockResolvedValue([
      { credentialId: 'cred-abc', transports: null },
    ]);
    const { challengeToken } = (await svc.loginOptions(undefined, 'owner@acme.example', rp)) as {
      challengeToken: string;
    };
    prisma.passkeyCredential.findFirst.mockResolvedValue(null); // someone else's credential
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(svc.verifyLogin({ id: 'cred-zzz' } as any, challengeToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('verifies a login assertion and advances the sign counter', async () => {
    prisma.passkeyCredential.findMany.mockResolvedValue([
      { credentialId: 'cred-abc', transports: 'internal' },
    ]);
    const { challengeToken } = (await svc.loginOptions(undefined, 'owner@acme.example', rp)) as {
      challengeToken: string;
    };
    prisma.passkeyCredential.findFirst.mockResolvedValue({
      id: 'row1',
      userId: 'u1',
      credentialId: 'cred-abc',
      publicKey: Buffer.from([1, 2, 3]),
      signCount: 5,
      transports: 'internal',
    });
    (verifyAuthenticationResponse as jest.Mock).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await svc.verifyLogin({ id: 'cred-abc' } as any, challengeToken);
    expect(out).toEqual({ userId: 'u1' });
    expect(prisma.passkeyCredential.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ signCount: 6 }),
      }),
    );
  });
});
