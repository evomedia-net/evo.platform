#!/usr/bin/env node
import { checklist, scaffold } from "./new";

const USAGE = `evo — EvoPlatform scaffolding

Usage:
  evo new <app-name> [options]

Options:
  --stack <next|nicegui>   Template stack (default: next)
  --dir <path>             Parent directory for the new app (default: cwd)
  --port <n>               App dev port (default: 4180)
  --db-port <n>            Postgres host port (default: 5446)

Example:
  evo new acme-tracker --dir F:\\apps --port 4300 --db-port 5450
`;

function main(argv: string[]) {
  const [command, name, ...rest] = argv;
  if (command !== "new" || !name || name.startsWith("--")) {
    console.log(USAGE);
    process.exit(command === undefined || command === "--help" ? 0 : 1);
  }

  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith("--") || rest[i + 1] === undefined) {
      console.error(`Bad arguments near "${rest[i]}"\n${USAGE}`);
      process.exit(1);
    }
    flags.set(rest[i].slice(2), rest[i + 1]);
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

main(process.argv.slice(2));
