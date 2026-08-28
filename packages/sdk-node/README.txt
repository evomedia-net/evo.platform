@evoplatform/sdk-node
=====================

Node SDK for EvoPlatform. Verifies platform-issued JWTs locally (cached JWKS — no
per-request platform call), proxies auth, and exposes the client-credential services
(audit events, email). Mirrored by evoplatform-sdk (Python). In production under ProvenSheet and
CivilCode; DocketMail uses the Python mirror.

Install
-------

    npm install @evoplatform/sdk-node

From a checkout of this repo — which is what the bundled templates do — point a
file: dependency at the package instead:

    "@evoplatform/sdk-node": "file:../../packages/sdk-node"

The package builds itself on install (prepare), so a checkout is never
serving a stale dist/.

Setup
-----

    import { EvoPlatform } from '@evoplatform/sdk-node';

    const platform = new EvoPlatform({
      platformUrl: process.env.PLATFORM_URL!,      // e.g. https://platform.example.com
      clientId: process.env.EVO_CLIENT_ID,         // from the platform admin
      clientSecret: process.env.EVO_CLIENT_SECRET, // server-side only
    });

Verifying requests
------------------

    // Anywhere (Next.js middleware, API route, tRPC context...)
    const claims = await platform.verifyToken(bearerToken);
    // claims.tenant_id, claims.tenant_slug, claims.roles, claims.platform_admin

    // Express-style
    import { requireAuth, requireRole } from '@evoplatform/sdk-node';
    app.use('/api', requireAuth(platform));
    app.delete('/api/things/:id', requireRole('admin'), handler);

The JWKS is fetched once and cached (default 10 min). An unknown kid triggers a
re-fetch, so platform key rotation needs no app redeploys.

Auth proxy (apps that render their own login form)
--------------------------------------------------

    const session = await platform.login({ tenantSlug, email, password });
    // → { accessToken, refreshToken, expiresIn, user } — store in an httpOnly cookie
    const next = await platform.refresh(session.refreshToken); // rotates
    await platform.logout(next.refreshToken);

Passkeys (WebAuthn)
-------------------

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

Passkey login enforces the same account/tenant gates as password login and returns the
same session shape.

Services
--------

    await platform.sendEmail({ to, subject, html });          // tenant SMTP → default → env
    await platform.pushEvent({ action: 'thing.created', tenantId, detail });

Billing (client credentials)
----------------------------

    const prices = await platform.listPrices();
    // [{ stripeProductId, stripePriceId, productName, tier, unitAmount, currency,
    //    interval, intervalCount, trialDays }] — cheapest first, archived tiers omitted.
    // Enough to render a pricing table without holding any Stripe ids in your code.

    const ent = await platform.getEntitlement({ tenantId });
    // { enabled, status, plan, trialEndsAt, graceUntil, daysLeft }
    // enabled mirrors the login gate; daysLeft counts down a trial or grace window.
    // A cheap DB read (no Stripe round-trip) — fine to call per page load, and it
    // answers even before Stripe is configured.

    const { url } = await platform.createCheckout({
      tenantId,
      tier: 'pro',            // or interval: 'year'; or a priceId from listPrices()
      successUrl: `${appUrl}/billing/success`,
      cancelUrl: `${appUrl}/billing`,
    }); // redirect the browser to Stripe Checkout

    const portal = await platform.createBillingPortal({ tenantId, returnUrl: appUrl });

The platform's Stripe webhook then drives the tenant's access to the app
(paid → active, failed → grace → suspended).

Billing calls are scoped: the tenant must already have the calling app enabled,
and every redirect URL (successUrl, cancelUrl, returnUrl) must share an
origin with one of the app's registered callback URLs.

An app sells any number of tiers, each with its own billing period — name the
one you want by tier (+ interval, default monthly) rather than a Stripe id,
and repricing becomes a console edit instead of a redeploy. A tier billed
once is a one-time purchase: it grants access permanently and has no renewal,
grace or cancellation lifecycle.

Ask AI (evo-ai)
---------------

evo-ai is a separate service with its own URL and credentials, so it has its own
client rather than a method on EvoPlatform.

    import { AskAi } from '@evoplatform/sdk-node';

    const ai = new AskAi({
      url: process.env.EVOAI_URL!,
      serviceKey: process.env.EVOAI_SERVICE_KEY, // server-side only
    });

    const { answer, sources, gated } = await ai.ask({
      question: 'which permits expire this quarter?',
      tenantId: session.tenantId,
      userId: session.userId,          // who is asking - see below
      sourceTypes: ['permit'],        // inherit your app's permissions
      history: previousTurns,          // so "how many?" resolves
    });

tenantId says whose data to search; userId says who is asking. When evo-ai
has conversation memory enabled it keys remembered turns on the pair - and a
service key is ONE identity to evo-ai however many humans are behind it, so
omitting userId pools every user of a tenant into a single memory where they
would recall each other's questions. Derive both from your own session, never
from the browser. With an accessToken the user comes from verified claims and
userId is unnecessary.

Two auth modes, matching the two ways an app is built:

| Your app | Pass | evo-ai gets the tenant from |
|---|---|---|
| Has its own login | serviceKey on the client + tenantId per call | your X-Data-Tenant header |
| Is in platform mode | accessToken per call | the token's verified claims |

The service key authenticates the application, not the customer — so tenantId
is required with it, and must come from your own session. A holder of the key can
name any tenant, which is why it must never reach a browser.

A refusal is not an error. ask() resolves normally with gated: true when the
question was declined as unrelated to the indexed data (the guardrail working), and
unconfigured: true when the tenant has no usable model (an administrator problem).
Render both differently from a failure.

Timeout defaults to 120 s — a model composing an answer over retrieved records is
not a fast API call, and a shorter default cuts off answers that were about to
succeed. Override with timeoutMs.

Full walkthrough, including the two patterns that don't use this client: see the
Integrating Ask AI guide supplied with evo-ai.

Errors
------

- TokenError — token failed local verification
- PlatformError — non-2xx from a service (.status, .body). Status 0 means
  unreachable; 504 is a client-side timeout, not a response
- ConfigError — missing or contradictory credentials for a call

Tests
-----

    npm test              # unit (no network)
    npm run integration   # live smoke against a running platform; see scripts/integration.ts
