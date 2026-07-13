# EvoPlatform — Pitch

> Working copy. Rule: every claim must describe something that exists and runs today.
> Update this file when features land — never ahead of them.

## GitHub tagline (repo description field)

Self-hosted multi-tenant SaaS platform + offline-first Next.js starter. Tenants, passkeys,
Stripe, and email in one service; `evo new` scaffolds an app that runs standalone or plugs in.

## One-liner (open-source / HN audience)

EvoPlatform is the boring half of your SaaS, built once: a self-hosted service that owns
tenants, auth (passwords + passkeys), Stripe billing, and email — and a CLI that scaffolds
offline-first, multi-tenant Next.js apps that run with or without it.

## README opening pitch

Every multi-tenant app rebuilds the same plumbing. EvoPlatform packages it:

- **A platform service** (NestJS + Postgres) that owns tenant lifecycle, users,
  passkey/WebAuthn login, app-scoped roles, Stripe subscriptions with payment-grace
  handling, per-tenant SMTP, and a central audit log. Apps verify RS256 tokens locally via
  cached JWKS — no per-request platform call, and key rotation needs no redeploys.
- **A Next.js starter** with the two things most starters skip: real row-level tenant
  isolation, and a production-grade offline-first sync engine (per-tenant IndexedDB
  replica, append-only outbox, cursor sync with tombstones and forced resync past the GC
  horizon).
- **`evo new my-app`** — scaffold, rename, secrets, running in minutes.

The design bet: **standalone by default**. Every generated app works with zero platform
dependency — own login, own Postgres, fully offline-capable. One env var (`PLATFORM_URL`)
flips the same build into a platform tenant app. Adopt the template today, adopt the
platform never, or later — your call.

Extracted from shipping production apps, not designed in the abstract. Early: one template
stack (Next.js), one SDK (Node), no admin UI yet. Everything claimed above runs and is
tested.

## General-audience one-liner (10 seconds)

EvoPlatform turns "build a SaaS product" into "build your product" — one command scaffolds
a multi-tenant, offline-first web app with login, passkeys, billing, and email already
running.

## General-audience elevator pitch (30 seconds)

Every SaaS app rebuilds the same plumbing: tenants, login, roles, billing, email, audit
trails. EvoPlatform builds it once. A shared platform service owns your customers —
accounts, passkey login, Stripe subscriptions, email — and your apps stay thin: they
verify a token and write their own domain data. `evo new my-app` gives you a working app
in minutes: multi-tenant, offline-first — it keeps working without a connection and syncs
when you're back — and it runs standalone on a laptop or joins the platform with one
environment flag. You ship features; the platform handles customers.
