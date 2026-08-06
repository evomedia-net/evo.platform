// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatform } from "@/lib/platform";
import { memberProxyGate, platformErrorResponse } from "@/lib/member-proxy";

/** List invites (pending and accepted) for the tenant. */
export async function GET(req: NextRequest) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  try {
    return NextResponse.json(await getPlatform().listTenantInvites(gate.token));
  } catch (err) {
    return platformErrorResponse(err);
  }
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  isTenantAdmin: z.boolean().optional(),
});

/** Send an invite: the platform emails a 24h single-use accept link. */
export async function POST(req: NextRequest) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid invite details" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getPlatform().createTenantInvite(gate.token, parsed.data));
  } catch (err) {
    return platformErrorResponse(err);
  }
}
