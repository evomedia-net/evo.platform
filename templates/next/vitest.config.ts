// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Unit tests only. Without this vitest's default pattern also collects
    // e2e/*.spec.ts, and Playwright's API refuses to run outside its runner.
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // Every source file is in the denominator, imported by a test or not.
      // Measuring only what the tests happen to load reads several times
      // higher than the truth (evo.platform#199).
      //
      // vitest 5 dropped the `all` flag that used to say this: `include` now
      // carries the whole meaning, and every file matching it is counted
      // whether a test imported it or not. The denominator is the thing to
      // watch on any change here - it was 3392 statements and 178 functions
      // before this migration and must stay there, because a shrinking
      // denominator turns 100% into a smaller claim wearing the same number.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
      reporter: ["text-summary", "text"],
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
