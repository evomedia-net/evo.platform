// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The gate every /api/platform/members proxy passes through. Three refusals
 * in order - not platform mode, no app session, no sudo cookie - and the
 * platform's own status codes passed through so the UI reacts honestly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/dal", () => ({ requireApiSession: vi.fn() }));
vi.mock("@/lib/platform", () => ({ isPlatformMode: vi.fn(() => true) }));

import { requireApiSession } from "@/lib/auth/dal";
import { isPlatformMode } from "@/lib/platform";
import { MEMBER_SUDO_COOKIE, memberProxyGate, platformErrorResponse } from "./member-proxy";

function req(cookie?: string): NextRequest {
  return {
    cookies: { get: (name: string) => (name === MEMBER_SUDO_COOKIE && cookie ? { value: cookie } : undefined) },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlatformMode).mockReturnValue(true);
  vi.mocked(requireApiSession).mockResolvedValue({ userId: "u1", tenantId: "t1", role: "ADMIN", email: "" });
});

describe("memberProxyGate", () => {
  it("is a 404 outside platform mode - the feature does not exist standalone", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(false);
    const out = await memberProxyGate(req("tok"));
    expect(out.res!.status).toBe(404);
    expect(await out.res!.json()).toEqual({ error: "Not available" });
    expect(requireApiSession).not.toHaveBeenCalled();
  });

  it("returns the DAL's own 401 when there is no app session", async () => {
    const unauthorized = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    vi.mocked(requireApiSession).mockRejectedValue(unauthorized);
    const out = await memberProxyGate(req("tok"));
    expect(out.res).toBe(unauthorized);
  });

  it("rethrows anything from the DAL that is not a Response", async () => {
    vi.mocked(requireApiSession).mockRejectedValue(new Error("db down"));
    await expect(memberProxyGate(req("tok"))).rejects.toThrow("db down");
  });

  it("demands the sudo cookie, and hands back its token when present", async () => {
    const missing = await memberProxyGate(req());
    expect(missing.res!.status).toBe(401);
    expect(await missing.res!.json()).toEqual({ error: "sudo-required" });

    expect(await memberProxyGate(req("platform-token"))).toEqual({ token: "platform-token" });
  });
});

describe("platformErrorResponse", () => {
  it("passes a platform status and message through", async () => {
    const err = Object.assign(new Error("Not a tenant admin"), { status: 403 });
    const res = platformErrorResponse(err);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not a tenant admin" });
  });

  it("falls back to 502 for an unusable status, and to a generic message for a non-Error", async () => {
    expect(platformErrorResponse(Object.assign(new Error("x"), { status: "weird" })).status).toBe(502);
    expect(platformErrorResponse(new Error("no status")).status).toBe(502);
    const bare = platformErrorResponse("just a string");
    expect(bare.status).toBe(502);
    expect(await bare.json()).toEqual({ error: "Platform request failed" });
  });
});
