// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Shared plumbing for the /api/platform/members proxies. Member management
 * runs under a GitHub-style sudo window like passkey management: the tenant
 * admin re-enters their password, and the resulting short-lived platform
 * access token (which carries the tenant_admin claim) lives in an httpOnly
 * cookie scoped to these routes. The platform is the authority on who may
 * manage members — these proxies just forward the token.
 */
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/dal";
import { isPlatformMode } from "@/lib/platform";

export const MEMBER_SUDO_COOKIE = "evo_member_sudo";
export const MEMBER_SUDO_PATH = "/api/platform/members";

/** Platform mode + app session + sudo cookie, or a ready-to-return response. */
export async function memberProxyGate(
  req: NextRequest,
): Promise<{ token: string; res?: never } | { res: NextResponse; token?: never }> {
  if (!isPlatformMode()) {
    return { res: NextResponse.json({ error: "Not available" }, { status: 404 }) };
  }
  try {
    await requireApiSession();
  } catch (res) {
    if (res instanceof Response) return { res: res as NextResponse };
    throw res;
  }
  const token = req.cookies.get(MEMBER_SUDO_COOKIE)?.value;
  if (!token) return { res: NextResponse.json({ error: "sudo-required" }, { status: 401 }) };
  return { token };
}

/** Pass platform status codes through (401 sudo expired, 403 not a tenant
 *  admin, 409 self-lockout guards…) so the UI can react to each honestly. */
export function platformErrorResponse(err: unknown): NextResponse {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status: unknown }).status) || 502
      : 502;
  const message = err instanceof Error ? err.message : "Platform request failed";
  return NextResponse.json({ error: message }, { status });
}
