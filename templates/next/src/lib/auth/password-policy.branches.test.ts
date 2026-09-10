// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The screening branches password-policy.test.ts does not reach: a
 * whitespace-only password (trimmed to nothing before the sequence check),
 * a common password padded with a trailing suffix, and a leet-substituted
 * one. Each is a real evasion of the blocklist, not a synthetic case.
 */
import { describe, expect, it } from "vitest";
import { validatePassword } from "./password-policy";

describe("password screening", () => {
  it("rejects a password that is only whitespace as a single repeated character", () => {
    // Twelve spaces pass the length check; trimmed, nothing is left for the
    // sequence check, and what remains is one character repeated.
    expect(validatePassword(" ".repeat(12))).toMatch(/too common/);
  });

  it("sees through a common password padded with digits and punctuation", () => {
    expect(validatePassword("password123!!!")).toMatch(/too common/);
    expect(validatePassword("letmein2026!")).toMatch(/too common/);
    // and an exact entry long enough to pass the length rule on its own
    expect(validatePassword("administrator")).toMatch(/too common/);
  });

  it("sees through leet substitutions", () => {
    // p@ssw0rd1234 -> strip the suffix -> p@ssw0rd -> un-leet -> password
    expect(validatePassword("p@ssw0rd1234")).toMatch(/too common/);
    // l3tm31n20260 (12 chars) -> strip the suffix -> l3tm31n -> un-leet -> letmein
    expect(validatePassword("l3tm31n20260")).toMatch(/too common/);
  });

  it("still accepts a passphrase that merely contains a common word", () => {
    expect(validatePassword("my password is long")).toBeNull();
  });
});
