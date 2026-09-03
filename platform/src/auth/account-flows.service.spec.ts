// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { BadRequestException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { createHmac } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AccountFlowsService } from './account-flows.service';
import { EmailTemplateService } from '../email/email-template.service';
import { KeysService } from '../core/keys.service';
import { config } from '../config';

const keys = new KeysService();
const audit = { record: jest.fn().mockResolvedValue(undefined) };

const baseUser = {
  id: 'u1',
  tenantId: 't1',
  email: 'owner@acme.example',
  passwordHash: 'HASH-1',
  emailVerifiedAt: null as Date | null,
  deletedAt: null as Date | null,
  isPlatformAdmin: false,
};

function makeDeps(user: Partial<typeof baseUser> | null = {}) {
  const row = user === null ? null : { ...baseUser, ...user };
  return {
    prisma: {
      tenant: { findFirst: jest.fn().mockResolvedValue({ id: 't1', slug: 'acme' }) },
      // resolveProduct reads the registry: the product name and the sign-in
      // URL in platform mail come from here, never from the request.
      app: {
        findFirst: jest.fn().mockResolvedValue({
          name: 'acme-app',
          displayName: 'Acme App',
          callbackUrls: ['https://acme.example/login'],
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(row),
        findUnique: jest.fn().mockResolvedValue(row),
        // Fallback lookup for a platform admin homed inside a tenant; the
        // no-tenant path reaches it only when findFirst finds nobody.
        findMany: jest.fn().mockResolvedValue(row && row.isPlatformAdmin ? [row] : []),
        update: jest.fn().mockResolvedValue(row),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn().mockResolvedValue([]),
    },
    email: { send: jest.fn().mockResolvedValue({ ok: true, messageId: 'm1' }) },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (deps: ReturnType<typeof makeDeps>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new AccountFlowsService(deps.prisma as any, keys, audit as any, deps.email as any, templates());

/** The real renderer over an empty template table, so these tests cover the
 *  built-in copy that ships - the path every install uses until someone edits. */
const templates = () =>
  new EmailTemplateService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { emailTemplate: { findUnique: jest.fn().mockResolvedValue(null) } } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    audit as any,
  );

const resetSecret = (id: string, passwordHash: string) =>
  createHmac('sha256', config.secretKey).update(`reset:${id}:${passwordHash}`).digest('hex');

beforeAll(() => keys.loadOrGenerate(mkdtempSync(join(tmpdir(), 'evokeys-'))));
beforeEach(() => jest.clearAllMocks());

describe('email verification', () => {
  it('sends a link for an unverified account', async () => {
    const deps = makeDeps();
    await makeSvc(deps).sendVerification({ tenantSlug: 'acme', email: 'Owner@acme.example' });
    expect(deps.email.send).toHaveBeenCalledTimes(1);
    const mail = deps.email.send.mock.calls[0][0];
    expect(mail.to).toBe('owner@acme.example');
    expect(mail.text).toContain('/auth/verify?token=');
  });

  it('answers ok without sending for unknown or already-verified accounts', async () => {
    const unknown = makeDeps(null);
    expect(await makeSvc(unknown).sendVerification({ email: 'ghost@x.example' })).toEqual({
      ok: true,
    });
    expect(unknown.email.send).not.toHaveBeenCalled();

    const verified = makeDeps({ emailVerifiedAt: new Date() });
    expect(
      await makeSvc(verified).sendVerification({ tenantSlug: 'acme', email: 'v1@acme.example' }),
    ).toEqual({ ok: true });
    expect(verified.email.send).not.toHaveBeenCalled();
  });

  it('confirm marks the mailbox proven', async () => {
    const deps = makeDeps();
    const token = keys.sign({ purpose: 'email_verify', sub: 'u1' }, 60);
    await makeSvc(deps).confirmVerification(token);
    expect(deps.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { emailVerifiedAt: expect.any(Date) } }),
    );
  });

  it('rejects tokens with the wrong purpose or bad signature', async () => {
    const deps = makeDeps();
    const svc = makeSvc(deps);
    const wrongPurpose = keys.sign({ purpose: 'password_reset', sub: 'u1' }, 60);
    await expect(svc.confirmVerification(wrongPurpose)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.confirmVerification('not-a-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deps.prisma.user.update).not.toHaveBeenCalled();
  });

  it('rate-limits repeated sends for the same address from one client', async () => {
    const deps = makeDeps({ email: 'burst@acme.example' });
    const svc = makeSvc(deps);
    for (let i = 0; i < 7; i++) {
      await svc.sendVerification({ tenantSlug: 'acme', email: 'burst@acme.example' }, '10.0.0.1');
    }
    expect(deps.email.send.mock.calls.length).toBe(5);
  });

  // The budget used to be keyed on the address alone and charged on every
  // request, so anyone who knew an address could lock its owner out of
  // recovery for good (#159).
  it('a second client gets its own share, up to the ceiling for the address', async () => {
    const deps = makeDeps({ email: 'shared@acme.example' });
    const svc = makeSvc(deps);
    for (let i = 0; i < 6; i++) {
      await svc.sendVerification({ tenantSlug: 'acme', email: 'shared@acme.example' }, '10.0.0.7');
    }
    expect(deps.email.send.mock.calls.length).toBe(5);
    await svc.sendVerification({ tenantSlug: 'acme', email: 'shared@acme.example' }, '10.0.0.8');
    expect(deps.email.send.mock.calls.length).toBe(6);
  });

  it('charges nothing for addresses that do not exist, so probing cannot lock anyone out', async () => {
    const ghost = makeDeps(null);
    const svc = makeSvc(ghost);
    for (let i = 0; i < 10; i++) {
      await svc.sendVerification({ tenantSlug: 'acme', email: 'later@acme.example' }, '10.0.0.9');
    }
    expect(ghost.email.send).not.toHaveBeenCalled();
    // The address now exists; the earlier probes must not have spent its budget.
    const real = makeDeps({ email: 'later@acme.example' });
    await makeSvc(real).sendVerification({ tenantSlug: 'acme', email: 'later@acme.example' }, '10.0.0.9');
    expect(real.email.send).toHaveBeenCalledTimes(1);
  });
});

describe('password reset', () => {
  it('emails a reset-page link for a known account', async () => {
    const deps = makeDeps();
    await makeSvc(deps).requestReset({ tenantSlug: 'acme', email: 'owner@acme.example' });
    expect(deps.email.send.mock.calls[0][0].text).toContain('/auth/reset-page?token=');
  });

  it('reaches a platform admin homed in a tenant when no workspace is given', async () => {
    // The console has no workspace to offer someone who only knows they are an
    // admin; without this fallback their reset mail is silently never sent.
    const deps = makeDeps({ isPlatformAdmin: true });
    deps.prisma.user.findFirst.mockResolvedValueOnce(null); // no platform-level row
    await makeSvc(deps).requestReset({ email: 'owner@acme.example' });
    expect(deps.email.send).toHaveBeenCalled();
  });

  it('refuses to guess when two platform admins share an address', async () => {
    const deps = makeDeps({ isPlatformAdmin: true });
    deps.prisma.user.findFirst.mockResolvedValueOnce(null);
    deps.prisma.user.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    expect(await makeSvc(deps).requestReset({ email: 'owner@acme.example' })).toEqual({ ok: true });
    expect(deps.email.send).not.toHaveBeenCalled();
  });

  it('answers ok without sending for unknown accounts', async () => {
    const deps = makeDeps(null);
    expect(await makeSvc(deps).requestReset({ email: 'ghost@x.example' })).toEqual({ ok: true });
    expect(deps.email.send).not.toHaveBeenCalled();
  });

  it('resets the password, revokes sessions, and counts as mailbox proof', async () => {
    const deps = makeDeps();
    const token = jwt.sign({ purpose: 'password_reset', sub: 'u1' }, resetSecret('u1', 'HASH-1'), {
      expiresIn: 60,
    });
    await makeSvc(deps).resetPassword(token, 'N3w!!pass99$');
    const update = deps.prisma.user.update.mock.calls[0][0];
    expect(update.data.passwordHash).toEqual(expect.any(String));
    expect(update.data.passwordHash).not.toBe('HASH-1');
    expect(update.data.emailVerifiedAt).toEqual(expect.any(Date));
    expect(deps.prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(audit.record).toHaveBeenCalledWith('auth.password_reset', expect.anything());
  });

  it('a token dies once the password hash changes (single-use)', async () => {
    // Token signed against HASH-1, but the stored hash has since moved on.
    const deps = makeDeps({ passwordHash: 'HASH-2' });
    const staleToken = jwt.sign(
      { purpose: 'password_reset', sub: 'u1' },
      resetSecret('u1', 'HASH-1'),
      { expiresIn: 60 },
    );
    await expect(makeSvc(deps).resetPassword(staleToken, 'N3w!!pass99$')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects platform-signed tokens (wrong signature scheme)', async () => {
    const deps = makeDeps();
    const platformSigned = keys.sign({ purpose: 'password_reset', sub: 'u1' }, 60);
    await expect(
      makeSvc(deps).resetPassword(platformSigned, 'N3w!!pass99$'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('workspace lookup', () => {
  it('emails the workspaces an address belongs to', async () => {
    const deps = makeDeps();
    deps.prisma.user.findMany = jest.fn().mockResolvedValue([
      { id: 'u1', tenant: { slug: 'acme', name: 'Acme', deletedAt: null } },
      { id: 'u2', tenant: { slug: 'zeta', name: 'Zeta', deletedAt: null } },
    ]);
    await makeSvc(deps).listWorkspaces({ email: 'owner@acme.example' });
    const body = deps.email.send.mock.calls[0][0].text;
    expect(body).toContain('acme');
    expect(body).toContain('zeta');
  });

  it('answers ok without sending when the address has none', async () => {
    const deps = makeDeps();
    deps.prisma.user.findMany = jest.fn().mockResolvedValue([]);
    expect(await makeSvc(deps).listWorkspaces({ email: 'ghost@x.example' })).toEqual({ ok: true });
    expect(deps.email.send).not.toHaveBeenCalled();
  });

  // An unauthenticated caller used to supply appName and appUrl, which became
  // the From display name and the button href of a mail sent with the
  // platform's own SPF/DKIM-aligned identity - listing the victim's real
  // workspaces, so it read as genuine. Both now come from the app registry.
  it('takes the product name and sign-in link from the registry, not the caller', async () => {
    const deps = makeDeps();
    deps.prisma.user.findMany = jest.fn().mockResolvedValue([
      { id: 'u1', tenant: { slug: 'acme', name: 'Acme', deletedAt: null } },
    ]);

    await makeSvc(deps).listWorkspaces({
      email: 'owner@acme.example',
      clientId: 'app_1',
      // Anything else a caller sends is not part of the input type and is
      // stripped by the global whitelist pipe before it ever gets here.
    });

    const sent = deps.email.send.mock.calls[0][0];
    expect(sent.fromName).toBe('Acme App');
    expect(sent.html).toContain('https://acme.example/login');
    expect(sent.html).not.toContain('evil');
  });

  it('falls back to the platform identity when no app is named', async () => {
    const deps = makeDeps();
    deps.prisma.user.findMany = jest.fn().mockResolvedValue([
      { id: 'u1', tenant: { slug: 'acme', name: 'Acme', deletedAt: null } },
    ]);

    await makeSvc(deps).listWorkspaces({ email: 'owner@acme.example' });

    // No clientId means resolveProduct never touches the registry at all.
    expect(deps.prisma.app.findFirst).not.toHaveBeenCalled();
    expect(deps.email.send.mock.calls[0][0].fromName).toBe(config.brand.platformName);
  });

  it('never returns the workspaces in the response body', async () => {
    const deps = makeDeps();
    deps.prisma.user.findMany = jest.fn().mockResolvedValue([
      { id: 'u1', tenant: { slug: 'acme', name: 'Acme', deletedAt: null } },
    ]);
    const found = await makeSvc(deps).listWorkspaces({ email: 'owner@acme.example' });
    deps.email.send.mockClear();
    deps.prisma.user.findMany = jest.fn().mockResolvedValue([]);
    const missing = await makeSvc(deps).listWorkspaces({ email: 'ghost@x.example' });
    // Identical shape either way - the difference exists only in the mailbox.
    expect(found).toEqual(missing);
    expect(JSON.stringify(found)).not.toContain('acme');
  });

  it('skips soft-deleted workspaces', async () => {
    const deps = makeDeps();
    deps.prisma.user.findMany = jest.fn().mockResolvedValue([
      { id: 'u1', tenant: { slug: 'live', name: 'Live', deletedAt: null } },
      { id: 'u2', tenant: { slug: 'gone', name: 'Gone', deletedAt: new Date() } },
    ]);
    await makeSvc(deps).listWorkspaces({ email: 'owner@acme.example' });
    const body = deps.email.send.mock.calls[0][0].text;
    expect(body).toContain('live');
    expect(body).not.toContain('gone');
  });
});
