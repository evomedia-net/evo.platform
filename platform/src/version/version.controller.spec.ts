// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Two things matter here. The reader must never invent a version — whatever
// it returns is recorded by zdeploy and the fleet dashboard as the build
// that is live — and the stamp must sit where Docker's runtime stage and
// zdeploy's localRoot expect it, next to package.json. The controller test
// reads the real file, so moving it breaks the suite before it breaks a
// deploy.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readBuildVersion, stampCandidates } from './build-version';
import { VersionController } from './version.controller';

describe('readBuildVersion', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the stamped string, trimmed, from the first candidate that exists', () => {
    const missing = join(dir, 'nope.json');
    const present = join(dir, 'build-version.json');
    writeFileSync(present, JSON.stringify({ version: ' v0.0.1.0.12 ' }));
    expect(readBuildVersion([missing, present])).toBe('v0.0.1.0.12');
  });

  it('is null when no candidate exists', () => {
    expect(readBuildVersion([join(dir, 'a.json'), join(dir, 'b.json')])).toBeNull();
  });

  it.each([
    ['not JSON', '{'],
    ['no version key', '{"build":"12"}'],
    ['an empty version', '{"version":"   "}'],
    ['a non-string version', '{"version":12}'],
  ])('is null, never a placeholder, for a stamp that is %s', (_what, body) => {
    const p = join(dir, 'build-version.json');
    writeFileSync(p, body);
    expect(readBuildVersion([p])).toBeNull();
  });

  it('does not fall through to a later candidate when the first is unreadable', () => {
    const broken = join(dir, 'build-version.json');
    const good = join(dir, 'other.json');
    writeFileSync(broken, '{');
    writeFileSync(good, '{"version":"v9.9.9.9.9"}');
    expect(readBuildVersion([broken, good])).toBeNull();
  });

  it('looks in the working directory first, then at the project root', () => {
    const [cwd, root] = stampCandidates();
    expect(cwd).toBe(join(process.cwd(), 'build-version.json'));
    expect(root).toBe(join(__dirname, '..', '..', 'build-version.json'));
  });
});

describe('GET /api/build-version', () => {
  it("answers the repo's own stamp, which proves the file is where the image and zdeploy expect it", () => {
    const stamp = JSON.parse(readFileSync(join(__dirname, '..', '..', 'build-version.json'), 'utf8'));
    const { version } = new VersionController().buildVersion();
    expect(version).toMatch(/^v\d+\.\d+\.\d+\.\d+\.\d+$/);
    expect(version).toBe(stamp.version);
  });
});
