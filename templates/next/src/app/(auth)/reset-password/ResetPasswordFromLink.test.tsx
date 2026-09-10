// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The token travels in the URL fragment so the server never sees it (#163):
 * not in an access log, not in a Referer. That only holds if this component
 * reads the fragment on the client, which is what these tests pin.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../actions", () => ({ resetPassword: vi.fn() }));

import ResetPasswordFromLink from "./ResetPasswordFromLink";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

function withHash(hash: string) {
  window.location.hash = hash;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
});

describe("ResetPasswordFromLink", () => {
  it("renders the form from the fragment, never touching the query string", async () => {
    withHash("#email=owner%40acme.example&token=a-token-long-enough");
    render(<ResetPasswordFromLink fallback={{}} />);

    expect(await screen.findByText("owner@acme.example")).toBeTruthy();
    const hidden = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="hidden"]'));
    expect(hidden.map((i) => i.value)).toEqual(["owner@acme.example", "a-token-long-enough"]);
  });

  // Links minted before the fragment change carry their parts in the query
  // string; they have to keep working until they expire.
  it("falls back to the query string for a link minted before the change", async () => {
    render(
      <ResetPasswordFromLink
        fallback={{ email: "old@acme.example", token: "an-older-token-value" }}
      />,
    );
    expect(await screen.findByText("old@acme.example")).toBeTruthy();
  });

  it("prefers the fragment over the query string when a link carries both", async () => {
    withHash("#email=new%40acme.example&token=the-newer-token-value");
    render(
      <ResetPasswordFromLink
        fallback={{ email: "old@acme.example", token: "an-older-token-value" }}
      />,
    );
    expect(await screen.findByText("new@acme.example")).toBeTruthy();
    expect(screen.queryByText("old@acme.example")).toBeNull();
  });

  // Mail clients wrap long URLs, which truncates the fragment. Saying so is
  // the difference between "request a new one" and "this app is broken".
  it.each([
    ["nothing at all", "", {}],
    ["only an address", "#email=owner%40acme.example", {}],
    ["only a token", "#token=a-token-long-enough", {}],
  ])("explains an incomplete link that carries %s", async (_what, hash, fallback) => {
    if (hash) withHash(hash);
    render(<ResetPasswordFromLink fallback={fallback} />);

    expect(await screen.findByText(/incomplete reset link/i)).toBeTruthy();
    expect(screen.getByText(/some mail clients break long URLs/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /request a reset link/i }).getAttribute("href")).toBe(
      "/forgot-password",
    );
    expect(document.querySelector("form")).toBeNull();
  });

  // Rendering either branch before the effect reads the fragment would flash
  // "incomplete link" at everyone whose link is perfectly fine. The server
  // render is the first render, and it has no fragment to read - so asserting
  // on it is the only way to see that first paint. (render() from Testing
  // Library wraps in act() and has already flushed the effect by the time it
  // returns, which is why this one goes through the server renderer.)
  it("renders nothing on the first paint, before the fragment has been read", () => {
    expect(
      renderToStaticMarkup(
        <ResetPasswordFromLink
          fallback={{ email: "owner@acme.example", token: "a-token-long-enough" }}
        />,
      ),
    ).toBe("");
  });

  it("shows the form once the effect has run", async () => {
    withHash("#email=owner%40acme.example&token=a-token-long-enough");
    const { container } = render(<ResetPasswordFromLink fallback={{}} />);
    await waitFor(() => expect(container.querySelector("form")).not.toBeNull());
  });
});
