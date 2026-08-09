// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/dal";
import { getPlatform, isPlatformMode } from "@/lib/platform";

export async function POST(req: NextRequest) {
  if (!isPlatformMode()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  try {
    await requireApiSession();
  } catch (res) {
    if (res instanceof Response) return res;
    throw res;
  }
  const token = req.cookies.get("evo_sudo")?.value;
  if (!token) return NextResponse.json({ error: "sudo-required" }, { status: 401 });
  try {
    const out = await getPlatform().passkeyRegisterOptions(token, {
      origin: req.headers.get("origin") ?? undefined,
    });
    return NextResponse.json(out);
  } catch {
    return NextResponse.json({ error: "sudo-required" }, { status: 401 });
  }
}
