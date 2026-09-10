// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The sign-up, sign-in and re-send actions. recovery.test.ts covers the
 * reset and workspace-lookup actions in this same module; this file is the
 * rest of it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ signIn: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => true) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/platform", () => ({
  isPlatformMode: vi.fn(() => false),
  getPlatform: vi.fn(),
  defaultWorkspace: vi.fn(() => undefined),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findFirst: vi.fn() }, $transaction: vi.fn() },
}));
// The POLICY stays real - it is what signup enforces - but bcrypt at cost 12
// is about a second per hash and would dominate the suite.
vi.mock("@/lib/auth/password", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/password")>()),
  hashPassword: vi.fn(async () => "hashed"),
}));
vi.mock("@/lib/email/mailer", () => ({
  appBaseUrl: () => "http://test.local",
  passwordResetEmail: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock("@/lib/auth/tokens", () => ({
  consumeToken: vi.fn(),
  createToken: vi.fn(),
  RESET_TTL_MS: 3_600_000,
}));

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { audit } from "@/lib/audit";
import { defaultWorkspace, getPlatform, isPlatformMode } from "@/lib/platform";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import {
  login,
  requestPasswordReset,
  requestWorkspaceList,
  resendVerification,
  signup,
} from "./actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const state = { error: null };
const STRONG = "correct horse battery staple";

// What the standalone signup transaction gets to talk to.
const tx = {
  user: { create: vi.fn() },
  tenant: { create: vi.fn() },
  membership: { create: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlatformMode).mockReturnValue(false);
  vi.mocked(defaultWorkspace).mockReturnValue(undefined);
  vi.mocked(rateLimit).mockReturnValue(true);
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (t: typeof tx) => Promise<unknown>) =>
    fn(tx)) as never);
  tx.user.create.mockResolvedValue({ id: "u1" });
  tx.tenant.create.mockResolvedValue({ id: "t1" });
  tx.membership.create.mockResolvedValue({});
});

describe("signup", () => {
  const good = { company: "Acme Widgets", email: "Owner@Acme.Example", password: STRONG };

  it("rejects bad input before touching anything", async () => {
    const res = await signup(state, form({ ...good, company: "A" }));
    expect(res.error).toMatch(/at least 2 characters/);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("enforces the password policy", async () => {
    const res = await signup(state, form({ ...good, password: "password123" }));
    expect(res.error).toBeTruthy();
    expect(res.error).not.toMatch(/company/i);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("is rate limited per address", async () => {
    vi.mocked(rateLimit).mockReturnValue(false);
    const res = await signup(state, form(good));
    expect(res.error).toMatch(/too many attempts/i);
    expect(rateLimit).toHaveBeenCalledWith("signup:owner@acme.example", 5, 15 * 60_000);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a duplicate standalone account", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "existing" } as never);
    const res = await signup(state, form(good));
    expect(res.error).toMatch(/already exists/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates user, workspace and OWNER membership in one transaction, audits, and signs in", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    const res = await signup(state, form(good));

    expect(tx.user.create).toHaveBeenCalledWith({
      data: { email: "owner@acme.example", passwordHash: "hashed", name: "owner" },
    });
    const tenant = tx.tenant.create.mock.calls[0]![0].data;
    expect(tenant.name).toBe("Acme Widgets");
    expect(tenant.slug).toMatch(/^acme-widgets-[a-z0-9]{6}$/);
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { userId: "u1", tenantId: "t1", role: "OWNER" },
    });
    expect(audit).toHaveBeenCalledWith("auth.signup", {
      tenantId: "t1",
      detail: { email: "owner@acme.example" },
    });
    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "owner@acme.example",
      password: STRONG,
      redirectTo: "/",
    });
    expect(res).toEqual({ error: null });
  });

  it("slugifies a name with nothing usable in it to 'company', and caps the base at 40", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    await signup(state, form({ ...good, company: "!!!" }));
    expect(tx.tenant.create.mock.calls[0]![0].data.slug).toMatch(/^company-[a-z0-9]{6}$/);

    tx.tenant.create.mockClear();
    await signup(state, form({ ...good, company: "x".repeat(60) }));
    const slug: string = tx.tenant.create.mock.calls[0]![0].data.slug;
    expect(slug).toHaveLength(40 + 1 + 6);
  });

  // signIn signals success by throwing NEXT_REDIRECT; swallowing it would
  // leave the new owner on the signup form.
  it("lets the post-signup redirect propagate", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never);
    vi.mocked(signIn).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(signup(state, form(good))).rejects.toThrow("NEXT_REDIRECT");
  });

  it("delegates to the platform's self-service signup in platform mode", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const platformSignup = vi.fn().mockResolvedValue({ tenantSlug: "acme-widgets" });
    vi.mocked(getPlatform).mockReturnValue({ signup: platformSignup } as never);

    const res = await signup(state, form(good));

    expect(platformSignup).toHaveBeenCalledWith({
      company: "Acme Widgets",
      email: "owner@acme.example",
      password: STRONG,
    });
    expect(res.error).toBeNull();
    expect(res.notice).toMatch(/"acme-widgets" created/);
    expect(res.canResend).toBe(true);
    expect(res.resendEmail).toBe("owner@acme.example");
    expect(res.resendWorkspace).toBe("acme-widgets");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("passes the platform's own message through, and has a fallback for a bare throw", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    vi.mocked(getPlatform).mockReturnValue({
      signup: vi.fn().mockRejectedValue(new Error("Signups are closed")),
    } as never);
    expect((await signup(state, form(good))).error).toBe("Signups are closed");

    vi.mocked(getPlatform).mockReturnValue({ signup: vi.fn().mockRejectedValue("boom") } as never);
    expect((await signup(state, form(good))).error).toBe("Signup failed");
  });
});

describe("login", () => {
  const good = { email: "Owner@Acme.Example", password: "whatever" };

  it("validates the form", async () => {
    expect((await login(state, form({ email: "nope", password: "x" }))).error).toMatch(/valid email/);
    expect((await login(state, form({ email: "a@b.co", password: "" }))).error).toMatch(/required/);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("is rate limited per address", async () => {
    vi.mocked(rateLimit).mockReturnValue(false);
    const res = await login(state, form(good));
    expect(res.error).toMatch(/too many attempts/i);
    expect(rateLimit).toHaveBeenCalledWith("login:owner@acme.example", 10, 15 * 60_000);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs in with a normalised address and an empty workspace when none was given", async () => {
    vi.mocked(signIn).mockRejectedValueOnce(new Error("NEXT_REDIRECT"));
    await expect(login(state, form(good))).rejects.toThrow("NEXT_REDIRECT");
    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "owner@acme.example",
      password: "whatever",
      workspace: "",
      redirectTo: "/",
    });
  });

  it("returns the generic message for bad credentials, without probing the platform standalone", async () => {
    vi.mocked(signIn).mockRejectedValueOnce(new AuthError("CredentialsSignin"));
    const res = await login(state, form(good));
    expect(res.error).toBe("Invalid email or password");
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("rethrows anything that is not an auth failure", async () => {
    vi.mocked(signIn).mockRejectedValueOnce(new TypeError("network down"));
    await expect(login(state, form(good))).rejects.toThrow("network down");
  });

  describe("in platform mode, after an auth failure", () => {
    beforeEach(() => {
      vi.mocked(isPlatformMode).mockReturnValue(true);
      vi.mocked(signIn).mockRejectedValueOnce(new AuthError("CredentialsSignin"));
    });

    it("offers a re-send when the probe says the email is unverified", async () => {
      const probe = vi.fn().mockRejectedValue(new Error("Email not verified"));
      vi.mocked(getPlatform).mockReturnValue({ login: probe } as never);

      const res = await login(state, form({ ...good, workspace: " Acme " }));

      expect(probe).toHaveBeenCalledWith({
        tenantSlug: "acme",
        email: "owner@acme.example",
        password: "whatever",
      });
      expect(res.error).toMatch(/not verified/);
      expect(res.canResend).toBe(true);
      expect(res.resendEmail).toBe("owner@acme.example");
      expect(res.resendWorkspace).toBe("acme");
    });

    it("uses the configured default workspace for the probe when the field is blank", async () => {
      vi.mocked(defaultWorkspace).mockReturnValue("house");
      const probe = vi.fn().mockRejectedValue(new Error("Email not verified"));
      vi.mocked(getPlatform).mockReturnValue({ login: probe } as never);

      const res = await login(state, form(good));

      expect(probe).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: "house" }));
      expect(res.resendWorkspace).toBe("house");
    });

    it("hands the form an empty workspace when no default is configured either", async () => {
      // No field, no EVO_DEFAULT_WORKSPACE: the resend action still needs a
      // string, not undefined, so the hidden input round-trips cleanly.
      vi.mocked(defaultWorkspace).mockReturnValue(undefined as never);
      vi.mocked(getPlatform).mockReturnValue({
        login: vi.fn().mockRejectedValue(new Error("Email not verified")),
      } as never);

      const res = await login(state, form(good));

      expect(res.canResend).toBe(true);
      expect(res.resendWorkspace).toBe("");
    });

    it("stays generic when the probe fails for any other reason", async () => {
      vi.mocked(getPlatform).mockReturnValue({
        login: vi.fn().mockRejectedValue(new Error("Invalid credentials")),
      } as never);
      expect((await login(state, form(good))).error).toBe("Invalid email or password");
    });

    it("stays generic when the probe unexpectedly succeeds", async () => {
      vi.mocked(getPlatform).mockReturnValue({
        login: vi.fn().mockResolvedValue({ accessToken: "t" }),
      } as never);
      const res = await login(state, form(good));
      expect(res.error).toBe("Invalid email or password");
      expect(res.canResend).toBeUndefined();
    });
  });
});

describe("resendVerification", () => {
  it("is a no-op standalone, and for an empty address", async () => {
    expect(await resendVerification("a@b.c")).toEqual({ ok: true });
    vi.mocked(isPlatformMode).mockReturnValue(true);
    expect(await resendVerification("")).toEqual({ ok: true });
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("is rate limited, and still answers ok", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    vi.mocked(rateLimit).mockReturnValue(false);
    expect(await resendVerification("a@b.c")).toEqual({ ok: true });
    expect(rateLimit).toHaveBeenCalledWith("resend:a@b.c", 3, 15 * 60_000);
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("asks the platform, with the given or default workspace", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const send = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(getPlatform).mockReturnValue({ sendVerificationEmail: send } as never);

    await resendVerification("a@b.c", "acme");
    expect(send).toHaveBeenCalledWith({ tenantSlug: "acme", email: "a@b.c" });

    vi.mocked(defaultWorkspace).mockReturnValue("house");
    await resendVerification("a@b.c");
    expect(send).toHaveBeenLastCalledWith({ tenantSlug: "house", email: "a@b.c" });
  });

  // Same answer whether or not the account exists, and whether or not the
  // platform could be reached: this endpoint must not distinguish them.
  it("answers ok even when the platform call fails", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    vi.mocked(getPlatform).mockReturnValue({
      sendVerificationEmail: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    } as never);
    expect(await resendVerification("a@b.c")).toEqual({ ok: true });
  });
});

// recovery.test.ts covers the standalone answer and the platform paths; these
// are the two gates in front of them.
describe("requestWorkspaceList gates", () => {
  it("rejects an address that isn't one", async () => {
    const res = await requestWorkspaceList(state, form({ email: "nope" }));
    expect(res.error).toMatch(/valid email/i);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("is rate limited per address", async () => {
    vi.mocked(rateLimit).mockReturnValue(false);
    const res = await requestWorkspaceList(state, form({ email: "Owner@Acme.Example" }));
    expect(res.error).toMatch(/too many requests/i);
    expect(rateLimit).toHaveBeenCalledWith("workspaces:owner@acme.example", 3, 15 * 60_000);
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("rejects a form with no email field before consulting the rate limiter", async () => {
    const res = await requestWorkspaceList(state, form({}));
    expect(res.error).toBeTruthy();
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset gate", () => {
  it("is rate limited per address", async () => {
    vi.mocked(rateLimit).mockReturnValue(false);
    const res = await requestPasswordReset(state, form({ email: "Owner@Acme.Example" }));
    expect(res.error).toMatch(/too many reset requests/i);
    expect(rateLimit).toHaveBeenCalledWith("pwreset:owner@acme.example", 3, 15 * 60_000);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a form with no email field before consulting the rate limiter", async () => {
    const res = await requestPasswordReset(state, form({}));
    expect(res.error).toBeTruthy();
    expect(rateLimit).not.toHaveBeenCalled();
  });
});

describe("login when sign-in returns instead of redirecting", () => {
  // Auth.js signals success by throwing NEXT_REDIRECT; a plain return is the
  // shape a custom signIn wrapper might have, and it must read as success.
  it("reports no error", async () => {
    vi.mocked(signIn).mockResolvedValueOnce(undefined as never);
    expect(await login(state, form({ email: "a@b.co", password: "pw" }))).toEqual({ error: null });
  });
});
