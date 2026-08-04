import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

const audit = { record: jest.fn().mockResolvedValue(undefined) };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new UsersService(prisma, audit as any);

beforeEach(() => jest.clearAllMocks());

// ── profile / name derivation ────────────────────────────────────────────────

function makeProfilePrisma(existing: Record<string, unknown> | null = null) {
  return {
    user: {
      findFirst: jest.fn().mockResolvedValue(null), // no email conflict
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };
}

describe('UsersService.create name derivation', () => {
  it('derives the display name from first + last', async () => {
    const prisma = makeProfilePrisma();
    await makeSvc(prisma).create({
      email: 'a@b.co',
      password: 'x',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.name).toBe('Ada Lovelace');
    expect(data.firstName).toBe('Ada');
    expect(data.lastName).toBe('Lovelace');
  });

  it('falls back to an explicit name when no first/last given', async () => {
    const prisma = makeProfilePrisma();
    await makeSvc(prisma).create({ email: 'a@b.co', password: 'x', name: 'Legacy Name' });
    expect(prisma.user.create.mock.calls[0][0].data.name).toBe('Legacy Name');
  });

  it('stores phone and omits keys that were not provided', async () => {
    const prisma = makeProfilePrisma();
    await makeSvc(prisma).create({ email: 'a@b.co', password: 'x', firstName: 'Ada', phone: '555' });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.phone).toBe('555');
    expect('lastName' in data).toBe(false);
  });
});

describe('UsersService.update name derivation', () => {
  it('re-merges a single changed name part with the stored other half', async () => {
    const prisma = makeProfilePrisma({ firstName: 'Ada', lastName: 'Lovelace' });
    await makeSvc(prisma).update('u1', { lastName: 'Byron' });
    expect(prisma.user.update.mock.calls[0][0].data.name).toBe('Ada Byron');
  });

  it('leaves name untouched when only phone changes', async () => {
    const prisma = makeProfilePrisma({ firstName: 'Ada', lastName: 'Lovelace' });
    await makeSvc(prisma).update('u1', { phone: '555' });
    const data = prisma.user.update.mock.calls[0][0].data;
    expect('name' in data).toBe(false);
    expect(data.phone).toBe('555');
  });
});

// ── purge (erasure) ──────────────────────────────────────────────────────────

function makePurgePrisma(user: Record<string, unknown> | null) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      delete: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

describe('UsersService.purge', () => {
  it('refuses to purge a user that is not soft-deleted', async () => {
    const prisma = makePurgePrisma({ id: 'u1', tenantId: 't1', deletedAt: null });
    await expect(makeSvc(prisma).purge('u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('unlinks audit rows and hard-deletes the user', async () => {
    const prisma = makePurgePrisma({ id: 'u1', tenantId: 't1', deletedAt: new Date() });
    const out = await makeSvc(prisma).purge('u1');
    expect(out).toEqual({ ok: true });
    expect(prisma.auditEvent.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { userId: null },
    });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(audit.record).toHaveBeenCalledWith('user.purged', { tenantId: 't1' });
  });
});

// -- email change (admin-editable identity) ----------------------------------
//
// Email is what a user signs in with, so these guard the two ways this can go
// wrong: silently colliding with another account, and locking someone out.

function makeEmailPrisma(existing: Record<string, unknown>, clash: unknown = null) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(existing),
      findFirst: jest.fn().mockResolvedValue(clash),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };
}

const EXISTING = { id: "u1", tenantId: null, email: "old@example.com" };

describe("UsersService.update email", () => {
  it("changes the address and lowercases it", async () => {
    const prisma = makeEmailPrisma(EXISTING);
    await makeSvc(prisma).update("u1", { email: "New@Evomedia.NET" });
    expect(prisma.user.update.mock.calls[0][0].data.email).toBe("new@evomedia.net");
  });

  it("rejects an address already used in the same tenant", async () => {
    const prisma = makeEmailPrisma(EXISTING, { id: "u2" });
    await expect(makeSvc(prisma).update("u1", { email: "taken@example.com" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("excludes the user itself, so re-saving an unchanged form is not a conflict", async () => {
    const prisma = makeEmailPrisma(EXISTING);
    await makeSvc(prisma).update("u1", { email: "old@example.com" });
    // Same address: no lookup needed at all, and certainly no conflict.
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("does NOT clear emailVerifiedAt", async () => {
    // Sign-in is refused for an unverified mailbox, so clearing this would lock
    // the account out - including a platform admin renaming their own account.
    const prisma = makeEmailPrisma(EXISTING);
    await makeSvc(prisma).update("u1", { email: "new@example.com" });
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty("emailVerifiedAt");
  });

  it("audits the change with both addresses", async () => {
    const prisma = makeEmailPrisma(EXISTING);
    await makeSvc(prisma).update("u1", { email: "new@example.com" });
    expect(audit.record).toHaveBeenCalledWith(
      "user.email_changed",
      expect.objectContaining({ detail: { from: "old@example.com", to: "new@example.com" } }),
    );
  });

  it("does not audit when the address is unchanged", async () => {
    const prisma = makeEmailPrisma(EXISTING);
    await makeSvc(prisma).update("u1", { email: "old@example.com" });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("leaves the address alone when the field is omitted", async () => {
    const prisma = makeEmailPrisma(EXISTING);
    await makeSvc(prisma).update("u1", { firstName: "Ada" });
    expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty("email");
    expect(audit.record).not.toHaveBeenCalled();
  });
});
