# @evoplatform/sdk-node

Node SDK for EvoPlatform. Verifies platform-issued JWTs **locally** (cached JWKS — no
per-request platform call), proxies auth, and exposes the client-credential services
(audit events, email). Mirrored by `evoplatform-sdk` (Python).

## Setup

```ts
import { EvoPlatform } from '@evoplatform/sdk-node';

const platform = new EvoPlatform({
  platformUrl: process.env.PLATFORM_URL!,      // e.g. https://platform.example.com
  clientId: process.env.EVO_CLIENT_ID,         // from the platform admin
  clientSecret: process.env.EVO_CLIENT_SECRET, // server-side only
});
```

## Verifying requests

```ts
// Anywhere (Next.js middleware, API route, tRPC context...)
const claims = await platform.verifyToken(bearerToken);
// claims.tenant_id, claims.tenant_slug, claims.roles, claims.platform_admin

// Express-style
import { requireAuth, requireRole } from '@evoplatform/sdk-node';
app.use('/api', requireAuth(platform));
app.delete('/api/things/:id', requireRole('admin'), handler);
```

The JWKS is fetched once and cached (default 10 min). An unknown `kid` triggers a
re-fetch, so platform key rotation needs no app redeploys.

## Auth proxy (apps that render their own login form)

```ts
const session = await platform.login({ tenantSlug, email, password });
// → { accessToken, refreshToken, expiresIn, user } — store in an httpOnly cookie
const next = await platform.refresh(session.refreshToken); // rotates
await platform.logout(next.refreshToken);
```

## Services

```ts
await platform.sendEmail({ to, subject, html });          // tenant SMTP → default → env
await platform.pushEvent({ action: 'thing.created', tenantId, detail });
```

## Errors

- `TokenError` — token failed local verification
- `PlatformError` — non-2xx from the platform (`.status`, `.body`)
- `ConfigError` — missing client credentials for a credentialed call

## Tests

```bash
npm test              # unit (no network)
npm run integration   # live smoke against a running platform; see scripts/integration.ts
```
