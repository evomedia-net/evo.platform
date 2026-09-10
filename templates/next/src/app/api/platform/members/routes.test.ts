// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The member-management proxy routes. Every handler has the same spine —
 * memberProxyGate, optional body validation, one platform call, and
 * platformErrorResponse on failure — so the plain ones are table-driven.
 * Billing adds a tenant-admin claim check; sudo mints the cookie the gate
 * later reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/member-proxy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/member-proxy")>()),
  memberProxyGate: vi.fn(),
  platformErrorResponse: vi.fn(),
}));
vi.mock("@/lib/platform", () => ({
  getPlatform: vi.fn(),
  isPlatformMode: vi.fn(),
  defaultWorkspace: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { tenant: { findUnique: vi.fn() } } }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn(() => true) }));
vi.mock("@/lib/auth/dal", () => ({ requireApiSession: vi.fn() }));

import {
  MEMBER_SUDO_COOKIE,
  MEMBER_SUDO_PATH,
  memberProxyGate,
  platformErrorResponse,
} from "@/lib/member-proxy";
import { getPlatform, isPlatformMode } from "@/lib/platform";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { requireApiSession } from "@/lib/auth/dal";

import * as members from "./route";
import * as member from "./[id]/route";
import * as restore from "./[id]/restore/route";
import * as roles from "./[id]/roles/route";
import * as invites from "./invites/route";
import * as invite from "./invites/[id]/route";
import * as resend from "./invites/[id]/resend/route";
import * as tenantRoles from "./roles/route";
import * as checkout from "./billing/checkout/route";
import * as portal from "./billing/portal/route";
import * as sudo from "./sudo/route";

const ORIGIN = "http://app.test";
const TOKEN = "platform-access-token";
const STRONG = "correct horse battery staple";

function req(body?: unknown, init: { method?: string; raw?: string } = {}): NextRequest {
  const method = init.method ?? (body === undefined && init.raw === undefined ? "GET" : "POST");
  return new NextRequest(`${ORIGIN}/api/platform/members`, {
    method,
    headers: { "content-type": "application/json" },
    body: init.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Handler = (r: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(memberProxyGate).mockResolvedValue({ token: TOKEN });
  vi.mocked(platformErrorResponse).mockImplementation(() =>
    NextResponse.json({ error: "upstream" }, { status: 502 }),
  );
});

function sdk(methods: Record<string, unknown>) {
  vi.mocked(getPlatform).mockReturnValue(methods as never);
  return methods;
}

interface Plain {
  name: string;
  handler: Handler;
  method: string;
  id?: string;
  body?: unknown;
  sdk: string;
  args: unknown[];
  badBodies?: unknown[];
}

const plain: Plain[] = [
  { name: "GET /members", handler: members.GET as Handler, method: "GET", sdk: "listTenantMembers", args: [TOKEN] },
  {
    name: "POST /members",
    handler: members.POST as Handler,
    method: "POST",
    body: { email: " New@Acme.Example ", password: STRONG, firstName: " Ann " },
    sdk: "createTenantMember",
    args: [TOKEN, { email: "new@acme.example", password: STRONG, firstName: "Ann" }],
    badBodies: [{}, { email: "nope", password: STRONG }, { email: "a@b.co", password: "short" }],
  },
  {
    name: "PATCH /members/[id]",
    handler: member.PATCH as Handler,
    method: "PATCH",
    id: "m1",
    body: { firstName: " Ann ", isTenantAdmin: true },
    sdk: "updateTenantMember",
    args: [TOKEN, "m1", { firstName: "Ann", isTenantAdmin: true }],
    badBodies: [{ isTenantAdmin: "yes" }, { phone: "x".repeat(41) }],
  },
  { name: "DELETE /members/[id]", handler: member.DELETE as Handler, method: "DELETE", id: "m1", sdk: "deactivateTenantMember", args: [TOKEN, "m1"] },
  { name: "POST /members/[id]/restore", handler: restore.POST as Handler, method: "POST", id: "m1", sdk: "restoreTenantMember", args: [TOKEN, "m1"] },
  {
    name: "PUT /members/[id]/roles",
    handler: roles.PUT as Handler,
    method: "PUT",
    id: "m1",
    body: { roleIds: ["r1", "r2"] },
    sdk: "setTenantMemberRoles",
    args: [TOKEN, "m1", ["r1", "r2"]],
    badBodies: [{}, { roleIds: "r1" }, { roleIds: Array.from({ length: 101 }, (_, i) => `r${i}`) }],
  },
  { name: "GET /members/invites", handler: invites.GET as Handler, method: "GET", sdk: "listTenantInvites", args: [TOKEN] },
  {
    name: "POST /members/invites",
    handler: invites.POST as Handler,
    method: "POST",
    body: { email: "Guest@Acme.Example", isTenantAdmin: true },
    sdk: "createTenantInvite",
    args: [TOKEN, { email: "guest@acme.example", isTenantAdmin: true }],
    badBodies: [{}, { email: "nope" }],
  },
  { name: "DELETE /members/invites/[id]", handler: invite.DELETE as Handler, method: "DELETE", id: "i1", sdk: "revokeTenantInvite", args: [TOKEN, "i1"] },
  { name: "POST /members/invites/[id]/resend", handler: resend.POST as Handler, method: "POST", id: "i1", sdk: "resendTenantInvite", args: [TOKEN, "i1"] },
  { name: "GET /members/roles", handler: tenantRoles.GET as Handler, method: "GET", sdk: "listTenantRoles", args: [TOKEN] },
];

describe.each(plain)("$name", (c) => {
  const call = (r: NextRequest) => c.handler(r, params(c.id ?? "unused"));
  const good = () => req(c.body, { method: c.method });

  it("returns the gate's response when the gate refuses", async () => {
    const refusal = NextResponse.json({ error: "sudo-required" }, { status: 401 });
    vi.mocked(memberProxyGate).mockResolvedValue({ res: refusal });
    const fn = vi.fn();
    sdk({ [c.sdk]: fn });
    expect(await call(good())).toBe(refusal);
    expect(fn).not.toHaveBeenCalled();
  });

  it("forwards to the platform with the sudo token and echoes the result", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: c.sdk });
    sdk({ [c.sdk]: fn });
    const res = await call(good());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: c.sdk });
    expect(fn).toHaveBeenCalledWith(...c.args);
  });

  it("maps a platform failure through platformErrorResponse", async () => {
    const err = Object.assign(new Error("nope"), { status: 409 });
    sdk({ [c.sdk]: vi.fn().mockRejectedValue(err) });
    const res = await call(good());
    expect(res.status).toBe(502);
    expect(platformErrorResponse).toHaveBeenCalledWith(err);
  });

  if (c.body !== undefined) {
    it("rejects a malformed JSON body with 400 before calling the platform", async () => {
      const fn = vi.fn();
      sdk({ [c.sdk]: fn });
      const res = await call(req(undefined, { method: c.method, raw: "{not json" }));
      expect(res.status).toBe(400);
      expect(fn).not.toHaveBeenCalled();
    });

    it.each(c.badBodies!.map((b) => [JSON.stringify(b).slice(0, 60), b]))(
      "rejects an invalid body with 400: %s",
      async (_label, body) => {
        const fn = vi.fn();
        sdk({ [c.sdk]: fn });
        const res = await call(req(body, { method: c.method }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/invalid/i);
        expect(fn).not.toHaveBeenCalled();
      },
    );
  }
});

describe.each([
  {
    name: "POST /members/billing/checkout",
    handler: checkout.POST,
    sdk: "createCheckout",
    args: {
      tenantId: "t1",
      successUrl: `${ORIGIN}/members?billing=success`,
      cancelUrl: `${ORIGIN}/members`,
    },
  },
  {
    name: "POST /members/billing/portal",
    handler: portal.POST,
    sdk: "createBillingPortal",
    args: { tenantId: "t1", returnUrl: `${ORIGIN}/members` },
  },
])("$name", (c) => {
  const admin = { tenant_admin: true, tenant_id: "t1" };

  it("returns the gate's response when the gate refuses", async () => {
    const refusal = NextResponse.json({ error: "Not available" }, { status: 404 });
    vi.mocked(memberProxyGate).mockResolvedValue({ res: refusal });
    expect(await c.handler(req(undefined, { method: "POST" }))).toBe(refusal);
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it.each([
    ["not a tenant admin", { ...admin, tenant_admin: false }],
    ["no tenant in the token", { ...admin, tenant_id: undefined }],
  ])("refuses with 403 when the verified token is %s", async (_why, claims) => {
    const fn = vi.fn();
    sdk({ verifyToken: vi.fn().mockResolvedValue(claims), [c.sdk]: fn });
    const res = await c.handler(req(undefined, { method: "POST" }));
    expect(res.status).toBe(403);
    expect(fn).not.toHaveBeenCalled();
  });

  it("verifies the sudo token locally, then calls the platform with origin-derived URLs", async () => {
    const verifyToken = vi.fn().mockResolvedValue(admin);
    const fn = vi.fn().mockResolvedValue({ url: "https://stripe.test/s" });
    sdk({ verifyToken, [c.sdk]: fn });
    const res = await c.handler(req(undefined, { method: "POST" }));
    expect(verifyToken).toHaveBeenCalledWith(TOKEN);
    expect(fn).toHaveBeenCalledWith(c.args);
    expect(await res.json()).toEqual({ url: "https://stripe.test/s" });
  });

  it("maps a verification or platform failure through platformErrorResponse", async () => {
    const err = new Error("jwks down");
    sdk({ verifyToken: vi.fn().mockRejectedValue(err) });
    const res = await c.handler(req(undefined, { method: "POST" }));
    expect(res.status).toBe(502);
    expect(platformErrorResponse).toHaveBeenCalledWith(err);
  });
});

describe("POST /members/sudo", () => {
  const session = { userId: "u1", tenantId: "t1", email: "owner@acme.example" };
  const body = { password: "whatever-the-user-typed" };

  beforeEach(() => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    vi.mocked(requireApiSession).mockResolvedValue(session as never);
    vi.mocked(rateLimit).mockReturnValue(true);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue({ id: "t1", slug: "acme" } as never);
    vi.unstubAllEnvs();
  });

  it("is not available standalone", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(false);
    const res = await sudo.POST(req(body));
    expect(res.status).toBe(404);
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
    const res = await sudo.POST(req(b));
    expect(res.status).toBe(400);
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("treats a malformed body as a missing password", async () => {
    expect((await sudo.POST(req(undefined, { raw: "nope" }))).status).toBe(400);
  });

  it("is rate limited per address, five tries per fifteen minutes", async () => {
    vi.mocked(rateLimit).mockReturnValue(false);
    const res = await sudo.POST(req(body));
    expect(res.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("member-sudo:owner@acme.example", 5, 15 * 60_000);
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("answers 400 when the session's workspace no longer exists", async () => {
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    const res = await sudo.POST(req(body));
    expect(res.status).toBe(400);
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("answers 401 when the platform rejects the password", async () => {
    sdk({ login: vi.fn().mockRejectedValue(new Error("Invalid credentials")) });
    const res = await sudo.POST(req(body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid password" });
  });

  it("stores the platform token in an httpOnly cookie scoped to the member routes", async () => {
    const login = vi.fn().mockResolvedValue({ accessToken: "pat", user: { tenantAdmin: true } });
    sdk({ login });
    const res = await sudo.POST(req(body));

    expect(login).toHaveBeenCalledWith({ tenantSlug: "acme", email: session.email, password: body.password });
    expect(await res.json()).toEqual({ ok: true, tenantAdmin: true });
    const cookie = (res as NextResponse).cookies.get(MEMBER_SUDO_COOKIE)!;
    expect(cookie.value).toBe("pat");
    expect(cookie.path).toBe(MEMBER_SUDO_PATH);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.maxAge).toBe(900);
    expect(cookie.secure).toBeFalsy();
  });

  it("marks the cookie secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    sdk({ login: vi.fn().mockResolvedValue({ accessToken: "pat", user: { tenantAdmin: false } }) });
    const res = await sudo.POST(req(body));
    expect((res as NextResponse).cookies.get(MEMBER_SUDO_COOKIE)?.secure).toBe(true);
    expect(await res.json()).toEqual({ ok: true, tenantAdmin: false });
  });
});
