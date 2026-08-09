// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Pre-auth proxy: passkey login options from the platform. The browser's
 * Origin header is forwarded so the platform derives the WebAuthn RP from
 * the page actually running the ceremony.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rateLimit";
import { defaultWorkspace, getPlatform, isPlatformMode } from "@/lib/platform";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  workspace: z.string().trim().toLowerCase().optional(),
});

export async function POST(req: NextRequest) {
  if (!isPlatformMode()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { email, workspace } = parsed.data;
  if (!rateLimit(`pk-login:${email}`, 10, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }
  try {
    const out = await getPlatform().passkeyLoginOptions(
      { tenantSlug: workspace || defaultWorkspace(), email },
      { origin: req.headers.get("origin") ?? undefined },
    );
    return NextResponse.json(out);
  } catch {
    // Indistinguishable from "no passkeys" — no account probing.
    return NextResponse.json({ options: null });
  }
}
