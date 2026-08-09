// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Sync v2 server logic, factored out of the route for testability. Both
 * functions take a Prisma transaction handle and MUST run inside a
 * transaction that first acquires the per-tenant advisory lock:
 *
 *   SELECT pg_advisory_xact_lock(hashtext(<tenantId>))
 *
 * INVARIANT: every write path that touches Project/Task for a tenant must
 * hold that lock. It serializes pushes per tenant, which is what makes the
 * single-sequence cursor gap-safe (no commit-order races where a lower
 * rowVersion commits after a higher one was already pulled).
 *
 * Conflict resolution is server-receive-order LWW: mutations are applied
 * unconditionally in arrival order. Client clocks are never consulted.
 */
import { Prisma } from "@prisma/client";
import type {
  ProjectData,
  RejectReason,
  ServerProject,
  ServerTask,
  SyncMutation,
  TaskData,
} from "./protocol";

type Tx = Prisma.TransactionClient;

export interface ApplyResult {
  applied: number[];
  rejected: Array<{ seq: number; reason: RejectReason }>;
}

export async function applyMutations(
  tx: Tx,
  tenantId: string,
  mutations: SyncMutation[],
): Promise<ApplyResult> {
  const applied: number[] = [];
  const rejected: Array<{ seq: number; reason: RejectReason }> = [];
  const now = new Date();

  for (const m of mutations) {
    try {
      if (m.table === "project") {
        if (m.op === "upsert") {
          const data = m.data as ProjectData | undefined;
          if (!data?.name || typeof data.status !== "string") {
            rejected.push({ seq: m.seq, reason: "invalid" });
            continue;
          }
          const existing = await tx.project.findUnique({ where: { id: m.id } });
          if (existing && existing.tenantId !== tenantId) {
            rejected.push({ seq: m.seq, reason: "id-conflict" });
            continue;
          }
          const fields = {
            name: data.name,
            description: data.description ?? null,
            status: data.status,
            deletedAt: null, // an upsert un-tombstones — recreating is legitimate
          };
          await tx.project.upsert({
            where: { id: m.id },
            create: { id: m.id, tenantId, ...fields },
            update: fields,
          });
          applied.push(m.seq);
        } else {
          // delete → tombstone
          const existing = await tx.project.findUnique({ where: { id: m.id } });
          if (existing && existing.tenantId !== tenantId) {
            rejected.push({ seq: m.seq, reason: "id-conflict" });
            continue;
          }
          if (existing && !existing.deletedAt) {
            await tx.project.update({ where: { id: m.id }, data: { deletedAt: now } });
          }
          applied.push(m.seq); // deleting a non-existent row is a no-op success
        }
      } else {
        // ── task ──
        if (m.op === "upsert") {
          const data = m.data as TaskData | undefined;
          if (!data?.projectId || !data.title) {
            rejected.push({ seq: m.seq, reason: "invalid" });
            continue;
          }
          const parent = await tx.project.findUnique({ where: { id: data.projectId } });
          if (parent && parent.tenantId !== tenantId) {
            rejected.push({ seq: m.seq, reason: "id-conflict" });
            continue;
          }
          if (!parent) {
            // Orphan task write (project row never pushed) — create a stub.
            await tx.project.create({
              data: { id: data.projectId, tenantId, name: data.projectId, status: "Active" },
            });
          }
          const existing = await tx.task.findUnique({ where: { id: m.id } });
          if (existing && existing.tenantId !== tenantId) {
            rejected.push({ seq: m.seq, reason: "id-conflict" });
            continue;
          }
          const fields = {
            title: data.title,
            done: Boolean(data.done),
            deletedAt: null,
          };
          await tx.task.upsert({
            where: { id: m.id },
            create: { id: m.id, tenantId, projectId: data.projectId, ...fields },
            update: fields,
          });
          applied.push(m.seq);
        } else {
          const existing = await tx.task.findUnique({ where: { id: m.id } });
          if (existing && existing.tenantId !== tenantId) {
            rejected.push({ seq: m.seq, reason: "id-conflict" });
            continue;
          }
          if (existing && !existing.deletedAt) {
            await tx.task.update({ where: { id: m.id }, data: { deletedAt: now } });
          }
          applied.push(m.seq);
        }
      }
    } catch (err) {
      // A single bad mutation must not poison the batch.
      console.error("[sync] mutation failed", { seq: m.seq, id: m.id }, err);
      rejected.push({ seq: m.seq, reason: "invalid" });
    }
  }

  return { applied, rejected };
}

export interface PullResult {
  projects: ServerProject[];
  tasks: ServerTask[];
  cursor: bigint;
  hasMore: boolean;
}

export async function pullChanges(
  tx: Tx,
  tenantId: string,
  cursor: bigint,
  limit: number,
): Promise<PullResult> {
  const projects = await tx.project.findMany({
    where: { tenantId, rowVersion: { gt: cursor } },
    orderBy: { rowVersion: "asc" },
    take: limit,
  });
  const tasks = await tx.task.findMany({
    where: { tenantId, rowVersion: { gt: cursor } },
    orderBy: { rowVersion: "asc" },
    take: limit,
  });

  const prjTruncated = projects.length === limit;
  const tskTruncated = tasks.length === limit;
  const hasMore = prjTruncated || tskTruncated;

  const maxPrj = projects.length ? projects[projects.length - 1].rowVersion : cursor;
  const maxTsk = tasks.length ? tasks[tasks.length - 1].rowVersion : cursor;

  // Untruncated tables are fully caught up; a truncated table caps the cursor
  // at its own max so nothing between pages is skipped. Re-pulled rows from
  // the other table are harmless (idempotent puts client-side).
  let next: bigint;
  if (!hasMore) {
    next = maxPrj > maxTsk ? maxPrj : maxTsk;
  } else if (prjTruncated && tskTruncated) {
    next = maxPrj < maxTsk ? maxPrj : maxTsk;
  } else {
    next = prjTruncated ? maxPrj : maxTsk;
  }
  if (next < cursor) next = cursor;

  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
      rowVersion: p.rowVersion.toString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      title: t.title,
      done: t.done,
      deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
      rowVersion: t.rowVersion.toString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
    cursor: next,
    hasMore,
  };
}
