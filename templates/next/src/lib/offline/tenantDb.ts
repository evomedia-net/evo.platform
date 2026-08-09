// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Per-tenant Dexie database (`EVOAPP_{tenantId}`) — prevents cross-tenant
 * data bleed on shared browsers.
 *
 * No `needsSync` flags anywhere: pending work lives in the append-only
 * `outbox` table, drained by src/lib/sync/client.ts.
 */
"use client";

import Dexie, { type Table } from "dexie";
import type { SyncOp, SyncTable } from "@/lib/sync/protocol";

export interface LocalProject {
  id: string;
  name: string;
  description?: string;
  status: string;
  updatedAt: string;
}

export interface LocalTask {
  id: string; // "{projectId}::{uuid}"
  projectId: string;
  title: string;
  done: boolean;
  updatedAt: string;
}

export interface OutboxMutation {
  seq?: number; // auto-increment PK
  table: SyncTable;
  rowId: string;
  op: SyncOp;
  /** Row snapshot for upserts (shape depends on table). */
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface MetaRow {
  key: string;
  value: string;
}

export class TenantDatabase extends Dexie {
  projects!: Table<LocalProject, string>;
  tasks!: Table<LocalTask, string>;
  outbox!: Table<OutboxMutation, number>;
  meta!: Table<MetaRow, string>;

  readonly tenantId: string;

  constructor(tenantId: string) {
    super(`EVOAPP_${tenantId}`);
    this.tenantId = tenantId;
    this.version(1).stores({
      projects: "id, updatedAt",
      tasks: "id, projectId",
      outbox: "++seq, [table+rowId], rowId",
      meta: "key",
    });
  }
}

const instances = new Map<string, TenantDatabase>();
let active: TenantDatabase | null = null;

/** Get (or lazily create) the Dexie DB for a tenant. */
export function getTenantDb(tenantId: string): TenantDatabase {
  let db = instances.get(tenantId);
  if (!db) {
    db = new TenantDatabase(tenantId);
    instances.set(tenantId, db);
  }
  return db;
}

/** Install the active tenant DB for this browser session (TenantProvider). */
export function setActiveTenantDb(tenantId: string): TenantDatabase {
  active = getTenantDb(tenantId);
  return active;
}

export function activeDb(): TenantDatabase {
  if (!active) throw new Error("No active tenant DB — is TenantProvider mounted?");
  return active;
}

/** Meta helpers. */
export async function getMeta(db: TenantDatabase, key: string): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(db: TenantDatabase, key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
