// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * POST /email/send must not be a relay for other people's domains.
 *
 * It is guarded only by client credentials, and SendEmailDto.tenantId is
 * caller-supplied. Without an enablement check, any app holding any valid
 * client secret could name another workspace's tenant id: the platform would
 * decrypt that workspace's SMTP password and send attacker-authored HTML from
 * their fromAddress, SPF/DKIM-aligned with their real domain. Security review
 * #125 - and the same gate BillingService.requireRelationship already applies.
 */
import { ForbiddenException, HttpException } from '@nestjs/common';
import type { App } from '@prisma/client';
import { _resetEmailQuotasForTests, EmailService } from './email.service';
import { SendEmailDto } from './dto';
import { config } from '../config';

const sendMail = jest.fn().mockResolvedValue({ messageId: 'm1' });
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: () => ({ sendMail: (...a: unknown[]) => sendMail(...a) }) },
}));

const TENANT_SMTP = {
  host: 'smtp.victim.example',
  port: 587,
  secure: false,
  username: 'victim',
  passwordEnc: null,
  fromAddress: 'billing@victim.example',
};

function makeDeps(enabled: boolean) {
  return {
    prisma: {
      appTenant: {
        findUnique: jest.fn().mockResolvedValue(enabled ? { status: 'ACTIVE' } : null),
      },
      smtpConfig: {
        findUnique: jest.fn().mockResolvedValue(TENANT_SMTP),
        findFirst: jest.fn().mockResolvedValue({ ...TENANT_SMTP, fromAddress: 'noreply@platform' }),
      },
    },
    audit: { record: jest.fn() },
  };
}

const svc = (deps: ReturnType<typeof makeDeps>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new EmailService(deps.prisma as any, deps.audit as any);

const callingApp = { id: 'app-row-1', clientId: 'app_attacker' } as App;
const dto = (tenantId?: string) =>
  ({ to: 'anyone@anywhere.test', subject: 'hi', html: '<b>x</b>', tenantId }) as SendEmailDto;

beforeEach(() => {
  jest.clearAllMocks();
  _resetEmailQuotasForTests();
});

describe('POST /email/send tenant authorization', () => {
  it('refuses a tenant the calling app is not enabled for', async () => {
    const deps = makeDeps(false);

    await expect(svc(deps).send(dto('victim-tenant'), callingApp)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // The check must come BEFORE resolveConfig: reaching it would decrypt the
    // victim's SMTP password even if the send were later refused.
    expect(deps.prisma.smtpConfig.findUnique).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('allows a tenant the app IS enabled for', async () => {
    const deps = makeDeps(true);

    const out = await svc(deps).send(dto('own-tenant'), callingApp);

    expect(out).toEqual({ ok: true, messageId: 'm1' });
    expect(deps.prisma.appTenant.findUnique).toHaveBeenCalledWith({
      where: { tenantId_appId: { tenantId: 'own-tenant', appId: 'app-row-1' } },
    });
  });

  // Platform-internal sends - verification, recovery, invites, billing health -
  // pass no app. The tenant they name came from the platform's own lookup, not
  // a request body, so gating them would break recovery for every tenant.
  it('leaves platform-internal sends ungated', async () => {
    const deps = makeDeps(false);

    const out = await svc(deps).send(dto('any-tenant'));

    expect(out.ok).toBe(true);
    expect(deps.prisma.appTenant.findUnique).not.toHaveBeenCalled();
  });

  // An app-originated send with no tenantId uses the platform default relay,
  // which is not any customer's domain, so there is no relationship to check.
  it('does not gate an app send that names no tenant', async () => {
    const deps = makeDeps(false);

    const out = await svc(deps).send(dto(undefined), callingApp);

    expect(out.ok).toBe(true);
    expect(deps.prisma.appTenant.findUnique).not.toHaveBeenCalled();
  });

  it('records the calling app on the audit row', async () => {
    const deps = makeDeps(true);

    await svc(deps).send(dto('own-tenant'), callingApp);

    expect(deps.audit.record).toHaveBeenCalledWith(
      'email.sent',
      expect.objectContaining({ appClientId: 'app_attacker' }),
    );
  });
});

// An app-originated send that names no tenant uses the platform default relay
// with a caller-written recipient, subject and body. One leaked client secret
// was therefore an SPF/DKIM-aligned relay under the platform's own sending
// domain, bounded only by the per-IP throttle (#155).
describe('POST /email/send per-app quota', () => {
  const saved = { ...config.emailAppQuota };
  const status = (e: unknown) => (e instanceof HttpException ? e.getStatus() : undefined);
  const breaches = (deps: ReturnType<typeof makeDeps>) =>
    deps.audit.record.mock.calls.filter((c) => c[0] === 'email.quota_exceeded');

  beforeEach(() => {
    config.emailAppQuota.perMin = 2;
    config.emailAppQuota.perDay = 3;
  });
  afterAll(() => Object.assign(config.emailAppQuota, saved));

  it('lets an app send up to its per-minute ceiling, then answers 429', async () => {
    const deps = makeDeps(true);
    await svc(deps).send(dto(undefined), callingApp);
    await svc(deps).send(dto(undefined), callingApp);
    await expect(svc(deps).send(dto(undefined), callingApp)).rejects.toSatisfy(
      (e: unknown) => status(e) === 429,
    );
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('audits a breach once per minute, not once per refused attempt', async () => {
    const deps = makeDeps(true);
    await svc(deps).send(dto(undefined), callingApp);
    await svc(deps).send(dto(undefined), callingApp);
    for (let i = 0; i < 3; i++) {
      await expect(svc(deps).send(dto(undefined), callingApp)).rejects.toBeInstanceOf(HttpException);
    }
    expect(breaches(deps)).toHaveLength(1);
    expect(breaches(deps)[0][1]).toMatchObject({ appClientId: 'app_attacker' });
  });

  it('enforces the daily ceiling as well', async () => {
    config.emailAppQuota.perMin = 10;
    const deps = makeDeps(true);
    for (let i = 0; i < 3; i++) await svc(deps).send(dto(undefined), callingApp);
    await expect(svc(deps).send(dto(undefined), callingApp)).rejects.toSatisfy(
      (e: unknown) => status(e) === 429,
    );
  });

  it('meters each app separately', async () => {
    const deps = makeDeps(true);
    const other = { id: 'app-row-2', clientId: 'app_other' } as App;
    await svc(deps).send(dto(undefined), callingApp);
    await svc(deps).send(dto(undefined), callingApp);
    await expect(svc(deps).send(dto(undefined), other)).resolves.toMatchObject({ ok: true });
  });

  // Verification, recovery, invites and billing mail pass no app; a quota on
  // those would let one noisy tenant break password reset for everyone.
  it('does not meter platform-internal sends', async () => {
    const deps = makeDeps(true);
    for (let i = 0; i < 5; i++) {
      await expect(svc(deps).send(dto(undefined))).resolves.toMatchObject({ ok: true });
    }
    expect(breaches(deps)).toHaveLength(0);
  });
});
