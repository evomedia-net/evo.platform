// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The handoff module is imported by client components that a server component
 * renders, so it is evaluated where there is no `window` at all. This file
 * runs in the default node environment - no jsdom, no DOM globals - which is
 * the only honest way to exercise that guard: stubbing `window` away inside
 * jsdom breaks React DOM itself before the guard is ever reached.
 */
import { describe, expect, it } from "vitest";
import { clearAuthHandoff } from "./useAuthHandoff";

describe("on the server", () => {
  it("has no window to read", () => {
    expect(typeof window).toBe("undefined");
  });

  it("clearing the handoff is a silent no-op rather than a crash", () => {
    expect(() => clearAuthHandoff()).not.toThrow();
  });
});
