// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Sync v2 client against a real Dexie database (fake-indexeddb) and a stubbed
 * /api/sync. The property that matters most: a pending local mutation shadows
 * a pulled row for the same id - local intent beats a stale server echo.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TenantDatabase, getMeta, setMeta } from "@/lib/offline/tenantDb";
import { enqueue } from "@/lib/offline/outbox";
import { getLastSyncedAt, runSync } from "./client";
import type { SyncResponseV2 } from "./protocol";

let db: TenantDatabase;
const fetchMock = vi.fn();

function reply(body: unknown, status = 200): Response {
  return { ok: status < 300, status, json: async () => body } as Response;
}
function page(over: Partial<SyncResponseV2> = {}): SyncResponseV2 {
  return {
    applied: [],
    rejected: [],
    changes: { projects: [], tasks: [] },
    cursor: "0",
    hasMore: false,
    resyncRequired: false,
    ...over,
  };
}
function sentBody(call = 0) {
  return JSON.parse(fetchMock.mock.calls[call]![1].body as string);
}
const serverProject = (id: string, rowVersion: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Project ${id}`,
  description: null,
  status: "Active",
  deletedAt: null,
  rowVersion,
  updatedAt: "2026-09-09T00:00:00.000Z",
  ...over,
});
const serverTask = (id: string, projectId: string, over: Record<string, unknown> = {}) => ({
  id,
  projectId,
  title: `Task ${id}`,
  done: false,
  deletedAt: null,
  rowVersion: "1",
  updatedAt: "2026-09-09T00:00:00.000Z",
  ...over,
});

beforeEach(async () => {
  db = new TenantDatabase(`t-${crypto.randomUUID()}`);
  await db.open();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("transport failures", () => {
  it("falls back to a generic message when the rejection is not an Error", async () => {
    // A failed request is "offline"; this is the request succeeding and the
    // body reader throwing a non-Error, which `throw "string"` makes legal.
    // The status must still carry a message, not "undefined".
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject("boom"),
    } as unknown as Response);
    const res = await runSync(db);
    expect(res.kind).toBe("error");
    expect((res as { message: string }).message).toBe("Sync failed");
  });

  it("reports offline when the request cannot be made", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await runSync(db)).toEqual({ kind: "offline", lastSyncedAt: null });
  });

  it("reports a 401 as an expired session", async () => {
    fetchMock.mockResolvedValue(reply({}, 401));
    expect(await runSync(db)).toEqual({
      kind: "error",
      message: "Session expired — sign in again",
      lastSyncedAt: null,
    });
  });

  it("surfaces the server's error message, or the status when there is none", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: "tenant suspended" }, 403));
    expect(await runSync(db)).toMatchObject({ kind: "error", message: "tenant suspended" });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    expect(await runSync(db)).toMatchObject({ kind: "error", message: "HTTP 500" });
  });

  it("turns an unexpected throw into an error status rather than propagating", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    expect(await runSync(db)).toMatchObject({ kind: "error", message: "bad json" });
  });
});

describe("push", () => {
  it("sends pending mutations with the cursor and a stable client id, then clears them", async () => {
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "A", status: "Active" } });
    fetchMock.mockResolvedValue(reply(page({ applied: [1], cursor: "12" })));

    const before = await getLastSyncedAt(db);
    const out = await runSync(db);

    expect(fetchMock).toHaveBeenCalledWith("/api/sync", expect.objectContaining({ method: "POST" }));
    const body = sentBody();
    expect(body).toMatchObject({ v: 2, cursor: "0" });
    expect(body.mutations).toEqual([
      { seq: 1, table: "project", op: "upsert", id: "p1", data: { name: "A", status: "Active" } },
    ]);
    expect(body.clientId).toMatch(/^[0-9a-f-]{36}$/);

    expect(await db.outbox.count()).toBe(0);
    expect(await getMeta(db, "cursor")).toBe("12");
    expect(before).toBeNull();
    expect(out.kind).toBe("idle");
    expect((out as { lastSyncedAt: string }).lastSyncedAt).toBe(await getLastSyncedAt(db));

    // The client id is minted once and reused.
    await runSync(db);
    expect(sentBody(1).clientId).toBe(body.clientId);
  });

  it("drops every queued write for a row the server rejected, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "v1", status: "Active" } });
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "v2", status: "Active" } });
    await enqueue(db, { table: "project", rowId: "p2", op: "upsert", data: { name: "keep", status: "Active" } });
    // The drain coalesces p1 to its last mutation (seq 2); the server rejects it.
    fetchMock.mockResolvedValue(reply(page({ applied: [3], rejected: [{ seq: 2, reason: "id-conflict" }] })));

    await runSync(db);

    expect(await db.outbox.count()).toBe(0); // both p1 seqs dropped, p2 applied
    expect(warn).toHaveBeenCalledWith("[sync] server rejected mutations", [
      { seq: 2, reason: "id-conflict" },
    ]);
  });
});

describe("pull", () => {
  it("applies pulled rows, cascades a project tombstone to its tasks, and advances the cursor", async () => {
    await db.projects.put({ id: "gone", name: "Gone", status: "Active", updatedAt: "x" });
    await db.tasks.put({ id: "gone::t", projectId: "gone", title: "t", done: false, updatedAt: "x" });
    await db.tasks.put({ id: "p1::old", projectId: "p1", title: "old", done: false, updatedAt: "x" });
    fetchMock.mockResolvedValue(
      reply(
        page({
          cursor: "40",
          changes: {
            projects: [
              serverProject("p1", "30", { description: "north" }),
              serverProject("gone", "31", { deletedAt: "2026-09-09T00:00:00.000Z" }),
            ],
            tasks: [
              serverTask("p1::t1", "p1", { done: true }),
              serverTask("p1::old", "p1", { deletedAt: "2026-09-09T00:00:00.000Z" }),
            ],
          },
        }),
      ),
    );

    await runSync(db);

    expect(await db.projects.get("p1")).toEqual({
      id: "p1",
      name: "Project p1",
      description: "north",
      status: "Active",
      updatedAt: "2026-09-09T00:00:00.000Z",
    });
    expect(await db.projects.get("gone")).toBeUndefined();
    expect(await db.tasks.get("gone::t")).toBeUndefined();
    expect(await db.tasks.get("p1::t1")).toMatchObject({ done: true });
    expect(await db.tasks.get("p1::old")).toBeUndefined();
    expect(await getMeta(db, "cursor")).toBe("40");
  });

  it("leaves a null description undefined locally", async () => {
    fetchMock.mockResolvedValue(reply(page({ changes: { projects: [serverProject("p1", "1")], tasks: [] } })));
    await runSync(db);
    expect((await db.projects.get("p1"))!.description).toBeUndefined();
  });

  it("does not overwrite a row with a pending local write", async () => {
    await db.projects.put({ id: "p1", name: "mine", status: "Active", updatedAt: "x" });
    await db.tasks.put({ id: "p1::t1", projectId: "p1", title: "mine", done: false, updatedAt: "x" });
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "mine", status: "Active" } });
    await enqueue(db, { table: "task", rowId: "p1::t1", op: "upsert", data: { projectId: "p1", title: "mine", done: false } });
    // The server echoes older versions of both, and applies nothing (as if a
    // different tab's drain were racing this one).
    fetchMock.mockResolvedValue(
      reply(
        page({
          changes: { projects: [serverProject("p1", "1")], tasks: [serverTask("p1::t1", "p1")] },
        }),
      ),
    );

    await runSync(db);

    expect((await db.projects.get("p1"))!.name).toBe("mine");
    expect((await db.tasks.get("p1::t1"))!.title).toBe("mine");
  });

  it("keeps pulling while the server has more, then records the sync time", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(page({ cursor: "10", hasMore: true })))
      .mockResolvedValueOnce(reply(page({ cursor: "20" })));
    const out = await runSync(db);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(1).cursor).toBe("10");
    expect(await getMeta(db, "cursor")).toBe("20");
    expect(out.kind).toBe("idle");
  });

  it("wipes the replica and re-pulls from zero when told to resync, keeping the outbox", async () => {
    await db.projects.put({ id: "stale", name: "s", status: "Active", updatedAt: "x" });
    await setMeta(db, "cursor", "999");
    await enqueue(db, { table: "project", rowId: "p1", op: "upsert", data: { name: "A", status: "Active" } });
    fetchMock
      .mockResolvedValueOnce(reply(page({ resyncRequired: true })))
      .mockResolvedValueOnce(reply(page({ applied: [1], cursor: "5" })));

    await runSync(db);

    expect(await db.projects.get("stale")).toBeUndefined();
    expect(sentBody(1).cursor).toBe("0"); // second request starts over
    expect(sentBody(1).mutations).toHaveLength(1); // local edits survived the wipe
    expect(await getMeta(db, "cursor")).toBe("5");
  });

  it("gives up after fifty pages rather than looping forever", async () => {
    fetchMock.mockResolvedValue(reply(page({ hasMore: true })));
    expect(await runSync(db)).toMatchObject({ kind: "error", message: "Sync did not converge" });
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });
});

describe("cross-tab lock", () => {
  it("syncs directly when the browser has no Web Locks", async () => {
    // Node 24 ships navigator.locks, so without this stub the no-locks path
    // never runs locally; on Node 20 it is the only path. Pin it explicitly.
    vi.stubGlobal("navigator", {});
    fetchMock.mockResolvedValue(reply(page({ cursor: "2" })));
    expect((await runSync(db)).kind).toBe("idle");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await getMeta(db, "cursor")).toBe("2");
  });

  it("skips when another tab holds the lock - its drain covers this tab's writes too", async () => {
    const request = vi.fn(async (_name: string, _opts: unknown, cb: (lock: unknown) => Promise<void>) => {
      await cb(null);
    });
    vi.stubGlobal("navigator", { locks: { request } });
    await setMeta(db, "lastSyncedAt", "earlier");

    expect(await runSync(db)).toEqual({ kind: "idle", lastSyncedAt: "earlier" });
    expect(request).toHaveBeenCalledWith(
      expect.stringMatching(/^evoapp-sync-/),
      { ifAvailable: true },
      expect.any(Function),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports idle if the lock request settles without ever running the callback", async () => {
    // A request can resolve with no callback invocation (the browser aborted
    // it); that must read as "nothing happened", not as an error.
    vi.stubGlobal("navigator", { locks: { request: async () => undefined } });
    await setMeta(db, "lastSyncedAt", "earlier");
    expect(await runSync(db)).toEqual({ kind: "idle", lastSyncedAt: "earlier" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("syncs when the lock is granted", async () => {
    vi.stubGlobal("navigator", {
      locks: { request: async (_n: string, _o: unknown, cb: (lock: unknown) => Promise<void>) => cb({}) },
    });
    fetchMock.mockResolvedValue(reply(page({ cursor: "3" })));
    expect((await runSync(db)).kind).toBe("idle");
    expect(await getMeta(db, "cursor")).toBe("3");
  });
});
