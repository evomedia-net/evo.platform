evoplatform-sdk (Python)
========================

Python SDK for EvoPlatform, mirrored method-for-method with
@evoplatform/sdk-node (../sdk-node). Verifies platform-issued JWTs
locally (cached JWKS — no per-request platform call), proxies auth, and
exposes the client-credential services (billing, email, events) plus the
Ask AI client for evo-ai.

Synchronous by design: the first consumer is SmartPlant EHS, whose service
code runs sync (NiceGUI hands blocking work to run.io_bound).

Setup
-----

    from evoplatform_sdk import EvoPlatform

    platform = EvoPlatform(
        os.environ["PLATFORM_URL"],            # e.g. https://platform.example.com
        client_id=os.environ["EVO_CLIENT_ID"],         # from the platform admin
        client_secret=os.environ["EVO_CLIENT_SECRET"], # server-side only
    )

Verifying requests
------------------

    claims = platform.verify_token(bearer_token)
    # claims["tenant_id"], claims["tenant_slug"], claims["roles"], claims["platform_admin"]

The JWKS is fetched once and cached (default 10 min). An unknown kid
triggers a re-fetch, so platform key rotation needs no app redeploys.

When the client is configured with a client_id, a token minted for a
different app is rejected — pass audience=False to opt out for the rare
case of deliberately inspecting foreign tokens.

Auth proxy (apps that render their own login form)
--------------------------------------------------

    session = platform.login(tenant_slug=slug, email=email, password=password)
    # -> {"accessToken", "refreshToken", "expiresIn", "user"} — store httpOnly
    nxt = platform.refresh(session["refreshToken"])  # rotates
    platform.logout(nxt["refreshToken"])

Email verification, password reset, passkeys (WebAuthn), tenant member and
invite management all mirror sdk-node — same endpoints, snake_case
parameters, camelCase on the wire.

Billing (client credentials)
----------------------------

    prices = platform.list_prices()
    # [{"stripeProductId", "stripePriceId", "productName", "tier", "unitAmount",
    #   "currency", "interval", "intervalCount", "trialDays"}] - cheapest first.

    ent = platform.get_entitlement(tenant_id=tenant_id)
    # {"enabled", "status", "plan", "trialEndsAt", "graceUntil", "daysLeft"}
    # enabled mirrors the login gate; daysLeft counts down a trial or grace window.
    # A cheap DB read (no Stripe round-trip) — fine to call per page load, and it
    # answers even before Stripe is configured.

    out = platform.create_checkout(
        tenant_id=tenant_id,
        tier="pro",          # or interval="year"; or price_id= from list_prices()
        success_url=f"{app_url}/billing/success",
        cancel_url=f"{app_url}/billing",
    )
    # out["url"] -> redirect the browser to Stripe Checkout

    portal = platform.create_billing_portal(tenant_id=tenant_id, return_url=app_url)

The platform's Stripe webhook then drives the tenant's access to the app
(paid -> active, failed -> grace -> suspended).

Billing calls are scoped: the tenant must already have the calling app
enabled, and every redirect URL (success_url, cancel_url, return_url)
must share an origin with one of the app's registered callback URLs.

An app sells any number of tiers, each with its own billing period - name the
one you want by tier (+ interval, default monthly) rather than a Stripe id, so
repricing is a console edit instead of a redeploy. A tier billed once is a
one-time purchase: permanent access, with no renewal or grace lifecycle.

Ask AI (evo-ai)
---------------

evo-ai is a separate service with its own URL and credentials, so AskAi is
a sibling of EvoPlatform, not a method on it:

    from evoplatform_sdk import AskAi

    ai = AskAi(os.environ["EVOAI_URL"], service_key=os.environ["EVOAI_SERVICE_KEY"])
    out = ai.ask(
        "which permits expire this quarter?",
        tenant_id=tenant_id,          # the service key names the app; this names the customer
        source_types=["permit"],
    )
    out.answer, out.sources
    out.gated         # declined as unrelated to the indexed data — not an error
    out.unconfigured  # no usable model for this tenant — an administrator problem

In platform mode, pass access_token= instead of tenant_id= and the tenant
comes from the token's verified claims.

Errors
------

- PlatformError(status, message, body) — non-2xx from a service. Status 0
  means unreachable; 504 is a client-side timeout.
- TokenError — the credential failed local verification.
- ConfigError — the calling code is wrong (missing credentials, both auth
  modes at once); raised before any network call.

Tests
-----

    pip install -e .[dev]
    pytest

Token tests sign real RS256 JWTs against a generated key and serve a real
JWKS through a mock transport — no verification step is stubbed.
