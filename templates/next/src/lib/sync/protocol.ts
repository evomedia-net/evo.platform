// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Sync v2 wire protocol — shared between the client (src/lib/sync/client.ts)
 * and the server (src/lib/sync/server.ts, /api/sync).
 *
 * Design invariants:
 *  - Cursor is a single BigInt (string-encoded on the wire) over one global
 *    Postgres sequence shared by both synced tables. One timeline means a
 *    project row and its tasks are totally ordered against each other.
 *  - Conflict resolution is server-receive-order LWW: mutations apply
 *    unconditionally in arrival order. No client clocks anywhere.
 *  - Deletes are tombstones (deletedAt) and sync like updates.
 */

export type SyncTable = "project" | "task";
export type SyncOp = "upsert" | "delete";

export interface ProjectData {
  name: string;
  description?: string | null;
  status: string;
}

export interface TaskData {
  projectId: string;
  title: string;
  done: boolean;
}

export interface SyncMutation {
  /** Client-local outbox sequence; echoed back in applied/rejected. */
  seq: number;
  table: SyncTable;
  op: SyncOp;
  id: string;
  data?: ProjectData | TaskData;
}

export interface SyncRequestV2 {
  v: 2;
  /** Stable per-browser UUID, for diagnostics only. */
  clientId: string;
  /** String-encoded BigInt; "0" for a first sync. */
  cursor: string;
  pullLimit?: number;
  mutations: SyncMutation[];
}

export type RejectReason = "id-conflict" | "invalid";

export interface ServerProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  deletedAt: string | null;
  rowVersion: string; // BigInt as string
  updatedAt: string;
}

export interface ServerTask {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
  deletedAt: string | null;
  rowVersion: string;
  updatedAt: string;
}

export interface SyncResponseV2 {
  applied: number[];
  rejected: Array<{ seq: number; reason: RejectReason }>;
  changes: {
    projects: ServerProject[];
    tasks: ServerTask[];
  };
  /** New client cursor (string BigInt). */
  cursor: string;
  /** True when a pull page was truncated — client should loop immediately. */
  hasMore: boolean;
  /** True when the client cursor predates the tombstone GC horizon —
   *  client must wipe its tenant DB and re-pull from "0". */
  resyncRequired: boolean;
}

export const DEFAULT_PULL_LIMIT = 1000;
export const MAX_PULL_LIMIT = 2000;
