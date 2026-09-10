// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Sync v2 server logic. The tenancy property under test: a mutation naming a
 * row that belongs to another tenant is rejected as id-conflict, never
 * applied, and never lets a caller learn more than "conflict". Everything
 * else is server-receive-order LWW, applied unconditionally.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyMutations, pullChanges } from "./server";
import type { SyncMutation } from "./protocol";

const tx = {
  project: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  task: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
};
const T = () => tx as never;
const TENANT = "tenant-a";

const projectUpsert = (over: Partial<SyncMutation> = {}): SyncMutation => ({
  seq: 1,
  table: "project",
  op: "upsert",
  id: "p1",
  data: { name: "Roof", status: "Active" },
  ...over,
});
const taskUpsert = (over: Partial<SyncMutation> = {}): SyncMutation => ({
  seq: 2,
  table: "task",
  op: "upsert",
  id: "p1::t1",
  data: { projectId: "p1", title: "Tiles", done: false },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const table of [tx.project, tx.task]) {
    for (const fn of Object.values(table)) fn.mockResolvedValue(null);
  }
});

describe("applyMutations: projects", () => {
  it("rejects an upsert with no name or a non-string status as invalid", async () => {
    const out = await applyMutations(T(), TENANT, [
      projectUpsert({ seq: 1, data: { name: "", status: "Active" } }),
      projectUpsert({ seq: 2, data: { name: "x", status: 3 as never } }),
      projectUpsert({ seq: 3, data: undefined }),
    ]);
    expect(out).toEqual({
      applied: [],
      rejected: [1, 2, 3].map((seq) => ({ seq, reason: "invalid" })),
    });
    expect(tx.project.upsert).not.toHaveBeenCalled();
  });

  it("rejects an upsert onto another tenant's row as id-conflict", async () => {
    tx.project.findUnique.mockResolvedValue({ id: "p1", tenantId: "tenant-b" });
    const out = await applyMutations(T(), TENANT, [projectUpsert()]);
    expect(out.rejected).toEqual([{ seq: 1, reason: "id-conflict" }]);
    expect(tx.project.upsert).not.toHaveBeenCalled();
  });

  it("upserts with the tenant stamped on create, and un-tombstones on update", async () => {
    const out = await applyMutations(T(), TENANT, [
      projectUpsert({ data: { name: "Roof", description: "north", status: "Active" } }),
    ]);
    expect(out).toEqual({ applied: [1], rejected: [] });
    expect(tx.project.upsert).toHaveBeenCalledWith({
      where: { id: "p1" },
      create: {
        id: "p1",
        tenantId: TENANT,
        name: "Roof",
        description: "north",
        status: "Active",
        deletedAt: null,
      },
      update: { name: "Roof", description: "north", status: "Active", deletedAt: null },
    });
  });

  it("defaults a missing description to null", async () => {
    await applyMutations(T(), TENANT, [projectUpsert()]);
    expect(tx.project.upsert.mock.calls[0]![0].update.description).toBeNull();
  });

  it("deletes by tombstoning a live row once, and treats missing or tombstoned rows as done", async () => {
    tx.project.findUnique.mockResolvedValueOnce({ id: "p1", tenantId: TENANT, deletedAt: null });
    const live = await applyMutations(T(), TENANT, [projectUpsert({ op: "delete", data: undefined })]);
    expect(live.applied).toEqual([1]);
    expect(tx.project.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { deletedAt: expect.any(Date) },
    });

    tx.project.update.mockClear();
    tx.project.findUnique.mockResolvedValueOnce({ id: "p1", tenantId: TENANT, deletedAt: new Date() });
    expect((await applyMutations(T(), TENANT, [projectUpsert({ op: "delete" })])).applied).toEqual([1]);
    tx.project.findUnique.mockResolvedValueOnce(null);
    expect((await applyMutations(T(), TENANT, [projectUpsert({ op: "delete" })])).applied).toEqual([1]);
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it("refuses to tombstone another tenant's row", async () => {
    tx.project.findUnique.mockResolvedValue({ id: "p1", tenantId: "tenant-b", deletedAt: null });
    const out = await applyMutations(T(), TENANT, [projectUpsert({ op: "delete" })]);
    expect(out.rejected).toEqual([{ seq: 1, reason: "id-conflict" }]);
    expect(tx.project.update).not.toHaveBeenCalled();
  });
});

describe("applyMutations: tasks", () => {
  it("rejects an upsert with no project or title as invalid", async () => {
    const out = await applyMutations(T(), TENANT, [
      taskUpsert({ seq: 1, data: { projectId: "", title: "x", done: false } }),
      taskUpsert({ seq: 2, data: { projectId: "p1", title: "", done: false } }),
    ]);
    expect(out.rejected).toEqual([
      { seq: 1, reason: "invalid" },
      { seq: 2, reason: "invalid" },
    ]);
  });

  it("rejects a task whose parent project belongs to another tenant", async () => {
    tx.project.findUnique.mockResolvedValue({ id: "p1", tenantId: "tenant-b" });
    const out = await applyMutations(T(), TENANT, [taskUpsert()]);
    expect(out.rejected).toEqual([{ seq: 2, reason: "id-conflict" }]);
    expect(tx.task.upsert).not.toHaveBeenCalled();
  });

  it("creates a stub project for an orphan task, then upserts the task", async () => {
    tx.project.findUnique.mockResolvedValue(null);
    const out = await applyMutations(T(), TENANT, [taskUpsert({ data: { projectId: "p1", title: "Tiles", done: 1 as never } })]);
    expect(out.applied).toEqual([2]);
    expect(tx.project.create).toHaveBeenCalledWith({
      data: { id: "p1", tenantId: TENANT, name: "p1", status: "Active" },
    });
    expect(tx.task.upsert).toHaveBeenCalledWith({
      where: { id: "p1::t1" },
      create: { id: "p1::t1", tenantId: TENANT, projectId: "p1", title: "Tiles", done: true, deletedAt: null },
      update: { title: "Tiles", done: true, deletedAt: null },
    });
  });

  it("does not create a stub when the parent exists, and rejects a foreign task id", async () => {
    tx.project.findUnique.mockResolvedValue({ id: "p1", tenantId: TENANT });
    tx.task.findUnique.mockResolvedValue({ id: "p1::t1", tenantId: "tenant-b" });
    const out = await applyMutations(T(), TENANT, [taskUpsert()]);
    expect(tx.project.create).not.toHaveBeenCalled();
    expect(out.rejected).toEqual([{ seq: 2, reason: "id-conflict" }]);
  });

  it("tombstones a live task, skips a tombstoned or missing one, refuses a foreign one", async () => {
    tx.task.findUnique.mockResolvedValueOnce({ id: "p1::t1", tenantId: TENANT, deletedAt: null });
    expect((await applyMutations(T(), TENANT, [taskUpsert({ op: "delete" })])).applied).toEqual([2]);
    expect(tx.task.update).toHaveBeenCalledTimes(1);

    tx.task.findUnique.mockResolvedValueOnce({ id: "p1::t1", tenantId: TENANT, deletedAt: new Date() });
    expect((await applyMutations(T(), TENANT, [taskUpsert({ op: "delete" })])).applied).toEqual([2]);
    tx.task.findUnique.mockResolvedValueOnce(null);
    expect((await applyMutations(T(), TENANT, [taskUpsert({ op: "delete" })])).applied).toEqual([2]);
    expect(tx.task.update).toHaveBeenCalledTimes(1);

    tx.task.findUnique.mockResolvedValueOnce({ id: "p1::t1", tenantId: "tenant-b", deletedAt: null });
    expect((await applyMutations(T(), TENANT, [taskUpsert({ op: "delete" })])).rejected).toEqual([
      { seq: 2, reason: "id-conflict" },
    ]);
  });
});

describe("applyMutations: batch", () => {
  it("keeps going when one mutation throws, rejecting only that one", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    tx.project.upsert.mockRejectedValueOnce(new Error("deadlock"));
    const out = await applyMutations(T(), TENANT, [
      projectUpsert({ seq: 1 }),
      projectUpsert({ seq: 2, id: "p2" }),
    ]);
    expect(out).toEqual({ applied: [2], rejected: [{ seq: 1, reason: "invalid" }] });
    expect(error).toHaveBeenCalledWith("[sync] mutation failed", { seq: 1, id: "p1" }, expect.any(Error));
    error.mockRestore();
  });
});

describe("pullChanges", () => {
  const row = (rowVersion: bigint, over: Record<string, unknown> = {}) => ({
    id: `r${rowVersion}`,
    name: "n",
    description: null,
    status: "Active",
    projectId: "p1",
    title: "t",
    done: false,
    deletedAt: null,
    rowVersion,
    updatedAt: new Date("2026-09-09T00:00:00Z"),
    ...over,
  });

  it("queries both tables past the cursor in row-version order, capped at the limit", async () => {
    tx.project.findMany.mockResolvedValue([]);
    tx.task.findMany.mockResolvedValue([]);
    const out = await pullChanges(T(), TENANT, 7n, 100);
    for (const fn of [tx.project.findMany, tx.task.findMany]) {
      expect(fn).toHaveBeenCalledWith({
        where: { tenantId: TENANT, rowVersion: { gt: 7n } },
        orderBy: { rowVersion: "asc" },
        take: 100,
      });
    }
    // nothing changed: the cursor holds
    expect(out).toEqual({ projects: [], tasks: [], cursor: 7n, hasMore: false });
  });

  it("serialises rows for the wire, with tombstones and BigInts as strings", async () => {
    tx.project.findMany.mockResolvedValue([row(3n, { deletedAt: new Date("2026-09-08T00:00:00Z") })]);
    tx.task.findMany.mockResolvedValue([row(5n, { done: true })]);
    const out = await pullChanges(T(), TENANT, 0n, 100);
    expect(out.projects[0]).toEqual({
      id: "r3",
      name: "n",
      description: null,
      status: "Active",
      deletedAt: "2026-09-08T00:00:00.000Z",
      rowVersion: "3",
      updatedAt: "2026-09-09T00:00:00.000Z",
    });
    expect(out.tasks[0]).toMatchObject({ id: "r5", done: true, deletedAt: null, rowVersion: "5" });
  });

  it("advances to the higher max when neither table was truncated", async () => {
    tx.project.findMany.mockResolvedValue([row(3n)]);
    tx.task.findMany.mockResolvedValue([row(9n)]);
    const out = await pullChanges(T(), TENANT, 0n, 100);
    expect(out.cursor).toBe(9n);
    expect(out.hasMore).toBe(false);
  });

  // The invariant: a truncated table caps the cursor at its own max, so the
  // rows it did not return are not skipped on the next page.
  it("caps the cursor at the truncated table's max when only one was truncated", async () => {
    tx.project.findMany.mockResolvedValue([row(3n), row(4n)]); // limit 2 -> truncated
    tx.task.findMany.mockResolvedValue([row(9n)]);
    const out = await pullChanges(T(), TENANT, 0n, 2);
    expect(out).toMatchObject({ cursor: 4n, hasMore: true });

    tx.project.findMany.mockResolvedValue([row(3n)]);
    tx.task.findMany.mockResolvedValue([row(8n), row(9n)]);
    expect(await pullChanges(T(), TENANT, 0n, 2)).toMatchObject({ cursor: 9n, hasMore: true });
  });

  it("takes the lower max when both tables were truncated", async () => {
    tx.project.findMany.mockResolvedValue([row(3n), row(4n)]);
    tx.task.findMany.mockResolvedValue([row(8n), row(9n)]);
    expect(await pullChanges(T(), TENANT, 0n, 2)).toMatchObject({ cursor: 4n, hasMore: true });
  });

  it("advances to the project max when projects are the newer table", async () => {
    tx.project.findMany.mockResolvedValue([row(9n)]);
    tx.task.findMany.mockResolvedValue([row(3n)]);
    expect((await pullChanges(T(), TENANT, 0n, 100)).cursor).toBe(9n);
  });

  it("takes the task max when both are truncated and tasks are the lower one", async () => {
    tx.project.findMany.mockResolvedValue([row(8n), row(9n)]);
    tx.task.findMany.mockResolvedValue([row(3n), row(4n)]);
    expect(await pullChanges(T(), TENANT, 0n, 2)).toMatchObject({ cursor: 4n, hasMore: true });
  });

  it("never moves the cursor backwards", async () => {
    // The query cannot return rows below the cursor, but the function does
    // not rely on that: a cursor ahead of every returned row still holds.
    tx.project.findMany.mockResolvedValue([row(3n)]);
    tx.task.findMany.mockResolvedValue([row(4n)]);
    expect((await pullChanges(T(), TENANT, 10n, 100)).cursor).toBe(10n);
  });

  it("serialises a task tombstone too", async () => {
    tx.project.findMany.mockResolvedValue([]);
    tx.task.findMany.mockResolvedValue([row(5n, { deletedAt: new Date("2026-09-08T00:00:00Z") })]);
    const out = await pullChanges(T(), TENANT, 0n, 100);
    expect(out.tasks[0]!.deletedAt).toBe("2026-09-08T00:00:00.000Z");
  });
});
