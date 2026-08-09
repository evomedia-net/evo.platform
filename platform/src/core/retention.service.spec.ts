// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { RetentionService } from './retention.service';
import { config } from '../config';

function makePrisma() {
  return {
    auditEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
  };
}

const saved = { ...config.retention };
afterEach(() => Object.assign(config.retention, saved));

describe('RetentionService.sweep', () => {
  it('keeps audit events forever when auditDays is 0', async () => {
    Object.assign(config.retention, { auditDays: 0, tokenDays: 30 });
    const prisma = makePrisma();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await new RetentionService(prisma as any).sweep();
    expect(prisma.auditEvent.deleteMany).not.toHaveBeenCalled();
    expect(out.refreshTokens).toBe(5);
  });

  it('deletes with the configured cutoffs', async () => {
    Object.assign(config.retention, { auditDays: 90, tokenDays: 30 });
    const prisma = makePrisma();
    const now = new Date('2026-07-13T00:00:00Z');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await new RetentionService(prisma as any).sweep(now);
    const auditCutoff = prisma.auditEvent.deleteMany.mock.calls[0][0].where.createdAt.lt;
    expect(auditCutoff.toISOString()).toBe('2026-04-14T00:00:00.000Z');
    const tokenWhere = prisma.refreshToken.deleteMany.mock.calls[0][0].where;
    expect(tokenWhere.OR[0].revokedAt.lt.toISOString()).toBe('2026-06-13T00:00:00.000Z');
    expect(out).toEqual({ auditEvents: 3, refreshTokens: 5 });
  });

  it('survives a failing sweep (retries next interval)', async () => {
    Object.assign(config.retention, { auditDays: 1, tokenDays: 1 });
    const prisma = makePrisma();
    prisma.auditEvent.deleteMany.mockRejectedValue(new Error('db down'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(new RetentionService(prisma as any).sweep()).resolves.toEqual({
      auditEvents: 0,
      refreshTokens: 0,
    });
  });
});
