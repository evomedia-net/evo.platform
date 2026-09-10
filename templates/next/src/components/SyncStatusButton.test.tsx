// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The button is both the trigger and the only place the app admits it is
 * offline or stuck, so each status has to reach the label — an "error" that
 * renders as a tick is worse than no indicator at all.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/tenantDb", () => ({
  setActiveTenantDb: vi.fn(() => ({ name: "tenant-t1" })),
}));
vi.mock("@/lib/sync/client", () => ({ runSync: vi.fn() }));

import { runSync } from "@/lib/sync/client";
import { SyncStatusButton } from "./SyncStatusButton";
import { TenantProvider } from "./TenantProvider";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

function renderButton() {
  return render(
    <TenantProvider value={{ tenantId: "t1", role: "ADMIN", email: "a@b.co", userId: "u1" }}>
      <SyncStatusButton />
    </TenantProvider>,
  );
}

const idle = { kind: "idle", lastSyncedAt: null } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runSync).mockResolvedValue(idle as never);
});
afterEach(() => vi.useRealTimers());

describe("SyncStatusButton", () => {
  it("syncs on mount with the tenant's database", async () => {
    renderButton();
    await waitFor(() => expect(runSync).toHaveBeenCalledWith({ name: "tenant-t1" }));
  });

  it.each([
    ["Not synced yet", { kind: "idle", lastSyncedAt: null }],
    ["Offline — changes saved locally", { kind: "offline", lastSyncedAt: null }],
    ["Session expired — sign in again", { kind: "error", message: "Session expired — sign in again", lastSyncedAt: null }],
  ])("shows %s", async (label, status) => {
    vi.mocked(runSync).mockResolvedValue(status as never);
    renderButton();
    expect(await screen.findByRole("button", { name: new RegExp(label.slice(0, 14), "i") })).toBeTruthy();
  });

  it("shows the time of the last successful sync", async () => {
    const at = new Date("2026-09-10T15:04:05Z").getTime();
    vi.mocked(runSync).mockResolvedValue({ kind: "idle", lastSyncedAt: at } as never);
    renderButton();
    const expected = new Date(at).toLocaleTimeString();
    expect(await screen.findByRole("button", { name: `Synced ${expected}` })).toBeTruthy();
  });

  it("says it is syncing while the request is in flight", async () => {
    let release!: () => void;
    vi.mocked(runSync).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(idle as never);
      }),
    );
    renderButton();
    expect(await screen.findByRole("button", { name: /syncing/i })).toBeTruthy();
    await act(async () => release());
  });

  it("marks an error state on the control itself, not only in the text", async () => {
    vi.mocked(runSync).mockResolvedValue({ kind: "error", message: "Sync failed", lastSyncedAt: null } as never);
    renderButton();
    const button = await screen.findByRole("button", { name: "Sync failed" });
    expect(button.className).toMatch(/amber/);
  });

  it("syncs again on click", async () => {
    const user = userEvent.setup();
    renderButton();
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2));
  });

  it.each(["online", "evoapp:sync"])("syncs when the browser fires %s", async (event) => {
    renderButton();
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event(event));
    });
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2));
  });

  it("syncs on a thirty-second timer, and stops when unmounted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderButton();
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(1));

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2));

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(90_000);
      window.dispatchEvent(new Event("online"));
    });
    expect(runSync).toHaveBeenCalledTimes(2);
  });
});
