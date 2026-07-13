import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/dal";
import { getPlatform, isPlatformMode } from "@/lib/platform";

/** List the signed-in user's passkeys (requires the sudo cookie). */
export async function GET(req: NextRequest) {
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
    return NextResponse.json(await getPlatform().listPasskeys(token));
  } catch {
    return NextResponse.json({ error: "sudo-required" }, { status: 401 });
  }
}
