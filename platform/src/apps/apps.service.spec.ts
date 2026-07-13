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
