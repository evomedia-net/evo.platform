// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatform } from "@/lib/platform";
import { memberProxyGate, platformErrorResponse } from "@/lib/member-proxy";

/** List the tenant's members (tenant-admin sudo required). */
export async function GET(req: NextRequest) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  try {
    return NextResponse.json(await getPlatform().listTenantMembers(gate.token));
  } catch (err) {
    return platformErrorResponse(err);
  }
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
  isTenantAdmin: z.boolean().optional(),
});

/** Create a member in the tenant. The platform enforces the password policy. */
export async function POST(req: NextRequest) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid member details" }, { status: 400 });
  }
  try {
    return NextResponse.json(await getPlatform().createTenantMember(gate.token, parsed.data));
  } catch (err) {
    return platformErrorResponse(err);
  }
}
