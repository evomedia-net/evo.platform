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
import { ForbiddenException } from '@nestjs/common';
import type { App } from '@prisma/client';
import { EmailService } from './email.service';
import { SendEmailDto } from './dto';

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

beforeEach(() => jest.clearAllMocks());

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
