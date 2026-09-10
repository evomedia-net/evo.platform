// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The three recovery screens. Their shared contract is that a success reveals
 * nothing: the confirmation reads the same whether or not the address has an
 * account, so neither form can be used to find out who is registered here.
 * They also carry the handoff, so nobody retypes an address they just typed
 * on the login screen.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./actions", () => ({
  requestPasswordReset: vi.fn(),
  requestWorkspaceList: vi.fn(),
  resetPassword: vi.fn(),
}));

import { requestPasswordReset, requestWorkspaceList, resetPassword } from "./actions";
import ForgotPasswordForm from "./forgot-password/ForgotPasswordForm";
import WorkspaceForm from "./forgot-workspace/WorkspaceForm";
import ResetPasswordForm from "./reset-password/ResetPasswordForm";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from "@/lib/auth/password-policy";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`);
const STRONG = "correct horse battery staple";

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(requestPasswordReset).mockResolvedValue({ error: null });
  vi.mocked(requestWorkspaceList).mockResolvedValue({ error: null });
  vi.mocked(resetPassword).mockResolvedValue({ error: null });
});

describe("ForgotPasswordForm", () => {
  it("asks only for an email when there is one workspace", () => {
    render(<ForgotPasswordForm platformMode={false} />);
    expect(field("email")).not.toBeNull();
    expect(field("workspace")).toBeNull();
    expect(screen.queryByRole("link", { name: /look it up/i })).toBeNull();
  });

  it("asks for the workspace too in platform mode, and links the lookup", () => {
    render(<ForgotPasswordForm platformMode />);
    expect(field("workspace")).not.toBeNull();
    expect(screen.getByRole("link", { name: /look it up/i }).getAttribute("href")).toBe(
      "/forgot-workspace",
    );
  });

  it("prefills from the login screen and keeps writing back", async () => {
    window.sessionStorage.setItem(
      "auth_handoff",
      JSON.stringify({ email: "owner@acme.example", workspace: "acme" }),
    );
    const user = userEvent.setup();
    render(<ForgotPasswordForm platformMode />);

    await waitFor(() => expect(field("email")!.value).toBe("owner@acme.example"));
    expect(field("workspace")!.value).toBe("acme");

    await user.type(field("workspace")!, "-two");
    expect(JSON.parse(window.sessionStorage.getItem("auth_handoff")!).workspace).toBe("acme-two");
  });

  // The confirmation must not depend on whether the address exists.
  it("confirms without saying whether the address has an account", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm platformMode={false} />);

    await user.type(field("email")!, "nobody@acme.example");
    await user.click(screen.getByRole("button", { name: /email me a reset link/i }));

    expect(await screen.findByText(/check your email/i)).toBeTruthy();
    expect(screen.getByText(/if that address has an account/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: /back to sign in/i }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("keeps the form up and shows the reason when the action refuses", async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({ error: "Too many reset requests" });
    const user = userEvent.setup();
    render(<ForgotPasswordForm platformMode={false} />);

    await user.type(field("email")!, "owner@acme.example");
    await user.click(screen.getByRole("button", { name: /email me a reset link/i }));

    expect(await screen.findByText("Too many reset requests")).toBeTruthy();
    expect(screen.getByRole("button", { name: /email me a reset link/i })).toBeTruthy();
    expect(screen.queryByText(/check your email/i)).toBeNull();
  });
});

describe("WorkspaceForm", () => {
  it("explains there is nothing to look up when running standalone", () => {
    render(<WorkspaceForm platformMode={false} />);
    expect(screen.getByText(/single workspace/i)).toBeTruthy();
    expect(field("email")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link", { name: /back to sign in/i })).toBeTruthy();
  });

  it("asks for the address in platform mode", () => {
    render(<WorkspaceForm platformMode />);
    expect(field("email")).not.toBeNull();
    expect(screen.getByRole("button", { name: /email me my workspaces/i })).toBeTruthy();
  });

  it("prefills the address typed on the login screen", async () => {
    window.sessionStorage.setItem(
      "auth_handoff",
      JSON.stringify({ email: "owner@acme.example", workspace: "" }),
    );
    render(<WorkspaceForm platformMode />);
    await waitFor(() => expect(field("email")!.value).toBe("owner@acme.example"));
  });

  it("writes what is typed back to the handoff", async () => {
    const user = userEvent.setup();
    render(<WorkspaceForm platformMode />);
    await user.type(field("email")!, "owner@acme.example");
    expect(JSON.parse(window.sessionStorage.getItem("auth_handoff")!).email).toBe(
      "owner@acme.example",
    );
  });

  // The list of workspaces arrives by email and is never in the response.
  it("answers the same way whether or not the address has workspaces", async () => {
    const user = userEvent.setup();
    render(<WorkspaceForm platformMode />);

    await user.type(field("email")!, "nobody@acme.example");
    await user.click(screen.getByRole("button", { name: /email me my workspaces/i }));

    expect(await screen.findByText(/check your email/i)).toBeTruthy();
    expect(screen.getByText(/if that address belongs to any workspaces/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the reason when the action refuses", async () => {
    vi.mocked(requestWorkspaceList).mockResolvedValue({ error: "Too many lookups" });
    const user = userEvent.setup();
    render(<WorkspaceForm platformMode />);

    await user.type(field("email")!, "owner@acme.example");
    await user.click(screen.getByRole("button", { name: /email me my workspaces/i }));

    expect(await screen.findByText("Too many lookups")).toBeTruthy();
    expect(screen.queryByText(/check your email/i)).toBeNull();
  });
});

describe("ResetPasswordForm", () => {
  const props = { email: "owner@acme.example", token: "a-token-long-enough" };

  it("shows whose password it is setting and carries the link's identity", () => {
    render(<ResetPasswordForm {...props} />);
    expect(screen.getByText("owner@acme.example")).toBeTruthy();
    const hidden = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="hidden"]'));
    expect(hidden.map((i) => [i.name, i.value])).toEqual([
      ["email", props.email],
      ["token", props.token],
    ]);
  });

  it("states the policy under the field and enforces its length", () => {
    render(<ResetPasswordForm {...props} />);
    expect(screen.getByText(PASSWORD_RULES_TEXT)).toBeTruthy();
    expect(field("password")!.minLength).toBe(PASSWORD_MIN_LENGTH);
    // Both fields mask, and both offer the show/hide toggle.
    expect(field("password")!.type).toBe("password");
    expect(field("confirm")!.type).toBe("password");
    expect(screen.getAllByRole("button", { name: "Show password" })).toHaveLength(2);
  });

  it("submits both entries to the action", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm {...props} />);

    await user.type(field("password")!, STRONG);
    await user.type(field("confirm")!, STRONG);
    await user.click(screen.getByRole("button", { name: /set password and sign in/i }));

    await waitFor(() => expect(resetPassword).toHaveBeenCalled());
    const form = vi.mocked(resetPassword).mock.calls[0][1] as FormData;
    expect(form.get("email")).toBe(props.email);
    expect(form.get("token")).toBe(props.token);
    expect(form.get("password")).toBe(STRONG);
    expect(form.get("confirm")).toBe(STRONG);
  });

  it("shows the action's error, which is where the policy is really enforced", async () => {
    vi.mocked(resetPassword).mockResolvedValue({ error: "That password is too common" });
    const user = userEvent.setup();
    render(<ResetPasswordForm {...props} />);

    await user.type(field("password")!, "password1234");
    await user.type(field("confirm")!, "password1234");
    await user.click(screen.getByRole("button", { name: /set password and sign in/i }));

    expect(await screen.findByText("That password is too common")).toBeTruthy();
  });
});
