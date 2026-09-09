// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for the auth screens (evo.platform#200), against standalone
 * mode: no PLATFORM_URL, local credentials, the seeded demo user.
 *
 * The app is started separately rather than by a webServer block. In CI the
 * job migrates and seeds the database first and then starts `next start`
 * itself, so that ordering is visible in the workflow instead of hidden
 * here. Locally: `docker compose up -d`, `npm run db:migrate`,
 * `npm run db:seed`, `npm run dev`, then `npm run test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // One worker: the tests share one seeded user, and the sign-in and reset
  // actions are rate-limited per client.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4180",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
