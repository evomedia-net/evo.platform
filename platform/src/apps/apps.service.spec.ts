// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

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

const billing = { assertPriceUsable: jest.fn().mockResolvedValue(undefined) };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new AppsService(prisma, audit as any, billing as any);

beforeEach(() => jest.clearAllMocks());

// ── Stripe price is verified before it is stored ─────────────────────────────
//
// A price id that doesn't exist used to be saved happily and only failed at
// checkout — in front of a paying customer.

describe('AppsService.update stripePriceId', () => {
  const appRow = { id: 'a1', clientId: 'app_1', name: 'demo', deletedAt: null, roles: [] };
  const makeAppPrisma = () => ({
    app: {
      findUnique: jest.fn().mockResolvedValue(appRow),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...appRow, ...data })),
    },
  });

  it('verifies a new price with Stripe before saving', async () => {
    const prisma = makeAppPrisma();
    await makeSvc(prisma).update('a1', { stripePriceId: 'price_live123' });
    expect(billing.assertPriceUsable).toHaveBeenCalledWith('price_live123');
    expect(prisma.app.update).toHaveBeenCalled();
  });

  it('does not save when Stripe rejects the price', async () => {
    const prisma = makeAppPrisma();
    billing.assertPriceUsable.mockRejectedValueOnce(new Error('no such price'));
    await expect(makeSvc(prisma).update('a1', { stripePriceId: 'price_typo' })).rejects.toThrow();
    expect(prisma.app.update).not.toHaveBeenCalled();
  });

  it('clearing the price needs no Stripe round-trip', async () => {
    const prisma = makeAppPrisma();
    await makeSvc(prisma).update('a1', { stripePriceId: '' });
    expect(billing.assertPriceUsable).not.toHaveBeenCalled();
    expect(prisma.app.update.mock.calls[0][0].data.stripePriceId).toBeNull();
  });

  it('leaves the price alone when the field is omitted', async () => {
    const prisma = makeAppPrisma();
    await makeSvc(prisma).update('a1', { autoEnroll: false });
    expect(billing.assertPriceUsable).not.toHaveBeenCalled();
    expect(prisma.app.update.mock.calls[0][0].data).not.toHaveProperty('stripePriceId');
  });
});

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
    await makeSvc(prisma).remove("a1");
    expect(prisma.app.delete).not.toHaveBeenCalled();
    expect(prisma.app.update.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
  });

  it("refuses to soft delete twice", async () => {
    const prisma = makeLifecyclePrisma(DELETED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(makeSvc(prisma).remove("a1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("restore clears deletedAt", async () => {
    const prisma = makeLifecyclePrisma(DELETED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await makeSvc(prisma).restore("a1");
    expect(prisma.app.update.mock.calls[0][0].data.deletedAt).toBeNull();
  });

  it("refuses to restore an app that is not deleted", async () => {
    const prisma = makeLifecyclePrisma(LIVE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(makeSvc(prisma).restore("a1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("purge REFUSES unless the app is already soft-deleted", async () => {
    // The whole point of the two-step: a live app can never be erased in one go.
    const prisma = makeLifecyclePrisma(LIVE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(makeSvc(prisma).purge("a1")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.app.delete).not.toHaveBeenCalled();
  });

  it("purge deletes the row and audits what went with it", async () => {
    const prisma = makeLifecyclePrisma(DELETED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await makeSvc(prisma).purge("a1");
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
    const svc = makeSvc(prisma);
    await svc.list();
    expect(prisma.app.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null });
    await svc.list(true);
    expect(prisma.app.findMany.mock.calls[1][0].where).toEqual({});
  });
});

// ── update() leaves a trace (#54) ────────────────────────────────────────────
//
// update() was the one mutation here with no audit event, and it is the one
// that changes autoEnroll — whether every new workspace automatically gets
// the app. An unexplained autoEnroll flip on a production app could not be
// reconstructed afterwards, because nothing had recorded it.

describe('AppsService.update auditing', () => {
  const appRow = {
    id: 'a1',
    clientId: 'app_1',
    name: 'demo',
    callbackUrls: ['https://a.example/cb'],
    autoEnroll: false,
    stripePriceId: null,
    deletedAt: null,
    roles: [],
  };
  const makeAppPrisma = (updated: Record<string, unknown>) => ({
    app: {
      findUnique: jest.fn().mockResolvedValue(appRow),
      update: jest.fn(async () => ({ ...appRow, ...updated })),
    },
  });

  it('records app.updated with from/to for the fields that changed', async () => {
    const prisma = makeAppPrisma({ autoEnroll: true });
    await makeSvc(prisma).update('a1', { autoEnroll: true });
    expect(audit.record).toHaveBeenCalledWith('app.updated', {
      appClientId: 'app_1',
      detail: { autoEnroll: { from: false, to: true } },
    });
  });

  it('keeps the old value, which is what makes a change traceable', async () => {
    const prisma = makeAppPrisma({ name: 'renamed', stripePriceId: 'price_x' });
    await makeSvc(prisma).update('a1', { name: 'renamed', stripePriceId: 'price_x' });
    const detail = audit.record.mock.calls.find(([a]) => a === 'app.updated')![1].detail;
    expect(detail.name).toEqual({ from: 'demo', to: 'renamed' });
    expect(detail.stripePriceId).toEqual({ from: null, to: 'price_x' });
    expect(detail.autoEnroll).toBeUndefined(); // unchanged fields stay out
  });

  it('a no-op update records nothing — noise buries the flip that matters', async () => {
    const prisma = makeAppPrisma({});
    await makeSvc(prisma).update('a1', { name: 'demo' });
    expect(audit.record).not.toHaveBeenCalledWith('app.updated', expect.anything());
  });

  it('callbackUrls changes are compared by content, not identity', async () => {
    const prisma = makeAppPrisma({ callbackUrls: ['https://a.example/cb'] });
    await makeSvc(prisma).update('a1', { callbackUrls: ['https://a.example/cb'] });
    expect(audit.record).not.toHaveBeenCalledWith('app.updated', expect.anything());
  });
});
