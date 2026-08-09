// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service';

const audit = { record: jest.fn().mockResolvedValue(undefined) };

const tenantRow = {
  id: 't1',
  slug: 'acme',
  name: 'Acme',
  plan: 'free',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null as Date | null,
};

function makePrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    auditEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    smtpConfig: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    appTenant: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    invite: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    user: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    tenant: { delete: jest.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ ...tenantRow, ...overrides }),
      create: jest.fn().mockResolvedValue(tenantRow),
    },
    app: {
      findMany: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]),
      findUnique: jest.fn().mockResolvedValue({ id: 'a1', clientId: 'app_demo', name: 'demo-app' }),
    },
    appTenant: {
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ tenantId: 't1', appId: 'a1', status: 'ACTIVE', plan: 'free' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', action: 'auth.login' }]) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new TenantsService(prisma, audit as any);

beforeEach(() => jest.clearAllMocks());

describe('TenantsService.purge', () => {
  it('refuses to purge a tenant that is not soft-deleted', async () => {
    const svc = makeSvc(makePrisma({ deletedAt: null }));
    await expect(svc.purge('t1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('hard-deletes users, smtp, audit, and the tenant row, in one transaction', async () => {
    const prisma = makePrisma({ deletedAt: new Date() });
    const svc = makeSvc(prisma);
    const out = await svc.purge('t1');
    expect(out).toEqual({ ok: true, users: 2, auditEvents: 4 });
    expect(prisma.tx.auditEvent.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
    expect(prisma.tx.appTenant.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
    expect(prisma.tx.user.deleteMany).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
    expect(prisma.tx.tenant.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(audit.record).toHaveBeenCalledWith('tenant.purged', expect.anything());
  });

  it('404s on an unknown tenant', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue(null);
    await expect(makeSvc(prisma).purge('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TenantsService.exportTenant', () => {
  it('exports users/roles/smtp/audit and never leaks secrets', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({
      ...tenantRow,
      users: [
        {
          id: 'u1',
          email: 'owner@acme.example',
          name: 'Owner',
          passwordHash: 'SECRET-HASH',
          createdAt: new Date(),
          deletedAt: null,
          roles: [{ role: { name: 'admin', app: { name: 'demo-app' } } }],
        },
      ],
      smtpConfig: { host: 'smtp.example.com', port: 587, secure: false, username: 'x', passwordEnc: 'ENC', fromAddress: 'noreply@example.com' },
      appTenants: [
        {
          app: { name: 'demo-app', clientId: 'app_demo' },
          status: 'ACTIVE',
          plan: 'free',
          trialEndsAt: null,
          graceUntil: null,
        },
      ],
    });
    const out = await makeSvc(prisma).exportTenant('t1');
    expect(out.users[0].roles).toEqual([{ app: 'demo-app', role: 'admin' }]);
    expect(out.smtpConfig).toMatchObject({ host: 'smtp.example.com', hasPassword: true });
    expect(out.appAccess).toEqual([
      expect.objectContaining({ app: 'demo-app', clientId: 'app_demo', status: 'ACTIVE' }),
    ]);
    expect(out.auditEvents).toHaveLength(1);
    const dump = JSON.stringify(out);
    expect(dump).not.toContain('SECRET-HASH');
    expect(dump).not.toContain('passwordEnc');
    expect(dump).not.toContain('"ENC"');
  });
});

describe('TenantsService app access', () => {
  it('create() enables only auto-enroll apps for the new tenant', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue(null); // slug is free
    await makeSvc(prisma).create({ slug: 'acme', name: 'Acme' });
    // Opt-out apps (autoEnroll=false) are excluded at the query, so access to
    // them exists only when granted specifically.
    expect(prisma.app.findMany).toHaveBeenCalledWith({
      where: { autoEnroll: true },
      select: { id: true },
    });
    expect(prisma.appTenant.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 't1', appId: 'a1', plan: 'free' },
        { tenantId: 't1', appId: 'a2', plan: 'free' },
      ],
    });
  });

  it('setAppAccess upserts the enablement row and audits it', async () => {
    const prisma = makePrisma();
    const out = await makeSvc(prisma).setAppAccess('t1', 'a1', { status: 'SUSPENDED' });
    expect(prisma.appTenant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_appId: { tenantId: 't1', appId: 'a1' } } }),
    );
    expect(audit.record).toHaveBeenCalledWith('tenant.app_access_set', expect.anything());
    expect(out.status).toBe('ACTIVE'); // echoes what the mock upsert returned
  });

  it('setAppAccess 404s on an unknown app', async () => {
    const prisma = makePrisma();
    prisma.app.findUnique.mockResolvedValue(null);
    await expect(makeSvc(prisma).setAppAccess('t1', 'ghost', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('removeAppAccess deletes the row and audits it', async () => {
    const prisma = makePrisma();
    const out = await makeSvc(prisma).removeAppAccess('t1', 'a1');
    expect(out).toEqual({ ok: true });
    expect(prisma.appTenant.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', appId: 'a1' },
    });
    expect(audit.record).toHaveBeenCalledWith('tenant.app_access_removed', expect.anything());
  });
});
