// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantService } from './tenant.service';

const audit = { record: jest.fn().mockResolvedValue(undefined) };

const member = {
  id: 'u2',
  email: 'member@acme.example',
  name: 'Member',
  firstName: 'Mem',
  lastName: 'Ber',
  phone: null,
  isTenantAdmin: false,
  createdAt: new Date(),
  deletedAt: null as Date | null,
  roles: [] as unknown[],
};

function makePrisma() {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue([member]),
      findFirst: jest.fn().mockResolvedValue(member),
      create: jest.fn().mockResolvedValue(member),
      update: jest.fn().mockResolvedValue(member),
    },
    appTenant: { findMany: jest.fn().mockResolvedValue([{ appId: 'a1' }]) },
    role: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', appId: 'a1' }]) },
    userRole: {
      deleteMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new TenantService(prisma, audit as any);

beforeEach(() => jest.clearAllMocks());

describe('TenantService', () => {
  it('list is scoped to the caller tenant', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).list('t1');
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1' } }),
    );
  });

  it('404s for a member outside the caller tenant (existence not revealed)', async () => {
    const prisma = makePrisma();
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(makeSvc(prisma).deactivate('t1', 'admin', 'other-tenant-user')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'other-tenant-user', tenantId: 't1' } }),
    );
  });

  it('create scopes the member to the tenant and audits the actor', async () => {
    const prisma = makePrisma();
    prisma.user.findFirst.mockResolvedValue(null); // email free
    await makeSvc(prisma).create('t1', 'admin', {
      email: 'New@Acme.example',
      password: 'Str0ng!!pass1',
    });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('t1');
    expect(data.email).toBe('new@acme.example');
    expect(data.isPlatformAdmin).toBeUndefined(); // never settable from this surface
    expect(audit.record).toHaveBeenCalledWith('tenant.member_created', expect.anything());
  });

  it('409s on a duplicate email within the tenant', async () => {
    const prisma = makePrisma();
    await expect(
      makeSvc(prisma).create('t1', 'admin', { email: 'member@acme.example', password: 'x!!12x!!' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks removing your own tenant-admin role', async () => {
    const prisma = makePrisma();
    await expect(
      makeSvc(prisma).update('t1', 'u2', 'u2', { isTenantAdmin: false }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks deactivating your own account', async () => {
    const prisma = makePrisma();
    await expect(makeSvc(prisma).deactivate('t1', 'u2', 'u2')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deactivates another member and audits it', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).deactivate('t1', 'admin', 'u2');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    );
    expect(audit.record).toHaveBeenCalledWith('tenant.member_deactivated', expect.anything());
  });

  it('rejects roles of apps not enabled for the tenant', async () => {
    const prisma = makePrisma();
    prisma.appTenant.findMany.mockResolvedValue([]); // app a1 not enabled
    await expect(makeSvc(prisma).setRoles('t1', 'admin', 'u2', ['r1'])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s on unknown role ids', async () => {
    const prisma = makePrisma();
    prisma.role.findMany.mockResolvedValue([]);
    await expect(makeSvc(prisma).setRoles('t1', 'admin', 'u2', ['ghost'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('replaces the role set for enabled apps', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).setRoles('t1', 'admin', 'u2', ['r1', 'r1']);
    expect(prisma.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u2', roleId: 'r1' }], // deduped
    });
    expect(audit.record).toHaveBeenCalledWith('tenant.member_roles_set', expect.anything());
  });
});
