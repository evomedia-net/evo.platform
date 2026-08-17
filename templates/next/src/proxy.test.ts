// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    next: () => ({ type: "next" as const }),
    redirect: (url: URL) => ({ type: "redirect" as const, url }),
  },
}));

import proxy from "./proxy";

/** Minimal stand-in for NextRequest: the proxy only reads these two things. */
function request(pathname: string, opts: { session?: boolean; search?: string } = {}) {
  const url = new URL(`https://app.test${pathname}${opts.search ?? ""}`);
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    cookies: { has: (name: string) => Boolean(opts.session) && name === "evoapp.session-token" },
  } as never;
}

describe("proxy route protection", () => {
  it("sends a signed-out visitor to the login page", () => {
    const res = proxy(request("/projects")) as unknown as { type: string; url: URL };
    expect(res.type).toBe("redirect");
    expect(res.url.pathname).toBe("/login");
  });

  // Every one of these is reached by someone who cannot sign in. Behind the
  // auth redirect they are pages nobody can ever open — which is exactly the
  // state this template shipped in: the login page linked to
  // /forgot-password, and the proxy bounced it straight back to /login.
  it.each(["/login", "/signup", "/forgot-password", "/forgot-workspace", "/reset-password"])(
    "lets a signed-out visitor reach %s",
    (path) => {
      expect((proxy(request(path)) as { type: string }).type).toBe("next");
    },
  );

  it("redirects a signed-in user away from the sign-in pages", () => {
    const res = proxy(request("/login", { session: true })) as unknown as { type: string; url: URL };
    expect(res.type).toBe("redirect");
    expect(res.url.pathname).toBe("/");
  });

  // That redirect also clears the query string. A stale session cookie is
  // common in exactly the situation that produced the reset request, and
  // discarding the token would make the link fail for no visible reason.
  it("lets a reset link through with its token even when a session cookie exists", () => {
    const res = proxy(
      request("/reset-password", { session: true, search: "?email=a%40b.test&token=abc123" }),
    ) as { type: string };
    expect(res.type).toBe("next");
  });
});
