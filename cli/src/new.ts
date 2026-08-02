/**
 * `evo new <app-name>` — scaffold a working app from templates/<stack>.
 *
 * Deliberately boring: copy, rename identifiers, vendor the SDK as a packed
 * tarball (file: symlinks outside the project root break Turbopack), generate
 * secrets into .env, print the go-live checklist.
 */
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { nameForms, Ports, replaceCommon, replaceInfra } from "./transforms";

export interface NewOptions {
  name: string;
  stack: string;
  targetDir?: string;
  appPort: number;
  dbPort: number;
}

/** Never copied out of the template. */
const EXCLUDES = new Set([
  "node_modules",
  ".next",
  "dist",
  ".env",
  "next-env.d.ts",
  "package-lock.json",
  "tsconfig.tsbuildinfo",
]);

/** Files that carry DB identity rather than app identity. */
const INFRA_FILES = new Set(["docker-compose.yml", ".env.example"]);

function findRepoRoot(): string {
  // dist/new.js lives at <repo>/cli/dist — walk up until templates/ appears.
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, "templates"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not locate the EvoPlatform repo root (templates/ not found)");
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

export function scaffold(opts: NewOptions): string {
  if (opts.stack !== "next") {
    throw new Error(
      opts.stack === "nicegui"
        ? "The nicegui template is not built yet — only --stack next is available"
        : `Unknown stack "${opts.stack}" (available: next)`,
    );
  }
  const n = nameForms(opts.name);
  const ports: Ports = { appPort: opts.appPort, dbPort: opts.dbPort };

  const repoRoot = findRepoRoot();
  const templateDir = path.join(repoRoot, "templates", "next");
  const target = path.resolve(opts.targetDir ?? ".", n.slug);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`Target directory ${target} already exists and is not empty`);
  }

  // ── copy + rename ──
  for (const rel of walk(templateDir)) {
    const src = path.join(templateDir, rel);
    const dst = path.join(target, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const text = fs.readFileSync(src, "utf8");
    const name = path.basename(rel);
    fs.writeFileSync(
      dst,
      INFRA_FILES.has(name) ? replaceInfra(text, n, ports) : replaceCommon(text, n, ports),
    );
  }

  // ── package.json: identity, ports handled by replace; fix the SDK dep ──
  const pkgPath = path.join(target, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.name = n.slug;
  pkg.description = `${n.title} — built on the EvoPlatform next template`;
  pkg.dependencies["@evoplatform/sdk-node"] = vendorSdk(repoRoot, target);
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // ── next.config.ts: drop the monorepo turbopack.root workaround ──
  fs.writeFileSync(
    path.join(target, "next.config.ts"),
    `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {};\n\nexport default nextConfig;\n`,
  );

  // ── secrets: .env is generated, never copied ──
  fs.writeFileSync(
    path.join(target, ".env"),
    [
      `DATABASE_URL=postgresql://${n.dbIdent}:${n.dbIdent}@localhost:${ports.dbPort}/${n.dbIdent}`,
      `AUTH_SECRET=${randomBytes(32).toString("base64url")}`,
      `AUTH_URL=http://localhost:${ports.appPort}`,
      "",
    ].join("\n"),
  );

  return target;
}

/**
 * Pack the SDK into <app>/vendor and return the file: spec. Turbopack cannot
 * resolve file: symlinks outside the project root, so a tarball it is.
 * Falls back to a direct path spec (with a warning) if npm pack fails.
 */
function vendorSdk(repoRoot: string, target: string): string {
  const sdkDir = path.join(repoRoot, "packages", "sdk-node");
  const vendorDir = path.join(target, "vendor");
  fs.mkdirSync(vendorDir, { recursive: true });
  try {
    const out = execFileSync("npm", ["pack", "--pack-destination", vendorDir], {
      cwd: sdkDir,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const tgz = out.trim().split("\n").pop()!.trim();
    return `file:./vendor/${tgz}`;
  } catch {
    console.warn("! npm pack failed — falling back to a direct file: path for the SDK");
    return `file:${sdkDir.replace(/\\/g, "/")}`;
  }
}

export function checklist(target: string, name: string, appPort: number): string {
  const n = nameForms(name);
  return `
Created ${n.title} at ${target}

Next steps:
  cd ${target}
  docker compose up -d          # Postgres for this app
  npm install
  npx prisma migrate deploy && npx prisma generate
  npm run db:seed               # optional fictional demo data
  npm run dev                   # http://localhost:${appPort}

Going multi-tenant on EvoPlatform later:
  1. Register the app in the platform admin (POST /admin/apps) -> client id + secret
  2. Create its roles (admin, member) and your tenants/users
  3. Add to .env: PLATFORM_URL, EVO_CLIENT_ID, EVO_CLIENT_SECRET,
     PLATFORM_DEFAULT_WORKSPACE, NEXT_PUBLIC_PLATFORM_MODE=1
  4. Restart - login, passkeys, and email now come from the platform
`;
}
