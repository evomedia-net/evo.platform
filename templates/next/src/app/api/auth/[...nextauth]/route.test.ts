// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { describe, expect, it, vi } from "vitest";

// @/auth wires the whole NextAuth config on import; the route only forwards.
vi.mock("@/auth", () => ({ handlers: { GET: vi.fn(), POST: vi.fn() } }));

import { handlers } from "@/auth";
import { GET, POST } from "./route";

describe("/api/auth/[...nextauth]", () => {
  it("re-exports NextAuth's own handlers unchanged", () => {
    expect(GET).toBe(handlers.GET);
    expect(POST).toBe(handlers.POST);
  });
});
