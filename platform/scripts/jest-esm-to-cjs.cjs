// evomedia.net evo.platform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.
//
// Jest transformer: compile the ES-module packages NestJS 12 brought in to
// CommonJS, for tests only.
//
// WHY. NestJS 12 ships @nestjs/common, core, platform-express and testing as
// ES modules ("type": "module"). The platform itself is CommonJS and stays
// that way: Node 22.12+ can require() an ES module natively, so the built app
// starts and runs on the node:22 image unchanged. Jest cannot. Its CommonJS
// runtime only loads ES modules synchronously when node:vm exposes
// SourceTextModule.prototype.hasAsyncGraph, which needs Node 24.9+ AND
// --experimental-vm-modules. On Node 22 - CI and production - every suite
// that imports @nestjs/* failed with "Must use import to load ES Module"
// before a single test ran (28 of 36).
//
// So the packages are compiled to CommonJS as Jest loads them, using the
// TypeScript compiler the project already has. Nothing here runs in
// production, and nothing new is installed.
//
// WHAT IT DOES TO A FILE.
//   * A file with no ES-module syntax is returned untouched: rewriting plain
//     CommonJS could only break it (TypeScript would add "use strict").
//   * `import.meta.url` becomes the file URL of __filename. @nestjs/common's
//     loadPackage uses it with createRequire, and CommonJS has no import.meta.
//   * Everything else is TypeScript's ordinary ESM-to-CommonJS transpile.
//
// WHICH FILES. Only those matched by `transformIgnorePatterns` in
// package.json, which lists the ES-module packages by name. A new one shows up
// as the same "Must use import to load ES Module" error naming its path; add
// its package name there. When CI and production move to Node 24.9+, this
// file and that pattern can go, in favour of --experimental-vm-modules.

const ts = require('typescript');

const ESM_SYNTAX = /^\s*(import\s|import\{|export\s|export\{|export\*)/m;

module.exports = {
  process(source, filename) {
    if (!ESM_SYNTAX.test(source)) return { code: source };
    const code = source.replace(
      /\bimport\.meta\.url\b/g,
      "require('node:url').pathToFileURL(__filename).href",
    );
    const out = ts.transpileModule(code, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        allowJs: true,
        esModuleInterop: true,
      },
    });
    return { code: out.outputText };
  },
};
