// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Transactional mail. The transport is memoised at module scope, so each
 * case loads the module fresh; the mocks re-instantiate with it, which is
 * why their handles come from load() rather than top-level imports.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMailFn = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/platform", () => ({ isPlatformMode: vi.fn(() => false), getPlatform: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailFn })) },
}));

const ENV = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM", "AUTH_URL"] as const;
const saved: Record<string, string | undefined> = {};

async function load() {
  vi.resetModules();
  // Sequential on purpose: the mocked modules are imported first, so that
  // mailer's own imports of them resolve to these very instances. Importing
  // all three concurrently let mailer bind to a different instance of the
  // platform mock than the one the test then configured.
  const p = await import("@/lib/platform");
  const n = await import("nodemailer");

  // Reset here rather than trusting the framework to do it. vitest 5 caches
  // mock factories, so resetModules no longer re-runs them and the same mock
  // functions survive every load() - a mockReturnValue(true) set in one test
  // was still true in the next, which sent the standalone cases down the
  // platform branch. Doing it explicitly also means these tests no longer
  // depend on what restoreAllMocks happens to cover in a given version.
  vi.mocked(p.isPlatformMode).mockReset().mockReturnValue(false);
  vi.mocked(p.getPlatform).mockReset();
  vi.mocked(n.default.createTransport).mockReset().mockReturnValue({
    sendMail: sendMailFn,
  } as never);

  const m = await import("./mailer");
  return {
    ...m,
    isPlatformMode: vi.mocked(p.isPlatformMode),
    getPlatform: vi.mocked(p.getPlatform),
    createTransport: vi.mocked(n.default.createTransport),
  };
}

function smtp(port?: string) {
  process.env.SMTP_HOST = "smtp.test";
  process.env.SMTP_USER = "user";
  process.env.SMTP_PASS = "pass";
  if (port) process.env.SMTP_PORT = port;
}

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  sendMailFn.mockReset().mockResolvedValue({});
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

describe("isEmailEnabled", () => {
  it("is always on in platform mode, and needs host, user and password standalone", async () => {
    const m = await load();
    expect(m.isEmailEnabled()).toBe(false);
    smtp();
    expect(m.isEmailEnabled()).toBe(true);
    delete process.env.SMTP_PASS;
    expect(m.isEmailEnabled()).toBe(false);
    m.isPlatformMode.mockReturnValue(true);
    expect(m.isEmailEnabled()).toBe(true);
  });
});

describe("sendMail in platform mode", () => {
  it("sends through the platform and reports success", async () => {
    const m = await load();
    m.isPlatformMode.mockReturnValue(true);
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    m.getPlatform.mockReturnValue({ sendEmail } as never);

    expect(await m.sendMail({ to: "a@b.c", subject: "s", text: "t", html: "<p>" })).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith({ to: "a@b.c", subject: "s", text: "t", html: "<p>" });
    expect(m.createTransport).not.toHaveBeenCalled();
  });

  // A platform outage must never turn a user action into a 500.
  it("reports a platform failure as false, and logs it", async () => {
    const m = await load();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    m.isPlatformMode.mockReturnValue(true);
    m.getPlatform.mockReturnValue({ sendEmail: vi.fn().mockRejectedValue(new Error("503")) } as never);
    expect(await m.sendMail({ to: "a@b.c", subject: "s", text: "t" })).toBe(false);
    expect(error).toHaveBeenCalledWith("[mailer] platform send failed", expect.any(Error));
  });
});

describe("sendMail standalone", () => {
  it("is a logged no-op when SMTP is not configured", async () => {
    const m = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await m.sendMail({ to: "a@b.c", subject: "Reset", text: "t" })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('would have sent "Reset" to a@b.c'));
    expect(sendMailFn).not.toHaveBeenCalled();
  });

  it("builds the transport once from the env and sends from EMAIL_FROM", async () => {
    smtp();
    process.env.EMAIL_FROM = "noreply@test";
    const m = await load();

    expect(await m.sendMail({ to: "a@b.c", subject: "s", text: "t" })).toBe(true);
    expect(await m.sendMail({ to: "d@e.f", subject: "s2", text: "t2" })).toBe(true);

    expect(m.createTransport).toHaveBeenCalledTimes(1); // memoised
    expect(m.createTransport).toHaveBeenCalledWith({
      host: "smtp.test",
      port: 587,
      secure: false,
      auth: { user: "user", pass: "pass" },
    });
    expect(sendMailFn).toHaveBeenLastCalledWith({
      from: "noreply@test",
      to: "d@e.f",
      subject: "s2",
      text: "t2",
    });
  });

  it("falls back to the SMTP user as sender, and treats port 465 as implicit TLS", async () => {
    smtp("465");
    const m = await load();
    await m.sendMail({ to: "a@b.c", subject: "s", text: "t" });
    expect(m.createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 465, secure: true }));
    expect(sendMailFn).toHaveBeenCalledWith(expect.objectContaining({ from: "user" }));
  });
});

describe("appBaseUrl", () => {
  it("defaults to the dev port and strips one trailing slash", async () => {
    const m = await load();
    expect(m.appBaseUrl()).toBe("http://localhost:4180");
    process.env.AUTH_URL = "https://app.test/";
    expect(m.appBaseUrl()).toBe("https://app.test");
  });
});

describe("passwordResetEmail", () => {
  it("names the product, repeats the link in text and HTML, and warns about the lifetime", async () => {
    const m = await load();
    const { PRODUCT_NAME } = await import("@/lib/product");
    const mail = m.passwordResetEmail("a@b.c", "https://app.test/reset-password#token=x");

    expect(mail.to).toBe("a@b.c");
    expect(mail.subject).toBe(`Reset your ${PRODUCT_NAME} password`);
    expect(mail.text).toContain("https://app.test/reset-password#token=x");
    expect(mail.text).toContain("expires in 1 hour");
    // Button plus the pasted-URL fallback: every client that breaks one still has the other.
    expect(mail.html!.split("https://app.test/reset-password#token=x").length - 1).toBe(2);
    expect(mail.html).toContain(PRODUCT_NAME);
    expect(mail.html).toContain("<strong>a@b.c</strong>");
  });
});
