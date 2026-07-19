import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SignupService } from './signup.service';
import { KeysService } from '../core/keys.service';
import { config } from '../config';

const keys = new KeysService();
const audit = { record: jest.fn().mockResolvedValue(undefined) };
const flows = { sendVerification: jest.fn().mockResolvedValue({ ok: true }) };

function makePrisma() {
  const tx = {
    tenant: { create: jest.fn().mockResolvedValue({ id: 't9', slug: 'initech-llc' }) },
    user: { create: jest.fn().mockResolvedValue({ id: 'u9' }) },
    appTenant: { create: jest.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    app: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', clientId: 'app_demo' }) },
    tenant: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeSvc = (prisma: any) => new SignupService(prisma, keys, audit as any, flows as any);

const dto = {
  company: 'Initech LLC',
  email: 'Peter@Initech.example',
  password: 'Init3ch!!99',
  clientId: 'app_demo',
};

beforeAll(() => keys.loadOrGenerate(mkdtempSync(join(tmpdir(), 'evokeys-'))));
beforeEach(() => {
  jest.clearAllMocks();
  config.signup.mode = 'open';
});
afterAll(() => {
  config.signup.mode = 'closed';
});

describe('SignupService', () => {
  it('refuses when SIGNUP_MODE=closed', async () => {
    config.signup.mode = 'closed';
    await expect(makeSvc(makePrisma()).signup(dto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invite mode requires a valid platform-issued link token', async () => {
    config.signup.mode = 'invite';
    const svc = makeSvc(makePrisma());
    await expect(svc.signup(dto)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.signup({ ...dto, inviteToken: 'garbage' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const wrongPurpose = keys.sign({ purpose: 'email_verify' }, 60);
    await expect(svc.signup({ ...dto, inviteToken: wrongPurpose })).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const link = svc.issueSignupLink(1);
    const out = await svc.signup({ ...dto, inviteToken: link.token });
    expect(out.ok).toBe(true);
  });

  it('creates tenant + unverified founder tenant-admin + app trial', async () => {
    const prisma = makePrisma();
    const out = await makeSvc(prisma).signup(dto);

    expect(out).toMatchObject({ ok: true, tenantSlug: 'initech-llc', verificationRequired: true });

    const tenant = prisma.tx.tenant.create.mock.calls[0][0].data;
    expect(tenant).toMatchObject({ slug: 'initech-llc', name: 'Initech LLC' });

    const user = prisma.tx.user.create.mock.calls[0][0].data;
    expect(user.email).toBe('peter@initech.example');
    expect(user.isTenantAdmin).toBe(true); // the founder runs their workspace
    expect(user.emailVerifiedAt).toBeNull(); // and cannot log in until verified

    const access = prisma.tx.appTenant.create.mock.calls[0][0].data;
    expect(access.status).toBe('TRIAL');
    const days = (access.trialEndsAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);

    expect(flows.sendVerification).toHaveBeenCalledWith({
      tenantSlug: 'initech-llc',
      email: 'peter@initech.example',
    });
    expect(audit.record).toHaveBeenCalledWith('auth.signup', expect.anything());
  });

  it('rejects an unknown clientId — signups happen through an app', async () => {
    const prisma = makePrisma();
    prisma.app.findUnique.mockResolvedValue(null);
    await expect(makeSvc(prisma).signup(dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s an explicitly chosen slug that is taken', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'other' });
    await expect(makeSvc(prisma).signup({ ...dto, slug: 'initech-llc' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('suffixes a derived slug on collision instead of failing', async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: 'other' }); // base slug taken
    await makeSvc(prisma).signup(dto);
    const slug = prisma.tx.tenant.create.mock.calls[0][0].data.slug;
    expect(slug).toMatch(/^initech-llc-[0-9a-f]{4}$/);
  });
});
