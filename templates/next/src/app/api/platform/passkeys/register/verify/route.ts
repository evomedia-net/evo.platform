// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/dal";
import { getPlatform, isPlatformMode } from "@/lib/platform";

const schema = z.object({
  credential: z.record(z.string(), z.unknown()),
  challengeToken: z.string().min(1),
  nickname: z.string().trim().max(100).optional(),
});

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
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const saved = await getPlatform().passkeyRegisterVerify(token, parsed.data);
    return NextResponse.json(saved, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Passkey registration could not be verified" }, { status: 400 });
  }
}
