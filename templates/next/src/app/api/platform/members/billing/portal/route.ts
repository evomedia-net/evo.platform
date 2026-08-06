// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { getPlatform } from "@/lib/platform";
import { memberProxyGate, platformErrorResponse } from "@/lib/member-proxy";

/** Stripe billing portal for the workspace (payment method, invoices, cancel). */
export async function POST(req: NextRequest) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  try {
    const claims = await getPlatform().verifyToken(gate.token);
    if (!claims.tenant_admin || !claims.tenant_id) {
      return NextResponse.json({ error: "Tenant admin required" }, { status: 403 });
    }
    const out = await getPlatform().createBillingPortal({
      tenantId: claims.tenant_id,
      returnUrl: `${req.nextUrl.origin}/members`,
    });
    return NextResponse.json(out);
  } catch (err) {
    return platformErrorResponse(err);
  }
}
