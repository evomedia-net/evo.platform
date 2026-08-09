// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Pure rename logic for `evo new`. The next template ships with the
 * placeholder identity "evo-app-next" / "evoapp" / "EVOAPP" / "Evo App";
 * these helpers derive an app's forms from its kebab-case name and rewrite
 * template text per file kind.
 */

export interface NameForms {
  /** kebab-case, e.g. "acme-tracker" — package name, cookie prefix, lock names */
  slug: string;
  /** snake_case, e.g. "acme_tracker" — Postgres user/db, container/volume names */
  dbIdent: string;
  /** SNAKE upper, e.g. "ACME_TRACKER" — Dexie database prefix */
  upper: string;
  /** Title Case, e.g. "Acme Tracker" — UI headings, metadata */
  title: string;
}

export function nameForms(raw: string): NameForms {
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(raw) || raw.includes("--")) {
    throw new Error(
      `Invalid app name "${raw}" — use kebab-case: lowercase letters, digits, single dashes (e.g. acme-tracker)`,
    );
  }
  const dbIdent = raw.replace(/-/g, "_");
  return {
    slug: raw,
    dbIdent,
    upper: dbIdent.toUpperCase(),
    title: raw
      .split("-")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" "),
  };
}

export interface Ports {
  appPort: number;
  dbPort: number;
}

const TEMPLATE_APP_PORT = "4180";
const TEMPLATE_DB_PORT = "5446";

/** docker-compose.yml / .env.example: DB identity + db port. */
export function replaceInfra(text: string, n: NameForms, p: Ports): string {
  return text
    .replaceAll("evoapp", n.dbIdent)
    .replaceAll(TEMPLATE_DB_PORT, String(p.dbPort))
    .replaceAll(TEMPLATE_APP_PORT, String(p.appPort));
}

/** Everything else (src, README): app identity + both ports. */
export function replaceCommon(text: string, n: NameForms, p: Ports): string {
  return text
    .replaceAll("evo-app-next", n.slug)
    .replaceAll("EVOAPP", n.upper)
    .replaceAll("Evo App", n.title)
    .replaceAll("evoapp", n.slug)
    .replaceAll(TEMPLATE_APP_PORT, String(p.appPort))
    .replaceAll(TEMPLATE_DB_PORT, String(p.dbPort));
}
