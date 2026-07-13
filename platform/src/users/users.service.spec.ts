import { UsersService } from './users.service';

const audit = { record: jest.fn().mockResolvedValue(undefined) };

function makePrisma(existing: Record<string, unknown> | null = null) {
  return {
    user: {
      findFirst: jest.fn().mockResolvedValue(null), // no email conflict
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new UsersService(prisma, audit as any);

beforeEach(() => jest.clearAllMocks());

describe('UsersService.create name derivation', () => {
  it('derives the display name from first + last', async () => {
    const prisma = makePrisma();
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
    const prisma = makePrisma();
    await makeSvc(prisma).create({ email: 'a@b.co', password: 'x', name: 'Legacy Name' });
    expect(prisma.user.create.mock.calls[0][0].data.name).toBe('Legacy Name');
  });

  it('stores phone and omits keys that were not provided', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).create({ email: 'a@b.co', password: 'x', firstName: 'Ada', phone: '555' });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.phone).toBe('555');
    expect('lastName' in data).toBe(false);
  });
});

describe('UsersService.update name derivation', () => {
  it('re-merges a single changed name part with the stored other half', async () => {
    const prisma = makePrisma({ firstName: 'Ada', lastName: 'Lovelace' });
    await makeSvc(prisma).update('u1', { lastName: 'Byron' });
    expect(prisma.user.update.mock.calls[0][0].data.name).toBe('Ada Byron');
  });

  it('leaves name untouched when only address fields change', async () => {
    const prisma = makePrisma({ firstName: 'Ada', lastName: 'Lovelace' });
    await makeSvc(prisma).update('u1', { city: 'Paris' });
    const data = prisma.user.update.mock.calls[0][0].data;
    expect('name' in data).toBe(false);
    expect(data.city).toBe('Paris');
  });
});
