// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuditService, MAX_APP_EVENT_DETAIL_BYTES } from './audit.service';

function makePrisma(enabled = true, member = true) {
  return {
    auditEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'ev1' }),
    },
    appTenant: { findUnique: jest.fn().mockResolvedValue(enabled ? { status: 'ACTIVE' } : null) },
    user: { findFirst: jest.fn().mockResolvedValue(member ? { id: 'u1' } : null) },
  };
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

// POST /events is guarded only by client credentials, and every field of the
// row was caller-supplied. Any app holding any valid client secret could write
// `auth.login` against a workspace it was never enabled for (#154).
describe('AuditService.recordFromApp', () => {
  const app = { id: 'app-row-1', clientId: 'app_swag', name: 'swag' };

  it('records an app event against a tenant the app is enabled for', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).recordFromApp(app, {
      action: 'estimate.created',
      tenantId: 't1',
      userId: 'u1',
      detail: { estimateId: 'e9' },
    });
    expect(prisma.appTenant.findUnique).toHaveBeenCalledWith({
      where: { tenantId_appId: { tenantId: 't1', appId: 'app-row-1' } },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'swag.estimate.created',
        tenantId: 't1',
        userId: 'u1',
        appClientId: 'app_swag',
      }),
    });
  });

  it('refuses a tenant the app is not enabled for, before writing anything', async () => {
    const prisma = makePrisma(false);
    await expect(
      makeSvc(prisma).recordFromApp(app, { action: 'estimate.created', tenantId: 'victim' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('refuses a user who is not a member of the named tenant', async () => {
    const prisma = makePrisma(true, false);
    await expect(
      makeSvc(prisma).recordFromApp(app, { action: 'x.y', tenantId: 't1', userId: 'stranger' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('refuses a user with no tenant to check them against', async () => {
    const prisma = makePrisma();
    await expect(
      makeSvc(prisma).recordFromApp(app, { action: 'x.y', userId: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // The starter template's own audit() pushes auth.signup and friends, so a
  // blocklist would have dropped real events. Namespacing keeps them and still
  // makes a row that reads `auth.login` provably the platform's own.
  it('stores every app event under the app name, so it can never read as a platform event', async () => {
    const prisma = makePrisma();
    for (const action of ['auth.login', 'auth.signup', 'billing.paid']) {
      await makeSvc(prisma).recordFromApp(app, { action, tenantId: 't1' });
    }
    const stored = prisma.auditEvent.create.mock.calls.map((c) => c[0].data.action);
    expect(stored).toEqual(['swag.auth.login', 'swag.auth.signup', 'swag.billing.paid']);
  });

  it('bounds the detail payload', async () => {
    const prisma = makePrisma();
    const detail = { blob: 'x'.repeat(MAX_APP_EVENT_DETAIL_BYTES) };
    await expect(
      makeSvc(prisma).recordFromApp(app, { action: 'x.y', tenantId: 't1', detail }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a platform-level app event that names no tenant', async () => {
    const prisma = makePrisma();
    await makeSvc(prisma).recordFromApp(app, { action: 'sync.completed' });
    expect(prisma.appTenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'swag.sync.completed', appClientId: 'app_swag' }),
    });
  });
});
