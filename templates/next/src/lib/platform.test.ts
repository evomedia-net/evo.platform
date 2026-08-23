// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * JIT provisioning must key local users on the PLATFORM's identity, and the
 * session must be bound to the workspace that was actually authenticated
 * against.
 *
 * Both rules exist because of one bug. The platform scopes accounts per
 * workspace (`@@unique([tenantId, email])`), so one address is a different
 * person — different password — in each workspace. Provisioning upserted the
 * local row on the address alone, merging them; the session then resolved to
 * the user's OLDEST membership rather than the one just proven. A tenant
 * admin of any workspace could create a member carrying a victim's address
 * (the platform marks it verified on the admin's say-so), sign in with it,
 * and receive a session scoped to the victim's workspace.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyToken = vi.fn();

vi.mock("server-only", () => ({}));
// Mock the SDK, not the module under test: getPlatform() constructs this
// class, so every EvoPlatform instance the real code builds is this stub.
vi.mock("@evoplatform/sdk-node", () => ({
  EvoPlatform: class {
    verifyToken = verifyToken;
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { upsert: vi.fn() },
    user: { upsert: vi.fn() },
    membership: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

// isPlatformMode()/getPlatform() read this at call time.
process.env.PLATFORM_URL = "https://platform.test";

import { prisma } from "@/lib/prisma";
import { provisionFromPlatform } from "@/lib/platform";

const loginResult = (email: string, tenantSlug: string) =>
  ({
    accessToken: "token",
    user: { name: "A User", tenant: { name: "Victim Corp" } },
    // The claims are what the platform VERIFIED, which is the whole point:
    // provisioning must read identity from here, never from a form.
    _claims: { sub: "platform-user-1", email, tenant_slug: tenantSlug, roles: [] },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.tenant.upsert).mockResolvedValue({ id: "tenant-b" } as never);
  vi.mocked(prisma.user.upsert).mockResolvedValue({ id: "local-1" } as never);
  vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "MEMBER" } as never);
});

describe("provisionFromPlatform", () => {
  it("keys the local user on the platform id, never the email address", async () => {
    verifyToken.mockResolvedValue({
      sub: "platform-user-1",
      email: "victim@othercorp.com",
      tenant_slug: "attacker-co",
      roles: [],
    });

    await provisionFromPlatform(loginResult("victim@othercorp.com", "attacker-co"));

    const call = vi.mocked(prisma.user.upsert).mock.calls[0]![0];
    // The regression: `where: { email }` matched a DIFFERENT platform user who
    // happened to share the address, handing over their local account.
    expect(call.where).toEqual({ platformUserId: "platform-user-1" });
    expect(call.where).not.toHaveProperty("email");
  });

  it("returns the tenant that was authenticated against, so the session can bind to it", async () => {
    verifyToken.mockResolvedValue({
      sub: "platform-user-1",
      email: "a@b.test",
      tenant_slug: "attacker-co",
      roles: [],
    });

    const out = await provisionFromPlatform(loginResult("a@b.test", "attacker-co"));

    // Previously this returned the user alone and the caller resolved a tenant
    // from their memberships — the second half of the takeover.
    expect(out?.tenantId).toBe("tenant-b");
  });

  it("refuses a login carrying no workspace rather than guessing one", async () => {
    verifyToken.mockResolvedValue({
      sub: "platform-user-1",
      email: "admin@platform.test",
      tenant_slug: null,
      roles: [],
    });

    const out = await provisionFromPlatform({
      accessToken: "t",
      user: { name: "Platform Admin", tenant: null },
    } as never);

    expect(out).toBeNull();
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  // The platform owns roles in platform mode, so a demotion there has to reach
  // the app. Only ever RAISING the local role -- which is what "never
  // downgrade an OWNER" amounted to in practice -- meant revoking someone's
  // admin on the platform left them admin here for the life of the row.
  describe("role reconciliation", () => {
    beforeEach(() => {
      verifyToken.mockResolvedValue({
        sub: "platform-user-1",
        email: "a@b.test",
        tenant_slug: "acme",
        roles: [],
      });
    });

    it("lowers ADMIN to MEMBER when the platform no longer grants admin", async () => {
      vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "ADMIN" } as never);
      await provisionFromPlatform(loginResult("a@b.test", "acme"));
      expect(prisma.membership.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: "MEMBER" } }),
      );
    });

    it("raises MEMBER to ADMIN when the platform grants admin", async () => {
      verifyToken.mockResolvedValue({
        sub: "platform-user-1",
        email: "a@b.test",
        tenant_slug: "acme",
        roles: ["admin"],
      });
      vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "MEMBER" } as never);
      await provisionFromPlatform(loginResult("a@b.test", "acme"));
      expect(prisma.membership.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: "ADMIN" } }),
      );
    });

    // Not the old carve-out returning: the platform grants "admin" or nothing
    // and has no OWNER, so reconciling OWNER against these claims would demote
    // every workspace owner on their next login.
    it("leaves OWNER alone, because the platform never issues that role", async () => {
      vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "OWNER" } as never);
      await provisionFromPlatform(loginResult("a@b.test", "acme"));
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });

    it("writes nothing when the role already matches", async () => {
      vi.mocked(prisma.membership.findUnique).mockResolvedValue({ role: "MEMBER" } as never);
      await provisionFromPlatform(loginResult("a@b.test", "acme"));
      expect(prisma.membership.update).not.toHaveBeenCalled();
    });
  });
});
