// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * Both buttons hand off to Stripe, so every way the hand-off can fail has to
 * end somewhere the user can act on: the 401 has to name the sudo window
 * (the usual cause) rather than say "unauthorized", and no failure may leave
 * the buttons stuck disabled.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BillingCard } from "./BillingCard";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const subscribe = () => screen.getByRole("button", { name: /subscribe \/ upgrade/i });
const manage = () => screen.getByRole("button", { name: /manage billing/i });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { href: "" });
  fetchMock.mockResolvedValue(reply(200, { url: "https://stripe.test/session" }));
});
afterEach(() => vi.unstubAllGlobals());

describe("BillingCard", () => {
  it.each([
    ["Subscribe / upgrade", "checkout", "/api/platform/members/billing/checkout"],
    ["Manage billing", "portal", "/api/platform/members/billing/portal"],
  ])("%s posts to its own endpoint and follows the Stripe link", async (name, _which, path) => {
    const user = userEvent.setup();
    render(<BillingCard />);

    await user.click(screen.getByRole("button", { name }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(path, { method: "POST" }));
    await waitFor(() => expect(window.location.href).toBe("https://stripe.test/session"));
  });

  // 401 here means the sudo window lapsed, which is the common case and is
  // fixable in one step — so say which step.
  it("points at the sudo window when the proxy answers 401", async () => {
    fetchMock.mockResolvedValue(reply(401, { error: "sudo-required" }));
    const user = userEvent.setup();
    render(<BillingCard />);

    await user.click(subscribe());

    expect(await screen.findByText(/unlock member management above first/i)).toBeTruthy();
    expect(window.location.href).toBe("");
  });

  it("passes the platform's own message through on any other failure", async () => {
    fetchMock.mockResolvedValue(reply(403, { error: "Tenant admin required" }));
    const user = userEvent.setup();
    render(<BillingCard />);

    await user.click(manage());

    expect(await screen.findByText("Tenant admin required")).toBeTruthy();
  });

  it.each([
    ["the body carries no message", reply(500, {})],
    ["the body is not JSON at all", { ok: false, status: 502, json: async () => Promise.reject(new Error("html")) }],
  ])("falls back to a plain message when %s", async (_why, response) => {
    fetchMock.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<BillingCard />);

    await user.click(subscribe());

    expect(await screen.findByText(/billing is not available right now/i)).toBeTruthy();
  });

  it("says so rather than navigating nowhere when the link is missing", async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    const user = userEvent.setup();
    render(<BillingCard />);

    await user.click(subscribe());

    expect(await screen.findByText(/did not return a checkout link/i)).toBeTruthy();
    expect(window.location.href).toBe("");
  });

  it("disables both buttons while one is working, and names the one that is", async () => {
    let release!: () => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(reply(200, { url: "https://stripe.test/s" }));
      }),
    );
    const user = userEvent.setup();
    render(<BillingCard />);

    await user.click(subscribe());

    const opening = await screen.findByRole("button", { name: "Opening…" });
    expect((opening as HTMLButtonElement).disabled).toBe(true);
    expect((manage() as HTMLButtonElement).disabled).toBe(true);
    release();
  });

  it("re-enables the buttons after a failure so the user can retry", async () => {
    fetchMock.mockResolvedValue(reply(401, {}));
    const user = userEvent.setup();
    render(<BillingCard />);

    await user.click(subscribe());

    await waitFor(() => expect((subscribe() as HTMLButtonElement).disabled).toBe(false));
    expect((manage() as HTMLButtonElement).disabled).toBe(false);
  });

  it("clears a previous error when the next attempt starts", async () => {
    fetchMock.mockResolvedValueOnce(reply(401, {}));
    const user = userEvent.setup();
    render(<BillingCard />);

    await user.click(subscribe());
    expect(await screen.findByText(/unlock member management above first/i)).toBeTruthy();

    fetchMock.mockResolvedValue(reply(200, { url: "https://stripe.test/s" }));
    await user.click(manage());
    await waitFor(() =>
      expect(screen.queryByText(/unlock member management above first/i)).toBeNull(),
    );
  });
});
