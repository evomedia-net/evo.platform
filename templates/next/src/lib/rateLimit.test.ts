// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "./rateLimit";

// The bucket map is module state, so every test uses its own key.
const key = () => `k-${crypto.randomUUID()}`;

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-09-09T12:00:00Z") }));
afterEach(() => vi.useRealTimers());

describe("rateLimit", () => {
  it("allows up to max hits in the window and refuses the next", () => {
    const k = key();
    expect(rateLimit(k, 3, 60_000)).toBe(true);
    expect(rateLimit(k, 3, 60_000)).toBe(true);
    expect(rateLimit(k, 3, 60_000)).toBe(true);
    expect(rateLimit(k, 3, 60_000)).toBe(false);
    expect(rateLimit(k, 3, 60_000)).toBe(false); // a refusal does not count as a hit
  });

  it("slides: hits older than the window stop counting", () => {
    const k = key();
    rateLimit(k, 2, 60_000);
    rateLimit(k, 2, 60_000);
    expect(rateLimit(k, 2, 60_000)).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit(k, 2, 60_000)).toBe(true);
  });

  it("keeps keys independent", () => {
    const a = key();
    const b = key();
    expect(rateLimit(a, 1, 60_000)).toBe(true);
    expect(rateLimit(a, 1, 60_000)).toBe(false);
    expect(rateLimit(b, 1, 60_000)).toBe(true);
  });

  // The map is unbounded by design until it isn't: past 10k keys, a call
  // sweeps out every key whose hits have all aged out.
  it("sweeps expired keys once the map grows past ten thousand", () => {
    const keys = Array.from({ length: 10_001 }, key);
    for (const k of keys) rateLimit(k, 5, 1_000);
    vi.advanceTimersByTime(2_000);
    // One more call triggers the sweep; the old keys are gone, so each of
    // them is back to a clean slate.
    expect(rateLimit(key(), 5, 1_000)).toBe(true);
    expect(rateLimit(keys[0]!, 1, 1_000)).toBe(true);
  });
});
