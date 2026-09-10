// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 */
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/tenantDb", () => ({ setActiveTenantDb: vi.fn() }));

import { setActiveTenantDb } from "@/lib/offline/tenantDb";
import { TenantProvider, useTenant } from "./TenantProvider";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const value = { tenantId: "t1", role: "ADMIN", email: "owner@acme.example", userId: "u1" };
const db = { name: "tenant-t1" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setActiveTenantDb).mockReturnValue(db as never);
});

describe("TenantProvider", () => {
  it("opens the tenant's database and hands it down with the session", () => {
    const { result } = renderHook(() => useTenant(), {
      wrapper: ({ children }) => <TenantProvider value={value}>{children}</TenantProvider>,
    });
    expect(setActiveTenantDb).toHaveBeenCalledWith("t1");
    expect(result.current).toEqual({ ...value, db });
  });

  // The data layer's activeDb() is read by children during their first
  // render, so the database has to exist before they run — not in an effect.
  it("has already opened the database before a child renders", () => {
    let openWhenChildRendered = 0;
    function Child() {
      openWhenChildRendered = vi.mocked(setActiveTenantDb).mock.calls.length;
      return <p>child</p>;
    }
    render(
      <TenantProvider value={value}>
        <Child />
      </TenantProvider>,
    );
    expect(openWhenChildRendered).toBe(1);
    expect(screen.getByText("child")).toBeTruthy();
  });

  it("opens the database once, however often the tree re-renders", () => {
    const { rerender } = render(
      <TenantProvider value={value}>
        <p>child</p>
      </TenantProvider>,
    );
    rerender(
      <TenantProvider value={value}>
        <p>child again</p>
      </TenantProvider>,
    );
    expect(setActiveTenantDb).toHaveBeenCalledTimes(1);
  });
});

describe("useTenant", () => {
  // Reading the session outside the provider yields undefined fields that
  // surface far from the cause; failing loudly at the read is the point.
  it("throws when used outside the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTenant())).toThrow(/must be used inside <TenantProvider>/);
    quiet.mockRestore();
  });
});
