// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The Auth.js configuration. NextAuth() is called at import with the config
 * object; the mock keeps that object so its authorize() functions and jwt /
 * session callbacks can be driven directly, with no Auth.js runtime.
 *
 * Two things here have bitten before and are pinned: the session binds to
 * the workspace that was actually authenticated against (not the user's
 * oldest membership), and a role change on the platform reaches an open
 * session within ROLE_REFRESH_MS rather than at cookie expiry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ captured: undefined as any }));

vi.mock("next-auth", () => ({
  default: vi.fn((config: unknown) => {
    h.captured = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  }),
  AuthError: class AuthError extends Error {},
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: (opts: { id?: string }) => ({ id: opts.id ?? "credentials", ...opts }),
}));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: () => ({}) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: vi.fn() },
    membership: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/auth/password", () => ({ verifyPassword: vi.fn() }));
vi.mock("@/lib/platform", () => ({
  isPlatformMode: vi.fn(() => false),
  getPlatform: vi.fn(),
  defaultWorkspace: vi.fn(() => undefined),
  provisionFromPlatform: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import {
  defaultWorkspace,
  getPlatform,
  isPlatformMode,
  provisionFromPlatform,
} from "@/lib/platform";
import "@/auth";

/* eslint-disable @typescript-eslint/no-explicit-any */
const password = () => h.captured.providers[0].authorize as (c: any) => Promise<any>;
const passkey = () => h.captured.providers[1].authorize as (c: any) => Promise<any>;
const jwt = () => h.captured.callbacks.jwt as (a: any) => Promise<any>;
const session = () => h.captured.callbacks.session as (a: any) => Promise<any>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlatformMode).mockReturnValue(false);
  vi.mocked(defaultWorkspace).mockReturnValue(undefined);
});

describe("configuration", () => {
  it("uses the JWT strategy, the app-specific cookie, and the login page", () => {
    expect(h.captured.session).toEqual({ strategy: "jwt", maxAge: 30 * 24 * 60 * 60 });
    expect(h.captured.pages).toEqual({ signIn: "/login" });
    expect(h.captured.cookies.sessionToken.name).toBe("evoapp.session-token");
    expect(h.captured.cookies.sessionToken.options).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
  });
});

describe("password authorize, standalone", () => {
  it("refuses a missing email or password without touching the database", async () => {
    expect(await password()({ email: "", password: "x" })).toBeNull();
    expect(await password()({ email: "a@b.c", password: "" })).toBeNull();
    expect(await password()(undefined)).toBeNull();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("looks up standalone accounts only, by a normalised address", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    expect(await password()({ email: "  Owner@Acme.Example ", password: "pw" })).toBeNull();
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      // platformUserId: null - a platform-provisioned row has no password here
      where: { email: "owner@acme.example", platformUserId: null },
    });
  });

  it("refuses a row with no password hash and a wrong password", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1", passwordHash: null } as never);
    expect(await password()({ email: "a@b.c", password: "pw" })).toBeNull();
    expect(verifyPassword).not.toHaveBeenCalled();

    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1", passwordHash: "$2b$" } as never);
    vi.mocked(verifyPassword).mockResolvedValue(false);
    expect(await password()({ email: "a@b.c", password: "pw" })).toBeNull();
  });

  it("returns the user identity on a correct password", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "u1",
      email: "a@b.c",
      name: "A",
      passwordHash: "$2b$",
    } as never);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    expect(await password()({ email: "a@b.c", password: "pw" })).toEqual({
      id: "u1",
      email: "a@b.c",
      name: "A",
    });
    expect(verifyPassword).toHaveBeenCalledWith("pw", "$2b$");
  });
});

describe("password authorize, platform mode", () => {
  beforeEach(() => vi.mocked(isPlatformMode).mockReturnValue(true));

  it("logs in through the platform with the trimmed, lower-cased workspace", async () => {
    const login = vi.fn().mockResolvedValue({ accessToken: "t" });
    vi.mocked(getPlatform).mockReturnValue({ login } as never);
    vi.mocked(provisionFromPlatform).mockResolvedValue({
      user: { id: "l1", email: "a@b.c", name: "A" },
      tenantId: "tenant-b",
    } as never);

    const out = await password()({ email: "A@b.c", password: "pw", workspace: " Acme " });

    expect(login).toHaveBeenCalledWith({ tenantSlug: "acme", email: "a@b.c", password: "pw" });
    // tenantId rides along so the jwt callback binds the session to THIS workspace
    expect(out).toEqual({ id: "l1", email: "a@b.c", name: "A", tenantId: "tenant-b" });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the configured default workspace when the field is blank", async () => {
    vi.mocked(defaultWorkspace).mockReturnValue("house");
    const login = vi.fn().mockResolvedValue({});
    vi.mocked(getPlatform).mockReturnValue({ login } as never);
    vi.mocked(provisionFromPlatform).mockResolvedValue(null as never);

    expect(await password()({ email: "a@b.c", password: "pw", workspace: "  " })).toBeNull();
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: "house" }));
  });

  it("refuses when provisioning declines, and when the platform throws", async () => {
    vi.mocked(getPlatform).mockReturnValue({ login: vi.fn().mockResolvedValue({}) } as never);
    vi.mocked(provisionFromPlatform).mockResolvedValue(null as never);
    expect(await password()({ email: "a@b.c", password: "pw" })).toBeNull();

    vi.mocked(getPlatform).mockReturnValue({
      login: vi.fn().mockRejectedValue(new Error("Invalid credentials")),
    } as never);
    expect(await password()({ email: "a@b.c", password: "pw" })).toBeNull();
  });
});

describe("passkey authorize", () => {
  it("is platform-mode only", async () => {
    expect(await passkey()({ credential: "{}", challengeToken: "ct" })).toBeNull();
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("verifies the browser's credential with the platform and provisions the user", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const verify = vi.fn().mockResolvedValue({ accessToken: "t" });
    vi.mocked(getPlatform).mockReturnValue({ passkeyLoginVerify: verify } as never);
    vi.mocked(provisionFromPlatform).mockResolvedValue({
      user: { id: "l1", email: "a@b.c", name: null },
      tenantId: "tenant-b",
    } as never);

    const out = await passkey()({ credential: '{"id":"cred-1"}', challengeToken: "ct" });

    expect(verify).toHaveBeenCalledWith({ credential: { id: "cred-1" }, challengeToken: "ct" });
    expect(out).toEqual({ id: "l1", email: "a@b.c", name: null, tenantId: "tenant-b" });
  });

  it("refuses when provisioning declines, when the platform throws, and on bad JSON", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    vi.mocked(getPlatform).mockReturnValue({
      passkeyLoginVerify: vi.fn().mockResolvedValue({}),
    } as never);
    vi.mocked(provisionFromPlatform).mockResolvedValue(null as never);
    expect(await passkey()({ credential: "{}", challengeToken: "ct" })).toBeNull();

    vi.mocked(getPlatform).mockReturnValue({
      passkeyLoginVerify: vi.fn().mockRejectedValue(new Error("bad challenge")),
    } as never);
    expect(await passkey()({ credential: "{}", challengeToken: "ct" })).toBeNull();

    // JSON.parse throws inside the try; a malformed or absent credential is a
    // null, not a 500
    expect(await passkey()({ credential: "not json" })).toBeNull();
    expect(await passkey()({})).toBeNull();
  });

  it("sends an empty challenge token rather than the string 'undefined'", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const verify = vi.fn().mockResolvedValue({});
    vi.mocked(getPlatform).mockReturnValue({ passkeyLoginVerify: verify } as never);
    vi.mocked(provisionFromPlatform).mockResolvedValue(null as never);
    await passkey()({ credential: "{}" });
    expect(verify).toHaveBeenCalledWith({ credential: {}, challengeToken: "" });
  });
});

describe("jwt callback", () => {
  it("binds a platform sign-in to the workspace that was authenticated against", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({
      tenantId: "tenant-b",
      role: "ADMIN",
    } as never);

    const token = await jwt()({ token: {}, user: { id: "u1", tenantId: "tenant-b" } });

    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_tenantId: { userId: "u1", tenantId: "tenant-b" } },
    });
    expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    expect(token).toMatchObject({ uid: "u1", tenantId: "tenant-b", role: "ADMIN" });
    expect(typeof token.roleCheckedAt).toBe("number");
  });

  it("uses the sole membership for a standalone sign-in", async () => {
    vi.mocked(prisma.membership.findFirst).mockResolvedValue({
      tenantId: "t1",
      role: "OWNER",
    } as never);

    const token = await jwt()({ token: {}, user: { id: "u1" } });

    expect(prisma.membership.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "asc" },
    });
    expect(token).toMatchObject({ uid: "u1", tenantId: "t1", role: "OWNER" });
  });

  it("refuses to scope a session to a workspace the user is not in", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue(null as never);
    const token = await jwt()({ token: {}, user: { id: "u1", tenantId: "someone-elses" } });
    expect(token.tenantId).toBeNull();
    expect(token.role).toBeNull();
  });

  it("re-resolves a stale role, and drops the scope when the membership is gone", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({
      tenantId: "t1",
      role: "MEMBER",
    } as never);
    const stale = { uid: "u1", tenantId: "t1", role: "ADMIN", roleCheckedAt: Date.now() - 120_000 };

    const refreshed = await jwt()({ token: { ...stale } });
    expect(refreshed.role).toBe("MEMBER");
    expect(refreshed.roleCheckedAt).toBeGreaterThan(stale.roleCheckedAt);

    vi.mocked(prisma.membership.findUnique).mockResolvedValue(null as never);
    const removed = await jwt()({ token: { ...stale } });
    expect(removed.tenantId).toBeNull();
    expect(removed.role).toBeNull();
  });

  it("treats a missing check time as stale, and leaves a fresh token alone", async () => {
    vi.mocked(prisma.membership.findUnique).mockResolvedValue({
      tenantId: "t1",
      role: "MEMBER",
    } as never);
    await jwt()({ token: { uid: "u1", tenantId: "t1", role: "ADMIN" } });
    expect(prisma.membership.findUnique).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    const fresh = { uid: "u1", tenantId: "t1", role: "ADMIN", roleCheckedAt: Date.now() };
    expect(await jwt()({ token: { ...fresh } })).toEqual(fresh);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it("passes a token with no scope straight through", async () => {
    const anon = { something: "else" };
    expect(await jwt()({ token: { ...anon } })).toEqual(anon);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });
});

describe("session callback", () => {
  it("copies id, tenant and role onto the session user", async () => {
    const out = await session()({
      session: { user: { email: "a@b.c" } },
      token: { uid: "u1", tenantId: "t1", role: "ADMIN" },
    });
    expect(out.user).toEqual({ email: "a@b.c", id: "u1", tenantId: "t1", role: "ADMIN" });
  });

  it("defaults missing claims rather than leaving undefined behind", async () => {
    const out = await session()({ session: { user: {} }, token: {} });
    expect(out.user).toEqual({ id: "", tenantId: null, role: null });
  });

  it("leaves a session with no user untouched", async () => {
    const s = { expires: "later" };
    expect(await session()({ session: s, token: { uid: "u1" } })).toBe(s);
  });
});

// Last, because it re-imports the module: everything above holds references
// to the first import's mocks.
describe("cookie in production", () => {
  const prev = process.env.NODE_ENV;
  afterEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = prev;
  });

  it("uses the __Secure- prefix and the secure flag", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    vi.resetModules();
    await import("@/auth");
    expect(h.captured.cookies.sessionToken.name).toBe("__Secure-evoapp.session-token");
    expect(h.captured.cookies.sessionToken.options.secure).toBe(true);
  });
});
