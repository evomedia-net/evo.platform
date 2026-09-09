// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { execFileSync } from "child_process";
import * as fs from "fs";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { checklist, npmInvocation, scaffold } from "./new";

// scaffold() vendors the SDK with `npm pack`. The real thing is slow and
// touches packages/sdk-node; the mock returns what pack prints - the tarball
// name on its last line - and lets the failure path be exercised on demand.
jest.mock("child_process", () => ({ execFileSync: jest.fn() }));
const pack = execFileSync as unknown as jest.Mock;

// scaffold() also probes the filesystem with fs.existsSync - for the repo root
// and for npm-cli.js. `import * as fs` yields a namespace whose members cannot
// be spied on, so fs is mocked as itself with only existsSync replaceable.
jest.mock("fs", () => {
  const real = jest.requireActual("fs");
  return { ...real, existsSync: jest.fn(real.existsSync) };
});
const realFs = jest.requireActual("fs") as typeof fs;
const existsMock = fs.existsSync as unknown as jest.Mock;

// With shell:true on Windows, every argument - including the vendor directory
// built from the operator's own --dir - was joined into one cmd.exe command
// line and parsed by the shell (#168).
describe("npmInvocation", () => {
  it("runs the npm binary directly outside Windows", () => {
    expect(npmInvocation("/usr/bin/node", "linux", () => true)).toEqual({
      file: "npm",
      prefix: [],
      shell: false,
    });
  });

  it("runs npm's CLI entry under node itself on Windows, with no shell", () => {
    const seen: string[] = [];
    const out = npmInvocation("C:\\Program Files\\nodejs\\node.exe", "win32", (p) => {
      seen.push(p);
      return true;
    });
    expect(out.file).toBe("C:\\Program Files\\nodejs\\node.exe");
    expect(out.prefix[0]).toMatch(/node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/);
    expect(out.shell).toBe(false);
    expect(seen[0]).toContain("npm-cli.js");
  });

  it("falls back to a shell only when that entry is missing", () => {
    expect(npmInvocation("C:\\nodejs\\node.exe", "win32", () => false)).toEqual({
      file: "npm",
      prefix: [],
      shell: true,
    });
  });
});

describe("scaffold", () => {
  const opts = { name: "acme-tracker", stack: "next", appPort: 4300, dbPort: 5450 };

  beforeEach(() => {
    pack.mockReset().mockReturnValue("evoplatform-sdk-node-0.4.1.tgz\n");
    // restoreAllMocks strips a factory jest.fn's implementation, which would
    // make every existsSync call answer undefined - so re-seat the real one.
    existsMock.mockReset().mockImplementation(realFs.existsSync);
  });
  afterEach(() => jest.restoreAllMocks());

  it("scaffolds a working app from templates/next into an empty target", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "evo-new-"));
    const target = scaffold({ ...opts, targetDir: tmp });
    expect(target).toBe(path.resolve(tmp, "acme-tracker"));

    // identity rewritten, SDK vendored as the packed tarball
    const pkg = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
    expect(pkg.name).toBe("acme-tracker");
    expect(pkg.description).toContain("Acme Tracker");
    expect(pkg.dependencies["@evoplatform/sdk-node"]).toBe(
      "file:./vendor/evoplatform-sdk-node-0.4.1.tgz",
    );
    expect(pack).toHaveBeenCalledTimes(1);
    const [, args, execOpts] = pack.mock.calls[0];
    expect(args.slice(-3)).toEqual(["pack", "--pack-destination", path.join(target, "vendor")]);
    expect(execOpts.cwd).toMatch(/packages[\\/]sdk-node$/);
    expect(readdirSync(path.join(target, "vendor"))).toEqual([]);

    // secrets generated, never copied: exactly three lines, fresh values
    const env = readFileSync(path.join(target, ".env"), "utf8").split("\n");
    expect(env).toHaveLength(4);
    expect(env[0]).toBe(
      "DATABASE_URL=postgresql://acme_tracker:acme_tracker@localhost:5450/acme_tracker",
    );
    expect(env[1]).toMatch(/^AUTH_SECRET=[A-Za-z0-9_-]{40,}$/);
    expect(env[2]).toBe("AUTH_URL=http://localhost:4300");
    expect(env[3]).toBe("");

    // monorepo-only turbopack workaround dropped
    expect(readFileSync(path.join(target, "next.config.ts"), "utf8")).toBe(
      'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n',
    );

    // infra file got the db identity, app files got the app identity
    const compose = readFileSync(path.join(target, "docker-compose.yml"), "utf8");
    expect(compose).toContain("acme_tracker");
    expect(compose).not.toContain("evoapp");

    // EXCLUDES honoured, the rest of the tree present
    const top = readdirSync(target);
    for (const never of ["node_modules", ".next", "dist", "package-lock.json", "next-env.d.ts"]) {
      expect(top).not.toContain(never);
    }
    expect(top).toContain("prisma");
    expect(top).toContain("src");
  });

  it("accepts a target directory that exists but is empty", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "evo-new-"));
    mkdirSync(path.join(tmp, "acme-tracker"));
    expect(() => scaffold({ ...opts, targetDir: tmp })).not.toThrow();
  });

  it("defaults the target to the current directory when --dir is omitted", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "evo-new-"));
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const target = scaffold(opts);
      expect(target).toBe(path.join(process.cwd(), "acme-tracker"));
      expect(readdirSync(target)).toContain("package.json");
    } finally {
      process.chdir(cwd);
    }
  });

  it("refuses a target that already has content", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "evo-new-"));
    mkdirSync(path.join(tmp, "acme-tracker"));
    writeFileSync(path.join(tmp, "acme-tracker", "keep.txt"), "mine");
    expect(() => scaffold({ ...opts, targetDir: tmp })).toThrow(/already exists and is not empty/);
    expect(pack).not.toHaveBeenCalled();
  });

  it("rejects an unknown stack before touching the filesystem", () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "evo-new-"));
    expect(() => scaffold({ ...opts, stack: "vue", targetDir: tmp })).toThrow(
      /Unknown stack "vue" \(available: next\)/,
    );
    expect(readdirSync(tmp)).toEqual([]);
    expect(pack).not.toHaveBeenCalled();
  });

  it("falls back to a direct file: path when npm pack fails, and says so", () => {
    pack.mockImplementation(() => {
      throw new Error("npm exploded");
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const tmp = mkdtempSync(path.join(tmpdir(), "evo-new-"));
    const target = scaffold({ ...opts, targetDir: tmp });
    const pkg = JSON.parse(readFileSync(path.join(target, "package.json"), "utf8"));
    const dep: string = pkg.dependencies["@evoplatform/sdk-node"];
    expect(dep).toMatch(/^file:.*\/packages\/sdk-node$/);
    expect(dep).not.toContain("\\");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("npm pack failed"));
  });

  it("refuses a vendor path cmd.exe would misparse when only the shell fallback exists", () => {
    // Force the Windows shell fallback regardless of the host: platform is
    // win32 and npm-cli.js is "missing", so npmInvocation returns shell:true.
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    existsMock.mockImplementation((p: fs.PathLike) =>
      /npm-cli\.js$/.test(String(p)) ? false : realFs.existsSync(p),
    );
    try {
      const tmp = mkdtempSync(path.join(tmpdir(), "evo-new-"));
      expect(() => scaffold({ ...opts, targetDir: path.join(tmp, "bad&dir") })).toThrow(
        /cmd\.exe would interpret; choose a plainer --dir/,
      );
      expect(pack).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("fails clearly when the repo root cannot be found", () => {
    existsMock.mockReturnValue(false);
    expect(() => scaffold({ ...opts, targetDir: tmpdir() })).toThrow(
      /Could not locate the EvoPlatform repo root/,
    );
    expect(pack).not.toHaveBeenCalled();
  });
});

describe("checklist", () => {
  it("names the app, its directory and its port", () => {
    const out = checklist("/apps/acme-tracker", "acme-tracker", 4300);
    expect(out).toContain("Created Acme Tracker at /apps/acme-tracker");
    expect(out).toContain("cd /apps/acme-tracker");
    expect(out).toContain("http://localhost:4300");
    expect(out).toContain("PLATFORM_URL");
  });
});
