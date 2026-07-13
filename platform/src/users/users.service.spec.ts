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
