import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { patchEnvFile, register } from "./register";

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

  function mockFetch(responses: Array<{ ok: boolean; body: unknown; status?: number }>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift() ?? { ok: false, body: { message: "no more responses" } };
      return {
        ok: next.ok,
        status: next.status ?? (next.ok ? 200 : 400),
        json: async () => next.body,
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
});
