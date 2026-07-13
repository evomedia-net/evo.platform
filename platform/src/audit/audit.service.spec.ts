import { AuditService } from './audit.service';

function makePrisma() {
  return { auditEvent: { findMany: jest.fn().mockResolvedValue([]) } };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new AuditService(prisma);

describe('AuditService.list', () => {
  it('builds a createdAt range from from/to', async () => {
    const prisma = makePrisma();
    const from = new Date('2026-07-01T00:00:00Z');
    const to = new Date('2026-07-31T23:59:59.999Z');
    await makeSvc(prisma).list({ from, to, action: 'auth.login' });
    const where = prisma.auditEvent.findMany.mock.calls[0][0].where;
    expect(where.createdAt).toEqual({ gte: from, lte: to });
    expect(where.action).toBe('auth.login');
  });

  it('omits createdAt entirely when no dates are given', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).list({ tenantId: 't1' });
    expect(prisma.auditEvent.findMany.mock.calls[0][0].where.createdAt).toBeUndefined();
  });

  it('supports an open-ended (from-only) range', async () => {
    const prisma = makePrisma();
    const from = new Date('2026-07-01T00:00:00Z');
    await makeSvc(prisma).list({ from });
    expect(prisma.auditEvent.findMany.mock.calls[0][0].where.createdAt).toEqual({ gte: from });
  });

  it('caps take at 10000 to bound exports', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).list({ take: 999999 });
    expect(prisma.auditEvent.findMany.mock.calls[0][0].take).toBe(10000);
  });
});
