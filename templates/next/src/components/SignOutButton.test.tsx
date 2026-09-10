// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The order here is the whole point (#167): the browser database is deleted
 * BEFORE the session ends, because once the sign-out action redirects,
 * nothing on this page runs again. A shared front-desk machine must not hand
 * the next person the previous one's projects.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/tenantDb", () => ({
  setActiveTenantDb: vi.fn(() => ({ name: "tenant-t1" })),
  deleteTenantDb: vi.fn(),
}));

import { deleteTenantDb } from "@/lib/offline/tenantDb";
import { SignOutButton } from "./SignOutButton";
import { TenantProvider } from "./TenantProvider";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

function renderIn(action: () => Promise<void>) {
  return render(
    <TenantProvider value={{ tenantId: "t1", role: "ADMIN", email: "a@b.co", userId: "u1" }}>
      <SignOutButton action={action} />
    </TenantProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("SignOutButton", () => {
  it("deletes this tenant's database before ending the session", async () => {
    const order: string[] = [];
    vi.mocked(deleteTenantDb).mockImplementation(async () => {
      order.push("delete");
    });
    const action = vi.fn(async () => {
      order.push("signout");
    });
    const user = userEvent.setup();
    renderIn(action);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    expect(deleteTenantDb).toHaveBeenCalledWith("t1");
    expect(order).toEqual(["delete", "signout"]);
  });

  // Losing the local copy is the goal; failing to lose it must not keep
  // someone signed in on a machine they are walking away from.
  it("signs out anyway when the database will not delete", async () => {
    vi.mocked(deleteTenantDb).mockRejectedValue(new Error("blocked by another tab"));
    const action = vi.fn(async () => {});
    const user = userEvent.setup();
    renderIn(action);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  // #221: the flag used to come from useState set inside the action, and
  // React defers updates made in a form action until it settles - so the
  // button stayed enabled for the whole sign-out and only claimed to be
  // working once it was done, leaving a slow database delete open to a
  // second click that ran the whole thing again.
  it("disables itself and says so for the duration, not afterwards", async () => {
    let release!: () => void;
    vi.mocked(deleteTenantDb).mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const action = vi.fn(async () => {});
    const user = userEvent.setup();
    renderIn(action);

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    const busy = await screen.findByRole("button", { name: "Signing out…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    // A second click while it is working must not start a second sign-out.
    await user.click(busy).catch(() => {});
    expect(deleteTenantDb).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false),
    );
  });
});
