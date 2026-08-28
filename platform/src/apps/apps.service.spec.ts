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

const MONTHLY = { unitAmount: 1000, currency: 'usd', interval: 'month', intervalCount: 1 };
const billing = { describePrice: jest.fn().mockResolvedValue(MONTHLY) };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new AppsService(prisma, audit as any, billing as any);

beforeEach(() => jest.clearAllMocks());

// ── What an app sells is a list of prices, verified against Stripe ──────────
//
// A price id that doesn't exist used to be saved happily and only failed at
// checkout — in front of a paying customer. Amount/currency/interval are read
// from Stripe rather than typed, so the console can never display a price
// that differs from what is actually billed.

describe('AppsService prices', () => {
  const appRow = { id: 'a1', clientId: 'app_1', name: 'demo', deletedAt: null, roles: [] };
  const makePrisma = (existing: Record<string, unknown> | null = null, clash: Record<string, unknown> | null = null) => ({
    app: {
      findUnique: jest.fn().mockResolvedValue(appRow),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...appRow, ...data })),
    },
    appPrice: {
      findUnique: jest.fn()
        .mockResolvedValueOnce(existing)   // global stripePriceId owner check
        .mockResolvedValueOnce(clash),     // (app, tier, interval) clash check
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
  });

  it('stores the amount and interval Stripe reports, not what was typed', async () => {
    const prisma = makePrisma();
    billing.describePrice.mockResolvedValueOnce({
      unitAmount: 49900, currency: 'usd', interval: 'year', intervalCount: 1,
    });
    const price = await makeSvc(prisma).addPrice('a1', { stripePriceId: 'price_pro_y', tier: 'pro' });
    expect(billing.describePrice).toHaveBeenCalledWith('price_pro_y');
    expect(price).toMatchObject({ tier: 'pro', unitAmount: 49900, interval: 'year' });
  });

  it('does not save when Stripe rejects the price', async () => {
    const prisma = makePrisma();
    billing.describePrice.mockRejectedValueOnce(new Error('no such price'));
    await expect(
      makeSvc(prisma).addPrice('a1', { stripePriceId: 'price_typo', tier: 'pro' }),
    ).rejects.toThrow();
    expect(prisma.appPrice.create).not.toHaveBeenCalled();
  });

  it("refuses a price already registered to another app — one app cannot sell another's product", async () => {
    const prisma = makePrisma({ appId: 'other', tier: 'pro', app: { name: 'swag-estimates' } });
    await expect(
      makeSvc(prisma).addPrice('a1', { stripePriceId: 'price_taken', tier: 'pro' }),
    ).rejects.toThrow(/already belongs to "swag-estimates"/);
    expect(prisma.appPrice.create).not.toHaveBeenCalled();
  });

  it('refuses a second price for the same tier and billing period', async () => {
    const prisma = makePrisma(null, { id: 'existing', tier: 'pro' });
    await expect(
      makeSvc(prisma).addPrice('a1', { stripePriceId: 'price_dupe', tier: 'pro' }),
    ).rejects.toThrow(/already sells "pro"/);
  });

  it('an app may sell as many tiers as it likes — nothing caps the list', async () => {
    const svc = makeSvc(makePrisma());
    for (let i = 0; i < 25; i++) {
      const prisma = makePrisma();
      const s = makeSvc(prisma);
      await s.addPrice('a1', { stripePriceId: `price_${i}`, tier: `seat-${i}` });
      expect(prisma.appPrice.create).toHaveBeenCalled();
    }
    expect(svc).toBeDefined();
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
    const prisma = makeAppPrisma({ name: 'renamed' });
    await makeSvc(prisma).update('a1', { name: 'renamed' });
    const detail = audit.record.mock.calls.find(([a]) => a === 'app.updated')![1].detail;
    expect(detail.name).toEqual({ from: 'demo', to: 'renamed' });
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

// ── The registration lifecycle: create, update, rotate ──────────────────────
//
// The client secret is the sharp edge here: it must come back exactly once,
// from create (and rotate), while only its bcrypt hash is ever stored. A test
// asserting that is the difference between "we hash secrets" as a habit and
// as a checked property.

describe('AppsService create / update / rotateSecret', () => {
  const appRow = { id: 'a1', clientId: 'app_1', name: 'demo', displayName: 'Demo', deletedAt: null };
  const makePrisma = (existing: Record<string, unknown> | null = null) => ({
    app: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...appRow, ...data })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...appRow, ...data })),
    },
  });

  it('refuses a duplicate app name', async () => {
    const prisma = makePrisma(appRow);
    await expect(makeSvc(prisma).create({ name: 'demo', displayName: 'Demo' } as any))
      .rejects.toThrow(ConflictException);
  });

  it('returns the client secret exactly once and stores only its hash', async () => {
    const prisma = makePrisma(null);
    const created = await makeSvc(prisma).create({ name: 'demo', displayName: 'Demo' } as any);
    expect(created.clientSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const stored = prisma.app.create.mock.calls[0][0].data;
    expect(stored.clientSecretHash).toBeDefined();
    expect(stored.clientSecretHash).not.toContain(created.clientSecret);
    expect(stored).not.toHaveProperty('clientSecret');
    expect(audit.record).toHaveBeenCalledWith('app.created', expect.anything());
  });

  it('update audits each changed field with its old and new value', async () => {
    const prisma = makePrisma(null);
    prisma.app.findUnique.mockResolvedValue({ ...appRow, autoEnroll: true, callbackUrls: [] });
    await makeSvc(prisma).update('a1', { displayName: 'Renamed', autoEnroll: false } as any);
    const evt = audit.record.mock.calls.find(([name]) => name === 'app.updated');
    expect(evt).toBeDefined();
    const changes = (evt![1] as any).detail;
    expect(changes.autoEnroll).toEqual({ from: true, to: false });
    expect(changes.displayName).toMatchObject({ to: 'Renamed' });
  });

  it('rotateSecret returns a fresh secret and stores only the new hash', async () => {
    const prisma = makePrisma(null);
    prisma.app.findUnique.mockResolvedValue(appRow);
    const out = await makeSvc(prisma).rotateSecret('a1');
    expect(out.clientId).toBe('app_1');
    expect(out.clientSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const stored = prisma.app.update.mock.calls[0][0].data;
    expect(stored.clientSecretHash).not.toContain(out.clientSecret);
    expect(audit.record).toHaveBeenCalledWith('app.secret_rotated', expect.anything());
  });
});

// ── The access matrix and the read-side lists ───────────────────────────────

describe('AppsService listTenants / prices / roles', () => {
  const appRow = { id: 'a1', clientId: 'app_1', name: 'demo', deletedAt: null };
  const tenants = [
    { id: 't1', slug: 'acme', name: 'Acme', status: 'active' },
    { id: 't2', slug: 'beta', name: 'Beta', status: 'active' },
  ];
  const makePrisma = () => ({
    app: { findUnique: jest.fn().mockResolvedValue(appRow) },
    tenant: { findMany: jest.fn().mockResolvedValue(tenants) },
    appTenant: { findMany: jest.fn().mockResolvedValue([{ appId: 'a1', tenantId: 't1', enabled: true }]) },
    appPrice: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn().mockResolvedValue({}),
    },
    role: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([roleRow]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r2', ...data })),
    },
  });

  it('lists every tenant with its access state, null where none granted', async () => {
    const out = await makeSvc(makePrisma()).listTenants('a1');
    expect(out).toHaveLength(2);
    expect(out[0].access).toMatchObject({ tenantId: 't1' });
    expect(out[1].access).toBeNull();
  });

  it('listPrices scopes to the app', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).listPrices('a1');
    expect(prisma.appPrice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { appId: 'a1' } }),
    );
  });

  it("removePrice 404s for a price belonging to a different app", async () => {
    const prisma = makePrisma();
    prisma.appPrice.findUnique.mockResolvedValue({ id: 'p1', appId: 'OTHER' });
    await expect(makeSvc(prisma).removePrice('a1', 'p1')).rejects.toThrow(NotFoundException);
    expect(prisma.appPrice.delete).not.toHaveBeenCalled();
  });

  it('removePrice deletes and audits the Stripe linkage that went with it', async () => {
    const prisma = makePrisma();
    prisma.appPrice.findUnique.mockResolvedValue({
      id: 'p1', appId: 'a1', tier: 'pro', stripePriceId: 'price_x',
    });
    const out = await makeSvc(prisma).removePrice('a1', 'p1');
    expect(out).toEqual({ ok: true });
    expect(audit.record).toHaveBeenCalledWith('app.price_removed', expect.anything());
  });

  it('addRole refuses a duplicate name within the app', async () => {
    const prisma = makePrisma();
    prisma.role.findUnique.mockResolvedValue(roleRow);
    await expect(makeSvc(prisma).addRole('a1', { name: 'admin' } as any))
      .rejects.toThrow(ConflictException);
  });

  it('addRole creates and listRoles reads back, both scoped to the app', async () => {
    const prisma = makePrisma();
    const role = await makeSvc(prisma).addRole('a1', { name: 'viewer', description: 'ro' } as any);
    expect(role).toMatchObject({ appId: 'a1', name: 'viewer' });
    const roles = await makeSvc(prisma).listRoles('a1');
    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { appId: 'a1' } }),
    );
    expect(roles).toEqual([roleRow]);
  });
});
