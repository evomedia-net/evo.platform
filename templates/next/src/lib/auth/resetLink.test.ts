// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { describe, expect, it } from "vitest";
import { parseResetLink } from "./resetLink";

describe("parseResetLink", () => {
  it("reads the address and token from the fragment", () => {
    expect(parseResetLink("#email=kelly%40example.com&token=abc")).toEqual({
      email: "kelly@example.com",
      token: "abc",
    });
  });

  it("tolerates a missing leading hash", () => {
    expect(parseResetLink("email=a%40b.c&token=t")).toEqual({ email: "a@b.c", token: "t" });
  });

  // Links minted before the move to the fragment carried both in the query
  // string; they keep working until they expire.
  it("falls back to the query-string form for links still in flight", () => {
    expect(parseResetLink("", { email: "a@b.c", token: "t" })).toEqual({ email: "a@b.c", token: "t" });
  });

  it("prefers the fragment when both are present", () => {
    expect(parseResetLink("#email=x%40y.z&token=new", { email: "a@b.c", token: "old" })).toEqual({
      email: "x@y.z",
      token: "new",
    });
  });

  it("answers null when either part is missing", () => {
    expect(parseResetLink("#email=a%40b.c")).toBeNull();
    expect(parseResetLink("#token=t")).toBeNull();
    expect(parseResetLink("")).toBeNull();
  });
});
