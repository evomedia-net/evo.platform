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

## Passkeys (WebAuthn)

```ts
// Registration (user is logged in; run the browser ceremony between the two calls)
const { options, challengeToken } = await platform.passkeyRegisterOptions(accessToken);
const credential = await startRegistration({ optionsJSON: options }); // @simplewebauthn/browser
await platform.passkeyRegisterVerify(accessToken, { credential, challengeToken, nickname: 'Work laptop' });

// Login
const start = await platform.passkeyLoginOptions({ tenantSlug, email });
if (start.options) { // null → user has no passkeys; hide the button
  const credential = await startAuthentication({ optionsJSON: start.options });
  const session = await platform.passkeyLoginVerify({ credential, challengeToken: start.challengeToken! });
}

// Management
await platform.listPasskeys(accessToken);
await platform.deletePasskey(accessToken, id);
```

Passkey login enforces the same account/tenant gates as password login and returns the
same session shape.

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
