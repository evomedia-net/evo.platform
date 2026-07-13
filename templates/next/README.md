# evo-app-next

EvoPlatform's Next.js starter. Multi-tenant, **offline-first**, standalone by default,
platform mode with one env flag. Extracted from a production app (SWAG Estimates) — every
pattern here has shipped.

## Quickstart (standalone — no platform needed)

```bash
cp .env.example .env          # set AUTH_SECRET
docker compose up -d          # Postgres on :5446
npm install
npx prisma migrate deploy && npx prisma generate
npm run db:seed               # demo@example.com (fictional data only)
npm run dev                   # http://localhost:4180
```

Sign up creates a workspace (Tenant + OWNER Membership); everything is tenant-scoped.

## Platform mode

Uncomment the `PLATFORM_*` block in `.env`. Login (password + passkeys) is then delegated
to the EvoPlatform service; local Tenant/User/Membership rows are JIT-provisioned from
verified JWT claims; email routes through the platform. Remove the flag and the app is
standalone again — same build.

## Offline-first sync (the flagship)

- Reads come from a **per-tenant Dexie (IndexedDB) replica** — instant, works offline.
- Writes hit Dexie plus an **append-only outbox**; UI never waits on the network.
- The sync client drains the outbox to `/api/sync` and pulls changes by **rowVersion
  cursor** (one global Postgres sequence, trigger-assigned; see the init migration).
- Conflicts: server-receive-order last-write-wins. Deletes are tombstones. Stale clients
  past the GC horizon get `resyncRequired` and re-pull from scratch.
- Multi-tab safe (Web Locks), mid-flight edits never clobbered (outbox coalescing).

## Replace the example domain

`Project` + `Task` exist to show the pattern (client-generated ids, tenant scoping,
tombstones, rowVersion). To adapt: rename the models (keep the last four columns + the
trigger), update `src/lib/sync/protocol.ts` / `server.ts` / `client.ts` /
`offline/tenantDb.ts` field maps, and copy `src/lib/data/projects.ts` for your writes.

## Layout

```
prisma/                schema + hand-written init migration (sync trigger lives here)
src/auth.ts            Auth.js v5, dual-mode credentials + passkey provider
src/proxy.ts           optimistic cookie redirects (enforcement is in the DAL)
src/lib/auth/          password hashing, DAL (verifySession / requireApiSession)
src/lib/platform.ts    EvoPlatform SDK + JIT provisioning (platform mode)
src/lib/sync/          wire protocol, server apply/pull, client drain loop
src/lib/offline/       per-tenant Dexie db + outbox
src/lib/data/          local-first write layer (the pattern to copy)
src/lib/audit.ts       app audit trail (+ platform push in platform mode)
src/lib/email/         mailer: platform → local SMTP → logged no-op
src/app/api/sync/      the sync endpoint (advisory lock + GC horizon)
src/app/api/platform/  passkey proxies (sudo-mode management)
```

## Tests

`npm test` — outbox semantics (fake-indexeddb) + password hashing. The sync server logic
is exercised end-to-end by the app; add DB-backed tests as your domain grows.

## Not included (yet)

Password reset / invites (port from SWAG's tokens.ts + mailer flows when needed),
tombstone GC script, tenant settings admin UI (model exists).
