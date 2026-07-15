# EvoPlatform

![CI](https://github.com/kellymichels/EvoPlatform/actions/workflows/ci.yml/badge.svg)

A multi-tenant SaaS platform and app-template toolkit. Build a new tenant-aware site by
cloning a starter template — tenancy, auth, RBAC, audit logging, and deployment come wired in.

> **Status: working v1.** The platform service (with admin console), Node SDK, Next.js
> template, and `evo new` CLI all run and are tested. Not yet built: Python SDK, NiceGUI
> template. **Setup: [docs/INSTALL.md](docs/INSTALL.md)** · deploy:
> [docs/DEPLOY.md](docs/DEPLOY.md) · design:
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TEMPLATE_CONTRACT.md](docs/TEMPLATE_CONTRACT.md).

## The idea

Most multi-tenant apps re-implement the same undifferentiated plumbing: tenant isolation,
login, roles, billing, email, admin tooling. EvoPlatform splits that into:

- **A shared platform service** (Node.js/NestJS + Prisma + PostgreSQL) that owns tenants,
  users, auth (JWT/JWKS), billing, and SMTP — one service serving many apps.
- **Mirrored SDKs** — `@evoplatform/sdk-node` and `evoplatform-sdk` (Python) — with the same
  surface area, so apps can be written in whatever stack fits the problem.
- **Starter templates** that conform to a single template contract:
  - `templates/next` — Next.js + Prisma + PostgreSQL, with an offline-first browser layer
    (IndexedDB mutation queue, last-write-wins sync)
  - `templates/nicegui` — Python + NiceGUI + SQLAlchemy + PostgreSQL, server-rendered
- **A scaffold CLI** — `evo new <app-name> --stack next|nicegui` — clone, rename, generate
  secrets, done.

## Standalone mode

Every template runs **without** the platform service by default: a local users table, a
single implicit tenant, and no external dependencies — the whole app runs on one machine,
offline if needed. Setting `PLATFORM_URL` (plus client credentials) flips auth, tenancy, and
email over to the platform SDK. Apps can start standalone today and join the platform later.

## Repository layout

```
platform/            Shared platform service (NestJS)
packages/sdk-node/   Node SDK
packages/sdk-python/ Python SDK
templates/next/      Next.js starter template
templates/nicegui/   NiceGUI starter template
cli/                 `evo new` scaffolding tool
docs/                Architecture and design docs
```

## License

[MIT](LICENSE) © Kelly Michels
