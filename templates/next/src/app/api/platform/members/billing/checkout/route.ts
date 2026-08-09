// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { getPlatform } from "@/lib/platform";
import { memberProxyGate, platformErrorResponse } from "@/lib/member-proxy";

/**
 * Start Stripe Checkout for this workspace's subscription to THIS app.
 * Requires the member sudo window AND the tenant_admin claim — the sudo token
 * is verified locally (JWKS) since the platform call itself uses client
 * credentials rather than the user's token.
 */
export async function POST(req: NextRequest) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  try {
    const claims = await getPlatform().verifyToken(gate.token);
    if (!claims.tenant_admin || !claims.tenant_id) {
      return NextResponse.json({ error: "Tenant admin required" }, { status: 403 });
    }
    const origin = req.nextUrl.origin;
    const out = await getPlatform().createCheckout({
      tenantId: claims.tenant_id,
      successUrl: `${origin}/members?billing=success`,
      cancelUrl: `${origin}/members`,
    });
    return NextResponse.json(out);
  } catch (err) {
    return platformErrorResponse(err);
  }
}
