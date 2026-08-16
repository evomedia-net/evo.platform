// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailBody, esc, renderEmail } from './email-layout';
import { isUsable, TEMPLATE_BY_CODE, TEMPLATES, TemplateCopy } from './email-templates';

export interface RenderedMessage {
  subject: string;
  html: string;
  text: string;
}

/**
 * Turns a template code plus values into a ready-to-send message.
 *
 * The one rule that shapes everything here: **mail must not depend on the
 * editor**. A missing row, an empty heading, a row saved with the subject
 * deleted — every one of those falls back to the built-in default and logs,
 * rather than throwing. Locking someone out of password recovery because an
 * administrator fat-fingered a template would be a far worse failure than
 * sending them the stock wording.
 */
@Injectable()
export class EmailTemplateService {
  private readonly log = new Logger(EmailTemplateService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Built-in copy for a code, or undefined when the code is unknown. */
  private seed(code: string) {
    return TEMPLATE_BY_CODE.get(code);
  }

  /**
   * Substitute {{name}} values.
   *
   * The template body is admin-authored and trusted as HTML; the values are
   * NOT — an address or workspace name is user input. So values are escaped
   * for the HTML part and left raw for the text part, and an unknown
   * placeholder is left visible rather than silently blanked, because a
   * reader seeing "{{workspace}}" tells an operator something is wrong far
   * faster than an empty gap does.
   */
  private fill(template: string, vars: Record<string, string>, escapeValues: boolean): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) => {
      const value = vars[key];
      if (value === undefined) return whole;
      return escapeValues ? esc(value) : value;
    });
  }

  private toBody(copy: TemplateCopy, vars: Record<string, string>, actionUrl?: string): EmailBody {
    const lines = (s: string) =>
      s
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    return {
      product: vars.productName ?? 'EvoPlatform',
      heading: this.fill(copy.heading, vars, true),
      intro: lines(this.fill(copy.intro, vars, true)),
      ...(actionUrl && copy.actionLabel
        ? { action: { label: this.fill(copy.actionLabel, vars, true), url: actionUrl } }
        : {}),
      outro: lines(this.fill(copy.outro, vars, true)),
    };
  }

  /**
   * Render a message. `actionUrl` is passed separately from the variables
   * because it is never operator-editable: the destination of a link in a
   * password-reset email is decided by the platform, not by copy.
   */
  async render(
    code: string,
    vars: Record<string, string>,
    actionUrl?: string,
  ): Promise<RenderedMessage> {
    const seed = this.seed(code);
    if (!seed) throw new NotFoundException(`Unknown email template "${code}"`);

    let copy: TemplateCopy = seed;
    try {
      const saved = await this.prisma.emailTemplate.findUnique({ where: { code } });
      if (saved) {
        if (isUsable(saved)) {
          copy = saved;
        } else {
          this.log.warn(`Email template "${code}" is incomplete; using the built-in default.`);
        }
      }
    } catch (err) {
      // A database hiccup must not stop a password reset going out.
      this.log.warn(`Could not load email template "${code}": ${String(err)}`);
    }

    let body: EmailBody;
    let subject: string;
    try {
      body = this.toBody(copy, vars, actionUrl);
      subject = this.fill(copy.subject, vars, false);
    } catch (err) {
      this.log.warn(`Email template "${code}" failed to render; using the default: ${String(err)}`);
      body = this.toBody(seed, vars, actionUrl);
      subject = this.fill(seed.subject, vars, false);
    }
    const { html, text } = renderEmail(body);
    return { subject, html, text };
  }

  // ---- console ----

  /** Every template, with its saved copy when there is one. */
  async list() {
    const saved = await this.prisma.emailTemplate.findMany();
    const byCode = new Map(saved.map((s) => [s.code, s]));
    return TEMPLATES.map((t) => {
      const row = byCode.get(t.code);
      return {
        code: t.code,
        description: t.description,
        variables: t.variables,
        customized: Boolean(row),
        updatedAt: row?.updatedAt ?? null,
        subject: row?.subject ?? t.subject,
        heading: row?.heading ?? t.heading,
        intro: row?.intro ?? t.intro,
        actionLabel: row?.actionLabel ?? t.actionLabel ?? '',
        outro: row?.outro ?? t.outro,
        // So the console can offer "revert to default" without a second call.
        default: {
          subject: t.subject,
          heading: t.heading,
          intro: t.intro,
          actionLabel: t.actionLabel ?? '',
          outro: t.outro,
        },
      };
    });
  }

  async save(code: string, copy: TemplateCopy, actorId?: string) {
    const seed = this.seed(code);
    if (!seed) throw new NotFoundException(`Unknown email template "${code}"`);
    const row = await this.prisma.emailTemplate.upsert({
      where: { code },
      create: { code, ...copy, updatedById: actorId },
      update: { ...copy, updatedById: actorId },
    });
    await this.audit.record('email.template_updated', { userId: actorId, detail: { code } });
    return row;
  }

  /** Drop the override; the built-in default takes over again. */
  async reset(code: string, actorId?: string) {
    if (!this.seed(code)) throw new NotFoundException(`Unknown email template "${code}"`);
    await this.prisma.emailTemplate.deleteMany({ where: { code } });
    await this.audit.record('email.template_reset', { userId: actorId, detail: { code } });
    return { ok: true };
  }

  /** Sample values so a preview shows a realistic message, not empty gaps. */
  sampleVars(code: string): Record<string, string> {
    return {
      productName: 'SWAG Estimates',
      email: 'someone@example.com',
      expiryMinutes: '30',
      expiryHours: '24',
      inviter: 'Kelly Michels',
      workspace: 'Acme Industrial',
      workspaces: '  acme  (Acme Industrial)\n  acme-eu  (Acme Europe)',
      signInUrl: 'https://swag.evomedia.net/login',
      ...(code === 'workspace_list' ? {} : {}),
    };
  }
}
