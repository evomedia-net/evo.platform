// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Changing a password is a SET path, so it takes the same policy as signup and
 * reset. It used to take a bare min(8), which accepted "password" - eight
 * characters and a literal member of COMMON_PASSWORDS - defeating the
 * screening every other path applies. This ships in the template, so every
 * scaffolded app inherited it (security review #128).
 *
 * The current password is a REAL bcrypt hash here, not a stub. A fake hash
 * makes every case fail at "Current password is incorrect" instead of at the
 * policy, so the test passes against the vulnerable code and proves nothing -
 * which is exactly what the first version of this file did.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/platform", () => ({ isPlatformMode: vi.fn(() => false) }));
vi.mock("@/lib/auth/dal", () => ({
  verifySession: vi.fn(async () => ({ userId: "u1", tenantId: "t1" })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { changePassword } from "./actions";

const CURRENT = "the current passphrase";
let currentHash: string;

function form(next: string, confirm = next, current = CURRENT): FormData {
  const fd = new FormData();
  fd.set("current", current);
  fd.set("next", next);
  fd.set("confirm", confirm);
  return fd;
}

const state = { error: null };

beforeAll(async () => {
  currentHash = await hashPassword(CURRENT);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: "u1",
    passwordHash: currentHash,
  } as never);
  vi.mocked(prisma.user.update).mockResolvedValue({ id: "u1" } as never);
});

describe("changePassword password policy", () => {
  // Positive control: proves the harness can actually reach the write, so
  // "update was not called" means the policy stopped it - not the fixture.
  it("accepts a strong password and writes it", async () => {
    const res = await changePassword(state, form("correct horse battery staple"));

    expect(res.error).toBeNull();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it.each([
    ["password", "a common password, exactly 8 characters"],
    ["Summer2026!", "under the 12-character minimum"],
    ["abcdefghijklm", "a sequential run"],
  ])("refuses %s (%s)", async (pw) => {
    const res = await changePassword(state, form(pw));

    expect(prisma.user.update).not.toHaveBeenCalled();
    // Rejected by the POLICY, not by the credential check - otherwise this
    // test would pass against a bare min(8) too.
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/current password/i);
  });

  it("still rejects a mismatched confirmation", async () => {
    const res = await changePassword(
      state,
      form("correct horse battery staple", "something else entirely"),
    );
    expect(res.error).toMatch(/don't match/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("still rejects a wrong current password", async () => {
    const res = await changePassword(
      state,
      form("correct horse battery staple", "correct horse battery staple", "not the password"),
    );
    expect(res.error).toMatch(/current password/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
