// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Two things live here beyond delegation, and both are security posture:
// rpFromRequest's origin handling (a ceremony from an unrecognized origin is
// refused, never guessed at), and loginVerify's rule that the ceremony alone
// grants nothing — the same completeLogin gate as password sign-in runs after.

import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PasskeysController } from './passkeys.controller';

const passkeys = {
  registrationOptions: jest.fn().mockResolvedValue({ challenge: 'c' }),
  verifyRegistration: jest.fn().mockResolvedValue({ ok: true }),
  list: jest.fn().mockResolvedValue([]),
  remove: jest.fn().mockResolvedValue({ ok: true }),
  loginOptions: jest.fn().mockResolvedValue({ challenge: 'c' }),
  verifyLogin: jest.fn().mockResolvedValue({ userId: 'u1' }),
};
const auth = { completeLogin: jest.fn().mockResolvedValue({ accessToken: 'jwt' }) };
const userRow = { id: 'u1', tenant: { id: 't1' }, roles: [] };
const prisma = { user: { findUnique: jest.fn().mockResolvedValue(userRow) } };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctrl = new PasskeysController(passkeys as any, auth as any, prisma as any);

// The loopback origin passes deriveRpContext regardless of config.
const req = (headers: Record<string, string> = { origin: 'http://localhost:3000' }) =>
  ({ user: { sub: 'u1' }, headers }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findUnique.mockResolvedValue(userRow);
});

describe('origin handling', () => {
  it('refuses a ceremony from an unrecognized origin instead of guessing', () => {
    expect(() => ctrl.registerOptions(req({ origin: 'https://evil.example' })))
      .toThrow(ForbiddenException);
    expect(passkeys.registrationOptions).not.toHaveBeenCalled();
  });

  it('falls back to the Host header for non-browser clients, loopback as http', async () => {
    await ctrl.registerOptions(req({ host: 'localhost:3000' }));
    expect(passkeys.registrationOptions).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ origin: 'http://localhost:3000' }),
    );
  });
});

describe('registration and management delegate for the logged-in user only', () => {
  it('registerOptions / registerVerify / list / remove carry req.user.sub', async () => {
    await ctrl.registerOptions(req());
    expect(passkeys.registrationOptions).toHaveBeenCalledWith('u1', expect.anything());
    await ctrl.registerVerify(req(), {
      credential: { id: 'cred' }, challengeToken: 'ch', nickname: 'laptop',
    } as never);
    expect(passkeys.verifyRegistration).toHaveBeenCalledWith('u1', { id: 'cred' }, 'ch', 'laptop');
    await ctrl.list(req());
    expect(passkeys.list).toHaveBeenCalledWith('u1');
    await ctrl.remove(req(), 'pk1');
    expect(passkeys.remove).toHaveBeenCalledWith('u1', 'pk1');
  });
});

describe('login', () => {
  it('loginOptions passes tenant, email and the derived rp through', async () => {
    await ctrl.loginOptions(req(), { tenantSlug: 'acme', email: 'a@b.c' } as never);
    expect(passkeys.loginOptions).toHaveBeenCalledWith('acme', 'a@b.c', expect.anything());
  });

  it('a verified ceremony still goes through the same completeLogin gate as passwords', async () => {
    const out = await ctrl.loginVerify(
      req(), { credential: { id: 'c' }, challengeToken: 'ch', clientId: 'app_1' } as never, '10.0.0.9',
    );
    expect(auth.completeLogin).toHaveBeenCalledWith(
      userRow, userRow.tenant, 'app_1', { ip: '10.0.0.9', method: 'passkey' },
    );
    expect(out).toEqual({ accessToken: 'jwt' });
  });

  it('rejects when the verified user has vanished rather than minting a session', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      ctrl.loginVerify(req(), { credential: {}, challengeToken: 'ch' } as never, '10.0.0.9'),
    ).rejects.toThrow(BadRequestException);
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });
});
