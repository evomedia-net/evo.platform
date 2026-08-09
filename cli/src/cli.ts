#!/usr/bin/env node
// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { checklist, scaffold } from "./new";
import { promptHidden, register } from "./register";

const USAGE = `evo — EvoPlatform scaffolding

Usage:
  evo new <app-name> [options]        Scaffold a new app from a template
  evo register <app-name> [options]   Register an app with the platform and
                                      write its credentials into the app .env

Options (new):
  --stack <next|nicegui>   Template stack (default: next)
  --dir <path>             Parent directory for the new app (default: cwd)
  --port <n>               App dev port (default: 4180)
  --db-port <n>            Postgres host port (default: 5446)

Options (register):
  --platform-url <url>     Platform base URL (default: http://localhost:8200)
  --email <email>          Platform admin email (required)
  --password <pw>          Admin password (or EVO_ADMIN_PASSWORD env, or prompt)
  --dir <path>             App directory holding .env (default: ./<app-name>)
  --workspace <slug>       PLATFORM_DEFAULT_WORKSPACE for the app's login form

Examples:
  evo new acme-tracker --dir F:\\apps --port 4300 --db-port 4550
  evo register acme-tracker --email admin@example.com --dir F:\\apps\\acme-tracker
`;

function parseFlags(rest: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith("--") || rest[i + 1] === undefined) {
      console.error(`Bad arguments near "${rest[i]}"\n${USAGE}`);
      process.exit(1);
    }
    flags.set(rest[i].slice(2), rest[i + 1]);
  }
  return flags;
}

async function main(argv: string[]) {
  const [command, name, ...rest] = argv;
  if (!["new", "register"].includes(command) || !name || name.startsWith("--")) {
    console.log(USAGE);
    process.exit(command === undefined || command === "--help" ? 0 : 1);
  }
  const flags = parseFlags(rest);

  if (command === "register") {
    const email = flags.get("email");
    if (!email) {
      console.error(`--email is required for register\n${USAGE}`);
      process.exit(1);
    }
    const password =
      flags.get("password") ??
      process.env.EVO_ADMIN_PASSWORD ??
      (await promptHidden(`Platform admin password for ${email}: `));
    try {
      const summary = await register({
        name,
        platformUrl: flags.get("platform-url") ?? "http://localhost:8200",
        email,
        password,
        dir: flags.get("dir") ?? `./${name}`,
        workspace: flags.get("workspace"),
      });
      console.log(summary);
    } catch (err) {
      console.error(`evo register failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
    return;
  }

  const appPort = Number(flags.get("port") ?? 4180);
  const dbPort = Number(flags.get("db-port") ?? 5446);
  if (!Number.isInteger(appPort) || !Number.isInteger(dbPort)) {
    console.error("Ports must be integers");
    process.exit(1);
  }

  try {
    const target = scaffold({
      name,
      stack: flags.get("stack") ?? "next",
      targetDir: flags.get("dir"),
      appPort,
      dbPort,
    });
    console.log(checklist(target, name, appPort));
  } catch (err) {
    console.error(`evo new failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

void main(process.argv.slice(2));
