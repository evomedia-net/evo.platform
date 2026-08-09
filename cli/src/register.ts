// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

/**
 * `evo register <app-name>`: register the app in the platform's registry and
 * wire the credentials into the app's .env — the manual copy-paste of client
 * id/secret from the admin console, automated. The client secret is shown by
 * the platform exactly once; this command is the thing that catches it.
 */

export interface RegisterOptions {
  name: string;
  platformUrl: string;
  email: string;
  password: string;
  /** App directory whose .env receives the credentials. */
  dir: string;
  /** Default workspace slug for the app's login form (optional). */
  workspace?: string;
}

/** Update KEY=value lines in place, append missing ones; creates the file. */
export function patchEnvFile(path: string, entries: Record<string, string>): void {
  let out = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    out = re.test(out) ? out.replace(re, line) : `${out.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(path, out.replace(/^\n/, ""));
}

async function api<T>(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as { message?: unknown } | null;
  if (!res.ok) {
    const msg = parsed && parsed.message ? String(parsed.message) : `HTTP ${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return parsed as T;
}

export async function register(opts: RegisterOptions): Promise<string> {
  const base = opts.platformUrl.replace(/\/+$/, "");

  const login = await api<{ accessToken: string; user: { platformAdmin: boolean } }>(
    base,
    "/auth/login",
    { email: opts.email, password: opts.password },
  );
  if (!login.user?.platformAdmin) {
    throw new Error("That account is not a platform admin");
  }

  const app = await api<{ clientId: string; clientSecret: string; name: string }>(
    base,
    "/admin/apps",
    { name: opts.name },
    login.accessToken,
  );

  const envPath = join(opts.dir, ".env");
  patchEnvFile(envPath, {
    PLATFORM_URL: base,
    EVO_CLIENT_ID: app.clientId,
    EVO_CLIENT_SECRET: app.clientSecret,
    NEXT_PUBLIC_PLATFORM_MODE: "1",
    ...(opts.workspace ? { PLATFORM_DEFAULT_WORKSPACE: opts.workspace } : {}),
  });

  return [
    `Registered "${app.name}" with the platform at ${base}`,
    ``,
    `  client id: ${app.clientId}`,
    `  secret:    written to ${envPath} (the platform stores only its hash)`,
    ``,
    `Next steps:`,
    `  1. In the platform console, enable workspaces for this app ("Tenant access")`,
    `     — or let self-service signup/billing do it.`,
    `  2. Restart the app; PLATFORM_URL flips it into platform mode.`,
  ].join("\n");
}

/** Password prompt with muted echo (no extra dependencies). */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolvePw) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(question);
    // Mute the echo readline would otherwise write for each keystroke.
    (rl as unknown as { _writeToOutput: () => void })._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolvePw(answer);
    });
  });
}
