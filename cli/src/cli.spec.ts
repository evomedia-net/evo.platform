// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * cli.ts runs main() at import and leaves through process.exit, so every case
 * loads it fresh (isolateModules) with process.argv set first.
 *
 * process.exit is a recorder, not a thrower. An exit stub that threw would
 * surface as an unhandled rejection from the `void main()` promise, which Jest
 * fails the test on. So each case asserts the FIRST exit code and the output
 * that preceded it, and the module mocks absorb whatever the code does after
 * an exit that did not actually stop it.
 */

jest.mock("./new", () => ({
  scaffold: jest.fn(),
  checklist: jest.fn(),
  npmInvocation: jest.fn(),
}));
jest.mock("./register", () => ({
  register: jest.fn(),
  promptHidden: jest.fn(),
  patchEnvFile: jest.fn(),
}));

interface Mocks {
  scaffold: jest.Mock;
  checklist: jest.Mock;
  register: jest.Mock;
  promptHidden: jest.Mock;
}

interface Run {
  /** The code of the first process.exit call, or undefined if it never exited. */
  exitCode: number | undefined;
  log: string;
  error: string;
  warn: string;
  m: Mocks;
}

async function run(
  args: string[],
  env: Record<string, string | undefined> = {},
  setup: (m: Mocks) => void = () => {},
): Promise<Run> {
  const argv = process.argv;
  const before = new Map(Object.keys(env).map((k) => [k, process.env[k]] as const));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.argv = ["node", "cli", ...args];

  const exit = jest
    .spyOn(process, "exit")
    .mockImplementation((() => undefined) as unknown as typeof process.exit);
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

  let m!: Mocks;
  jest.isolateModules(() => {
    // Same registry as the cli module about to load, so these are the
    // instances it imports.
    const n = jest.requireMock("./new") as { scaffold: jest.Mock; checklist: jest.Mock };
    const r = jest.requireMock("./register") as { register: jest.Mock; promptHidden: jest.Mock };
    m = { scaffold: n.scaffold, checklist: n.checklist, register: r.register, promptHidden: r.promptHidden };
    for (const fn of Object.values(m)) fn.mockReset();
    m.scaffold.mockReturnValue("/apps/acme");
    m.checklist.mockReturnValue("CHECKLIST");
    m.register.mockResolvedValue("SUMMARY");
    m.promptHidden.mockResolvedValue("prompted-pw");
    setup(m);
    require("./cli");
  });
  // main() is async and its promise is discarded; let it settle.
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));

  const joined = (spy: jest.SpyInstance) => spy.mock.calls.map((c) => c.join(" ")).join("\n");
  const out: Run = {
    exitCode: exit.mock.calls[0]?.[0] as number | undefined,
    log: joined(log),
    error: joined(error),
    warn: joined(warn),
    m,
  };

  exit.mockRestore();
  log.mockRestore();
  error.mockRestore();
  warn.mockRestore();
  process.argv = argv;
  for (const [k, v] of before) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return out;
}

describe("usage and argument errors", () => {
  it("prints usage and exits 0 with no command", async () => {
    const r = await run([]);
    expect(r.log).toContain("Usage:");
    expect(r.exitCode).toBe(0);
  });

  it("prints usage and exits 0 for --help", async () => {
    const r = await run(["--help"]);
    expect(r.log).toContain("Usage:");
    expect(r.exitCode).toBe(0);
  });

  it("exits 1 for an unknown command", async () => {
    const r = await run(["bogus", "acme"]);
    expect(r.log).toContain("Usage:");
    expect(r.exitCode).toBe(1);
  });

  it("exits 1 when the app name is missing", async () => {
    const r = await run(["new"]);
    expect(r.exitCode).toBe(1);
  });

  it("exits 1 when a flag sits where the app name should be", async () => {
    const r = await run(["new", "--dir", "x"]);
    expect(r.log).toContain("Usage:");
    expect(r.exitCode).toBe(1);
  });

  it("rejects a flag with no value", async () => {
    const r = await run(["new", "acme", "--port"]);
    expect(r.error).toContain('Bad arguments near "--port"');
    expect(r.exitCode).toBe(1);
  });

  it("rejects a value with no flag", async () => {
    const r = await run(["new", "acme", "port", "4300"]);
    expect(r.error).toContain('Bad arguments near "port"');
    expect(r.exitCode).toBe(1);
  });
});

describe("evo new", () => {
  it("scaffolds with the defaults and prints the checklist", async () => {
    const r = await run(["new", "acme"]);
    expect(r.m.scaffold).toHaveBeenCalledWith({
      name: "acme",
      stack: "next",
      targetDir: undefined,
      appPort: 4180,
      dbPort: 5446,
    });
    expect(r.m.checklist).toHaveBeenCalledWith("/apps/acme", "acme", 4180);
    expect(r.log).toContain("CHECKLIST");
    expect(r.exitCode).toBeUndefined();
  });

  it("passes every flag through", async () => {
    const r = await run([
      "new", "acme", "--stack", "next", "--dir", "F:/apps", "--port", "4300", "--db-port", "5450",
    ]);
    expect(r.m.scaffold).toHaveBeenCalledWith({
      name: "acme",
      stack: "next",
      targetDir: "F:/apps",
      appPort: 4300,
      dbPort: 5450,
    });
    expect(r.m.checklist).toHaveBeenCalledWith("/apps/acme", "acme", 4300);
  });

  it("refuses non-integer ports before scaffolding", async () => {
    const r = await run(["new", "acme", "--port", "abc"]);
    expect(r.error).toContain("Ports must be integers");
    expect(r.exitCode).toBe(1);
  });

  it("reports a scaffold error and exits 1", async () => {
    const r = await run(["new", "acme", "--stack", "vue"], {}, (m) => {
      m.scaffold.mockImplementation(() => {
        throw new Error('Unknown stack "vue"');
      });
    });
    expect(r.error).toContain('evo new failed: Unknown stack "vue"');
    expect(r.exitCode).toBe(1);
  });

  it("reports a non-Error throw verbatim", async () => {
    const r = await run(["new", "acme"], {}, (m) => {
      m.scaffold.mockImplementation(() => {
        throw "boom";
      });
    });
    expect(r.error).toContain("evo new failed: boom");
    expect(r.exitCode).toBe(1);
  });
});

describe("evo register", () => {
  it("requires --email", async () => {
    const r = await run(["register", "acme"], { EVO_ADMIN_PASSWORD: undefined });
    expect(r.error).toContain("--email is required for register");
    expect(r.exitCode).toBe(1);
  });

  it("takes --password, but warns that argv is visible", async () => {
    const r = await run(["register", "acme", "--email", "a@b", "--password", "pw"]);
    expect(r.warn).toContain("--password is visible in the process list and shell history");
    expect(r.m.register).toHaveBeenCalledWith({
      name: "acme",
      platformUrl: "http://localhost:8200",
      email: "a@b",
      password: "pw",
      dir: "./acme",
      workspace: undefined,
    });
    expect(r.m.promptHidden).not.toHaveBeenCalled();
    expect(r.log).toContain("SUMMARY");
    expect(r.exitCode).toBeUndefined();
  });

  it("falls back to EVO_ADMIN_PASSWORD, silently", async () => {
    const r = await run(["register", "acme", "--email", "a@b"], { EVO_ADMIN_PASSWORD: "envpw" });
    expect(r.warn).toBe("");
    expect(r.m.register.mock.calls[0][0].password).toBe("envpw");
    expect(r.m.promptHidden).not.toHaveBeenCalled();
  });

  it("prompts when neither flag nor env supplies a password", async () => {
    const r = await run(["register", "acme", "--email", "a@b"], { EVO_ADMIN_PASSWORD: undefined });
    expect(r.m.promptHidden).toHaveBeenCalledWith("Platform admin password for a@b: ");
    expect(r.m.register.mock.calls[0][0].password).toBe("prompted-pw");
  });

  it("passes every flag through", async () => {
    const r = await run([
      "register", "acme", "--email", "a@b", "--password", "pw",
      "--platform-url", "http://p:1", "--dir", "/d", "--workspace", "ws",
    ]);
    expect(r.m.register).toHaveBeenCalledWith({
      name: "acme",
      platformUrl: "http://p:1",
      email: "a@b",
      password: "pw",
      dir: "/d",
      workspace: "ws",
    });
  });

  it("reports a registration error and exits 1", async () => {
    const r = await run(["register", "acme", "--email", "a@b", "--password", "pw"], {}, (m) => {
      m.register.mockRejectedValue(new Error("That account is not a platform admin"));
    });
    expect(r.error).toContain("evo register failed: That account is not a platform admin");
    expect(r.exitCode).toBe(1);
  });

  it("reports a non-Error rejection verbatim", async () => {
    const r = await run(["register", "acme", "--email", "a@b", "--password", "pw"], {}, (m) => {
      m.register.mockRejectedValue("raw");
    });
    expect(r.error).toContain("evo register failed: raw");
    expect(r.exitCode).toBe(1);
  });
});
