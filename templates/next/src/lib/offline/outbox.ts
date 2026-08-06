// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Append-only outbox. Every local write enqueues a mutation; the sync client
 * drains it. Enqueue never mutates existing rows (a row may be in flight) —
 * coalescing happens at drain time: only the LAST mutation per rowId is sent,
 * and on success every snapshot seq for that row is deleted. Mutations
 * enqueued during a request have higher seqs and survive the drain, so
 * mid-flight edits are never clobbered.
 */
"use client";

import type { TenantDatabase, OutboxMutation } from "./tenantDb";

export async function enqueue(
  db: TenantDatabase,
  m: Omit<OutboxMutation, "seq" | "createdAt">,
): Promise<void> {
  await db.outbox.add({ ...m, createdAt: new Date().toISOString() });
}

/** All outbox rows targeting one row id (any op). */
export async function pendingForRow(db: TenantDatabase, rowId: string): Promise<OutboxMutation[]> {
  return db.outbox.where("rowId").equals(rowId).toArray();
}

/** Purge every pending mutation for a project and its tasks (used when the
 *  project is deleted locally so queued task writes can't resurrect a stub). */
export async function purgeForProject(db: TenantDatabase, projectId: string): Promise<void> {
  const prefix = `${projectId}::`;
  await db.outbox
    .filter((m) => m.rowId === projectId || m.rowId.startsWith(prefix))
    .delete();
}

export interface DrainSnapshot {
  /** Latest mutation per rowId, in ascending seq order — what gets sent. */
  toSend: OutboxMutation[];
  /** Every seq captured in this snapshot, keyed by rowId — deleted on apply. */
  seqsByRow: Map<string, number[]>;
}

/** Snapshot the outbox, coalescing to the last mutation per row. */
export async function snapshotForDrain(db: TenantDatabase): Promise<DrainSnapshot> {
  const all = await db.outbox.orderBy("seq").toArray();
  const latest = new Map<string, OutboxMutation>();
  const seqsByRow = new Map<string, number[]>();
  for (const m of all) {
    const key = `${m.table}:${m.rowId}`;
    latest.set(key, m);
    const seqs = seqsByRow.get(key) ?? [];
    seqs.push(m.seq!);
    seqsByRow.set(key, seqs);
  }
  const toSend = [...latest.values()].sort((a, b) => a.seq! - b.seq!);
  return { toSend, seqsByRow };
}

/** Delete every snapshot seq belonging to rows whose latest seq was applied. */
export async function deleteApplied(
  db: TenantDatabase,
  snapshot: DrainSnapshot,
  appliedSeqs: number[],
): Promise<void> {
  const applied = new Set(appliedSeqs);
  const toDelete: number[] = [];
  for (const m of snapshot.toSend) {
    if (!applied.has(m.seq!)) continue;
    const key = `${m.table}:${m.rowId}`;
    for (const seq of snapshot.seqsByRow.get(key) ?? []) toDelete.push(seq);
  }
  if (toDelete.length) await db.outbox.bulkDelete(toDelete);
}

/** True when any pending mutation exists for the given table+rowId. */
export async function hasPending(db: TenantDatabase, table: string, rowId: string): Promise<boolean> {
  const count = await db.outbox.where("[table+rowId]").equals([table, rowId]).count();
  return count > 0;
}
