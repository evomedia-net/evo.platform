# Architecture

## Model: shared platform service

A standalone platform service owns tenancy, auth, billing, and email. Apps stay in their
native stack and talk to it through a JWT-authenticated SDK. Each app owns its own domain
database with a `tenant_id` foreign key on every row.

```
                    ┌──────────────────────────┐
                    │   EvoPlatform service    │
                    │  NestJS + Prisma + PG    │
                    │  tenants, users, roles,  │
                    │  billing, SMTP, admin UI │
                    └───────────┬──────────────┘
                        JWT / JWKS / REST
              ┌─────────────────┼─────────────────┐
        ┌─────┴─────┐     ┌─────┴─────┐     ┌─────┴─────┐
        │  App A    │     │  App B    │     │  App C    │
        │ (Next.js) │     │ (NiceGUI) │     │  (any)    │
        │  own DB   │     │  own DB   │     │  own DB   │
        └───────────┘     └───────────┘     └───────────┘
```

## Key decisions

| Area | Decision |
|---|---|
| Platform stack | Node.js + NestJS + Prisma + PostgreSQL |
| Tenant isolation | Row-level: shared schema, `tenant_id` FK on every domain table, auto-scoped queries |
| Routing | Subdomain per tenant (`acme.app.example.com`) and path-based (`example.com/acme/…`); subdomain is the default |
| Auth | Platform issues short-lived JWTs (~15 min) signed with its private key; apps verify via cached JWKS — no per-request platform call. Refresh tokens for long sessions |
| SDKs | Two mirrored SDKs (Node + Python) with identical surface area |
| Deployment | Docker Compose; no Kubernetes at small scale |

## Request flow

1. User visits `acme.app.example.com`; app middleware sees no JWT and redirects to the
   platform login with `app`, `tenant`, and `return` parameters.
2. Platform authenticates the user (scoped to the tenant slug), issues a JWT containing
   `{user_id, tenant_id, tenant_slug, roles, app, exp}`.
3. App stores the token in an httpOnly cookie. Every request, middleware verifies the
   signature against the cached JWKS, extracts `tenant_id`, and auto-scopes all queries.
4. The app never touches the platform database; the platform never touches app databases.
5. Cross-cutting services go through the SDK: `platform.sendEmail(...)` uses the tenant's
   SMTP config; audit events are pushed via the API.

## Responsibility split

| Concern | Platform | App |
|---|---|---|
| User accounts | owns | reads via JWT claims |
| Roles & permissions | owns (generic) | defines app-specific roles via API |
| Tenant lifecycle | owns | reads status; refuses if suspended |
| Billing | owns | reads plan / seat limits |
| SMTP config + sending | owns | calls `sendEmail()` |
| Global admin UI | owns | — |
| Audit (auth events) | owns | pushes app events via API |
| Domain data, settings, UI | — | owns entirely |

## Integrating a new app

1. Install the SDK (`npm i @evoplatform/sdk-node` or `pip install evoplatform-sdk`).
2. Add middleware that validates the JWT and attaches tenant context.
3. Put a `tenant_id` column on every domain table; auto-scope queries
   (Prisma middleware / SQLAlchemy event listener).
4. Replace in-app user/role/login code with SDK calls.
5. Register the app in the platform admin UI; receive a client ID and set callback URLs.

Or skip all of that on day one: start from a template in standalone mode and flip
`PLATFORM_URL` on later.
