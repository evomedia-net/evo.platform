// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Local-first data layer for the example domain. Every write lands in Dexie
 * (instant UI) and enqueues an outbox mutation (eventual server sync). Reads
 * come straight from Dexie — the server is only ever touched by the sync
 * client. This is the pattern to copy for real domain modules.
 */
"use client";

import type { TenantDatabase } from "@/lib/offline/tenantDb";
import { enqueue, purgeForProject } from "@/lib/offline/outbox";

function notifySync() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("evoapp:sync"));
}

export async function createProject(db: TenantDatabase, name: string): Promise<string> {
  const id = `prj_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const data = { name, description: null, status: "Active" };
  await db.transaction("rw", db.projects, db.outbox, async () => {
    await db.projects.put({ id, name, status: "Active", updatedAt: now });
    await enqueue(db, { table: "project", rowId: id, op: "upsert", data });
  });
  notifySync();
  return id;
}

export async function renameProject(db: TenantDatabase, id: string, name: string): Promise<void> {
  const existing = await db.projects.get(id);
  if (!existing) return;
  const now = new Date().toISOString();
  const data = { name, description: existing.description ?? null, status: existing.status };
  await db.transaction("rw", db.projects, db.outbox, async () => {
    await db.projects.put({ ...existing, name, updatedAt: now });
    await enqueue(db, { table: "project", rowId: id, op: "upsert", data });
  });
  notifySync();
}

export async function deleteProject(db: TenantDatabase, id: string): Promise<void> {
  await db.transaction("rw", db.projects, db.tasks, db.outbox, async () => {
    await db.projects.delete(id);
    await db.tasks.where("projectId").equals(id).delete();
    // Queued writes for this project must not resurrect a stub server-side.
    await purgeForProject(db, id);
    await enqueue(db, { table: "project", rowId: id, op: "delete" });
  });
  notifySync();
}

export async function addTask(
  db: TenantDatabase,
  projectId: string,
  title: string,
): Promise<string> {
  const id = `${projectId}::${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.put({ id, projectId, title, done: false, updatedAt: now });
    await enqueue(db, {
      table: "task",
      rowId: id,
      op: "upsert",
      data: { projectId, title, done: false },
    });
  });
  notifySync();
  return id;
}

export async function toggleTask(db: TenantDatabase, id: string): Promise<void> {
  const task = await db.tasks.get(id);
  if (!task) return;
  const done = !task.done;
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.put({ ...task, done, updatedAt: new Date().toISOString() });
    await enqueue(db, {
      table: "task",
      rowId: id,
      op: "upsert",
      data: { projectId: task.projectId, title: task.title, done },
    });
  });
  notifySync();
}

export async function deleteTask(db: TenantDatabase, id: string): Promise<void> {
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.delete(id);
    await enqueue(db, { table: "task", rowId: id, op: "delete" });
  });
  notifySync();
}
