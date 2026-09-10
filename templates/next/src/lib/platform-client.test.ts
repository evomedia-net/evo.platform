// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The platform client accessor and the mode switch. platform.test.ts covers
 * provisioning; this covers the memoised client itself, which is module
 * state and so is loaded fresh per case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ctor: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@evoplatform/sdk-node", () => ({
  EvoPlatform: class {
    constructor(opts: unknown) {
      h.ctor(opts);
    }
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const ENV = ["PLATFORM_URL", "EVO_CLIENT_ID", "EVO_CLIENT_SECRET", "PLATFORM_DEFAULT_WORKSPACE"] as const;
const saved: Record<string, string | undefined> = {};

async function load() {
  vi.resetModules();
  return import("./platform");
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isPlatformMode", () => {
  it("is exactly whether PLATFORM_URL is set", async () => {
    let m = await load();
    expect(m.isPlatformMode()).toBe(false);
    process.env.PLATFORM_URL = "https://platform.test";
    m = await load();
    expect(m.isPlatformMode()).toBe(true);
  });
});

describe("getPlatform", () => {
  it("refuses with a clear message when there is no platform to talk to", async () => {
    const m = await load();
    expect(() => m.getPlatform()).toThrow("PLATFORM_URL is not configured");
    // and keeps refusing - a null client is memoised too
    expect(() => m.getPlatform()).toThrow("PLATFORM_URL is not configured");
    expect(h.ctor).not.toHaveBeenCalled();
  });

  it("builds one client from the env and reuses it", async () => {
    process.env.PLATFORM_URL = "https://platform.test";
    process.env.EVO_CLIENT_ID = "app_x";
    process.env.EVO_CLIENT_SECRET = "shh";
    const m = await load();

    const a = m.getPlatform();
    const b = m.getPlatform();

    expect(a).toBe(b);
    expect(h.ctor).toHaveBeenCalledTimes(1);
    expect(h.ctor).toHaveBeenCalledWith({
      platformUrl: "https://platform.test",
      clientId: "app_x",
      clientSecret: "shh",
    });
  });
});

describe("defaultWorkspace", () => {
  it("is the configured slug, and undefined for unset or blank", async () => {
    let m = await load();
    expect(m.defaultWorkspace()).toBeUndefined();
    process.env.PLATFORM_DEFAULT_WORKSPACE = "";
    m = await load();
    expect(m.defaultWorkspace()).toBeUndefined();
    process.env.PLATFORM_DEFAULT_WORKSPACE = "house";
    m = await load();
    expect(m.defaultWorkspace()).toBe("house");
  });
});
