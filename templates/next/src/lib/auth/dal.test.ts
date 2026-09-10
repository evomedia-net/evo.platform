// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The data access layer is where auth is actually enforced: the proxy only
 * does optimistic cookie-presence redirects. A session with no tenant scope
 * is refused here just like no session at all.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  // Next's redirect() never returns; modelling it as a throw keeps the
  // control flow honest.
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { requireApiSession, verifySession } from "./dal";

beforeEach(() => vi.clearAllMocks());

describe("verifySession", () => {
  it("redirects to /login with no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(verifySession()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects a session that carries no workspace scope", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", tenantId: null } } as never);
    await expect(verifySession()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("returns the context, defaulting role and email", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", tenantId: "t1" } } as never);
    expect(await verifySession()).toEqual({
      userId: "u1",
      tenantId: "t1",
      role: "MEMBER",
      email: "",
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", tenantId: "t1", role: "ADMIN", email: "a@b.c" },
    } as never);
    expect(await verifySession()).toMatchObject({ role: "ADMIN", email: "a@b.c" });
  });
});

describe("requireApiSession", () => {
  it("throws a ready-to-return 401 Response with no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const thrown = await requireApiSession().catch((e) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(401);
    expect((thrown as Response).headers.get("content-type")).toBe("application/json");
    expect(await (thrown as Response).json()).toEqual({ error: "Unauthorized" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("throws the same 401 for a session with no workspace scope", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
    const thrown = await requireApiSession().catch((e) => e);
    expect((thrown as Response).status).toBe(401);
  });

  it("returns the context with defaults", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", tenantId: "t1" } } as never);
    expect(await requireApiSession()).toEqual({
      userId: "u1",
      tenantId: "t1",
      role: "MEMBER",
      email: "",
    });
  });
});
