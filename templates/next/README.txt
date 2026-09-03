evo-app-next
============

EvoPlatform's Next.js starter. Multi-tenant, offline-first, standalone by default,
platform mode with one env flag. Extracted from a production app (ProvenSheet) — every
pattern here has shipped.

Quickstart (standalone — no platform needed)
--------------------------------------------
    cp .env.example .env          # set AUTH_SECRET
    docker compose up -d          # Postgres on :5446
    npm install
    npx prisma migrate deploy && npx prisma generate
    npm run db:seed               # demo@example.com (fictional data only)
    npm run dev                   # http://localhost:4180

Sign up creates a workspace (Tenant + OWNER Membership); everything is tenant-scoped.

Platform mode
-------------

Uncomment the PLATFORM_* block in .env. Login (password + passkeys) is then delegated
to the EvoPlatform service; local Tenant/User/Membership rows are JIT-provisioned from
verified JWT claims; email routes through the platform. Remove the flag and the app is
standalone again — same build.

Identity in platform mode is platformUserId, not the email address. The platform
scopes accounts per workspace (@@unique([tenantId, email])), so one address is a
different person, with a different password, in each workspace. Local rows are keyed on
the access token's sub; email stays unique only among standalone accounts, via a
partial index. The session is bound to the workspace that was actually authenticated
against — never resolved from the user's other memberships.

Offline-first sync (the flagship)
---------------------------------

- Reads come from a per-tenant Dexie (IndexedDB) replica — instant, works offline.
- Writes hit Dexie plus an append-only outbox; UI never waits on the network.
- The sync client drains the outbox to /api/sync and pulls changes by rowVersion
  cursor (one global Postgres sequence, trigger-assigned; see the init migration).
- Conflicts: server-receive-order last-write-wins. Deletes are tombstones. Stale clients
  past the GC horizon get resyncRequired and re-pull from scratch.
- Multi-tab safe (Web Locks), mid-flight edits never clobbered (outbox coalescing).

Replace the example domain
--------------------------

Project + Task exist to show the pattern (client-generated ids, tenant scoping,
tombstones, rowVersion). To adapt: rename the models (keep the last four columns + the
trigger), update src/lib/sync/protocol.ts / server.ts / client.ts /
offline/tenantDb.ts field maps, and copy src/lib/data/projects.ts for your writes.

Layout
------
    prisma/                schema + hand-written init migration (sync trigger lives here)
    src/auth.ts            Auth.js v5, dual-mode credentials + passkey provider
    src/proxy.ts           optimistic cookie redirects (enforcement is in the DAL)
    src/lib/auth/          password hashing, DAL, reset tokens, cross-screen handoff
    src/lib/platform.ts    EvoPlatform SDK + JIT provisioning (platform mode)
    src/lib/sync/          wire protocol, server apply/pull, client drain loop
    src/lib/offline/       per-tenant Dexie db + outbox
    src/lib/data/          local-first write layer (the pattern to copy)
    src/lib/audit.ts       app audit trail (+ platform push in platform mode)
    src/lib/email/         mailer: platform → local SMTP → logged no-op
    src/app/api/sync/      the sync endpoint (advisory lock + GC horizon)
    src/app/api/platform/  passkey proxies (sudo-mode management)
    src/app/(auth)/        login, signup, and the three recovery screens
    src/lib/product.ts     PRODUCT_NAME — rename your app here

Tests
-----

npm test — outbox semantics (fake-indexeddb), password hashing and policy, the
recovery actions (both modes), and proxy route protection. The sync server logic is
exercised end-to-end by the app; add DB-backed tests as your domain grows.

Account recovery
----------------

Three screens, all reachable signed-out (they are in the proxy's PUBLIC_PATHS — a
recovery page behind the sign-in redirect is one nobody can reach):

| Route | Standalone | Platform mode |
| --- | --- | --- |
| /forgot-password | mails a local one-hour token | delegates to the platform, which mails its own link |
| /reset-password | completes the reset, then signs in | explains the link belongs to the platform's page |
| /forgot-workspace | says there is only one workspace | asks the platform to email the list |

Three things here are deliberate and worth keeping if you edit them:

- The answer never depends on whether the account exists. Same copy, same code
  path — otherwise the form becomes a way to enumerate your users.
- The workspace slug is sent with the platform lookup. Without it the platform
  searches platform-level accounts only, so tenant users silently get no mail.
- A failed auto-sign-in after a reset renders as a form message. The password is
  already changed at that point; a 500 there sends people back to reset it again.

Email and workspace carry across all the auth screens via sessionStorage
(src/lib/auth/useAuthHandoff.ts) so nobody retypes an address they just entered.
Passwords are never stored there.

Not included (yet)
------------------

Invites (in platform mode the platform provides them), tombstone GC script, tenant
settings admin UI (model exists).
