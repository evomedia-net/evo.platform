// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The server components. Each one is a decision — which mode, which session,
 * which half of a branch — wrapped around a client component that is tested
 * on its own, so the children are stubbed and what is asserted here is the
 * decision and the wiring.
 *
 * `dynamic = "force-dynamic"` is asserted rather than described: reading
 * process.env does NOT opt a page out of build-time prerendering, and
 * `next build` runs in Docker with PLATFORM_URL unset — so without it the
 * standalone form is baked into static HTML and served forever, whatever
 * mode the runtime is really in.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./globals.css", () => ({}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/platform", () => ({ isPlatformMode: vi.fn() }));
vi.mock("@/lib/auth/dal", () => ({ verifySession: vi.fn() }));

// Client components, each covered by its own test file.
vi.mock("./(auth)/login/LoginForm", () => ({
  default: ({ platformMode }: { platformMode: boolean }) => <p>login:{String(platformMode)}</p>,
}));
vi.mock("./(auth)/forgot-password/ForgotPasswordForm", () => ({
  default: ({ platformMode }: { platformMode: boolean }) => <p>forgot:{String(platformMode)}</p>,
}));
vi.mock("./(auth)/forgot-workspace/WorkspaceForm", () => ({
  default: ({ platformMode }: { platformMode: boolean }) => <p>workspace:{String(platformMode)}</p>,
}));
vi.mock("./(auth)/reset-password/ResetPasswordFromLink", () => ({
  default: ({ fallback }: { fallback: { email?: string; token?: string } }) => (
    <p>
      reset:[{fallback.email}]:[{fallback.token}]
    </p>
  ),
}));
vi.mock("@/components/TenantProvider", () => ({
  TenantProvider: ({ value, children }: { value: unknown; children: React.ReactNode }) => (
    <div data-tenant={JSON.stringify(value)}>{children}</div>
  ),
}));
vi.mock("@/components/SyncStatusButton", () => ({ SyncStatusButton: () => <p>sync</p> }));
vi.mock("@/components/SignOutButton", () => ({
  SignOutButton: ({ action }: { action: unknown }) => (
    <p>signout:{typeof action === "function" ? "wired" : "missing"}</p>
  ),
}));
vi.mock("./(app)/signout-action", () => ({ signOutAction: vi.fn() }));
vi.mock("@/components/members/MembersManager", () => ({ MembersManager: () => <p>members</p> }));
vi.mock("@/components/members/BillingCard", () => ({ BillingCard: () => <p>billing</p> }));

import { isPlatformMode } from "@/lib/platform";
import { verifySession } from "@/lib/auth/dal";
import { PRODUCT_NAME } from "@/lib/product";

import RootLayout, { metadata } from "./layout";
import AuthLayout from "./(auth)/layout";
import LoginPage, { dynamic as loginDynamic } from "./(auth)/login/page";
import ForgotPasswordPage, { dynamic as forgotDynamic } from "./(auth)/forgot-password/page";
import ForgotWorkspacePage, { dynamic as workspaceDynamic } from "./(auth)/forgot-workspace/page";
import ResetPasswordPage, { dynamic as resetDynamic } from "./(auth)/reset-password/page";
import AppLayout from "./(app)/layout";
import MembersPage from "./(app)/members/page";

const session = {
  userId: "u1",
  tenantId: "t1",
  role: "ADMIN",
  email: "owner@acme.example",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPlatformMode).mockReturnValue(false);
  vi.mocked(verifySession).mockResolvedValue(session as never);
});

describe("the root layout", () => {
  it("names the product and declares the document language", () => {
    const html = renderToStaticMarkup(<RootLayout>{<p>page</p>}</RootLayout>);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<p>page</p>");
    expect(metadata.title).toBe(PRODUCT_NAME);
  });
});

describe("the auth layout", () => {
  it("frames the form under the product name", () => {
    const html = renderToStaticMarkup(<AuthLayout>{<p>form</p>}</AuthLayout>);
    expect(html).toContain(PRODUCT_NAME);
    expect(html).toContain("<p>form</p>");
  });
});

describe("the auth pages", () => {
  it.each([
    ["login", loginDynamic],
    ["forgot password", forgotDynamic],
    ["forgot workspace", workspaceDynamic],
    ["reset password", resetDynamic],
  ])("%s is never prerendered at build time", (_name, value) => {
    expect(value).toBe("force-dynamic");
  });

  it.each([
    ["login", LoginPage, "login"],
    ["forgot password", ForgotPasswordPage, "forgot"],
    ["forgot workspace", ForgotWorkspacePage, "workspace"],
  ])("%s resolves platform mode at request time", (_name, Page, marker) => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    expect(renderToStaticMarkup(<Page />)).toContain(`${marker}:true`);

    vi.mocked(isPlatformMode).mockReturnValue(false);
    expect(renderToStaticMarkup(<Page />)).toContain(`${marker}:false`);
  });
});

describe("the reset-password page", () => {
  // The platform hosts its own reset page and its emails never point here, so
  // rendering a form that cannot work would stall the user completely.
  it("explains itself in platform mode instead of showing a dead form", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const html = renderToStaticMarkup(
      await ResetPasswordPage({ searchParams: Promise.resolve({ email: "a@b.co", token: "t" }) }),
    );
    expect(html).toContain("This link can");
    expect(html).toContain('href="/forgot-password"');
    expect(html).not.toContain("reset:");
  });

  it("hands the query-string pair to the client component in standalone mode", async () => {
    const html = renderToStaticMarkup(
      await ResetPasswordPage({
        searchParams: Promise.resolve({ email: "a@b.co", token: "a-token" }),
      }),
    );
    expect(html).toContain("reset:[a@b.co]:[a-token]");
  });

  it("passes empty strings when the link carries no query string at all", async () => {
    const html = renderToStaticMarkup(
      await ResetPasswordPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain("reset:[]:[]");
  });
});

describe("the app layout", () => {
  it("puts the session under the provider and wires sign-out", async () => {
    const html = renderToStaticMarkup(await AppLayout({ children: <p>page</p> }));
    expect(verifySession).toHaveBeenCalled();
    expect(html).toContain(
      `data-tenant="${JSON.stringify({
        tenantId: "t1",
        role: "ADMIN",
        email: "owner@acme.example",
        userId: "u1",
      }).replace(/"/g, "&quot;")}"`,
    );
    expect(html).toContain("signout:wired");
    expect(html).toContain("<p>page</p>");
  });

  // #209: the brand-home link and Sign out must stay reachable at every
  // scroll position, and above any sticky table header.
  it("pins the header and clears sticky table headers", async () => {
    const html = renderToStaticMarkup(await AppLayout({ children: <p>page</p> }));
    const header = html.match(/<header class="([^"]*)"/)![1];
    expect(header).toContain("sticky");
    expect(header).toContain("top-0");
    expect(header).toMatch(/z-\d+/);
  });

  it("offers the brand-home link, the account link and sign-out on every page", async () => {
    const html = renderToStaticMarkup(await AppLayout({ children: <p>page</p> }));
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/settings/account"');
    expect(html).toContain("owner@acme.example");
    expect(html).toContain("signout:wired");
    expect(html).toContain("sync");
  });

  it("shows the members link only when the platform is managing accounts", async () => {
    expect(renderToStaticMarkup(await AppLayout({ children: <p /> }))).not.toContain(
      'href="/members"',
    );
    vi.mocked(isPlatformMode).mockReturnValue(true);
    expect(renderToStaticMarkup(await AppLayout({ children: <p /> }))).toContain('href="/members"');
  });
});

describe("the members page", () => {
  it("requires a session before deciding anything", async () => {
    await MembersPage();
    expect(verifySession).toHaveBeenCalled();
  });

  it("says where accounts come from in standalone mode", async () => {
    const html = renderToStaticMarkup(await MembersPage());
    expect(html).toContain("Member management is available when this app is connected");
    expect(html).not.toContain("members</p>");
    expect(html).not.toContain("billing");
  });

  it("shows the manager and billing in platform mode", async () => {
    vi.mocked(isPlatformMode).mockReturnValue(true);
    const html = renderToStaticMarkup(await MembersPage());
    expect(html).toContain("members");
    expect(html).toContain("billing");
  });
});
