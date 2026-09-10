// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The passkey proxy routes. Four are sudo-gated the same way — platform
 * mode, a session, the evo_sudo cookie, one platform call — and differ only
 * in the call and in how a failure is reported, so they share a table. The
 * pre-auth login-options route and the sudo route that mints the cookie
 * each get their own matrix.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn(),
  isPlatformMode: vi.fn(),
  defaultWorkspace: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: vi.fn() } } }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => true) }));
vi.mock("@/lib/auth/dal", () => ({ requireApiSession: vi.fn() }));

import { defaultWorkspace, getPlatform, isPlatformMode } from "@/lib/platform";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { requireApiSession } from "@/lib/auth/dal";

import * as list from "./route";
import * as one from "./[id]/route";
import * as registerOptions from "./register/options/route";
import * as registerVerify from "./register/verify/route";
import * as loginOptions from "./login/options/route";
import * as sudo from "./sudo/route";

const ORIGIN = "http://app.test";
const TOKEN = "sudo-token";
const session = { userId: "u1", tenantId: "t1", email: "owner@acme.example" };

function req(
  body?: unknown,
  init: { method?: string; raw?: string; cookie?: boolean; origin?: boolean } = {},
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.cookie !== false) headers.cookie = `evo_sudo=${TOKEN}`;
  if (init.origin !== false) headers.origin = ORIGIN;
  const method = init.method ?? (body === undefined && init.raw === undefined ? "GET" : "POST");
  return new NextRequest(`${ORIGIN}/api/platform/passkeys`, {
    method,
    headers,
    body: init.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function sdk(methods: Record<string, unknown>) {
  vi.mocked(getPlatform).mockReturnValue(methods as never);
  return methods;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlatformMode).mockReturnValue(true);
  vi.mocked(requireApiSession).mockResolvedValue(session as never);
  vi.mocked(rateLimit).mockReturnValue(true);
});

type Handler = (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const credential = { id: "cred", rawId: "cred", type: "public-key", response: {} };

describe.each([
  {
    name: "GET /passkeys",
    handler: list.GET as Handler,
    method: "GET",
    sdk: "listPasskeys",
    args: [TOKEN],
    okStatus: 200,
    failStatus: 401,
    failError: "sudo-required",
  },
  {
    name: "DELETE /passkeys/[id]",
    handler: one.DELETE as Handler,
    method: "DELETE",
    id: "p1",
    sdk: "deletePasskey",
    args: [TOKEN, "p1"],
    okStatus: 200,
    failStatus: 400,
    failError: "Could not remove passkey",
  },
  {
    name: "POST /passkeys/register/options",
    handler: registerOptions.POST as Handler,
    method: "POST",
    sdk: "passkeyRegisterOptions",
    args: [TOKEN, { origin: ORIGIN }],
    okStatus: 200,
    failStatus: 401,
    failError: "sudo-required",
  },
  {
    name: "POST /passkeys/register/verify",
    handler: registerVerify.POST as Handler,
    method: "POST",
    body: { credential, challengeToken: "ch", nickname: " Laptop " },
    sdk: "passkeyRegisterVerify",
    args: [TOKEN, { credential, challengeToken: "ch", nickname: "Laptop" }],
    okStatus: 201,
    failStatus: 400,
    failError: "Passkey registration could not be verified",
  },
])("$name", (c) => {
  const call = (r: NextRequest) => c.handler(r, params(c.id ?? "unused"));
  const good = () => req(c.body, { method: c.method });

  it("is not available standalone", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(false);
    expect((await call(good())).status).toBe(404);
    expect(requireApiSession).not.toHaveBeenCalled();
  });

  it("returns the DAL's 401 when there is no session, and rethrows anything else", async () => {
    const unauthorized = new Response(null, { status: 401 });
    vi.mocked(requireApiSession).mockRejectedValueOnce(unauthorized);
    expect(await call(good())).toBe(unauthorized);

    vi.mocked(requireApiSession).mockRejectedValueOnce(new Error("db down"));
    await expect(call(good())).rejects.toThrow("db down");
  });

  it("demands the sudo cookie", async () => {
    const fn = vi.fn();
    sdk({ [c.sdk]: fn });
    const res = await call(req(c.body, { method: c.method, cookie: false }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "sudo-required" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("forwards to the platform with the cookie's token and echoes the result", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: c.sdk });
    sdk({ [c.sdk]: fn });
    const res = await call(good());
    expect(res.status).toBe(c.okStatus);
    expect(await res.json()).toEqual({ ok: c.sdk });
    expect(fn).toHaveBeenCalledWith(...c.args);
  });

  it(`reports a platform failure as ${c.failStatus} without leaking the cause`, async () => {
    sdk({ [c.sdk]: vi.fn().mockRejectedValue(new Error("token expired: secret detail")) });
    const res = await call(good());
    expect(res.status).toBe(c.failStatus);
    expect(await res.json()).toEqual({ error: c.failError });
  });
});

describe("POST /passkeys/register/options origin forwarding", () => {
  it("passes no origin when the browser sent none", async () => {
    const fn = vi.fn().mockResolvedValue({});
    sdk({ passkeyRegisterOptions: fn });
    await registerOptions.POST(req(undefined, { method: "POST", origin: false }));
    expect(fn).toHaveBeenCalledWith(TOKEN, { origin: undefined });
  });
});

describe("POST /passkeys/register/verify body", () => {
  it.each([
    ["no credential", { challengeToken: "ch" }],
    ["a credential that is not an object", { credential: "x", challengeToken: "ch" }],
    ["an empty challenge token", { credential, challengeToken: "" }],
    ["a nickname over 100 chars", { credential, challengeToken: "ch", nickname: "n".repeat(101) }],
  ])("rejects %s with 400", async (_why, body) => {
    const fn = vi.fn();
    sdk({ passkeyRegisterVerify: fn });
    const res = await registerVerify.POST(req(body));
    expect(res.status).toBe(400);
    expect(fn).not.toHaveBeenCalled();
  });

  it("treats a malformed body as invalid", async () => {
    sdk({ passkeyRegisterVerify: vi.fn() });
    expect((await registerVerify.POST(req(undefined, { raw: "{" }))).status).toBe(400);
  });
});

describe("POST /passkeys/login/options", () => {
  const body = { email: " Owner@Acme.Example ", workspace: " Acme " };

  it("is not available standalone", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(false);
    expect((await loginOptions.POST(req(body))).status).toBe(404);
  });

  it.each([
    ["no email", {}],
    ["a bad email", { email: "nope" }],
    ["a malformed body", null],
  ])("rejects %s with 400 before the rate limiter", async (_why, b) => {
    const res =
      b === null ? await loginOptions.POST(req(undefined, { raw: "{" })) : await loginOptions.POST(req(b));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("is rate limited per address, ten tries per fifteen minutes", async () => {
    vi.mocked(rateLimit).mockReturnValue(false);
    const res = await loginOptions.POST(req(body));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("pk-login:owner@acme.example", 10, 15 * 60_000);
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("asks the platform with the normalized workspace and forwards the browser origin", async () => {
    const fn = vi.fn().mockResolvedValue({ options: { challenge: "c" } });
    sdk({ passkeyLoginOptions: fn });
    const res = await loginOptions.POST(req(body));
    expect(fn).toHaveBeenCalledWith(
      { tenantSlug: "acme", email: "owner@acme.example" },
      { origin: ORIGIN },
    );
    expect(await res.json()).toEqual({ options: { challenge: "c" } });
  });

  it("falls back to the configured default workspace, and to no origin", async () => {
    vi.mocked(defaultWorkspace).mockReturnValue("house");
    const fn = vi.fn().mockResolvedValue({ options: null });
    sdk({ passkeyLoginOptions: fn });
    await loginOptions.POST(req({ email: "owner@acme.example" }, { origin: false }));
    expect(fn).toHaveBeenCalledWith(
      { tenantSlug: "house", email: "owner@acme.example" },
      { origin: undefined },
    );
  });

  // Anything else would tell an attacker which addresses have passkeys.
  it("answers exactly like 'no passkeys' when the platform fails", async () => {
    sdk({ passkeyLoginOptions: vi.fn().mockRejectedValue(new Error("no such user")) });
    const res = await loginOptions.POST(req(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ options: null });
  });
});

describe("POST /passkeys/sudo", () => {
  const body = { password: "whatever-the-user-typed" };

  beforeEach(() => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: "t1", slug: "acme" } as never);
    vi.unstubAllEnvs();
  });

  it("is not available standalone", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(false);
    expect((await sudo.POST(req(body))).status).toBe(404);
    expect(requireApiSession).not.toHaveBeenCalled();
  });

  it("returns the DAL's 401 when there is no session, and rethrows anything else", async () => {
    const unauthorized = new Response(null, { status: 401 });
    vi.mocked(requireApiSession).mockRejectedValueOnce(unauthorized);
    expect(await sudo.POST(req(body))).toBe(unauthorized);

    vi.mocked(requireApiSession).mockRejectedValueOnce(new Error("db down"));
    await expect(sudo.POST(req(body))).rejects.toThrow("db down");
  });

  it.each([
    ["an empty password", { password: "" }],
    ["no password", {}],
  ])("requires a password: %s", async (_why, b) => {
    expect((await sudo.POST(req(b))).status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("treats a malformed body as a missing password", async () => {
    expect((await sudo.POST(req(undefined, { raw: "nope" }))).status).toBe(400);
  });

  it("is rate limited per address, five tries per fifteen minutes", async () => {
    vi.mocked(rateLimit).mockReturnValue(false);
    const res = await sudo.POST(req(body));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("pk-sudo:owner@acme.example", 5, 15 * 60_000);
  });

  it("answers 400 when the session's workspace no longer exists", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    expect((await sudo.POST(req(body))).status).toBe(400);
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("answers 401 when the platform rejects the password", async () => {
    sdk({ login: vi.fn().mockRejectedValue(new Error("Invalid credentials")) });
    const res = await sudo.POST(req(body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid password" });
  });

  it("stores the platform token in an httpOnly cookie scoped to the passkey routes", async () => {
    const login = vi.fn().mockResolvedValue({ accessToken: "pat" });
    sdk({ login });
    const res = await sudo.POST(req(body));

    expect(login).toHaveBeenCalledWith({ tenantSlug: "acme", email: session.email, password: body.password });
    expect(await res.json()).toEqual({ ok: true });
    const cookie = (res as NextResponse).cookies.get("evo_sudo")!;
    expect(cookie.value).toBe("pat");
    expect(cookie.path).toBe("/api/platform/passkeys");
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.maxAge).toBe(900);
    expect(cookie.secure).toBeFalsy();
  });

  it("marks the cookie secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    sdk({ login: vi.fn().mockResolvedValue({ accessToken: "pat" }) });
    const res = await sudo.POST(req(body));
    expect((res as NextResponse).cookies.get("evo_sudo")?.secure).toBe(true);
  });
});
