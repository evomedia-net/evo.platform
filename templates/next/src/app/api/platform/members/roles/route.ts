// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { getPlatform } from "@/lib/platform";
import { memberProxyGate, platformErrorResponse } from "@/lib/member-proxy";

/** Apps enabled for the tenant with their assignable roles (for role pickers). */
export async function GET(req: NextRequest) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  try {
    return NextResponse.json(await getPlatform().listTenantRoles(gate.token));
  } catch (err) {
    return platformErrorResponse(err);
  }
}
