// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * Two fleet rules meet on this screen: a failed sign-in never wipes what was
 * typed, and what was typed travels to the recovery screens. The passkey
 * path is the other half — every one of its exits has to leave the form
 * usable, because a cancelled ceremony is the normal case, not an error.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("../actions", () => ({ login: vi.fn() }));
vi.mock("@/lib/webauthn-browser", () => ({ passkeysSupported: vi.fn(), webauthnGet: vi.fn() }));

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { login } from "../actions";
import { passkeysSupported, webauthnGet } from "@/lib/webauthn-browser";
import LoginForm from "./LoginForm";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const router = { push: vi.fn(), refresh: vi.fn() };
const credential = { id: "cred", type: "public-key" };
const fetchMock = vi.fn();

const email = () => document.querySelector<HTMLInputElement>("#email")!;
const workspace = () => document.querySelector<HTMLInputElement>("#workspace");
const passkeyButton = () => screen.getByRole("button", { name: /sign in with a passkey/i });

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(useRouter).mockReturnValue(router as never);
  vi.mocked(login).mockResolvedValue({ error: null });
  vi.mocked(passkeysSupported).mockReturnValue(true);
  vi.mocked(webauthnGet).mockResolvedValue(credential as never);
  vi.mocked(signIn).mockResolvedValue({ error: undefined } as never);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ options: { challenge: "c" }, challengeToken: "ct" }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("LoginForm in standalone mode", () => {
  it("offers no workspace field, no passkey button, and no workspace lookup", () => {
    render(<LoginForm platformMode={false} />);
    expect(workspace()).toBeNull();
    expect(screen.queryByRole("button", { name: /passkey/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /look it up/i })).toBeNull();
    expect(screen.getByRole("link", { name: /forgot password/i }).getAttribute("href")).toBe(
      "/forgot-password",
    );
    expect(screen.getByRole("link", { name: /create your company workspace/i })).toBeTruthy();
  });
});

describe("LoginForm in platform mode", () => {
  it("offers the workspace field and both platform-only links", () => {
    render(<LoginForm platformMode />);
    expect(workspace()).not.toBeNull();
    expect(screen.getByRole("link", { name: /look it up/i }).getAttribute("href")).toBe(
      "/forgot-workspace",
    );
    expect(passkeyButton()).toBeTruthy();
  });

  it("shows the action's error and keeps what was typed", async () => {
    vi.mocked(login).mockResolvedValue({ error: "Invalid email or password" });
    const user = userEvent.setup();
    render(<LoginForm platformMode />);

    await user.type(email(), "owner@acme.example");
    await user.type(workspace()!, "acme");
    await user.type(document.querySelector<HTMLInputElement>("#password")!, "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Invalid email or password",
    );
    // The fleet rule: only the password clears.
    expect(email().value).toBe("owner@acme.example");
    expect(workspace()!.value).toBe("acme");
    expect(document.querySelector<HTMLInputElement>("#password")!.value).toBe("");
  });

  it("hands the email and workspace on to the recovery screens", async () => {
    const user = userEvent.setup();
    render(<LoginForm platformMode />);
    await user.type(email(), "owner@acme.example");
    await user.type(workspace()!, "acme");

    expect(JSON.parse(window.sessionStorage.getItem("auth_handoff")!)).toEqual({
      email: "owner@acme.example",
      workspace: "acme",
    });
  });

  it("prefills from what was typed on another auth screen", async () => {
    window.sessionStorage.setItem(
      "auth_handoff",
      JSON.stringify({ email: "owner@acme.example", workspace: "acme" }),
    );
    render(<LoginForm platformMode />);
    await waitFor(() => expect(email().value).toBe("owner@acme.example"));
    expect(workspace()!.value).toBe("acme");
  });
});

describe("passkey sign-in", () => {
  it("refuses before an address is entered, without calling the browser", async () => {
    const user = userEvent.setup();
    render(<LoginForm platformMode />);

    await user.click(passkeyButton());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Enter your email first, then use your passkey",
    );
    expect(passkeysSupported).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when the browser has no passkey support", async () => {
    vi.mocked(passkeysSupported).mockReturnValue(false);
    const user = userEvent.setup();
    render(<LoginForm platformMode />);

    await user.type(email(), "owner@acme.example");
    await user.click(passkeyButton());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Passkeys are not supported in this browser",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the platform for options with the typed address and workspace", async () => {
    const user = userEvent.setup();
    render(<LoginForm platformMode />);
    await user.type(email(), " owner@acme.example ");
    await user.type(workspace()!, " acme ");

    await user.click(passkeyButton());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/platform/passkeys/login/options");
    expect(JSON.parse(init.body)).toEqual({ email: "owner@acme.example", workspace: "acme" });
  });

  it.each([
    ["the request fails", { ok: false, json: async () => ({}) }],
    ["the account has no passkeys", { ok: true, json: async () => ({ options: null }) }],
  ])("reports one indistinguishable message when %s", async (_why, reply) => {
    fetchMock.mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<LoginForm platformMode />);
    await user.type(email(), "owner@acme.example");

    await user.click(passkeyButton());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "No passkeys are registered for this account",
    );
    expect(webauthnGet).not.toHaveBeenCalled();
  });

  it("signs in, clears the handoff and moves to the app", async () => {
    const user = userEvent.setup();
    render(<LoginForm platformMode />);
    await user.type(email(), "owner@acme.example");

    await user.click(passkeyButton());

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith("platform-passkey", {
        credential: JSON.stringify(credential),
        challengeToken: "ct",
        redirect: false,
      }),
    );
    expect(webauthnGet).toHaveBeenCalledWith({ challenge: "c" });
    await waitFor(() => expect(window.sessionStorage.getItem("auth_handoff")).toBeNull());
    expect(router.push).toHaveBeenCalledWith("/");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("reports a rejected assertion without moving the user", async () => {
    vi.mocked(signIn).mockResolvedValue({ error: "CredentialsSignin" } as never);
    const user = userEvent.setup();
    render(<LoginForm platformMode />);
    await user.type(email(), "owner@acme.example");

    await user.click(passkeyButton());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Passkey sign-in could not be verified",
    );
    expect(router.push).not.toHaveBeenCalled();
  });

  // Cancelling the browser prompt is the ordinary case, not a failure.
  it("recovers when the ceremony is cancelled, and re-enables the button", async () => {
    vi.mocked(webauthnGet).mockRejectedValue(new DOMException("NotAllowedError"));
    const user = userEvent.setup();
    render(<LoginForm platformMode />);
    await user.type(email(), "owner@acme.example");

    await user.click(passkeyButton());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Passkey sign-in was cancelled or failed",
    );
    await waitFor(() => expect((passkeyButton() as HTMLButtonElement).disabled).toBe(false));
  });

  it("says it is waiting while the browser prompt is open", async () => {
    let release!: () => void;
    vi.mocked(webauthnGet).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve(credential as never);
      }),
    );
    const user = userEvent.setup();
    render(<LoginForm platformMode />);
    await user.type(email(), "owner@acme.example");

    await user.click(passkeyButton());

    const waiting = await screen.findByRole("button", { name: /waiting for passkey/i });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(signIn).toHaveBeenCalled());
  });

  it("prefers the form's error over a stale passkey error", async () => {
    vi.mocked(login).mockResolvedValue({ error: "Invalid email or password" });
    vi.mocked(passkeysSupported).mockReturnValue(false);
    const user = userEvent.setup();
    render(<LoginForm platformMode />);
    await user.type(email(), "owner@acme.example");

    await user.click(passkeyButton());
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Passkeys are not supported in this browser",
    );

    // The password is required, so an empty one never reaches the action.
    await user.type(document.querySelector<HTMLInputElement>("#password")!, "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Invalid email or password"),
    );
  });
});
