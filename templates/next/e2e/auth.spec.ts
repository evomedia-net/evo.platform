// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { expect, test } from "@playwright/test";

/**
 * The fleet's auth-screen rules, each asserted in a real browser rather than
 * inferred from a rendered component (evo.platform#200):
 *
 *   - every password field has a show/hide toggle, and it works
 *   - a failed sign-in keeps the non-secret fields and clears only the password
 *   - what was typed carries login -> forgot-password -> signup and back, via
 *     sessionStorage and never the URL
 *   - after sign-in the header stays pinned, with the home link and Sign out
 *     reachable at every scroll position
 *
 * Runs against standalone mode with the seeded demo user; the workspace
 * field, passkeys and forgot-workspace are platform-mode only and absent here.
 */

const EMAIL = process.env.E2E_EMAIL ?? "demo@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "demo-password-1";

test.describe.configure({ mode: "serial" });

test("password fields have a working show/hide toggle", async ({ page }) => {
  await page.goto("/login");
  const password = page.locator("#password");
  await password.fill("secret-value");
  await expect(password).toHaveAttribute("type", "password");

  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("secret-value"); // revealing must not clear it

  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
});

test("a failed sign-in keeps the email and clears only the password", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // Scoped to the form: Next.js keeps its own <div role="alert"> route
  // announcer on every page, and an unscoped query matches both.
  await expect(page.locator("form").getByRole("alert")).toHaveText("Invalid email or password");
  await expect(page.locator("#email")).toHaveValue(EMAIL);
  await expect(page.locator("#password")).toHaveValue("");
  expect(page.url()).not.toContain(EMAIL); // nothing typed went into the URL
});

test("the typed email carries to forgot-password and signup and back, via sessionStorage", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator("#email").fill(EMAIL);

  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.locator("#email")).toHaveValue(EMAIL);

  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("#email")).toHaveValue(EMAIL);

  await page.getByRole("link", { name: "Create your company workspace" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.locator("#email")).toHaveValue(EMAIL);

  // The handoff lives in sessionStorage, holds only the non-secret
  // identifiers, and never touched a query string.
  const stored = await page.evaluate(() => window.sessionStorage.getItem("auth_handoff"));
  expect(JSON.parse(stored ?? "{}")).toEqual({ email: EMAIL, workspace: "" });
  expect(page.url()).not.toContain("email=");
});

test("forgot-password answers identically for any address", async ({ page }) => {
  // A reply that differed for known and unknown addresses would let anyone
  // find out who has an account here.
  for (const address of [EMAIL, "nobody-here@example.com"]) {
    await page.goto("/forgot-password");
    await page.locator("#email").fill(address);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  }
});

test("after sign-in the header stays pinned with home and Sign out reachable", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const header = page.locator("header");
  const signOut = header.getByRole("button", { name: "Sign out" });
  await expect(signOut).toBeVisible();
  await expect(header.locator('a[href="/"]')).toBeVisible();

  // Make the page tall, scroll well past a viewport, and check the header
  // did not move: still at the top, Sign out still in view.
  await page.evaluate(() => {
    document.body.style.minHeight = "4000px";
    window.scrollTo(0, 2500);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(2000);
  const box = await header.boundingBox();
  expect(box?.y).toBe(0);
  await expect(signOut).toBeInViewport();

  await signOut.click();
  await expect(page).toHaveURL(/\/login/);
});
