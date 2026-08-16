// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { EmailTemplateService } from './email-template.service';
import { NotFoundException } from '@nestjs/common';

const audit = { record: jest.fn().mockResolvedValue(undefined) };

const svc = (saved: Record<string, unknown> | null, failing = false) =>
  new EmailTemplateService(
    {
      emailTemplate: {
        findUnique: failing
          ? jest.fn().mockRejectedValue(new Error('db down'))
          : jest.fn().mockResolvedValue(saved),
        upsert: jest.fn(async ({ create }: { create: unknown }) => create),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue(saved ? [saved] : []),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    audit as any,
  );

const VARS = { productName: 'SWAG Estimates', email: 'kelly@evomedia.net', expiryMinutes: '30' };

beforeEach(() => jest.clearAllMocks());

describe('rendering', () => {
  it('uses the built-in copy when nothing has been customised', async () => {
    const msg = await svc(null).render('password_reset', VARS, 'https://p.test/r');
    expect(msg.subject).toBe('Reset your SWAG Estimates password');
    expect(msg.html).toContain('SWAG Estimates');
    expect(msg.html).toContain('https://p.test/r');
  });

  it('a saved row overrides the default', async () => {
    const msg = await svc({
      code: 'password_reset',
      subject: 'Custom: {{productName}}',
      heading: 'Custom heading',
      intro: 'Line one.',
      actionLabel: 'Go',
      outro: 'Bye.',
    }).render('password_reset', VARS, 'https://p.test/r');
    expect(msg.subject).toBe('Custom: SWAG Estimates');
    expect(msg.html).toContain('Custom heading');
  });

  // The rule the whole design hangs on: editing copy must never be able to
  // break password recovery.
  it('falls back to the default when a saved row is unusable', async () => {
    const msg = await svc({
      code: 'password_reset',
      subject: '   ',
      heading: '',
      intro: '',
      outro: '',
    }).render('password_reset', VARS, 'https://p.test/r');
    expect(msg.subject).toBe('Reset your SWAG Estimates password');
    expect(msg.html).toContain('Reset my password');
  });

  it('still sends when the template table cannot be read at all', async () => {
    const msg = await svc(null, true).render('password_reset', VARS, 'https://p.test/r');
    expect(msg.subject).toBe('Reset your SWAG Estimates password');
  });

  it('escapes values, so a workspace name cannot inject markup', async () => {
    const msg = await svc(null).render(
      'member_invite',
      {
        productName: 'EvoPlatform',
        inviter: '<script>alert(1)</script>',
        workspace: 'Acme',
        expiryHours: '24',
      },
      'https://p.test/i',
    );
    expect(msg.html).not.toContain('<script>alert(1)</script>');
    expect(msg.html).toContain('&lt;script&gt;');
  });

  it('leaves an unknown placeholder visible rather than blanking it', async () => {
    const msg = await svc({
      code: 'password_reset',
      subject: 'Hi',
      heading: 'Hello {{nope}}',
      intro: 'x',
      outro: 'y',
    }).render('password_reset', VARS, 'https://p.test/r');
    // A visible {{nope}} tells an operator something is wrong; a silent gap
    // just looks like sloppy copy.
    expect(msg.html).toContain('{{nope}}');
  });

  it('splits paragraphs on newlines, in both parts', async () => {
    const msg = await svc(null).render('password_reset', VARS, 'https://p.test/r');
    // The default outro is two lines; both must survive.
    expect(msg.text).toContain('valid for 30 minutes');
    expect(msg.text).toMatch(/ignore this email/i);
  });

  it('renders no button when the message has no action url', async () => {
    const msg = await svc(null).render('password_reset', VARS);
    expect(msg.html).not.toContain('bgcolor');
  });

  it('refuses an unknown code rather than sending something blank', async () => {
    await expect(svc(null).render('nope', VARS)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('console surface', () => {
  it('lists every template, marking which are customised', async () => {
    const list = await svc(null).list();
    expect(list.map((t) => t.code).sort()).toEqual([
      'email_verify',
      'member_invite',
      'password_reset',
      'workspace_list',
    ]);
    expect(list.every((t) => t.customized === false)).toBe(true);
    // The default travels with the row so "revert" needs no second call.
    expect(list[0].default.subject).toBeTruthy();
  });

  it('reset drops the override', async () => {
    const out = await svc(null).reset('password_reset', 'u1');
    expect(out).toEqual({ ok: true });
    expect(audit.record).toHaveBeenCalledWith(
      'email.template_reset',
      expect.objectContaining({ detail: { code: 'password_reset' } }),
    );
  });

  it('save and reset refuse an unknown code', async () => {
    const s = svc(null);
    const copy = { subject: 'a', heading: 'b', intro: 'c', outro: 'd' };
    await expect(s.save('nope', copy)).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.reset('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sample values fill every variable a preview can show', async () => {
    const s = svc(null);
    const list = await s.list();
    for (const t of list) {
      const vars = s.sampleVars(t.code);
      for (const v of t.variables) expect(vars[v]).toBeTruthy();
    }
  });
});
