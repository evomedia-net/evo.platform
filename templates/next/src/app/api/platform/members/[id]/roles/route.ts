// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatform } from "@/lib/platform";
import { memberProxyGate, platformErrorResponse } from "@/lib/member-proxy";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  const parsed = z
    .object({ roleIds: z.array(z.string()).max(100) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid roles" }, { status: 400 });
  }
  const { id } = await params;
  try {
    return NextResponse.json(
      await getPlatform().setTenantMemberRoles(gate.token, id, parsed.data.roleIds),
    );
  } catch (err) {
    return platformErrorResponse(err);
  }
}
