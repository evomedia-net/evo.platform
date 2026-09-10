// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(auth)/actions", () => ({ resendVerification: vi.fn() }));

import { resendVerification } from "@/app/(auth)/actions";
import { ResendVerification } from "./ResendVerification";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

beforeEach(() => vi.clearAllMocks());

describe("ResendVerification", () => {
  it("sends once, then replaces itself with the confirmation", async () => {
    vi.mocked(resendVerification).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ResendVerification email="owner@acme.example" workspace="acme" />);

    await user.click(screen.getByRole("button", { name: /re-send verification email/i }));

    expect(resendVerification).toHaveBeenCalledWith("owner@acme.example", "acme");
    expect(await screen.findByText(/verification email sent/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("passes no workspace when the caller has none", async () => {
    vi.mocked(resendVerification).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ResendVerification email="owner@acme.example" />);
    await user.click(screen.getByRole("button"));
    expect(resendVerification).toHaveBeenCalledWith("owner@acme.example", undefined);
  });

  it("disables the button while the request is in flight", async () => {
    let release!: () => void;
    vi.mocked(resendVerification).mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ ok: true });
      }),
    );
    const user = userEvent.setup();
    render(<ResendVerification email="owner@acme.example" />);

    await user.click(screen.getByRole("button"));
    const sending = screen.getByRole("button", { name: /sending/i });
    expect((sending as HTMLButtonElement).disabled).toBe(true);

    release();
    expect(await screen.findByText(/verification email sent/i)).toBeTruthy();
  });

  // #224: the account cannot be signed into until this email is clicked, so a
  // silently swallowed failure reads as "sent, still travelling" and the user
  // waits for something that was never sent.
  it("says the send failed, keeps the button usable, and swallows no rejection", async () => {
    vi.mocked(resendVerification).mockRejectedValue(new Error("smtp down"));
    const user = userEvent.setup();
    render(<ResendVerification email="owner@acme.example" />);

    await user.click(screen.getByRole("button"));

    expect(await screen.findByText(/couldn't send it just now/i)).toBeTruthy();
    const button = screen.getByRole("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.textContent).toMatch(/re-send verification email/i);
    expect(screen.queryByText(/verification email sent/i)).toBeNull();
  });

  it("clears the failure when the retry succeeds", async () => {
    vi.mocked(resendVerification).mockRejectedValueOnce(new Error("smtp down"));
    const user = userEvent.setup();
    render(<ResendVerification email="owner@acme.example" />);

    await user.click(screen.getByRole("button"));
    expect(await screen.findByText(/couldn't send it just now/i)).toBeTruthy();

    vi.mocked(resendVerification).mockResolvedValue({ ok: true });
    await user.click(screen.getByRole("button"));

    expect(await screen.findByText(/verification email sent/i)).toBeTruthy();
    expect(screen.queryByText(/couldn't send it just now/i)).toBeNull();
  });
});
