// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase } from "./tenantDb";
import {
  deleteApplied,
  enqueue,
  hasPending,
  pendingForRow,
  purgeForProject,
  snapshotForDrain,
} from "./outbox";

let db: TenantDatabase;

beforeEach(async () => {
  db = new TenantDatabase(`test-${crypto.randomUUID()}`);
  await db.open();
});

describe("outbox", () => {
  it("coalesces to the last mutation per row at drain time", async () => {
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "v1" } });
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "v2" } });
    const snap = await snapshotForDrain(db);
    expect(snap.toSend).toHaveLength(1);
    expect((snap.toSend[0].data as { name: string }).name).toBe("v2");
    expect(snap.seqsByRow.get("project:p1")).toHaveLength(2);
  });

  it("deleteApplied removes snapshot seqs but preserves mid-flight edits", async () => {
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "v1" } });
    const snap = await snapshotForDrain(db);
    // An edit lands while the request is in flight:
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "v2" } });
    await deleteApplied(db, snap, snap.toSend.map((m) => m.seq!));
    const remaining = await db.outbox.toArray();
    expect(remaining).toHaveLength(1);
    expect((remaining[0].data as { name: string }).name).toBe("v2");
  });

  it("does not delete unapplied rows", async () => {
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "a" } });
    await enqueue(db, { table: "task", rowId: "p1::t1", op: "upsert", data: { title: "b" } });
    const snap = await snapshotForDrain(db);
    const appliedSeq = snap.toSend.find((m) => m.table === "project")!.seq!;
    await deleteApplied(db, snap, [appliedSeq]);
    const remaining = await db.outbox.toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].table).toBe("task");
  });

  it("purgeForProject drops the project's own and task mutations only", async () => {
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "a" } });
    await enqueue(db, { table: "task", rowId: "p1::t1", op: "upsert", data: { title: "b" } });
    await enqueue(db, { table: "project", rowId: "p2", op: "upsert", data: { name: "c" } });
    await purgeForProject(db, "p1");
    const remaining = await db.outbox.toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].rowId).toBe("p2");
  });

  it("pendingForRow returns every queued mutation for one row, whatever the op", async () => {
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "a" } });
    await enqueue(db, { table: "project", rowId: "p1", op: "delete" });
    await enqueue(db, { table: "project", rowId: "p2", op: "upsert", data: { name: "b" } });
    const rows = await pendingForRow(db, "p1");
    expect(rows.map((m) => m.op)).toEqual(["upsert", "delete"]);
  });

  // The sync client's shadowing rule hangs on this: a pulled row is skipped
  // exactly when something for that table+rowId is still queued.
  it("hasPending is true only while a mutation for that table and row is queued", async () => {
    expect(await hasPending(db, "project", "p1")).toBe(false);
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "a" } });
    expect(await hasPending(db, "project", "p1")).toBe(true);
    expect(await hasPending(db, "task", "p1")).toBe(false); // same id, other table
    await db.outbox.clear();
    expect(await hasPending(db, "project", "p1")).toBe(false);
  });

  it("deleteApplied tolerates a snapshot row with no recorded seqs", async () => {
    // A snapshot handed back from elsewhere may name a row the seq index
    // never saw; that must delete nothing rather than throw.
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "a" } });
    const snap = await snapshotForDrain(db);
    await deleteApplied(db, { toSend: snap.toSend, seqsByRow: new Map() }, snap.toSend.map((m) => m.seq!));
    expect(await db.outbox.count()).toBe(1);
  });
});
