// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';

/** Enough for a structured detail record; not enough to bloat the table. */
export const MAX_APP_EVENT_DETAIL_BYTES = 4096;

export interface AppEventInput {
  action: string;
  tenantId?: string;
  userId?: string;
  detail?: unknown;
}

export interface AuditMeta {
  tenantId?: string;
  userId?: string;
  appClientId?: string;
  ip?: string;
  detail?: unknown;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  /**
   * An event pushed by a registered app over client credentials.
   *
   * Three things the plain record() path trusts, because its callers are the
   * platform's own services, cannot be trusted here. The tenant named must be
   * one the app is enabled for - without that check any app holding any valid
   * client secret could write rows against every workspace on the platform
   * (#154), the same gate BillingService.requireRelationship and
   * EmailService.send apply. The user named must belong to that tenant. And
   * the action is stored under the app's own namespace, `<app name>.<action>`,
   * so a row that reads `auth.login` can only ever have been written by the
   * platform: an app's `auth.signup` lands as `civilcode.auth.signup`. A
   * blocklist of platform prefixes would have done the same job by refusing,
   * but the starter template's own audit() pushes `auth.*` events, so refusing
   * would have silently dropped them from every app built on it.
   */
  async recordFromApp(app: { id: string; clientId: string; name: string }, input: AppEventInput) {
    const action = `${app.name}.${input.action.trim()}`;
    if (input.detail !== undefined) {
      const bytes = Buffer.byteLength(JSON.stringify(input.detail) ?? '', 'utf8');
      if (bytes > MAX_APP_EVENT_DETAIL_BYTES) {
        throw new BadRequestException(
          `detail is ${bytes} bytes; the limit is ${MAX_APP_EVENT_DETAIL_BYTES}`,
        );
      }
    }
    if (input.tenantId) {
      const access = await this.prisma.appTenant.findUnique({
        where: { tenantId_appId: { tenantId: input.tenantId, appId: app.id } },
      });
      if (!access) throw new ForbiddenException('App is not enabled for this workspace');
      if (input.userId) {
        const member = await this.prisma.user.findFirst({
          where: { id: input.userId, tenantId: input.tenantId },
          select: { id: true },
        });
        if (!member) throw new BadRequestException('userId is not a member of that workspace');
      }
    } else if (input.userId) {
      throw new BadRequestException('userId requires tenantId');
    }
    return this.record(action, {
      tenantId: input.tenantId,
      userId: input.userId,
      appClientId: app.clientId,
      detail: input.detail,
    });
  }

  record(action: string, meta: AuditMeta = {}) {
    return this.prisma.auditEvent.create({
      data: {
        action,
        tenantId: meta.tenantId,
        userId: meta.userId,
        appClientId: meta.appClientId,
        ip: meta.ip,
        detail: (meta.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  list(
    filters: { tenantId?: string; action?: string; from?: Date; to?: Date; take?: number } = {},
  ) {
    const createdAt =
      filters.from || filters.to
        ? { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) }
        : undefined;
    return this.prisma.auditEvent.findMany({
      where: {
        ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
        ...(filters.action ? { action: filters.action } : {}),
        ...(createdAt ? { createdAt } : {}),
      },
      orderBy: { createdAt: 'desc' },
      // Export needs the full range; cap high but bounded.
      take: Math.min(filters.take ?? 100, 10000),
    });
  }
}
