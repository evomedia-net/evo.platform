// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Which SMTP config a send uses: tenant's own, then the platform default,
 * then the environment fallback (#51).
 *
 * The NULL-tenant row means "the platform default" - a kind of row encoded as
 * a missing value, which is the shape the NULL-is-not-a-kind rule exists to
 * stop. The cheap half of that rule shipped in migration
 * 20260821000000_smtp_default_unique: a partial unique index so only one
 * default row can exist, since a plain @unique lets Postgres treat every NULL
 * as distinct and permits unlimited default rows.
 *
 * The half that was missing is this file. #51 asked for it in as many words:
 * "whoever does this needs a test that proves all three resolution branches
 * still work - tenant-specific config, fall-through to platform default,
 * fall-through to env - before and after." Mail failures are silent. If the
 * resolution order breaks during a refactor nothing crashes: verification
 * links, invites and password resets simply stop arriving, the site looks
 * healthy, and you hear about it from a customer rather than a monitor.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { EmailService, _resetEmailQuotasForTests } from './email.service';
import { SendEmailDto } from './dto';
import { config } from '../config';

const sendMail = jest.fn().mockResolvedValue({ messageId: 'm1' });
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: (opts: unknown) => {
    createTransport(opts);
    return { sendMail: (...a: unknown[]) => sendMail(...a) };
  } },
}));
const createTransport = jest.fn();

const TENANT_ROW = {
  host: 'smtp.tenant.example', port: 587, secure: false,
  username: 'tenant', passwordEnc: null, fromAddress: 'alerts@tenant.example',
};
const DEFAULT_ROW = {
  host: 'smtp.platform.example', port: 2525, secure: true,
  username: 'platform', passwordEnc: null, fromAddress: 'noreply@platform.example',
};

/** own: the tenant's own row, or null. fallback: the NULL-tenant row, or null. */
function deps(own: unknown, fallback: unknown) {
  return {
    prisma: {
      appTenant: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      smtpConfig: {
        findUnique: jest.fn().mockResolvedValue(own),
        findFirst: jest.fn().mockResolvedValue(fallback),
      },
    },
    audit: { record: jest.fn() },
  };
}

const svc = (d: ReturnType<typeof deps>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new EmailService(d.prisma as any, d.audit as any);

const dto = (tenantId?: string) =>
  ({ to: 'someone@example.test', subject: 'hi', html: '<b>x</b>', tenantId }) as SendEmailDto;

beforeEach(() => {
  jest.clearAllMocks();
  _resetEmailQuotasForTests();
});

describe('SMTP resolution order (#51)', () => {
  it("uses the tenant's own config when it has one", async () => {
    const d = deps(TENANT_ROW, DEFAULT_ROW);
    await svc(d).send(dto('tenant-1'));

    expect(d.prisma.smtpConfig.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1' },
    });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: TENANT_ROW.host, port: TENANT_ROW.port }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: TENANT_ROW.fromAddress }),
    );
  });

  it('falls through to the platform default when the tenant has none', async () => {
    const d = deps(null, DEFAULT_ROW);
    await svc(d).send(dto('tenant-without-config'));

    expect(d.prisma.smtpConfig.findFirst).toHaveBeenCalledWith({
      where: { tenantId: null },
    });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: DEFAULT_ROW.host, secure: true }),
    );
  });

  it('uses the platform default for a send that names no tenant', async () => {
    const d = deps(TENANT_ROW, DEFAULT_ROW);
    await svc(d).send(dto(undefined));

    expect(d.prisma.smtpConfig.findUnique).not.toHaveBeenCalled();
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: DEFAULT_ROW.host }),
    );
  });

  it('falls through to the environment when there is no default row', async () => {
    const previous = { ...config.smtpFallback };
    Object.assign(config.smtpFallback, {
      host: 'smtp.env.example', port: 25, secure: false,
      username: null, password: null, fromAddress: 'env@platform.example',
    });
    try {
      const d = deps(null, null);
      await svc(d).send(dto('tenant-1'));
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'smtp.env.example', port: 25 }),
      );
    } finally {
      Object.assign(config.smtpFallback, previous);
    }
  });

  it('refuses rather than guessing when nothing is configured anywhere', async () => {
    const previous = { ...config.smtpFallback };
    Object.assign(config.smtpFallback, { host: '' });
    try {
      await expect(svc(deps(null, null)).send(dto('tenant-1'))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(sendMail).not.toHaveBeenCalled();
    } finally {
      Object.assign(config.smtpFallback, previous);
    }
  });

  it('asks for the default row by NULL tenant, which the partial index keeps unique', async () => {
    // findFirst on a NULL-tenant row would pick an arbitrary one of several.
    // The migration is what guarantees there is only ever one to pick.
    const d = deps(null, DEFAULT_ROW);
    await svc(d).send(dto(undefined));
    const [[arg]] = d.prisma.smtpConfig.findFirst.mock.calls;
    expect(arg).toEqual({ where: { tenantId: null } });
  });
});
