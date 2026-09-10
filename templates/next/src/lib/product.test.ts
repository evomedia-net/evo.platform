// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { describe, expect, it } from "vitest";
import { PRODUCT_NAME } from "./product";

// A constant on purpose (see the module's own note): it reaches page
// metadata, a client component, and the sender line of recovery mail, and an
// empty name there reads as phishing.
describe("PRODUCT_NAME", () => {
  it("is a non-empty, trimmed name", () => {
    expect(PRODUCT_NAME.length).toBeGreaterThan(0);
    expect(PRODUCT_NAME).toBe(PRODUCT_NAME.trim());
  });
});
