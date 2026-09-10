// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The sync endpoint's own concerns: session, request validation, the pull
 * limit clamp, the GC-horizon resync decision, response shaping and error
 * mapping. The apply/pull semantics live in sync/server.ts and are covered
 * there against a hand-rolled transaction.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT } from "@/lib/sync/protocol";

const h = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(),
    syncGcHorizon: { findUnique: vi.fn() },
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/dal", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(h.tx)),
    $queryRaw: vi.fn(),
  },
}));
vi.mock("@/lib/sync/server", () => ({ applyMutations: vi.fn(), pullChanges: vi.fn() }));

import { requireApiSession } from "@/lib/auth/dal";
import { prisma } from "@/lib/prisma";
import { applyMutations, pullChanges } from "@/lib/sync/server";
import { GET, POST } from "./route";

const session = { userId: "u1", tenantId: "t1", email: "owner@acme.example" };

function post(body: unknown, raw?: string): Request {
  return new Request("http://app.test/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

const base = { v: 2, clientId: "c1", cursor: "0", mutations: [] };
const applied = { applied: [1, 2], rejected: [] };
const pulled = {
  projects: [{ id: "p1" }],
  tasks: [{ id: "t1" }],
  cursor: BigInt(42),
  hasMore: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireApiSession).mockResolvedValue(session as never);
  vi.mocked(applyMutations).mockResolvedValue(applied as never);
  vi.mocked(pullChanges).mockResolvedValue(pulled as never);
  h.tx.syncGcHorizon.findUnique.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/sync", () => {
  it("returns the DAL's 401 when there is no session, and rethrows anything else", async () => {
    const unauthorized = new Response(null, { status: 401 });
    vi.mocked(requireApiSession).mockRejectedValueOnce(unauthorized);
    expect(await POST(post(base))).toBe(unauthorized);

    vi.mocked(requireApiSession).mockRejectedValueOnce(new Error("db down"));
    await expect(POST(post(base))).rejects.toThrow("db down");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const res = await POST(post(undefined, "{not json"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it.each([
    ["the wrong protocol version", { ...base, v: 1 }],
    ["a non-numeric cursor", { ...base, cursor: "abc" }],
    ["a mutation on an unknown table", { ...base, mutations: [{ seq: 1, table: "user", op: "upsert", id: "x" }] }],
    ["a mutation with an empty id", { ...base, mutations: [{ seq: 1, table: "task", op: "delete", id: "" }] }],
    ["a fractional pull limit", { ...base, pullLimit: 1.5 }],
  ])("rejects %s with 400 and the zod issues", async (_why, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid sync request");
    expect(Array.isArray(json.detail)).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("takes the tenant's advisory lock, applies, then pulls with the default limit", async () => {
    const mutations = [{ seq: 7, table: "project", op: "upsert", id: "p1", data: { name: "A" } }];
    const res = await POST(post({ ...base, mutations }));

    expect(h.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(applyMutations).toHaveBeenCalledWith(h.tx, "t1", mutations);
    expect(pullChanges).toHaveBeenCalledWith(h.tx, "t1", BigInt(0), DEFAULT_PULL_LIMIT);
    expect(await res.json()).toEqual({
      applied: [1, 2],
      rejected: [],
      changes: { projects: [{ id: "p1" }], tasks: [{ id: "t1" }] },
      cursor: "42",
      hasMore: true,
      resyncRequired: false,
    });
  });

  it.each([
    ["clamps an oversized limit down", MAX_PULL_LIMIT * 10, MAX_PULL_LIMIT],
    ["clamps zero up to one", 0, 1],
    ["clamps a negative limit up to one", -5, 1],
    ["keeps a sane limit", 25, 25],
  ])("%s", async (_what, pullLimit, expected) => {
    await POST(post({ ...base, pullLimit }));
    expect(pullChanges).toHaveBeenCalledWith(h.tx, "t1", BigInt(0), expected);
  });

  describe("GC horizon", () => {
    it("tells a client behind the horizon to resync, still reporting what was applied", async () => {
      h.tx.syncGcHorizon.findUnique.mockResolvedValue({ id: 1, horizon: BigInt(100) });
      const res = await POST(post({ ...base, cursor: "50" }));
      expect(pullChanges).not.toHaveBeenCalled();
      expect(await res.json()).toEqual({
        applied: [1, 2],
        rejected: [],
        changes: { projects: [], tasks: [] },
        cursor: "50",
        hasMore: false,
        resyncRequired: true,
      });
    });

    it.each([
      ["a fresh client (cursor 0) pulls from scratch anyway", "0"],
      ["a client exactly at the horizon", "100"],
      ["a client past the horizon", "150"],
    ])("pulls normally for %s", async (_why, cursor) => {
      h.tx.syncGcHorizon.findUnique.mockResolvedValue({ id: 1, horizon: BigInt(100) });
      const res = await POST(post({ ...base, cursor }));
      expect(pullChanges).toHaveBeenCalledWith(h.tx, "t1", BigInt(cursor), DEFAULT_PULL_LIMIT);
      expect((await res.json()).resyncRequired).toBe(false);
    });

    it("pulls normally when no horizon has ever been recorded", async () => {
      const res = await POST(post({ ...base, cursor: "50" }));
      expect(pullChanges).toHaveBeenCalled();
      expect((await res.json()).resyncRequired).toBe(false);
    });
  });

  it("maps a failed transaction to 500 with the error's message, logged", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("deadlock detected"));
    const res = await POST(post(base));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "deadlock detected" });
    expect(console.error).toHaveBeenCalled();
  });

  it("has a generic message for a non-Error failure", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce("boom");
    const res = await POST(post(base));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Sync failed" });
  });
});

describe("GET /api/sync (health)", () => {
  it("requires a session so it cannot be used to probe the database", async () => {
    const unauthorized = new Response(null, { status: 401 });
    vi.mocked(requireApiSession).mockRejectedValueOnce(unauthorized);
    expect(await GET()).toBe(unauthorized);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();

    vi.mocked(requireApiSession).mockRejectedValueOnce(new Error("db down"));
    await expect(GET()).rejects.toThrow("db down");
  });

  it("reports ok when the database answers", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ "?column?": 1 }] as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("reports 503 with the error's message when it does not", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", error: "connection refused" });
  });

  it("has a generic message for a non-Error failure", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce("boom");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "error", error: "DB unreachable" });
  });
});
