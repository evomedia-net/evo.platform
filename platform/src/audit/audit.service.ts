import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';

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
