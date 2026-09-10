// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Where the release stamp may sit, in trust order: the working directory
 * (Docker runs `node dist/main.js` from /app; `npm run start:dev` runs from
 * platform/), then the project root relative to this file, which is the
 * same place whether it executes from src/version or dist/version.
 */
export function stampCandidates(): string[] {
  return [
    join(process.cwd(), 'build-version.json'),
    resolve(__dirname, '..', '..', 'build-version.json'),
  ];
}

/**
 * The stamped version, or null. Null on purpose: whatever string this
 * returns is recorded by zdeploy's verification and the fleet dashboard as
 * "the build that is live", so a placeholder such as "unknown" or "dev"
 * would be believed. A stamp that exists but cannot be read is a broken
 * build, not a reason to try the next path.
 */
export function readBuildVersion(paths: string[] = stampCandidates()): string | null {
  for (const p of paths) {
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as { version?: unknown };
      const v = typeof parsed.version === 'string' ? parsed.version.trim() : '';
      return v || null;
    } catch {
      return null;
    }
  }
  return null;
}
