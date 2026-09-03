// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import nodemailer from 'nodemailer';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret } from '../core/crypto.util';
import { config } from '../config';
import { SendEmailDto, UpsertSmtpDto } from './dto';
import type { App } from '@prisma/client';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Send timestamps per app id, kept for a day. Per-process, like the recovery
 *  limiter; docs/INSTALL.md records the single-container assumption. */
const sendWindows = new Map<string, number[]>();
/** When each app's breach was last audited, so a runaway app writes one row a
 *  minute rather than one per refused attempt - the audit table is not
 *  another thing it gets to fill. */
const breachNoted = new Map<string, number>();

/** Quotas are process state; tests reset them. */
export function _resetEmailQuotasForTests(): void {
  sendWindows.clear();
  breachNoted.clear();
}

interface ResolvedSmtp {
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string | null;
  fromAddress: string;
}

@Injectable()
export class EmailService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Resolution order: tenant config → platform default (NULL-tenant row) → env fallback. */
  private async resolveConfig(tenantId?: string): Promise<ResolvedSmtp> {
    if (tenantId) {
      const own = await this.prisma.smtpConfig.findUnique({ where: { tenantId } });
      if (own) {
        return { ...own, password: own.passwordEnc ? decryptSecret(own.passwordEnc) : null };
      }
    }
    const fallback = await this.prisma.smtpConfig.findFirst({ where: { tenantId: null } });
    if (fallback) {
      return {
        ...fallback,
        password: fallback.passwordEnc ? decryptSecret(fallback.passwordEnc) : null,
      };
    }
    if (config.smtpFallback.host) {
      return config.smtpFallback as ResolvedSmtp;
    }
    throw new ServiceUnavailableException('No SMTP configuration available');
  }

  /**
   * Send a message.
   *
   * `callingApp` is set only for calls that arrived over client credentials
   * (POST /email/send). Platform-internal sends - verification, recovery,
   * invites, billing health - pass nothing and are trusted, because the
   * tenant they name came from the platform's own lookup rather than a
   * request body.
   *
   * For an app-originated call the relationship is REQUIRED before a
   * tenant-scoped relay is used. Without it, any app holding any valid client
   * secret could name another workspace's tenant id and have the platform
   * decrypt that workspace's SMTP password and send attacker-authored HTML
   * from their address, SPF/DKIM-aligned with their real domain. This is the
   * same gate BillingService.requireRelationship applies for the same reason:
   * one app's credentials must not reach another app's customers.
   */
  async send(dto: SendEmailDto, callingApp?: App) {
    if (callingApp && dto.tenantId) {
      const access = await this.prisma.appTenant.findUnique({
        where: { tenantId_appId: { tenantId: dto.tenantId, appId: callingApp.id } },
      });
      if (!access) throw new ForbiddenException('App is not enabled for this workspace');
    }
    if (callingApp) await this.assertQuota(callingApp);
    const smtp = await this.resolveConfig(dto.tenantId);
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.username ? { user: smtp.username, pass: smtp.password ?? '' } : undefined,
    });
    const info = await transport.sendMail({
      // Address always from config; only the display name is caller-supplied,
      // and nodemailer escapes it into the header.
      from: dto.fromName ? { name: dto.fromName, address: smtp.fromAddress } : smtp.fromAddress,
      to: dto.to,
      subject: dto.subject,
      text: dto.text,
      html: dto.html,
    });
    await this.audit.record('email.sent', {
      tenantId: dto.tenantId,
      appClientId: callingApp?.clientId,
      detail: { to: dto.to, subject: dto.subject },
    });
    return { ok: true, messageId: info.messageId };
  }

  /**
   * Per-app ceiling on app-originated sends (#155).
   *
   * Charged before the send rather than after: a message the relay refuses
   * still cost an attempt, and an app that is failing loudly should not get
   * unlimited retries either. The breach is audited once a minute per app.
   */
  private async assertQuota(app: App): Promise<void> {
    const now = Date.now();
    const sends = (sendWindows.get(app.id) ?? []).filter((t) => t > now - DAY);
    const lastMinute = sends.filter((t) => t > now - MINUTE).length;
    const { perMin, perDay } = config.emailAppQuota;
    if (lastMinute >= perMin || sends.length >= perDay) {
      const noted = breachNoted.get(app.id) ?? 0;
      if (now - noted > MINUTE) {
        breachNoted.set(app.id, now);
        await this.audit.record('email.quota_exceeded', {
          appClientId: app.clientId,
          detail: { lastMinute, lastDay: sends.length, perMin, perDay },
        });
      }
      throw new HttpException('Email quota exceeded for this app', HttpStatus.TOO_MANY_REQUESTS);
    }
    sends.push(now);
    sendWindows.set(app.id, sends);
  }

  async upsertConfig(dto: UpsertSmtpDto) {
    const data = {
      host: dto.host,
      port: dto.port,
      secure: dto.secure,
      username: dto.username ?? null,
      passwordEnc: dto.password ? encryptSecret(dto.password) : null,
      fromAddress: dto.fromAddress,
    };
    const tenantId = dto.tenantId ?? null;
    // tenantId is nullable-unique, so upsert manually for the NULL default row
    const existing = await this.prisma.smtpConfig.findFirst({ where: { tenantId } });
    const saved = existing
      ? await this.prisma.smtpConfig.update({ where: { id: existing.id }, data })
      : await this.prisma.smtpConfig.create({ data: { ...data, tenantId } });
    return this.mask(saved);
  }

  async getConfig(tenantId?: string) {
    const found = await this.prisma.smtpConfig.findFirst({ where: { tenantId: tenantId ?? null } });
    return found ? this.mask(found) : null;
  }

  private mask<T extends { passwordEnc?: string | null }>(cfg: T) {
    const { passwordEnc, ...rest } = cfg;
    return { ...rest, hasPassword: Boolean(passwordEnc) };
  }
}
