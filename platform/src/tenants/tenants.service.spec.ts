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
    user: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    tenant: { delete: jest.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    tenant: { findUnique: jest.fn().mockResolvedValue({ ...tenantRow, ...overrides }) },
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
    });
    const out = await makeSvc(prisma).exportTenant('t1');
    expect(out.users[0].roles).toEqual([{ app: 'demo-app', role: 'admin' }]);
    expect(out.smtpConfig).toMatchObject({ host: 'smtp.example.com', hasPassword: true });
    expect(out.auditEvents).toHaveLength(1);
    const dump = JSON.stringify(out);
    expect(dump).not.toContain('SECRET-HASH');
    expect(dump).not.toContain('passwordEnc');
    expect(dump).not.toContain('"ENC"');
  });
});
