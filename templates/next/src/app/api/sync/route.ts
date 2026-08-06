// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Sync v2 endpoint. See src/lib/sync/protocol.ts for the wire format and
 * src/lib/sync/server.ts for semantics (advisory lock, arrival-order LWW,
 * tombstones, cursor pagination).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiSession } from "@/lib/auth/dal";
import { applyMutations, pullChanges } from "@/lib/sync/server";
import { DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT, type SyncMutation } from "@/lib/sync/protocol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const mutationSchema = z.object({
  seq: z.number().int(),
  table: z.enum(["project", "task"]),
  op: z.enum(["upsert", "delete"]),
  id: z.string().min(1).max(500),
  data: z.record(z.string(), z.unknown()).optional(),
});

const requestSchema = z.object({
  v: z.literal(2),
  clientId: z.string().max(100),
  cursor: z.string().regex(/^\d+$/),
  pullLimit: z.number().int().optional(),
  mutations: z.array(mutationSchema).max(5000),
});

export async function POST(req: Request) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireApiSession());
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }

  let parsed;
  try {
    parsed = requestSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid sync request", detail: parsed.error.issues },
      { status: 400 },
    );
  }

  const { cursor, pullLimit, mutations } = parsed.data;
  const limit = Math.max(1, Math.min(pullLimit ?? DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT));

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Serializes all sync writes for this tenant; makes the shared
        // sequence cursor gap-safe. See invariant note in sync/server.ts.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
        const apply = await applyMutations(tx, tenantId, mutations as SyncMutation[]);

        // A cursor older than the GC horizon may have missed hard-deleted
        // tombstones — mutations still applied above (no data loss), but the
        // client must wipe its replica and re-pull from scratch.
        const gc = await tx.syncGcHorizon.findUnique({ where: { id: 1 } });
        const clientCursor = BigInt(cursor);
        if (gc && clientCursor > BigInt(0) && clientCursor < gc.horizon) {
          return { apply, pull: null };
        }

        const pull = await pullChanges(tx, tenantId, clientCursor, limit);
        return { apply, pull };
      },
      { timeout: 30_000 },
    );

    if (!result.pull) {
      return NextResponse.json({
        applied: result.apply.applied,
        rejected: result.apply.rejected,
        changes: { projects: [], tasks: [] },
        cursor,
        hasMore: false,
        resyncRequired: true,
      });
    }

    return NextResponse.json({
      applied: result.apply.applied,
      rejected: result.apply.rejected,
      changes: {
        projects: result.pull.projects,
        tasks: result.pull.tasks,
      },
      cursor: result.pull.cursor.toString(),
      hasMore: result.pull.hasMore,
      resyncRequired: false,
    });
  } catch (err) {
    console.error("[/api/sync] failed", err);
    const msg = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Health check — requires a session so it can't be used to probe the DB. */
export async function GET() {
  try {
    await requireApiSession();
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "DB unreachable";
    return NextResponse.json({ status: "error", error: msg }, { status: 503 });
  }
}
