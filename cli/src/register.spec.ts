// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createInterface } from "readline";
import { patchEnvFile, promptHidden, register } from "./register";

// promptHidden reads a line from a readline interface; the mock hands back a
// fixed answer so the prompt can be driven without a terminal.
jest.mock("readline", () => ({ createInterface: jest.fn() }));

describe("patchEnvFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "evo-env-"));

  it("creates the file and appends entries", () => {
    const path = join(dir, ".env");
    patchEnvFile(path, { A: "1", B: "two" });
    expect(readFileSync(path, "utf8")).toBe("A=1\nB=two\n");
  });

  it("updates existing keys in place and keeps everything else", () => {
    const path = join(dir, "existing.env");
    writeFileSync(path, "# comment\nPLATFORM_URL=http://old:1\nKEEP=yes\n");
    patchEnvFile(path, { PLATFORM_URL: "http://new:2", EVO_CLIENT_ID: "app_x" });
    const out = readFileSync(path, "utf8");
    expect(out).toContain("# comment");
    expect(out).toContain("PLATFORM_URL=http://new:2");
    expect(out).not.toContain("http://old:1");
    expect(out).toContain("KEEP=yes");
    expect(out).toContain("EVO_CLIENT_ID=app_x");
  });
});

describe("register", () => {
  const dir = mkdtempSync(join(tmpdir(), "evo-reg-"));

  function mockFetch(
    responses: Array<{ ok: boolean; body: unknown; status?: number; badJson?: boolean }>,
  ) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift() ?? { ok: false, body: { message: "no more responses" } };
      return {
        ok: next.ok,
        status: next.status ?? (next.ok ? 200 : 400),
        json: async () => {
          if (next.badJson) throw new SyntaxError("not JSON");
          return next.body;
        },
      } as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  it("logs in, registers the app, and writes the env file", async () => {
    const calls = mockFetch([
      { ok: true, body: { accessToken: "tok", user: { platformAdmin: true } } },
      { ok: true, body: { name: "my-app", clientId: "app_abc", clientSecret: "s3cret" } },
    ]);
    const summary = await register({
      name: "my-app",
      platformUrl: "http://localhost:8200/",
      email: "admin@example.com",
      password: "pw",
      dir,
      workspace: "acme",
    });
    expect(calls[0].url).toBe("http://localhost:8200/auth/login");
    expect(calls[1].url).toBe("http://localhost:8200/admin/apps");
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toContain("EVO_CLIENT_ID=app_abc");
    expect(env).toContain("EVO_CLIENT_SECRET=s3cret");
    expect(env).toContain("PLATFORM_DEFAULT_WORKSPACE=acme");
    expect(summary).toContain("app_abc");
  });

  it("refuses non-admin accounts before touching the registry", async () => {
    const calls = mockFetch([
      { ok: true, body: { accessToken: "tok", user: { platformAdmin: false } } },
    ]);
    await expect(
      register({ name: "x", platformUrl: "http://p", email: "e", password: "p", dir }),
    ).rejects.toThrow("not a platform admin");
    expect(calls).toHaveLength(1);
  });

  it("surfaces platform error messages (e.g. duplicate app name)", async () => {
    mockFetch([
      { ok: true, body: { accessToken: "tok", user: { platformAdmin: true } } },
      { ok: false, status: 409, body: { message: 'App "my-app" already exists' } },
    ]);
    await expect(
      register({ name: "my-app", platformUrl: "http://p", email: "e", password: "p", dir }),
    ).rejects.toThrow("already exists");
  });

  it("falls back to the HTTP status when the error body carries no message", async () => {
    mockFetch([{ ok: false, status: 503, body: null }]);
    await expect(
      register({ name: "x", platformUrl: "http://p", email: "e", password: "p", dir }),
    ).rejects.toThrow("/auth/login failed: HTTP 503");
  });

  it("omits PLATFORM_DEFAULT_WORKSPACE when no workspace is given", async () => {
    const plain = mkdtempSync(join(tmpdir(), "evo-reg-nows-"));
    mockFetch([
      { ok: true, body: { accessToken: "tok", user: { platformAdmin: true } } },
      { ok: true, body: { name: "plain", clientId: "app_p", clientSecret: "s" } },
    ]);
    await register({ name: "plain", platformUrl: "http://p", email: "e", password: "p", dir: plain });
    const env = readFileSync(join(plain, ".env"), "utf8");
    expect(env).toContain("EVO_CLIENT_ID=app_p");
    expect(env).not.toContain("PLATFORM_DEFAULT_WORKSPACE");
  });

  it("treats a non-JSON error body as carrying no message", async () => {
    // A proxy or crashed service answers with HTML; res.json() rejects and
    // the message must fall back to the status rather than throw a parse error.
    mockFetch([{ ok: false, status: 502, body: "<html>bad gateway</html>", badJson: true }]);
    await expect(
      register({ name: "x", platformUrl: "http://p", email: "e", password: "p", dir }),
    ).rejects.toThrow("/auth/login failed: HTTP 502");
  });
});

describe("promptHidden", () => {
  it("asks on stdout, mutes readline's echo, and resolves the typed answer", async () => {
    const rl = {
      close: jest.fn(),
      question: jest.fn((_q: string, cb: (answer: string) => void) => cb("hunter2")),
      // What readline would call per keystroke to echo it. promptHidden must
      // replace this before asking, or the password is printed as typed.
      _writeToOutput: () => {
        throw new Error("echo was not muted");
      },
    };
    (createInterface as unknown as jest.Mock).mockReturnValue(rl);
    const write = jest.spyOn(process.stdout, "write").mockImplementation(() => true);

    const answer = await promptHidden("Password: ");

    expect(answer).toBe("hunter2");
    expect(createInterface).toHaveBeenCalledWith({ input: process.stdin, output: process.stdout });
    expect(write.mock.calls[0][0]).toBe("Password: ");
    expect(() => rl._writeToOutput()).not.toThrow();
    expect(rl.question).toHaveBeenCalledWith("", expect.any(Function));
    expect(rl.close).toHaveBeenCalled();
    expect(write.mock.calls[1][0]).toBe("\n");
    write.mockRestore();
  });
});
