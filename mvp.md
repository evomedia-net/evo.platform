# EvoPlatform — MVP

Distilled from design discussions on 2026-06-01 (platform architecture) and 2026-07-12
(app templates, standalone/offline mode, this repo).

## Vision

One platform, many sites. Building a new multi-tenant site should mean: run the scaffold
command, get a working tenant-aware app with auth, RBAC, audit, and deployment already wired,
and go straight to writing domain features. The undifferentiated SaaS plumbing is paid for
once, in the platform, not per app.

## What the MVP is

Three layers, in dependency order:

### 1. Platform service (the core)

Node.js + NestJS + Prisma + PostgreSQL. Owns, for every app:

- **Tenants** — lifecycle (create, suspend, delete/restore), slug, plan, status
- **Users & auth** — login scoped to tenant, short-lived JWTs (~15 min) signed with the
  platform key, JWKS endpoint for app-side verification, refresh tokens for long sessions
- **Roles & permissions** — generic RBAC; apps register their app-specific roles via API
- **Global admin UI** — one place to manage all customers across all apps
- **Billing** — Stripe subscriptions, seat limits, grace period on failed payment
- **Email** — per-tenant SMTP config; apps call `sendEmail()`, never touch SMTP themselves
- **Audit** — auth events logged centrally; apps push their own events via API

Apps never touch the platform database; the platform never touches app databases. Each app
keeps its own DB with `tenant_id` on every row.

### 2. SDKs

Two mirrored SDKs with identical surface area — `@evoplatform/sdk-node` and
`evoplatform-sdk` (Python): JWT/JWKS verification middleware, tenant-context helper,
`sendEmail()`, audit push, role checks.

MVP order: Node SDK first (first integrated app is Next.js), Python SDK second.

### 3. Starter templates + scaffold CLI

- `templates/next` — Next.js + Prisma + PostgreSQL, with an offline-first browser layer:
  IndexedDB (Dexie) mirror tables, mutation queue with `needs_sync` flags, last-write-wins
  sync on reconnect, visible sync-status indicator
- `templates/nicegui` — Python + NiceGUI + SQLAlchemy + PostgreSQL, server-rendered
- `cli` — `evo new <app-name> --stack next|nicegui`: copy template, rename identifiers,
  generate secrets, print the go-live checklist

Both templates conform to one contract (see `docs/TEMPLATE_CONTRACT.md`): tenant scoping,
auth, RBAC, audit log, soft delete with restore, settings, email, Docker Compose deploy,
smoke tests, fictional-only seed data.

## Standalone mode — the key design decision

Every template runs **without** the platform service by default: local users table, single
implicit tenant, no external dependencies. Setting `PLATFORM_URL` + client credentials flips
auth/tenancy/email over to the platform SDK.

Why it matters:

- New apps can start **now**, before the platform service exists, and join later
- It is the offline/field-use deployment: the whole app runs on one machine, no internet
- It forces the platform boundary to stay a clean SDK interface

Offline means two different things, both in scope:
- Next template: offline-first **in the browser** (queue mutations, sync later, LWW)
- NiceGUI template: offline = **standalone local install** (server-rendered, so browser
  offline-first doesn't apply)

## What the MVP is NOT

- No Kubernetes — Docker Compose on a single host until scale demands otherwise
- No conflict resolution beyond last-write-wins — no CRDTs, no merge UI
- No SSO/SAML/MFA in v1 (architecture leaves room; add once, benefit every app)
- No cross-app SQL joins — cross-app aggregation happens via platform API endpoints
- No porting existing apps to one stack — the whole point is polyglot apps on one platform

## Decisions log

| Decision | Choice |
|---|---|
| Integration model | Shared platform service (not shared libraries, not a rewrite) |
| Tenant isolation | Row-level: shared schema, `tenant_id` FK, auto-scoped queries |
| Routing | Subdomain per tenant default; path-based also supported |
| Platform stack | NestJS + Prisma + PostgreSQL |
| Auth | Platform-issued JWT, app-side JWKS verification (no per-request platform call) |
| Repo shape | Monorepo: platform + 2 SDKs + 2 templates + CLI (degit/copier can pull subfolders) |
| Deployment | Docker Compose |
| Licensing | Undecided; all rights reserved until a LICENSE is added |

## Build order

1. Platform service v1: tenants + users + auth/JWKS + global admin + Stripe + SMTP.
   Nothing fancy.
2. Node SDK + integrate the first real app (a Next.js app with no legacy auth — cheapest
   possible testbed; surfaces API gaps early).
3. Extract `templates/next` from that integration — the integration work *is* the template
   content; strip domain code, keep the skeleton plus one example CRUD module.
4. Python SDK + migrate the first Python/NiceGUI app; extract `templates/nicegui` from that
   migration the same way.
5. `evo new` CLI once either template exists.

## Success criteria

The MVP is done when: `evo new demo --stack next` produces an app that boots in standalone
mode with `docker compose up`, passes its smoke tests, and — after registering it in the
platform admin and setting `PLATFORM_URL` — logs in through the platform with tenant-scoped
data, all without editing template internals.

## Open questions

- License: MIT (adoption) vs AGPL (prevents closed-source SaaS clones) vs stay proprietary
- SQLite option for Next standalone mode: skipped for now (two migration paths); local
  Postgres via Docker is the default
- Hosted platform vs self-hosted only, if open-sourced
