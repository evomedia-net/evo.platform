import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/dal";
import { getPlatform, isPlatformMode } from "@/lib/platform";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const { id } = await params;
  try {
    return NextResponse.json(await getPlatform().deletePasskey(token, id));
  } catch {
    return NextResponse.json({ error: "Could not remove passkey" }, { status: 400 });
  }
}
