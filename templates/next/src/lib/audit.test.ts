// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ prisma: { auditEvent: { create: vi.fn() } } }));
vi.mock("@/lib/platform", () => ({ isPlatformMode: vi.fn(() => false), getPlatform: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { getPlatform, isPlatformMode } from "@/lib/platform";
import { audit } from "./audit";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlatformMode).mockReturnValue(false);
  vi.mocked(prisma.auditEvent.create).mockResolvedValue({} as never);
});

describe("audit", () => {
  it("records the event locally with whatever context was given", async () => {
    await audit("auth.signup", { tenantId: "t1", userId: "u1", detail: { email: "a@b.c" } });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: { action: "auth.signup", tenantId: "t1", userId: "u1", detail: { email: "a@b.c" } },
    });
    expect(getPlatform).not.toHaveBeenCalled();
  });

  it("stores undefined, not null, for a missing detail", async () => {
    await audit("x");
    expect(vi.mocked(prisma.auditEvent.create).mock.calls[0]![0].data.detail).toBeUndefined();
  });

  // Fire-and-forget: the platform is told, but a platform outage must never
  // fail the action that was being audited.
  it("also pushes to the platform in platform mode, and only warns when that fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const pushEvent = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.mocked(getPlatform).mockReturnValue({ pushEvent } as never);

    await expect(audit("auth.login", { tenantId: "t1" })).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r)); // let the detached rejection settle

    expect(pushEvent).toHaveBeenCalledWith({
      action: "auth.login",
      tenantId: "t1",
      userId: undefined,
      detail: undefined,
    });
    expect(warn).toHaveBeenCalledWith("[audit] platform push failed", expect.any(Error));
    warn.mockRestore();
  });
});
