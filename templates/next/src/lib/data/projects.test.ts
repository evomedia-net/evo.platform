// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The local-first data layer: every write lands in Dexie and queues one
 * outbox mutation, atomically. The pattern real domain modules copy, so its
 * shape is worth pinning exactly.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TenantDatabase } from "@/lib/offline/tenantDb";
import {
  addTask,
  createProject,
  deleteProject,
  deleteTask,
  renameProject,
  toggleTask,
} from "./projects";

let db: TenantDatabase;

beforeEach(async () => {
  db = new TenantDatabase(`t-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(() => vi.unstubAllGlobals());

const outbox = () => db.outbox.orderBy("seq").toArray();

describe("projects", () => {
  it("createProject writes the row and queues an upsert", async () => {
    const id = await createProject(db, "Roof");
    expect(id).toMatch(/^prj_[0-9a-f-]{36}$/);
    expect(await db.projects.get(id)).toMatchObject({ id, name: "Roof", status: "Active" });
    expect(await outbox()).toMatchObject([
      { table: "project", rowId: id, op: "upsert", data: { name: "Roof", description: null, status: "Active" } },
    ]);
  });

  it("renameProject keeps the other fields and queues the full row", async () => {
    const id = await createProject(db, "Roof");
    await db.projects.update(id, { description: "north" });
    await renameProject(db, id, "Roof v2");
    expect((await db.projects.get(id))!.name).toBe("Roof v2");
    const last = (await outbox()).at(-1)!;
    expect(last.data).toEqual({ name: "Roof v2", description: "north", status: "Active" });
  });

  it("renameProject queues a null description when the row never had one", async () => {
    const id = await createProject(db, "Roof");
    await renameProject(db, id, "Roof v2");
    expect((await outbox()).at(-1)!.data).toEqual({ name: "Roof v2", description: null, status: "Active" });
  });

  it("renameProject is a no-op for a missing project", async () => {
    await renameProject(db, "prj_missing", "x");
    expect(await outbox()).toEqual([]);
  });

  it("deleteProject removes the project, its tasks, and their queued writes, then queues the delete", async () => {
    const id = await createProject(db, "Roof");
    const taskId = await addTask(db, id, "Tiles");
    const other = await createProject(db, "Other");

    await deleteProject(db, id);

    expect(await db.projects.get(id)).toBeUndefined();
    expect(await db.tasks.get(taskId)).toBeUndefined();
    const queue = await outbox();
    // The project's own upsert and its task's upsert are purged - a queued
    // write must not resurrect a stub server-side - leaving Other's upsert
    // and this delete.
    expect(queue.map((m) => [m.table, m.rowId, m.op])).toEqual([
      ["project", other, "upsert"],
      ["project", id, "delete"],
    ]);
  });
});

describe("tasks", () => {
  it("addTask ids the task under its project and queues an upsert", async () => {
    const pid = await createProject(db, "Roof");
    const id = await addTask(db, pid, "Tiles");
    expect(id.startsWith(`${pid}::`)).toBe(true);
    expect(await db.tasks.get(id)).toMatchObject({ projectId: pid, title: "Tiles", done: false });
    expect((await outbox()).at(-1)).toMatchObject({
      table: "task",
      rowId: id,
      op: "upsert",
      data: { projectId: pid, title: "Tiles", done: false },
    });
  });

  it("toggleTask flips done and queues the whole task; a missing task is a no-op", async () => {
    const pid = await createProject(db, "Roof");
    const id = await addTask(db, pid, "Tiles");
    await toggleTask(db, id);
    expect((await db.tasks.get(id))!.done).toBe(true);
    expect((await outbox()).at(-1)!.data).toEqual({ projectId: pid, title: "Tiles", done: true });

    const before = (await outbox()).length;
    await toggleTask(db, "nope::missing");
    expect((await outbox()).length).toBe(before);
  });

  it("deleteTask removes the row and queues the delete", async () => {
    const pid = await createProject(db, "Roof");
    const id = await addTask(db, pid, "Tiles");
    await deleteTask(db, id);
    expect(await db.tasks.get(id)).toBeUndefined();
    expect((await outbox()).at(-1)).toMatchObject({ table: "task", rowId: id, op: "delete" });
  });
});

describe("sync notification", () => {
  it("dispatches evoapp:sync on the window after every write", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    await createProject(db, "Roof");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]![0].type).toBe("evoapp:sync");
  });
});
