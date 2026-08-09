// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { BootstrapAdminService } from './bootstrap-admin.service';
import { config } from '../config';

const audit = { record: jest.fn().mockResolvedValue(undefined) };

function makePrisma(adminCount: number) {
  return {
    user: {
      count: jest.fn().mockResolvedValue(adminCount),
      create: jest.fn().mockResolvedValue({ id: 'u1' }),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new BootstrapAdminService(prisma, audit as any);

const saved = { ...config.bootstrapAdmin };
beforeEach(() => {
  jest.clearAllMocks();
  config.bootstrapAdmin.email = 'Root@Example.com';
  config.bootstrapAdmin.password = 'B00t!!strap$$';
});
afterAll(() => Object.assign(config.bootstrapAdmin, saved));

describe('BootstrapAdminService', () => {
  it('is inert when the env vars are unset', async () => {
    config.bootstrapAdmin.email = undefined;
    const prisma = makePrisma(0);
    expect((await makeSvc(prisma).run()).created).toBe(false);
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('creates a verified platform admin when none exists', async () => {
    const prisma = makePrisma(0);
    const out = await makeSvc(prisma).run();
    expect(out.created).toBe(true);
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: null,
      email: 'root@example.com',
      isPlatformAdmin: true,
    });
    expect(data.emailVerifiedAt).toEqual(expect.any(Date));
    expect(audit.record).toHaveBeenCalledWith('admin.bootstrapped', expect.anything());
  });

  it('skips (harmlessly) when a platform admin already exists', async () => {
    const prisma = makePrisma(2);
    expect((await makeSvc(prisma).run()).reason).toBe('admin exists');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses a password that fails the policy', async () => {
    config.bootstrapAdmin.password = 'weak';
    const prisma = makePrisma(0);
    expect((await makeSvc(prisma).run()).reason).toBe('weak password');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
