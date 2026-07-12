# EvoPlatform service

NestJS + Prisma + PostgreSQL. Owns tenants, users, auth (RS256 JWT + JWKS), the app
registry, audit events, and email. See [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Quickstart (dev)

```bash
cp .env.example .env          # then set SECRET_KEY
docker compose up -d db       # Postgres on localhost:5433
npm install
npx prisma migrate dev        # create schema
npm run seed                  # fictional demo data; prints credentials once
npm run start:dev             # http://localhost:8200
```

An RSA signing keypair is generated into `./keys/` on first boot (gitignored). Delete the
folder to rotate keys in dev; in production, mount persistent keys.

## Endpoints

| Method / path | Auth | Purpose |
|---|---|---|
| `POST /auth/login` | — | `{tenantSlug?, email, password, clientId?}` → access + refresh tokens. Omit `tenantSlug` for platform-admin login |
| `POST /auth/refresh` | — | Rotate a refresh token |
| `POST /auth/logout` | — | Revoke a refresh token |
| `GET /auth/me` | Bearer | Echo verified claims |
| `GET /.well-known/jwks.json` | — | Public keys; apps cache this and verify locally |
| `GET/POST/PATCH/DELETE /admin/tenants[/:id]` | platform admin | Tenant CRUD (delete = soft) |
| `POST /admin/tenants/:id/restore\|suspend\|activate` | platform admin | Lifecycle |
| `GET/POST/PATCH/DELETE /admin/users[/:id]` | platform admin | User CRUD; `?tenantId=platform` for platform-level users |
| `PUT /admin/users/:id/roles` | platform admin | Assign roles |
| `GET/POST/PATCH /admin/apps[/:id]` | platform admin | App registry; create returns the client secret **once** |
| `POST /admin/apps/:id/rotate-secret` | platform admin | New client secret |
| `GET/POST /admin/apps/:id/roles` | platform admin | App-specific roles |
| `GET /admin/audit` | platform admin | Query audit events |
| `GET/PUT /admin/smtp` | platform admin | Per-tenant SMTP config; omit `tenantId` for platform default |
| `POST /events` | client creds | Apps push audit events (`x-client-id` / `x-client-secret`) |
| `POST /email/send` | client creds | Send via tenant SMTP → platform default → env fallback |

## Tests

```bash
npm test
```

## Not yet built (MVP roadmap)

Stripe billing, admin UI (endpoints exist, UI later), rate limiting, MFA/SSO.
