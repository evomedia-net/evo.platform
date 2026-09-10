// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The handoff exists so nobody retypes an address they just typed, and its
 * whole contract is about what must NOT happen: no password ever reaches
 * storage, a private-browsing throw never breaks a form, and nothing is read
 * during the first render (server-rendered markup would not match).
 */
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthHandoff, useAuthHandoff } from "./useAuthHandoff";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const KEY = "auth_handoff";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("useAuthHandoff", () => {
  it("starts empty when storage holds nothing", () => {
    const { result } = renderHook(() => useAuthHandoff());
    expect(result.current[0]).toEqual({ email: "", workspace: "" });
  });

  it("seeds from storage on mount", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ email: "a@b.co", workspace: "acme" }));
    const { result } = renderHook(() => useAuthHandoff());
    expect(result.current[0]).toEqual({ email: "a@b.co", workspace: "acme" });
  });

  // Seeding during the first render would produce markup the server cannot
  // match, so the effect runs after it. Pinned because "fix" the wrong way
  // (a lazy initializer) reintroduces a hydration warning nobody reads.
  it("renders empty first, then fills in — never during the first paint", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ email: "a@b.co", workspace: "" }));
    const seen: string[] = [];
    function Probe() {
      const [handoff] = useAuthHandoff();
      seen.push(handoff.email);
      return null;
    }
    render(<Probe />);
    expect(seen[0]).toBe("");
    expect(seen[seen.length - 1]).toBe("a@b.co");
  });

  it("does not re-render for a stored value that is empty in both fields", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ email: "", workspace: "" }));
    const seen: string[] = [];
    function Probe() {
      const [handoff] = useAuthHandoff();
      seen.push(handoff.email);
      return null;
    }
    render(<Probe />);
    expect(seen).toEqual([""]);
  });

  it("merges a patch, keeps the other field, and persists", () => {
    const { result } = renderHook(() => useAuthHandoff());
    act(() => result.current[1]({ email: "a@b.co" }));
    act(() => result.current[1]({ workspace: "acme" }));

    expect(result.current[0]).toEqual({ email: "a@b.co", workspace: "acme" });
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!)).toEqual({
      email: "a@b.co",
      workspace: "acme",
    });
  });

  it.each([
    ["a corrupted value", "not json"],
    ["a JSON value that is not an object", "42"],
    ["fields of the wrong type", JSON.stringify({ email: 42, workspace: ["acme"] })],
    ["a partial object", JSON.stringify({ email: "a@b.co" })],
  ])("survives %s without throwing", (_why, raw) => {
    window.sessionStorage.setItem(KEY, raw);
    const { result } = renderHook(() => useAuthHandoff());
    expect(typeof result.current[0].email).toBe("string");
    expect(typeof result.current[0].workspace).toBe("string");
  });

  it("keeps the email when only the email survives a partial object", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ email: "a@b.co" }));
    const { result } = renderHook(() => useAuthHandoff());
    expect(result.current[0]).toEqual({ email: "a@b.co", workspace: "" });
  });

  // Private browsing throws on access. A prefill is a convenience; losing it
  // must never take the sign-in form down with it.
  it("degrades to an empty prefill when storage throws on read", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new DOMException("denied");
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });
    const { result } = renderHook(() => useAuthHandoff());
    expect(result.current[0]).toEqual({ email: "", workspace: "" });
  });

  it("still updates its own state when storage throws on write", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota");
      },
      removeItem: () => {},
      clear: () => {},
    });
    const { result } = renderHook(() => useAuthHandoff());
    act(() => result.current[1]({ email: "a@b.co" }));
    expect(result.current[0].email).toBe("a@b.co");
  });

  it("keeps a stable update function across renders", () => {
    const { result, rerender } = renderHook(() => useAuthHandoff());
    const first = result.current[1];
    rerender();
    expect(result.current[1]).toBe(first);
  });
});

describe("clearAuthHandoff", () => {
  it("removes the stored handoff", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ email: "a@b.co", workspace: "acme" }));
    clearAuthHandoff();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("is silent when storage throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new DOMException("denied");
      },
      clear: () => {},
    });
    expect(() => clearAuthHandoff()).not.toThrow();
  });
});
