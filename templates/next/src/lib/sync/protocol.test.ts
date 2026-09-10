// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { describe, expect, it } from "vitest";
import { DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT } from "./protocol";

// The protocol module is almost entirely types; these two constants are the
// only executable code in it, and the server enforces the ceiling.
describe("pull limits", () => {
  it("default a page to 1000 rows and never allow more than 2000", () => {
    expect(DEFAULT_PULL_LIMIT).toBe(1000);
    expect(MAX_PULL_LIMIT).toBe(2000);
    expect(MAX_PULL_LIMIT).toBeGreaterThanOrEqual(DEFAULT_PULL_LIMIT);
  });
});
