import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InvitesService } from './invites.service';
import { sha256 } from '../core/crypto.util';

const audit = { record: jest.fn().mockResolvedValue(undefined) };

const RAW_TOKEN = 'raw-invite-token-raw-invite-token-raw-inv';

const invite = {
  id: 'i1',
  tenantId: 't1',
  email: 'raj@acme.example',
  roleIds: ['r1'],
  isTenantAdmin: false,
  invitedById: 'admin1',
  tokenHash: sha256(RAW_TOKEN),
  expiresAt: new Date(Date.now() + 3_600_000),
  acceptedAt: null as Date | null,
  tenant: { id: 't1', slug: 'acme', name: 'Acme', status: 'ACTIVE', deletedAt: null },
};

function makeDeps() {
  const tx = {
    user: { create: jest.fn().mockResolvedValue({ id: 'u9', email: 'raj@acme.example' }) },
    userRole: { createMany: jest.fn().mockResolvedValue({}) },
    invite: { update: jest.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    prisma: {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: 'admin1', name: 'Priya Patel', email: 'priya@acme.example' }),
      },
      role: { findMany: jest.fn().mockResolvedValue([{ id: 'r1', appId: 'a1' }]) },
      appTenant: { findMany: jest.fn().mockResolvedValue([{ appId: 'a1' }]) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 't1', name: 'Acme' }) },
      invite: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ ...invite }),
        findUnique: jest.fn().mockResolvedValue({ ...invite }),
        create: jest.fn().mockResolvedValue({ id: 'i1', email: 'raj@acme.example' }),
        update: jest.fn().mockResolvedValue({ id: 'i1', email: 'raj@acme.example' }),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
    email: { send: jest.fn().mockResolvedValue({ ok: true, messageId: 'm1' }) },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (d: ReturnType<typeof makeDeps>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new InvitesService(d.prisma as any, audit as any, d.email as any);

beforeEach(() => jest.clearAllMocks());

describe('InvitesService.create', () => {
  it('replaces any pending invite and emails an accept link', async () => {
    const d = makeDeps();
    await makeSvc(d).create('t1', 'admin1', { email: 'Raj@Acme.example', roleIds: ['r1'] });
    expect(d.prisma.invite.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', email: 'raj@acme.example', acceptedAt: null },
    });
    const created = d.prisma.invite.create.mock.calls[0][0].data;
    expect(created.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.email.send.mock.calls[0][0].text).toContain('/auth/invites/accept-page?token=');
    expect(audit.record).toHaveBeenCalledWith('tenant.invite_created', expect.anything());
  });

  it('409s when the address is already a member', async () => {
    const d = makeDeps();
    d.prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    await expect(
      makeSvc(d).create('t1', 'admin1', { email: 'raj@acme.example' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects roles of apps not enabled for the tenant', async () => {
    const d = makeDeps();
    d.prisma.appTenant.findMany.mockResolvedValue([]);
    await expect(
      makeSvc(d).create('t1', 'admin1', { email: 'raj@acme.example', roleIds: ['r1'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('InvitesService.accept', () => {
  const dto = { token: RAW_TOKEN, password: 'N3w!!pass99$' };

  it('creates a verified member with roles and consumes the invite', async () => {
    const d = makeDeps();
    const out = await makeSvc(d).accept({ ...dto, firstName: 'Raj', lastName: 'Verma' });
    expect(out).toMatchObject({ ok: true, tenantSlug: 'acme' });
    const created = d.tx.user.create.mock.calls[0][0].data;
    expect(created.tenantId).toBe('t1');
    expect(created.emailVerifiedAt).toEqual(expect.any(Date)); // link = mailbox proof
    expect(created.name).toBe('Raj Verma');
    expect(d.tx.userRole.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u9', roleId: 'r1' }],
    });
    expect(d.tx.invite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { acceptedAt: expect.any(Date) } }),
    );
  });

  it('silently drops roles whose app was disabled after the invite was sent', async () => {
    const d = makeDeps();
    d.prisma.appTenant.findMany.mockResolvedValue([]); // a1 no longer enabled
    await makeSvc(d).accept(dto);
    expect(d.tx.userRole.createMany).not.toHaveBeenCalled();
    expect(d.tx.user.create).toHaveBeenCalled(); // membership still happens
  });

  it('rejects expired, consumed, or unknown tokens alike', async () => {
    const d1 = makeDeps();
    d1.prisma.invite.findUnique.mockResolvedValue({
      ...invite,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(makeSvc(d1).accept(dto)).rejects.toBeInstanceOf(BadRequestException);

    const d2 = makeDeps();
    d2.prisma.invite.findUnique.mockResolvedValue({ ...invite, acceptedAt: new Date() });
    await expect(makeSvc(d2).accept(dto)).rejects.toBeInstanceOf(BadRequestException);

    const d3 = makeDeps();
    d3.prisma.invite.findUnique.mockResolvedValue(null);
    await expect(makeSvc(d3).accept(dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invites into a suspended tenant', async () => {
    const d = makeDeps();
    d.prisma.invite.findUnique.mockResolvedValue({
      ...invite,
      tenant: { ...invite.tenant, status: 'SUSPENDED' },
    });
    await expect(makeSvc(d).accept(dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s when the email already has an account by accept time', async () => {
    const d = makeDeps();
    d.prisma.user.findFirst.mockResolvedValue({ id: 'u1' });
    await expect(makeSvc(d).accept(dto)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('InvitesService resend/revoke', () => {
  it('resend rotates the token and re-emails', async () => {
    const d = makeDeps();
    await makeSvc(d).resend('t1', 'admin1', 'i1');
    const data = d.prisma.invite.update.mock.calls[0][0].data;
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.tokenHash).not.toBe(invite.tokenHash); // fresh token, old link dead
    expect(d.email.send).toHaveBeenCalledTimes(1);
  });

  it('resend/revoke refuse accepted invites', async () => {
    const d = makeDeps();
    d.prisma.invite.findFirst.mockResolvedValue({ ...invite, acceptedAt: new Date() });
    await expect(makeSvc(d).resend('t1', 'a', 'i1')).rejects.toBeInstanceOf(ConflictException);
    await expect(makeSvc(d).revoke('t1', 'a', 'i1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('revoke deletes the invite; unknown/foreign invites 404', async () => {
    const d = makeDeps();
    expect(await makeSvc(d).revoke('t1', 'admin1', 'i1')).toEqual({ ok: true });
    expect(d.prisma.invite.delete).toHaveBeenCalledWith({ where: { id: 'i1' } });

    d.prisma.invite.findFirst.mockResolvedValue(null);
    await expect(makeSvc(d).revoke('t1', 'admin1', 'ghost')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
