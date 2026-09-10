// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The lazy client. The property that matters: importing this module must not
 * construct a client - `next build` executes server modules to collect page
 * data, inside a Docker stage with no DATABASE_URL - so construction happens
 * on first use, and once.
 *
 * load() hands back the module namespace, never the proxy itself: returning
 * the proxy from an async function makes promise resolution probe it for a
 * `then`, and that property read IS a first use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ctor: vi.fn(), adapter: vi.fn() }));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    constructor(opts: unknown) {
      h.ctor(opts);
    }
    ping() {
      return this;
    }
    // A plain value, so the proxy's non-function branch is exercised too.
    kind = "mock";
  },
}));
vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(opts: unknown) {
      h.adapter(opts);
    }
  },
}));

const savedUrl = process.env.DATABASE_URL;
const savedEnv = process.env.NODE_ENV;
const g = globalThis as { prisma?: unknown };

async function load() {
  vi.resetModules();
  return import("./prisma");
}

beforeEach(() => {
  vi.clearAllMocks();
  delete g.prisma;
  delete process.env.DATABASE_URL;
});
afterEach(() => {
  delete g.prisma;
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
  (process.env as Record<string, string | undefined>).NODE_ENV = savedEnv;
});

describe("prisma", () => {
  it("constructs nothing at import, and names the missing DATABASE_URL on first use", async () => {
    const m = await load();
    expect(h.ctor).not.toHaveBeenCalled();
    expect(() => (m.prisma as unknown as { ping: unknown }).ping).toThrow("DATABASE_URL is not set");
    expect(h.ctor).not.toHaveBeenCalled();
  });

  it("wires the pg adapter on first use, once, and binds methods to the real client", async () => {
    process.env.DATABASE_URL = "postgresql://ci:ci@localhost/ci";
    const m = await load();
    const prisma = m.prisma as unknown as { ping: () => unknown };

    const ping = prisma.ping;
    prisma.ping();
    expect(typeof ping).toBe("function");
    expect((m.prisma as unknown as { kind: string }).kind).toBe("mock"); // values pass through unbound
    expect(h.adapter).toHaveBeenCalledWith({ connectionString: "postgresql://ci:ci@localhost/ci" });
    expect(h.ctor).toHaveBeenCalledTimes(1);
    expect(h.ctor).toHaveBeenCalledWith(expect.objectContaining({ log: ["warn", "error"] }));
    // Reused across hot reloads in dev: parked on globalThis.
    expect(g.prisma).toBeDefined();
  });

  it("does not park the client on globalThis in production", async () => {
    process.env.DATABASE_URL = "postgresql://ci:ci@localhost/ci";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const m = await load();
    const prisma = m.prisma as unknown as { ping: unknown };
    void prisma.ping;
    void prisma.ping;
    expect(g.prisma).toBeUndefined();
    // and so each access constructs again - the pooling story is the
    // platform's, not a global's
    expect(h.ctor).toHaveBeenCalledTimes(2);
  });
});
