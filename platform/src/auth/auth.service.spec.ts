import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AuthService } from './auth.service';
import { KeysService } from '../core/keys.service';

describe('AuthService.login', () => {
  const keys = new KeysService();
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const passwordHash = bcrypt.hashSync('correct-password', 10);

  const tenant = { id: 't1', slug: 'acme', name: 'Acme', status: 'ACTIVE', deletedAt: null };
  const user = {
    id: 'u1',
    tenantId: 't1',
    email: 'owner@acme.example',
    passwordHash,
    name: 'Owner',
    isPlatformAdmin: false,
    deletedAt: null,
    roles: [{ role: { name: 'admin', app: { clientId: 'app_demo' } } }],
  };

  let prisma: {
    tenant: { findFirst: jest.Mock };
    user: { findFirst: jest.Mock };
    refreshToken: { create: jest.Mock };
  };
  let svc: AuthService;

  beforeAll(() => keys.loadOrGenerate(mkdtempSync(join(tmpdir(), 'evokeys-'))));

  beforeEach(() => {
    prisma = {
      tenant: { findFirst: jest.fn().mockResolvedValue(tenant) },
      user: { findFirst: jest.fn().mockResolvedValue(user) },
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    svc = new AuthService(prisma as any, keys, audit as any);
  });

  it('issues tenant-scoped tokens on valid credentials', async () => {
    const result = await svc.login({
      tenantSlug: 'acme',
      email: 'owner@acme.example',
      password: 'correct-password',
      clientId: 'app_demo',
    });
    const claims = keys.verify<Record<string, unknown>>(result.accessToken);
    expect(claims.tenant_slug).toBe('acme');
    expect(claims.roles).toEqual(['admin']);
    expect(claims.app).toBe('app_demo');
    expect(result.refreshToken).toBeTruthy();
    expect(prisma.refreshToken.create).toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    await expect(
      svc.login({ tenantSlug: 'acme', email: 'owner@acme.example', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects login into a suspended tenant', async () => {
    prisma.tenant.findFirst.mockResolvedValue({ ...tenant, status: 'SUSPENDED' });
    await expect(
      svc.login({ tenantSlug: 'acme', email: 'owner@acme.example', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unknown tenant slug without leaking its absence', async () => {
    prisma.tenant.findFirst.mockResolvedValue(null);
    await expect(
      svc.login({ tenantSlug: 'ghost', email: 'owner@acme.example', password: 'correct-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
