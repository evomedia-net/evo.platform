// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { TenantDatabase } from "./tenantDb";
import { deleteApplied, enqueue, purgeForProject, snapshotForDrain } from "./outbox";

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
});
