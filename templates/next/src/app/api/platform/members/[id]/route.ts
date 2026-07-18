import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlatform } from "@/lib/platform";
import { memberProxyGate, platformErrorResponse } from "@/lib/member-proxy";

const updateSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(40).optional(),
  isTenantAdmin: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid member details" }, { status: 400 });
  }
  const { id } = await params;
  try {
    return NextResponse.json(await getPlatform().updateTenantMember(gate.token, id, parsed.data));
  } catch (err) {
    return platformErrorResponse(err);
  }
}

/** Deactivate (soft): the member can no longer sign in; restorable. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await memberProxyGate(req);
  if (gate.res) return gate.res;
  const { id } = await params;
  try {
    return NextResponse.json(await getPlatform().deactivateTenantMember(gate.token, id));
  } catch (err) {
    return platformErrorResponse(err);
  }
}
