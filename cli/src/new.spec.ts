// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { npmInvocation } from "./new";

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
