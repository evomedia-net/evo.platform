// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { getPlatform } from "@/lib/platform";
import { memberProxyGate, platformErrorResponse } from "@/lib/member-proxy";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  const { id } = await params;
  try {
    return NextResponse.json(await getPlatform().restoreTenantMember(gate.token, id));
  } catch (err) {
    return platformErrorResponse(err);
  }
}
