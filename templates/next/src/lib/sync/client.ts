// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Sync v2 client: drains the outbox, applies server changes, advances the
 * cursor. Multi-tab safe via the Web Locks API (one drain at a time per
 * tenant). Pending local mutations shadow pulled rows — local intent beats
 * a stale server echo.
 */
"use client";

import { getMeta, setMeta, type TenantDatabase } from "@/lib/offline/tenantDb";
import { deleteApplied, hasPending, snapshotForDrain } from "@/lib/offline/outbox";
import type { SyncMutation, SyncRequestV2, SyncResponseV2 } from "./protocol";

export type SyncStatus =
  | { kind: "idle"; lastSyncedAt: string | null }
  | { kind: "syncing" }
  | { kind: "error"; message: string; lastSyncedAt: string | null }
  | { kind: "offline"; lastSyncedAt: string | null };

const CURSOR_KEY = "cursor";
const CLIENT_ID_KEY = "clientId";
const LAST_SYNCED_KEY = "lastSyncedAt";
const MAX_PULL_LOOPS = 50;

export async function getLastSyncedAt(db: TenantDatabase): Promise<string | null> {
  return getMeta(db, LAST_SYNCED_KEY);
}

async function getClientId(db: TenantDatabase): Promise<string> {
  let id = await getMeta(db, CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await setMeta(db, CLIENT_ID_KEY, id);
  }
  return id;
}

/** Run one full sync (drain + pull-to-head). Safe to call opportunistically. */
export async function runSync(db: TenantDatabase): Promise<SyncStatus> {
  const lastSyncedAt = await getLastSyncedAt(db);

  // One drain per tenant across tabs. If another tab holds the lock, skip —
  // its sync covers our pending writes too (same Dexie DB).
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    let result: SyncStatus | null = null;
    await navigator.locks.request(
      `evoapp-sync-${db.tenantId}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          result = { kind: "idle", lastSyncedAt };
          return;
        }
        result = await syncOnce(db);
      },
    );
    return result ?? { kind: "idle", lastSyncedAt };
  }
  return syncOnce(db);
}

async function syncOnce(db: TenantDatabase): Promise<SyncStatus> {
  const lastSyncedAt = await getLastSyncedAt(db);
  const clientId = await getClientId(db);

  try {
    for (let loop = 0; loop < MAX_PULL_LOOPS; loop++) {
      const cursor = (await getMeta(db, CURSOR_KEY)) ?? "0";
      const snapshot = await snapshotForDrain(db);

      const mutations: SyncMutation[] = snapshot.toSend.map((m) => ({
        seq: m.seq!,
        table: m.table,
        op: m.op,
        id: m.rowId,
        data: m.data as SyncMutation["data"],
      }));

      const body: SyncRequestV2 = { v: 2, clientId, cursor, mutations };

      let response: Response;
      try {
        response = await fetch("/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        return { kind: "offline", lastSyncedAt };
      }

      if (response.status === 401) {
        return { kind: "error", message: "Session expired — sign in again", lastSyncedAt };
      }
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const j = (await response.json()) as { error?: string };
          if (j?.error) detail = j.error;
        } catch {
          /* ignore */
        }
        return { kind: "error", message: detail, lastSyncedAt };
      }

      const data = (await response.json()) as SyncResponseV2;

      if (data.resyncRequired) {
        // Cursor predates the GC horizon: local replica may hold rows whose
        // tombstones were purged. Wipe replica (outbox survives — local edits
        // are not lost) and re-pull from scratch.
        await db.transaction("rw", db.projects, db.tasks, db.meta, async () => {
          await db.projects.clear();
          await db.tasks.clear();
          await setMeta(db, CURSOR_KEY, "0");
        });
        continue;
      }

      await deleteApplied(db, snapshot, data.applied);

      if (data.rejected.length) {
        // Rejected mutations are dropped (cross-tenant collisions / invalid).
        const seqs = new Set(data.rejected.map((r) => r.seq));
        const drop: number[] = [];
        for (const m of snapshot.toSend) {
          if (!seqs.has(m.seq!)) continue;
          for (const s of snapshot.seqsByRow.get(`${m.table}:${m.rowId}`) ?? []) drop.push(s);
        }
        if (drop.length) await db.outbox.bulkDelete(drop);
        console.warn("[sync] server rejected mutations", data.rejected);
      }

      // ── Apply pulled changes with pending-write shadowing ──
      await db.transaction("rw", db.projects, db.tasks, db.outbox, async () => {
        for (const p of data.changes.projects) {
          if (await hasPending(db, "project", p.id)) continue;
          if (p.deletedAt) {
            await db.projects.delete(p.id);
            await db.tasks.where("projectId").equals(p.id).delete();
          } else {
            await db.projects.put({
              id: p.id,
              name: p.name,
              description: p.description ?? undefined,
              status: p.status,
              updatedAt: p.updatedAt,
            });
          }
        }
        for (const t of data.changes.tasks) {
          if (await hasPending(db, "task", t.id)) continue;
          if (t.deletedAt) {
            await db.tasks.delete(t.id);
          } else {
            await db.tasks.put({
              id: t.id,
              projectId: t.projectId,
              title: t.title,
              done: t.done,
              updatedAt: t.updatedAt,
            });
          }
        }
      });

      await setMeta(db, CURSOR_KEY, data.cursor);

      if (!data.hasMore) {
        const now = new Date().toISOString();
        await setMeta(db, LAST_SYNCED_KEY, now);
        return { kind: "idle", lastSyncedAt: now };
      }
    }
    return { kind: "error", message: "Sync did not converge", lastSyncedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return { kind: "error", message, lastSyncedAt };
  }
}
