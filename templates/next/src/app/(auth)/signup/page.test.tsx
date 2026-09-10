// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * Signup has one screen and two faces: the form, and the "check your email"
 * state platform mode lands on, where the account exists but cannot sign in
 * until the emailed link is clicked. The re-send offer only belongs on that
 * second face, and only when the action says the address can be re-sent to.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../actions", () => ({ signup: vi.fn() }));
vi.mock("@/components/auth/ResendVerification", () => ({
  ResendVerification: ({ email, workspace }: { email: string; workspace?: string }) => (
    <p>
      resend:[{email}]:[{workspace ?? ""}]
    </p>
  ),
}));

import { signup } from "../actions";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from "@/lib/auth/password";
import SignupPage from "./page";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const create = () => screen.getByRole("button", { name: /create workspace/i });
const STRONG = "correct horse battery staple";

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field("company"), "Acme Widgets");
  await user.type(field("email"), "owner@acme.example");
  await user.type(field("password"), STRONG);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(signup).mockResolvedValue({ error: null });
});

describe("the signup form", () => {
  it("states the policy under the password field and enforces its minimum", () => {
    render(<SignupPage />);
    expect(screen.getByText(PASSWORD_RULES_TEXT)).toBeTruthy();
    expect(field("password").minLength).toBe(PASSWORD_MIN_LENGTH);
    expect(field("password").type).toBe("password");
    expect(screen.getByRole("button", { name: "Show password" })).toBeTruthy();
  });

  // #208: someone who just found they have no account should not be asked
  // for the address they typed one screen ago.
  it("prefills the address typed on the sign-in screen", async () => {
    window.sessionStorage.setItem(
      "auth_handoff",
      JSON.stringify({ email: "owner@acme.example", workspace: "" }),
    );
    render(<SignupPage />);
    await waitFor(() => expect(field("email").value).toBe("owner@acme.example"));
  });

  it("writes the address back for the screens after it", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);
    await user.type(field("email"), "owner@acme.example");
    expect(JSON.parse(window.sessionStorage.getItem("auth_handoff")!).email).toBe(
      "owner@acme.example",
    );
  });

  it("submits the three fields to the action", async () => {
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillIn(user);
    await user.click(create());

    await waitFor(() => expect(signup).toHaveBeenCalled());
    const form = vi.mocked(signup).mock.calls[0][1] as FormData;
    expect(form.get("company")).toBe("Acme Widgets");
    expect(form.get("email")).toBe("owner@acme.example");
    expect(form.get("password")).toBe(STRONG);
  });

  it("shows the action's error and keeps the form up", async () => {
    vi.mocked(signup).mockResolvedValue({ error: "That workspace name is taken" });
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillIn(user);
    await user.click(create());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That workspace name is taken",
    );
    expect(create()).toBeTruthy();
  });

  it("says it is creating while the action runs", async () => {
    let release!: () => void;
    vi.mocked(signup).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ error: null });
      }),
    );
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillIn(user);
    await user.click(create());

    const creating = await screen.findByRole("button", { name: "Creating…" });
    expect((creating as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: /create workspace/i })).toBeTruthy());
  });

  it("links back to sign in", () => {
    render(<SignupPage />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  });
});

describe("after a signup that needs email verification", () => {
  it("replaces the form with the notice and offers a re-send", async () => {
    vi.mocked(signup).mockResolvedValue({
      error: null,
      notice: 'Workspace "acme-widgets" created — check your email',
      canResend: true,
      resendEmail: "owner@acme.example",
      resendWorkspace: "acme-widgets",
    });
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillIn(user);
    await user.click(create());

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeTruthy();
    expect(screen.getByText(/"acme-widgets" created/)).toBeTruthy();
    expect(screen.getByText("resend:[owner@acme.example]:[acme-widgets]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /create workspace/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  it.each([
    ["the action does not offer one", { canResend: false, resendEmail: "owner@acme.example" }],
    ["there is no address to send to", { canResend: true, resendEmail: undefined }],
  ])("offers no re-send when %s", async (_why, over) => {
    vi.mocked(signup).mockResolvedValue({ error: null, notice: "We sent you a link", ...over });
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillIn(user);
    await user.click(create());

    expect(await screen.findByText("We sent you a link")).toBeTruthy();
    expect(screen.queryByText(/^resend:/)).toBeNull();
  });

  it("passes no workspace to the re-send when the notice carries none", async () => {
    vi.mocked(signup).mockResolvedValue({
      error: null,
      notice: "We sent you a link",
      canResend: true,
      resendEmail: "owner@acme.example",
    });
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillIn(user);
    await user.click(create());

    expect(await screen.findByText("resend:[owner@acme.example]:[]")).toBeTruthy();
  });
});
