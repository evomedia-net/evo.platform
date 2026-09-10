// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The change-password form is standalone-only: in platform mode the platform
 * owns the password and this form would submit into a refusal. The rest is
 * the fleet's new-password shape — the policy minimum on the field, the rules
 * text under it, and a mismatch caught before the round trip (#222).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ changePassword: vi.fn() }));
vi.mock("@/components/auth/PasskeysCard", () => ({ PasskeysCard: () => <p>passkeys</p> }));
vi.mock("@/components/TenantProvider", () => ({
  useTenant: () => ({ email: "owner@acme.example" }),
}));

import { changePassword } from "./actions";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from "@/lib/auth/password-policy";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`);
const submit = () => screen.getByRole("button", { name: /update password/i });
const STRONG = "correct horse battery staple";

/** The page reads the mode at module scope, so each mode needs a fresh import. */
async function load(platformMode: boolean) {
  vi.stubEnv("NEXT_PUBLIC_PLATFORM_MODE", platformMode ? "1" : "0");
  vi.resetModules();
  return (await import("./page")).default;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(changePassword).mockResolvedValue({ error: null, ok: "Password updated" });
});
afterEach(() => vi.unstubAllEnvs());

describe("AccountPage", () => {
  it("names the signed-in account and always offers passkeys", async () => {
    const AccountPage = await load(false);
    render(<AccountPage />);
    expect(screen.getByText("owner@acme.example")).toBeTruthy();
    expect(screen.getByText("passkeys")).toBeTruthy();
  });

  // In platform mode the platform owns the password; the action refuses, so
  // showing the form at all would only waste the user's time.
  it("offers no change-password form in platform mode", async () => {
    const AccountPage = await load(true);
    render(<AccountPage />);
    expect(field("current")).toBeNull();
    expect(screen.queryByRole("button", { name: /update password/i })).toBeNull();
    expect(screen.getByText("passkeys")).toBeTruthy();
  });

  it("states the policy under the new-password field and enforces its minimum", async () => {
    const AccountPage = await load(false);
    render(<AccountPage />);
    expect(screen.getByText(PASSWORD_RULES_TEXT)).toBeTruthy();
    expect(field("next")!.minLength).toBe(PASSWORD_MIN_LENGTH);
    expect(field("confirm")!.minLength).toBe(PASSWORD_MIN_LENGTH);
    // Every password field masks and offers the show/hide toggle.
    expect(screen.getAllByRole("button", { name: "Show password" })).toHaveLength(3);
  });

  it("catches a mismatch before the round trip and blocks the submit", async () => {
    const AccountPage = await load(false);
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.type(field("next")!, STRONG);
    await user.type(field("confirm")!, "something else entirely");

    expect(screen.getByText(/passwords don't match/i)).toBeTruthy();
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("says nothing about a mismatch until the confirmation is started", async () => {
    const AccountPage = await load(false);
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.type(field("next")!, STRONG);

    expect(screen.queryByText(/passwords don't match/i)).toBeNull();
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
  });

  it("clears the mismatch once the two agree", async () => {
    const AccountPage = await load(false);
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.type(field("next")!, STRONG);
    await user.type(field("confirm")!, "correct horse battery stapl");
    expect(screen.getByText(/passwords don't match/i)).toBeTruthy();

    await user.type(field("confirm")!, "e");
    await waitFor(() => expect(screen.queryByText(/passwords don't match/i)).toBeNull());
  });

  it("submits all three fields and reports success", async () => {
    const AccountPage = await load(false);
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.type(field("current")!, "the-old-password");
    await user.type(field("next")!, STRONG);
    await user.type(field("confirm")!, STRONG);
    await user.click(submit());

    await waitFor(() => expect(changePassword).toHaveBeenCalled());
    const form = vi.mocked(changePassword).mock.calls[0][1] as FormData;
    expect(form.get("current")).toBe("the-old-password");
    expect(form.get("next")).toBe(STRONG);
    expect(form.get("confirm")).toBe(STRONG);
    expect(await screen.findByText("Password updated")).toBeTruthy();
  });

  it("shows the action's refusal, which is where the policy is really enforced", async () => {
    vi.mocked(changePassword).mockResolvedValue({ error: "That password is too common" });
    const AccountPage = await load(false);
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.type(field("current")!, "the-old-password");
    await user.type(field("next")!, "password1234");
    await user.type(field("confirm")!, "password1234");
    await user.click(submit());

    expect(await screen.findByText("That password is too common")).toBeTruthy();
  });

  it("says it is saving while the action runs", async () => {
    let release!: () => void;
    vi.mocked(changePassword).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ error: null, ok: "Password updated" });
      }),
    );
    const AccountPage = await load(false);
    const user = userEvent.setup();
    render(<AccountPage />);

    await user.type(field("current")!, "the-old-password");
    await user.type(field("next")!, STRONG);
    await user.type(field("confirm")!, STRONG);
    await user.click(submit());

    const saving = await screen.findByRole("button", { name: "Saving…" });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    release();
    await screen.findByText("Password updated");
  });
});
