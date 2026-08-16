// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret } from '../core/crypto.util';
import { config } from '../config';
import { SendEmailDto, UpsertSmtpDto } from './dto';

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

  async send(dto: SendEmailDto, appClientId?: string) {
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
      appClientId,
      detail: { to: dto.to, subject: dto.subject },
    });
    return { ok: true, messageId: info.messageId };
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
