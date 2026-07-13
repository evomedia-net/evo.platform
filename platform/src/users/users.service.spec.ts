import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

const audit = { record: jest.fn().mockResolvedValue(undefined) };

function makePrisma(user: Record<string, unknown> | null) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      delete: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('UsersService.purge', () => {
  it('refuses to purge a user that is not soft-deleted', async () => {
    const prisma = makePrisma({ id: 'u1', tenantId: 't1', deletedAt: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(new UsersService(prisma as any, audit as any).purge('u1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('unlinks audit rows and hard-deletes the user', async () => {
    const prisma = makePrisma({ id: 'u1', tenantId: 't1', deletedAt: new Date() });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await new UsersService(prisma as any, audit as any).purge('u1');
    expect(out).toEqual({ ok: true });
    expect(prisma.auditEvent.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { userId: null },
    });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(audit.record).toHaveBeenCalledWith('user.purged', { tenantId: 't1' });
  });
});
