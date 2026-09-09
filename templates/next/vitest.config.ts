// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      // Every source file is in the denominator, imported by a test or not.
      // The default measures only what the tests happen to load, which
      // reads several times higher than the truth (evo.platform#199).
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
      reporter: ["text-summary", "text"],
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
