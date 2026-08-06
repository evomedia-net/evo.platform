// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Sudo mode for member management: re-verify the password against the
 * platform and stash the short-lived platform access token in an httpOnly
 * cookie scoped to the member proxy routes. 15-minute window, same pattern
 * as passkey management. Only a token carrying the tenant_admin claim will
 * get past the platform's /tenant/* guard — non-admins can unlock but every
 * management call answers 403.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { requireApiSession } from "@/lib/auth/dal";
import { getPlatform, isPlatformMode } from "@/lib/platform";
import { MEMBER_SUDO_COOKIE, MEMBER_SUDO_PATH } from "@/lib/member-proxy";

export async function POST(req: NextRequest) {
  if (!isPlatformMode()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  let session;
  try {
    session = await requireApiSession();
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  const parsed = z
    .object({ password: z.string().min(1) })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }
  if (!rateLimit(`member-sudo:${session.email}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant) return NextResponse.json({ error: "Workspace not found" }, { status: 400 });

  try {
    const result = await getPlatform().login({
      tenantSlug: tenant.slug,
      email: session.email,
      password: parsed.data.password,
    });
    const res = NextResponse.json({ ok: true, tenantAdmin: result.user.tenantAdmin });
    res.cookies.set(MEMBER_SUDO_COOKIE, result.accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: MEMBER_SUDO_PATH,
      maxAge: 900,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
}
