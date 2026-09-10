// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The sudo window is the security property here: the card locks itself again
 * the moment the proxy says the window has lapsed, rather than showing a
 * stale list and failing on every action. The other half is that a cancelled
 * browser ceremony — the ordinary case — never strands the card.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/webauthn-browser", () => ({
  passkeysSupported: vi.fn(),
  webauthnCreate: vi.fn(),
}));

import { passkeysSupported, webauthnCreate } from "@/lib/webauthn-browser";
import { PasskeysCard } from "./PasskeysCard";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const fetchMock = vi.fn();
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number) => ({ ok: false, status, json: async () => ({}) });

const passkey = {
  id: "pk1",
  nickname: "Work laptop",
  createdAt: "2026-09-01T10:00:00.000Z",
  lastUsedAt: null as string | null,
};

const password = () => document.querySelector<HTMLInputElement>("#sudo-password")!;
const unlockButton = () => screen.getByRole("button", { name: "Unlock" });

/** Get past the sudo gate with the given list already loaded. */
async function unlock(list: unknown[] = [passkey]) {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(ok(list));
  render(<PasskeysCard />);
  await user.type(password(), "the-current-password");
  await user.click(unlockButton());
  await screen.findByRole("button", { name: "Add passkey" });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_PLATFORM_MODE", "1");
  vi.mocked(passkeysSupported).mockReturnValue(true);
  vi.mocked(webauthnCreate).mockResolvedValue({ id: "cred" } as never);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("PasskeysCard outside platform mode", () => {
  it("renders nothing at all", () => {
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_MODE", "0");
    const { container } = render(<PasskeysCard />);
    expect(container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the sudo gate", () => {
  it("asks for the password before showing anything", () => {
    render(<PasskeysCard />);
    expect(password()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Add passkey" })).toBeNull();
    // The field masks and offers the show/hide toggle, like every other one.
    expect(password().type).toBe("password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
  });

  it("sends the typed password and then loads the list", async () => {
    await unlock([passkey]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/platform/passkeys/sudo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "the-current-password" }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/platform/passkeys");
    expect(screen.getByText("Work laptop")).toBeTruthy();
  });

  it("refuses a wrong password without unlocking", async () => {
    fetchMock.mockResolvedValue(fail(401));
    const user = userEvent.setup();
    render(<PasskeysCard />);

    await user.type(password(), "wrong");
    await user.click(unlockButton());

    expect(await screen.findByText("Invalid password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add passkey" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // never asked for the list
  });

  it("says it is checking while the password is in flight", async () => {
    let release!: () => void;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(fail(401));
      }),
    );
    const user = userEvent.setup();
    render(<PasskeysCard />);
    await user.type(password(), "x");
    await user.click(unlockButton());

    const checking = await screen.findByRole("button", { name: "Checking…" });
    expect((checking as HTMLButtonElement).disabled).toBe(true);
    release();
    await screen.findByText("Invalid password");
  });

  // The window lapses after 15 minutes; the card must not keep showing a list
  // it can no longer act on.
  it("locks itself again when the list is refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(fail(401));
    render(<PasskeysCard />);
    await user.type(password(), "the-current-password");
    await user.click(unlockButton());

    expect(await screen.findByLabelText(/confirm your password/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add passkey" })).toBeNull();
  });
});

describe("the passkey list", () => {
  it("says when there are none", async () => {
    await unlock([]);
    expect(screen.getByText("No passkeys yet.")).toBeTruthy();
  });

  it("shows the date added, and the last use only when there is one", async () => {
    await unlock([passkey, { ...passkey, id: "pk2", nickname: "Phone", lastUsedAt: "2026-09-05T08:00:00.000Z" }]);
    const added = new Date(passkey.createdAt).toLocaleDateString();
    const used = new Date("2026-09-05T08:00:00.000Z").toLocaleDateString();

    expect(screen.getByText(`Added ${added}`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`last used ${used}`))).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
  });

  it("removes one by id and reloads the list", async () => {
    const user = await unlock([passkey]);
    fetchMock.mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(ok([]));

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/platform/passkeys/pk1", { method: "DELETE" }),
    );
    expect(await screen.findByText("No passkeys yet.")).toBeTruthy();
  });

  it("reports a removal the platform refuses, and keeps the entry", async () => {
    const user = await unlock([passkey]);
    fetchMock.mockResolvedValue(fail(400));

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("Could not remove passkey")).toBeTruthy();
    expect(screen.getByText("Work laptop")).toBeTruthy();
  });
});

describe("adding a passkey", () => {
  it("runs the ceremony, sends the nickname, and reloads", async () => {
    const user = await unlock([]);
    fetchMock
      .mockResolvedValueOnce(ok({ options: { challenge: "c" }, challengeToken: "ct" }))
      .mockResolvedValueOnce(ok({ id: "pk9" }))
      .mockResolvedValueOnce(ok([{ ...passkey, id: "pk9", nickname: "Phone" }]));

    await user.type(screen.getByPlaceholderText(/name \(e\.g\. work laptop\)/i), "Phone");
    await user.click(screen.getByRole("button", { name: "Add passkey" }));

    await waitFor(() => expect(webauthnCreate).toHaveBeenCalledWith({ challenge: "c" }));
    const verify = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/platform/passkeys/register/verify",
    )!;
    expect(JSON.parse(verify[1].body)).toEqual({
      credential: { id: "cred" },
      challengeToken: "ct",
      nickname: "Phone",
    });
    expect(await screen.findByText("Phone")).toBeTruthy();
    // The name box is emptied so the next one does not inherit it.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/name \(e\.g\. work laptop\)/i)).toHaveProperty("value", ""),
    );
  });

  it("omits an empty nickname rather than sending a blank one", async () => {
    const user = await unlock([]);
    fetchMock
      .mockResolvedValueOnce(ok({ options: {}, challengeToken: "ct" }))
      .mockResolvedValueOnce(ok({ id: "pk9" }))
      .mockResolvedValueOnce(ok([]));

    await user.click(screen.getByRole("button", { name: "Add passkey" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => c[0] === "/api/platform/passkeys/register/verify"),
      ).toBe(true),
    );
    const verify = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/platform/passkeys/register/verify",
    )!;
    expect(JSON.parse(verify[1].body).nickname).toBeUndefined();
  });

  it("says so when the browser cannot do passkeys, without calling the platform", async () => {
    const user = await unlock([]);
    vi.mocked(passkeysSupported).mockReturnValue(false);
    const before = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Add passkey" }));

    expect(await screen.findByText("Passkeys are not supported in this browser")).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("locks the card again when the options call says the window has lapsed", async () => {
    const user = await unlock([]);
    fetchMock.mockResolvedValue(fail(401));

    await user.click(screen.getByRole("button", { name: "Add passkey" }));

    expect(await screen.findByLabelText(/confirm your password/i)).toBeTruthy();
  });

  it("reports a registration the platform will not verify", async () => {
    const user = await unlock([]);
    fetchMock
      .mockResolvedValueOnce(ok({ options: {}, challengeToken: "ct" }))
      .mockResolvedValueOnce(fail(400));

    await user.click(screen.getByRole("button", { name: "Add passkey" }));

    expect(await screen.findByText("Passkey could not be registered")).toBeTruthy();
  });

  // Dismissing the browser prompt is normal, not an error state to get stuck in.
  it("recovers from a cancelled ceremony and re-enables the button", async () => {
    const user = await unlock([]);
    fetchMock.mockResolvedValueOnce(ok({ options: {}, challengeToken: "ct" }));
    vi.mocked(webauthnCreate).mockRejectedValue(new DOMException("NotAllowedError"));

    await user.click(screen.getByRole("button", { name: "Add passkey" }));

    expect(await screen.findByText("Passkey setup was cancelled or failed")).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Add passkey" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("says it is waiting while the browser prompt is open", async () => {
    const user = await unlock([]);
    let release!: () => void;
    fetchMock.mockResolvedValueOnce(ok({ options: {}, challengeToken: "ct" }));
    vi.mocked(webauthnCreate).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ id: "cred" } as never);
      }),
    );

    await user.click(screen.getByRole("button", { name: "Add passkey" }));

    const waiting = await screen.findByRole("button", { name: "Waiting…" });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    fetchMock.mockResolvedValueOnce(ok({ id: "pk9" })).mockResolvedValueOnce(ok([]));
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add passkey" })).toBeTruthy());
  });
});
