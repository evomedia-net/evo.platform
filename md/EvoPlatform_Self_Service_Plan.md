# EvoPlatform — Self-Service Plan (remove all manual processes)

> Status: **reviewed 2026-07-17 — decisions locked, nothing built yet.** Next: Phase 1.
> Companion chart: [EvoPlatform_Tenant_Workflow.png](EvoPlatform_Tenant_Workflow.png)

## Goal

A company goes from "never heard of us" → signed up → app enabled → staff invited →
paying, with **zero platform-admin action**. The admin console stays as an oversight and
override surface, not a required step in anyone's onboarding.

## Manual processes today (the inventory)

| # | Manual process | Who does it today | Replacement |
|---|---|---|---|
| 1 | Tenant creation | Platform admin, New Tenant overlay in console. Template signup in platform mode returns "ask your administrator" | Public self-service signup (Phase 5) |
| 2 | App ↔ tenant enablement | Doesn't exist yet (Layer 1); naive version would be an admin toggle | Trial auto-enable on signup + subscription-driven enablement via Stripe webhook (Phases 1, 6) |
| 3 | User creation | Platform admin creates every user in console | Tenant-admin invites with emailed accept links (Phases 2, 4) |
| 4 | Passwords | Platform admin sets every password by hand (Set Password modal); no platform-level reset flow | Invitee sets own password/passkey on accept; self-service forgot/reset (Phases 3, 4) |
| 5 | Email verification | None | Verification email on signup (Phase 3) |
| 6 | Billing → access | Webhooks flip whole-tenant status; nothing connects a subscription to a specific app | Per-app subscription drives the AppTenant row automatically (Phase 6) |
| 7 | App (client) registration | Create app in console, copy/paste id+secret into `.env` | `evo register` CLI does the round trip (Phase 7) |
| 8 | Platform-admin bootstrap | Seed script, dev-oriented | First-boot bootstrap from env vars (Phase 7) |

Deliberately **staying manual**: suspend override, two-step purge (safety by design),
Stripe account/price setup, DNS + deploy, mail-server administration.

## Design principles

- **Reuse the purpose-claim JWT pattern.** `JwtAuthGuard` already rejects any token
  carrying a `purpose` claim, so signed single-purpose tokens (`email_verify`,
  `password_reset`, `invite_accept`) can travel in email links with no risk of being
  replayed as API credentials.
- **Password-reset tokens are single-use without a new table**: sign them with a
  per-user secret derived from the current password hash — the moment the password
  changes, every outstanding reset token dies.
- **Invites are DB rows** (not stateless tokens) because tenant admins need to list,
  re-send, and revoke them.
- **Everything gated by env flags** so nothing goes public before you flip it:
  `SIGNUP_MODE=closed|invite|open` (default `closed` — current behavior unchanged).

## Phases (one PR each, review before merge)

### Phase 1 — Layer 1: app enablement (~1 day)
As already scoped in our architecture discussion:
- `AppTenant` join table: `tenantId`, `appId`, `status` (`TRIAL | ACTIVE | PAST_DUE | SUSPENDED`), `plan`, `trialEndsAt`, `graceUntil`.
- Backfill migration: every existing tenant × registered app → `ACTIVE`.
- Login/refresh check: token issued for `clientId` X requires an enabled `AppTenant` row.
- Console: per-app tenant matrix view (read + manual override toggle).

### Phase 2 — Layer 2: tenant admins (~2 days)
- `User.isTenantAdmin` flag → `tenant_admin` claim in JWTs.
- `/tenant/users` endpoints (list, create, deactivate, role-assign — scoped to own tenant, own apps).
- SDK methods + template/SWAG members page proxying through the SDK.

### Phase 3 — Email verification + password reset (~1 day)
- `User.emailVerifiedAt`; `POST /auth/verify/send` + `GET /auth/verify?token=`.
- `POST /auth/forgot` (always 200 — no account enumeration) + `POST /auth/reset`.
- Emails go through the existing SMTP resolution chain (tenant → platform default → env).
- **Policy (decided): no login until verified.** Unverified accounts are blocked at
  `completeLogin` until `emailVerifiedAt` is set. Note the consequence: the verification
  email is login-critical, so SMTP health becomes an onboarding dependency — the signup
  response and login error must both offer "re-send verification email".

### Phase 4 — Invites (~1–1.5 days)
- `Invite` model: `tenantId`, `email`, `roleIds`, `isTenantAdmin`, `invitedById`, `tokenHash`, `expiresAt`, `acceptedAt`.
- `/tenant/invites` CRUD (tenant-admin) + public `POST /auth/invites/accept` (sets password, optional passkey next).
- **Expiry (decided): 24 hours**, re-sendable (re-send issues a fresh token, old one dies).
- Accepting an invite proves control of the mailbox → `emailVerifiedAt` is set on accept
  (invitees never hit the separate verification step).
- SDK methods; accept page in template + SWAG; members page gains "Invite" instead of "Create user".

### Phase 5 — Self-service signup (~1 day)
- Public `POST /auth/signup` `{company, slug?, email, password, clientId}`:
  creates tenant + first user (`isTenantAdmin=true`) + `AppTenant` in `TRIAL` for the
  app they arrived through + sends verification email.
- `SIGNUP_MODE` env: `closed` (today's behavior), `invite` (platform-admin generated links), `open`.
- Template + SWAG signup pages: platform mode calls the platform instead of erroring.

### Phase 6 — Subscription-driven enablement (~1 day)
- App registry gains Stripe price id(s) per plan.
- Checkout is created **per app**; webhook maps `subscription → AppTenant` status:
  paid → `ACTIVE`, payment failed → `PAST_DUE` + grace, canceled → `SUSPENDED`.
- Trial-expiry sweep (RetentionService pattern): `TRIAL` past `trialEndsAt` → blocked with an upgrade prompt, not deleted.
- Tenant admin reaches the Stripe billing portal from the members/billing page — card
  changes, cancellations, invoices all self-service (Stripe hosts it).

### Phase 7 — Developer path + hardening (~1 day)
- `evo register <app-name>`: calls `POST /admin/apps` with your admin token, writes
  `EVO_CLIENT_ID`/`EVO_CLIENT_SECRET`/`PLATFORM_URL` into the scaffolded app's `.env`.
- First-boot platform-admin bootstrap: `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`
  (only when no platform admin exists) — replaces the seed script for prod.
- Rate limiting (`@nestjs/throttler`) on all public endpoints (login, signup, forgot,
  accept) — **prerequisite for `SIGNUP_MODE=open`**.

## The flow after all phases

1. Raj hits SWAG's signup → platform creates *Initech* + Raj as tenant admin + SWAG trial → verification email → he's in. **You did nothing.**
2. Raj invites Priya from SWAG's members page → she sets her own password from the email link. **You did nothing.**
3. Trial ends → upgrade prompt → Stripe checkout → webhook flips SWAG `ACTIVE` for Initech. **You did nothing.**
4. Initech later opens DocketMail → same account works; DocketMail starts its own trial → its own subscription. Per-app billing isolation as designed.
5. Card fails → `PAST_DUE` + 7-day grace → email → auto-suspend or auto-recover. **You did nothing.**
6. Your console shows all of it and can override any of it.

## Decisions (confirmed 2026-07-17)

1. **Trial length**: 14 days per app.
2. **`SIGNUP_MODE`**: ships `closed`; Kelly flips it after rate limiting (Phase 7) lands.
3. **Unverified email**: **no login until verified** (hard block, no grace window).
4. **Invite expiry**: **24 hours**, re-sendable.

## Total estimate

~7–8 working days across 7 PRs, each independently reviewable and shippable in order.
Phases 1–2 are the architecture layers we already agreed on; 3–7 are the manual-process
removal on top.
