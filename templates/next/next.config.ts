import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Inside the EvoPlatform monorepo the SDK is a file: dependency two levels
  // up; widening the Turbopack root lets it resolve. `evo new` removes this
  // when it rewrites the dependency to the published package.
  turbopack: { root: path.join(__dirname, "../..") },
};

export default nextConfig;
