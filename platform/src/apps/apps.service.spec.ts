import { ConflictException, NotFoundException } from '@nestjs/common';
import { AppsService } from './apps.service';

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const roleRow = { id: 'r1', appId: 'a1', name: 'admin', description: null };

function makePrisma() {
  return {
    role: {
      findFirst: jest.fn().mockResolvedValue(roleRow),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...roleRow, ...data })),
      delete: jest.fn().mockResolvedValue(roleRow),
    },
    userRole: { count: jest.fn().mockResolvedValue(3) },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new AppsService(prisma, audit as any);

beforeEach(() => jest.clearAllMocks());

describe('AppsService.updateRole', () => {
  it('renames a role', async () => {
    const prisma = makePrisma();
    const out = await makeSvc(prisma).updateRole('a1', 'r1', { name: 'owner' });
    expect(out.name).toBe('owner');
    expect(audit.record).toHaveBeenCalledWith('app.role_renamed', {
      detail: { from: 'admin', to: 'owner' },
    });
  });

  it('rejects a rename that collides with an existing role name', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue({ id: 'r2', name: 'member' });
    await expect(makeSvc(prisma).updateRole('a1', 'r1', { name: 'member' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s when the role does not belong to the app', async () => {
    const prisma = makePrisma();
    prisma.role.findFirst.mockResolvedValue(null);
    await expect(makeSvc(prisma).updateRole('other-app', 'r1', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AppsService.removeRole', () => {
  it('deletes the role and reports removed assignments', async () => {
    const prisma = makePrisma();
    const out = await makeSvc(prisma).removeRole('a1', 'r1');
    expect(out).toEqual({ ok: true, assignmentsRemoved: 3 });
    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    expect(audit.record).toHaveBeenCalledWith('app.role_deleted', {
      detail: { role: 'admin', assignmentsRemoved: 3 },
    });
  });
});

// -- lifecycle: soft delete, restore, purge ---------------------------------
//
// Mirrors tenants and users: delete is reversible, purge refuses unless the
// app is already soft-deleted, so one mistaken click can never destroy client
// credentials and every tenant grant that depends on them.

const LIVE = { id: "a1", clientId: "app_x", name: "swag", deletedAt: null };
const DELETED = { ...LIVE, deletedAt: new Date("2026-08-01") };

function makeLifecyclePrisma(current: Record<string, unknown>) {
  return {
    app: {
      findUnique: jest.fn().mockResolvedValue(current),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...current, ...data })),
      delete: jest.fn().mockResolvedValue(current),
    },
    role: { count: jest.fn().mockResolvedValue(2) },
    appTenant: { count: jest.fn().mockResolvedValue(5) },
  };
}

describe("AppsService lifecycle", () => {
  beforeEach(() => jest.clearAllMocks());

  it("soft delete stamps deletedAt rather than removing the row", async () => {
    const prisma = makeLifecyclePrisma(LIVE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AppsService(prisma as any, audit as any).remove("a1");
    expect(prisma.app.delete).not.toHaveBeenCalled();
    expect(prisma.app.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });

  it("refuses to soft delete twice", async () => {
    const prisma = makeLifecyclePrisma(DELETED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(new AppsService(prisma as any, audit as any).remove("a1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("restore clears deletedAt", async () => {
    const prisma = makeLifecyclePrisma(DELETED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AppsService(prisma as any, audit as any).restore("a1");
    expect(prisma.app.update.mock.calls[0][0].data.deletedAt).toBeNull();
  });

  it("refuses to restore an app that is not deleted", async () => {
    const prisma = makeLifecyclePrisma(LIVE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(new AppsService(prisma as any, audit as any).restore("a1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("purge REFUSES unless the app is already soft-deleted", async () => {
    // The whole point of the two-step: a live app can never be erased in one go.
    const prisma = makeLifecyclePrisma(LIVE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(new AppsService(prisma as any, audit as any).purge("a1")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.app.delete).not.toHaveBeenCalled();
  });

  it("purge deletes the row and audits what went with it", async () => {
    const prisma = makeLifecyclePrisma(DELETED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await new AppsService(prisma as any, audit as any).purge("a1");
    expect(prisma.app.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    expect(res).toEqual({ ok: true, roles: 2, tenants: 5 });
    expect(audit.record).toHaveBeenCalledWith(
      "app.purged",
      expect.objectContaining({ detail: expect.objectContaining({ roles: 2, tenants: 5 }) }),
    );
  });

  it("list hides deleted apps by default and includes them on request", async () => {
    const prisma = makeLifecyclePrisma(LIVE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = new AppsService(prisma as any, audit as any);
    await svc.list();
    expect(prisma.app.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    await svc.list(true);
    expect(prisma.app.findMany.mock.calls[1][0].where).toEqual({});
  });
});
