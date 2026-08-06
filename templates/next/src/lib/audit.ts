// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * App-level audit trail (template contract). Records locally always; in
 * platform mode the event is also pushed to the platform's central audit log
 * (fire-and-forget — a platform outage must never fail the user action).
 */
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPlatform, isPlatformMode } from "@/lib/platform";

export interface AuditMeta {
  tenantId?: string;
  userId?: string;
  detail?: unknown;
}

export async function audit(action: string, meta: AuditMeta = {}): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      action,
      tenantId: meta.tenantId,
      userId: meta.userId,
      detail: (meta.detail ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
  if (isPlatformMode()) {
    getPlatform()
      .pushEvent({ action, tenantId: meta.tenantId, userId: meta.userId, detail: meta.detail })
      .catch((err) => console.warn("[audit] platform push failed", err));
  }
}
