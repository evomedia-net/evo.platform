// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The actions import signIn from @/auth, whose module init wires the whole
// Auth.js config — mock it. next-auth itself is mocked because its ESM entry
// imports next/server, which vitest can't resolve outside the Next build.
vi.mock("@/auth", () => ({ signIn: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => true }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/platform", () => ({
  isPlatformMode: vi.fn(() => false),
  getPlatform: vi.fn(),
  defaultWorkspace: vi.fn(() => undefined),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findFirst: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock("@/lib/auth/tokens", () => ({
  consumeToken: vi.fn(),
  createToken: vi.fn(() => "raw-token-value"),
  RESET_TTL_MS: 3_600_000,
}));
vi.mock("@/lib/email/mailer", () => ({
  appBaseUrl: () => "http://test.local",
  passwordResetEmail: vi.fn(() => ({ to: "x", subject: "s", text: "t" })),
  sendMail: vi.fn(),
}));

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { defaultWorkspace, getPlatform, isPlatformMode } from "@/lib/platform";
import { prisma } from "@/lib/prisma";
import { consumeToken, createToken } from "@/lib/auth/tokens";
import { passwordResetEmail, sendMail } from "@/lib/email/mailer";
import { requestPasswordReset, requestWorkspaceList, resetPassword } from "./actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const state = { error: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlatformMode).mockReturnValue(false);
  vi.mocked(defaultWorkspace).mockReturnValue(undefined);
});

describe("requestPasswordReset", () => {
  it("rejects an address that isn't one", async () => {
    const res = await requestPasswordReset(state, form({ email: "nope" }));
    expect(res.error).toMatch(/valid email/i);
  });

  // The point of the generic answer: a different response for a known address
  // turns this form into a way to enumerate accounts.
  it("answers identically for a known and an unknown address", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: "u1" } as never);
    const known = await requestPasswordReset(state, form({ email: "real@example.com" }));

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null as never);
    const unknown = await requestPasswordReset(state, form({ email: "ghost@example.com" }));

    expect(known).toEqual(unknown);
    expect(known.error).toBeNull();
  });

  it("only sends mail when the account exists", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce(null as never);
    await requestPasswordReset(state, form({ email: "ghost@example.com" }));
    expect(sendMail).not.toHaveBeenCalled();

    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: "u1" } as never);
    await requestPasswordReset(state, form({ email: "real@example.com" }));
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  // In the fragment, never the query string: the token must not reach an
  // access log, proxy log or Referer header on its way to the page (#163).
  it("builds a link carrying the address and token in the fragment", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValueOnce({ id: "u1" } as never);
    await requestPasswordReset(state, form({ email: "real@example.com" }));
    const link = vi.mocked(passwordResetEmail).mock.calls[0]![1];
    expect(link).toContain("/reset-password#");
    expect(link).not.toContain("/reset-password?");
    expect(link).toContain("email=real%40example.com");
    expect(link).toContain("token=raw-token-value");
  });

  // In platform mode the platform owns the password: minting a local token
  // would produce a link that resets a password this app doesn't store.
  it("delegates in platform mode and mints no local token", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const forgotPassword = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(getPlatform).mockReturnValue({ forgotPassword } as never);

    const res = await requestPasswordReset(
      state,
      form({ email: "kelly@example.com", workspace: "Acme" }),
    );

    expect(res.error).toBeNull();
    expect(createToken).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    // Lower-cased: slugs are case-sensitive on the platform side.
    expect(forgotPassword).toHaveBeenCalledWith({
      tenantSlug: "acme",
      email: "kelly@example.com",
    });
  });

  // Without a slug the platform searches platform-level accounts only, so
  // every tenant user silently gets no mail.
  it("falls back to the configured default workspace when the field is blank", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    vi.mocked(defaultWorkspace).mockReturnValue("house-workspace");
    const forgotPassword = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(getPlatform).mockReturnValue({ forgotPassword } as never);

    await requestPasswordReset(state, form({ email: "kelly@example.com", workspace: "  " }));

    expect(forgotPassword).toHaveBeenCalledWith(
      expect.objectContaining({ tenantSlug: "house-workspace" }),
    );
  });

  it("reports a platform outage instead of falsely confirming an email was sent", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    vi.mocked(getPlatform).mockReturnValue({
      forgotPassword: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    } as never);

    const res = await requestPasswordReset(state, form({ email: "kelly@example.com" }));
    expect(res.error).toMatch(/couldn't reach/i);
  });
});

describe("resetPassword", () => {
  const good = {
    email: "kelly@example.com",
    token: "a-token-long-enough",
    password: "correct horse battery",
    confirm: "correct horse battery",
  };

  it("enforces the password policy on this path too", async () => {
    const res = await resetPassword(state, form({ ...good, password: "short", confirm: "short" }));
    expect(res.error).toBeTruthy();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation", async () => {
    const res = await resetPassword(state, form({ ...good, confirm: "something else entirely" }));
    expect(res.error).toMatch(/don't match/i);
  });

  it("refuses an expired or unknown token without touching the password", async () => {
    vi.mocked(consumeToken).mockResolvedValueOnce(false);
    const res = await resetPassword(state, form(good));
    expect(res.error).toMatch(/invalid or has expired/i);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("sets the password when the token is good", async () => {
    vi.mocked(consumeToken).mockResolvedValueOnce(true);
    vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    await resetPassword(state, form(good));
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      // platformUserId: null scopes the write to standalone accounts. Without
      // it a local reset could overwrite a platform-provisioned row, whose
      // password the platform owns and this app must never set.
      expect.objectContaining({ where: { email: good.email, platformUserId: null } }),
    );
  });

  // A valid token for an account that no longer exists (deleted between the
  // request and the click) matches no row; that is not a success.
  it("reports a vanished account instead of signing in", async () => {
    vi.mocked(consumeToken).mockResolvedValueOnce(true);
    vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 0 } as never);
    const res = await resetPassword(state, form(good));
    expect(res.error).toMatch(/account not found/i);
    expect(signIn).not.toHaveBeenCalled();
  });

  // The password is already changed by this point. A 500 here sends people
  // back to request a second reset for a password that actually works.
  it("renders a failed auto-sign-in as a form message, never an exception", async () => {
    vi.mocked(consumeToken).mockResolvedValueOnce(true);
    vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    vi.mocked(signIn).mockRejectedValueOnce(new AuthError("nope"));

    const res = await resetPassword(state, form(good));
    expect(res.error).toMatch(/password was updated/i);
  });

  // signIn signals success by throwing NEXT_REDIRECT; swallowing that would
  // strand the user on the form after a completed reset.
  it("lets the redirect propagate on success", async () => {
    vi.mocked(consumeToken).mockResolvedValueOnce(true);
    vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    const redirect = new Error("NEXT_REDIRECT");
    vi.mocked(signIn).mockRejectedValueOnce(redirect);

    await expect(resetPassword(state, form(good))).rejects.toThrow("NEXT_REDIRECT");
  });

  it("turns a stale pre-cutover link into a message rather than resetting anything", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const res = await resetPassword(state, form(good));
    expect(res.error).toMatch(/no longer valid/i);
    expect(consumeToken).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("requestWorkspaceList", () => {
  it("says there is nothing to look up when running standalone", async () => {
    const res = await requestWorkspaceList(state, form({ email: "kelly@example.com" }));
    expect(res.error).toMatch(/single workspace/i);
  });

  // The reply goes by email, never in the response — otherwise this endpoint
  // reads out the workspaces for any address someone cares to type.
  it("asks the platform and returns nothing about the account", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const forgotWorkspace = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(getPlatform).mockReturnValue({ forgotWorkspace } as never);

    const res = await requestWorkspaceList(state, form({ email: "Kelly@Example.com" }));

    expect(res).toEqual({ error: null });
    // No product name or URL: the platform resolves both from the app
    // registry via the SDK's configured client id. Passing them let any
    // caller choose the sender name and link target of platform mail
    // (security review #124).
    expect(forgotWorkspace).toHaveBeenCalledWith({ email: "kelly@example.com" });
  });

  it("reports an outage rather than confirming mail that never went", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    vi.mocked(getPlatform).mockReturnValue({
      forgotWorkspace: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    } as never);

    const res = await requestWorkspaceList(state, form({ email: "kelly@example.com" }));
    expect(res.error).toMatch(/couldn't reach/i);
  });
});
