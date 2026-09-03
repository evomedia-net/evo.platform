EvoPlatform service
===================

NestJS + Prisma + PostgreSQL. Owns tenants, users, auth (RS256 JWT + JWKS), the app
registry, audit events, and email. See ../docs/ARCHITECTURE.md (../docs/ARCHITECTURE.md).

Quickstart (dev)
----------------
    cp .env.example .env          # then set SECRET_KEY
    docker compose up -d          # Postgres on :5433 + Mailpit SMTP on :1025
    npm install
    npx prisma migrate dev        # create schema
    npm run seed                  # fictional demo data; prints credentials once
    npm run start:dev             # http://localhost:8200

An RSA signing keypair is generated into ./keys/ on first boot (gitignored). Delete the
folder to rotate keys in dev; in production, mount persistent keys.

Email
-----

Email works out of the box: the compose stack bundles Mailpit (https://mailpit.axllent.org/)
as a built-in SMTP sink, and .env.example points the env-level fallback at it. Every mail
the platform sends in dev lands in the Mailpit inbox UI at http://localhost:8025.

Resolution order per send: tenant SMTP config → platform default (PUT /admin/smtp with no
tenantId) → env fallback (Mailpit in dev, your real relay in production).

Endpoints
---------

| Method / path | Auth | Purpose |
|---|---|---|
| POST /auth/login | — | {tenantSlug?, email, password, clientId?} → access + refresh tokens. Omit tenantSlug for platform-admin login |
| POST /auth/refresh | — | Rotate a refresh token |
| POST /auth/logout | — | Revoke a refresh token |
| GET /auth/me | Bearer | Echo verified claims |
| GET /.well-known/jwks.json | — | Public keys; apps cache this and verify locally |
| POST /auth/passkeys/register/options | Bearer | Start passkey registration → WebAuthn options + challenge token |
| POST /auth/passkeys/register/verify | Bearer | Finish registration: {credential, challengeToken, nickname?} |
| GET /auth/passkeys | Bearer | List own passkeys |
| DELETE /auth/passkeys/:id | Bearer | Remove own passkey (owner-scoped) |
| POST /auth/passkeys/login/options | — | {tenantSlug?, email} → options (null if user has none) + challenge token |
| POST /auth/passkeys/login/verify | — | {credential, challengeToken, clientId?} → same session shape as password login |
| POST /auth/signup | — (gated by SIGNUP_MODE) | {company, slug?, email, password, clientId, inviteToken?} → workspace + founder tenant-admin + app trial; verification email sent, no tokens |
| POST /auth/signup-links | platform admin | Shareable signup link token for SIGNUP_MODE=invite |
| POST /auth/verify/send | — | {tenantSlug?, email} → verification email; always ok (no enumeration) |
| POST /auth/verify · GET /auth/verify?token= | — | Confirm a verification token (API / emailed-link page) |
| POST /auth/forgot | — | {tenantSlug?, email} → reset email; always ok (no enumeration) |
| POST /auth/reset · GET /auth/reset-page?token= | — | Set a new password (API / emailed-link form); revokes all sessions |
| GET /tenant/users | tenant admin | List own tenant's members (deactivated included) |
| POST /tenant/users | tenant admin | Create a member in own tenant |
| PATCH /tenant/users/:id | tenant admin | Update profile / tenant-admin flag (self-demotion blocked) |
| DELETE /tenant/users/:id | tenant admin | Deactivate a member — soft, restorable (self blocked) |
| POST /tenant/users/:id/restore | tenant admin | Restore a deactivated member |
| PUT /tenant/users/:id/roles | tenant admin | Replace the member's roles (enabled apps only) |
| GET /tenant/roles | tenant admin | Enabled apps with their assignable roles |
| GET/POST /tenant/invites | tenant admin | List invites / email an accept link (24 h, single-use; replaces any pending invite for the address) |
| POST /tenant/invites/:id/resend | tenant admin | Fresh token + email — the previously sent link dies |
| DELETE /tenant/invites/:id | tenant admin | Revoke a pending invite |
| POST /auth/invites/accept · GET /auth/invites/accept-page?token= | — | Create the account from an invite (API / emailed-link form); the account is born email-verified |
| GET/POST/PATCH/DELETE /admin/tenants[/:id] | platform admin | Tenant CRUD (delete = soft) |
| POST /admin/tenants/:id/restore\|suspend\|activate | platform admin | Lifecycle |
| GET /admin/tenants/:id/apps | platform admin | Registered apps with this tenant's access state for each |
| PUT /admin/tenants/:id/apps/:appId | platform admin | Enable an app for a tenant, or change its status/plan/trial/grace |
| DELETE /admin/tenants/:id/apps/:appId | platform admin | Disable an app for a tenant — logins scoped to it are refused |
| GET /admin/apps/:id/tenants | platform admin | Every tenant's access state for an app (the enablement matrix) |
| GET /admin/tenants/:id/export | platform admin | Full platform-data export (portability/backup); secrets omitted |
| DELETE /admin/tenants/:id/purge | platform admin | Hard delete (erasure); requires prior soft-delete |
| DELETE /admin/users/:id/purge | platform admin | Hard delete a soft-deleted user; audit rows unlinked |
| GET/POST/PATCH/DELETE /admin/users[/:id] | platform admin | User CRUD; ?tenantId=platform for platform-level users |
| PUT /admin/users/:id/roles | platform admin | Assign roles |
| GET/POST/PATCH /admin/apps[/:id] | platform admin | App registry; create returns the client secret once |
| POST /admin/apps/:id/rotate-secret | platform admin | New client secret |
| GET/POST /admin/apps/:id/roles | platform admin | App-specific roles |
| PATCH/DELETE /admin/apps/:id/roles/:roleId | platform admin | Rename a role / delete it (removes all assignments) |
| GET /admin/audit | platform admin | Query audit events (action, tenantId, from, to dates, take) |
| GET/PUT /admin/smtp | platform admin | Per-tenant SMTP config; omit tenantId for platform default |
| POST /events | client creds | Apps push audit events (x-client-id / x-client-secret) |
| POST /billing/checkout | client creds | Stripe Checkout for the tenant's subscription to the CALLING app (price from the app registry) |
| POST /billing/portal | client creds | Stripe billing-portal URL (payment method, invoices, cancel) |
| POST /billing/webhook | stripe signature | Subscription/invoice events → that app-tenant pair's access + 7-day grace on failed payment |
| POST /email/send | client creds | Send via tenant SMTP → platform default → env fallback |

App enablement
--------------

Tenants are granted access per app (app_tenants): a login or refresh scoped to a
clientId requires an enabled row for that tenant — ACTIVE, TRIAL until
trialEndsAt, or PAST_DUE until graceUntil; SUSPENDED or no row refuses the
login. One app's suspension never touches the tenant's other apps. Platform-admin
logins and tenant logins without an app scope are governed by the tenant-level checks
only. Admin-created tenants start enabled on every auto-enroll app; apps with
"Auto-enroll new tenants" unchecked (autoEnroll: false) are skipped, so access to
them exists only when granted specifically — in the console, by signup through the
app, or by subscription. The migration backfills existing tenants as enabled, so
turning this on locks nobody out. Manage it per app in the console ("Tenant
access") or via the /admin/tenants/:id/apps endpoints.

Rate limiting & bootstrap
-------------------------

Every route is rate limited per IP (RATE_LIMIT_PER_MIN, default 100/min), with a
tighter budget on the public auth surface — login, signup, verification, reset,
passkey login, invite accept (RATE_LIMIT_AUTH_PER_MIN, default 30/min). The Stripe
webhook and JWKS are exempt. Behind nginx set TRUST_PROXY=1 so the limiter sees
real client IPs. This is the precondition for SIGNUP_MODE=open.

First boot in production: set BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD
and a platform admin is created only if none exists (policy-checked, verified).
Inert afterwards — and lost-admin recovery is: set the vars, restart. Registering an
app then takes one command from the repo root:
evo register <app-name> --platform-url https://platform.example.com --email you@example.com --dir ./my-app
— it creates the registry entry and writes PLATFORM_URL / EVO_CLIENT_ID /
EVO_CLIENT_SECRET into the app's .env (the secret is caught at its single
reveal; the platform stores only its hash).

Self-service signup
-------------------

A company creates its own workspace through an app's signup page: tenant + founder
(automatically a tenant admin, unverified — the Phase 3 gate holds until they click
the verification email) + a SIGNUP_TRIAL_DAYS (default 14) trial of the app they
arrived through. Other apps stay un-enabled until subscribed or enabled by an admin.
Gated by SIGNUP_MODE:

- closed (default) — signups refused; nothing changes until you flip it.
- invite — requires a link token issued by a platform admin (POST /auth/signup-links).
- open — public. Turn on only after real rate limiting is deployed.

Explicitly chosen slugs conflict with a 409; slugs derived from the company name get a
random suffix on collision.

Email verification & password reset
-----------------------------------

Login is refused until the user's mailbox is proven (emailVerifiedAt), with the
distinct error Email not verified so apps can offer a re-send action. Users created
by a platform or tenant admin are stamped verified at creation (the credentials were
handed over directly); the migration backfills all existing users the same way, so
enforcement switches on without locking anyone out. Self-service signups (Phase 5)
will start unverified and use POST /auth/verify/send.

Password reset is fully self-service: POST /auth/forgot emails a link to a minimal
platform-hosted form. Reset tokens are HMAC-signed with a secret derived from the
user's current password hash — the moment the password changes, every outstanding
link dies, making tokens single-use with nothing stored. A successful reset revokes
all of the user's refresh tokens and counts as mailbox proof. Both send endpoints
answer ok regardless of account existence and are rate-limited in-process
(5 per address / 15 min) until the Phase 7 throttler lands.

Tenant admins
-------------

Users with isTenantAdmin (set per user in the console or admin API) carry a
tenant_admin claim and manage their own tenant's members through /tenant/*.
The tenant scope always comes from the verified token — the API takes no tenant
parameter, so a tenant admin can never reach another tenant. Self-lockout is
prevented (you cannot demote or deactivate yourself), role assignment is limited
to apps enabled for the tenant, and isPlatformAdmin is not settable from this
surface. Apps integrate via the SDK's TenantMember methods; the Next.js
template ships a Members page behind a password-confirm (sudo) window.

Members join by invite: the admin enters an email, the platform mails a
24-hour single-use accept link (only its hash is stored), and the invitee
chooses their own password on a self-contained accept page — no temporary
passwords change hands, and following the link doubles as email verification.
Re-sending rotates the token (the old link dies); revoking deletes it. Roles
attached to an invite are granted at accept time, silently dropping any whose
app has since been disabled for the tenant.

Data lifecycle
--------------

- Export (GET /admin/tenants/:id/export): the tenant's platform-owned data as one
  JSON document — tenant, users with role assignments, SMTP config (password masked),
  audit trail. App domain data is exported by each app from its own database.
- Purge (DELETE /admin/tenants/:id/purge, DELETE /admin/users/:id/purge): true
  erasure, deliberately two-step — the row must already be soft-deleted, so one mistaken
  call can never destroy data. Tenant purge removes users (cascading tokens, passkeys,
  role links), SMTP config, audit events, then the tenant. User purge unlinks the user
  from remaining audit rows before deleting. Stripe customers are not touched — cancel
  in Stripe first.
- Retention: a daily sweep (and on boot) deletes audit events older than
  RETENTION_AUDIT_DAYS (0 = keep forever) and refresh tokens revoked/expired longer
  than RETENTION_TOKEN_DAYS (default 30) ago.

Tests
-----
    npm test

Billing
-------

Stripe subscriptions, per app: the tenant has one Stripe customer, and each
(tenant, app) pair carries its own subscription driving its own app_tenants row —
one app's lapse never touches the tenant's other apps. Set STRIPE_SECRET_KEY +
STRIPE_WEBHOOK_SECRET, give each sellable app a Stripe Price in the console
("Stripe price" on the app card), and point a Stripe webhook at /billing/webhook
(events: customer.subscription.*, invoice.paid, invoice.payment_failed).

Apps request checkout with their client credentials; the platform tags the
subscription with tenant + app so webhook events route to the right pair. Payment
failure marks the pair PAST_DUE with a BILLING_GRACE_DAYS (default 7) window —
logins to that app keep working until it closes. invoice.paid lifts PAST_DUE
automatically but never revives a manual suspension. A completed first checkout for
a pair with no row creates it (paying is enablement), and a subscription ends any
running trial for that app. Unconfigured, billing endpoints return 503 and everything
else works normally.

Admin console
-------------

A dependency-free admin UI is served at / (the service root): tenant lifecycle,
users and role assignment, app registry with one-time secret display and rotation,
audit browsing, and SMTP config. Sign in with a platform-admin account. It is a thin
static client over the /admin API — all authorization stays in the API guards.

Production
----------

Deploy behind an nginx/TLS reverse proxy with docker-compose.prod.yml — see
../docs/DEPLOY.md (../docs/DEPLOY.md) for the full walkthrough (env, migrations,
nginx, DNS, Stripe). Back up the database and the signing keys with
scripts/backup.sh (losing the keys logs every user out); schedule it via cron and
ship the output off-box.

Not yet built (MVP roadmap)
---------------------------

MFA/SSO.
