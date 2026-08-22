// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth/dal";
import { hashPassword, newPassword, verifyPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { isPlatformMode } from "@/lib/platform";

export interface AccountActionState {
  error: string | null;
  ok?: string | null;
}

const schema = z
  .object({
    current: z.string().min(1, "Current password is required"),
    // newPassword() is the NIST/OWASP policy - 12 chars, common-password
    // blocklist, leet/padding normalization, sequence screening - and the
    // policy's own rule is "applied when a password is SET or CHANGED".
    // A bare min(8) here let an authenticated user set "password", which
    // is 8 characters and a literal member of COMMON_PASSWORDS, defeating
    // the screening every other path applies.
    next: newPassword(),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export async function changePassword(
  _prev: AccountActionState,
  formData: FormData,
): Promise<AccountActionState> {
  if (isPlatformMode()) {
    return { error: "Your password is managed by the platform" };
  }
  const session = await verifySession();
  const parsed = schema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user?.passwordHash || !(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return { error: "Current password is incorrect" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next) },
  });
  await audit("auth.password_changed", { tenantId: session.tenantId, userId: user.id });
  return { error: null, ok: "Password updated" };
}
