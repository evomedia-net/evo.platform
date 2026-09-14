# System flows

Three sequence diagrams showing how requests move through EvoPlatform. They
reflect the code as shipped, not an aspiration.

**Reading the arrows** — time runs top to bottom, and every arrow points the
way the call travels: the tail is always the initiator.

| Mark | Meaning |
| --- | --- |
| Solid arrow | A request, pointing from the initiator to the receiver. Whoever is at the tail made the call. |
| Dashed arrow | A response, returning to whoever asked. Responses never initiate anything. |
| Amber arrow | An out-of-band push — a verification email, a Stripe webhook. It arrives on its own schedule, not as a reply to the flow above it. |
| Blue arrow / box | The mechanism the figure exists to show. |

---

## 1 · User sign-up, end to end

Self-service signup arrives through an app (ProvenSheet, EvoCivilCode, …), never at
the platform directly. One request creates the workspace, its founding admin,
and trial access to exactly the app the person arrived through — and nobody
can sign in until the mailbox is proven.

![Sign-up sequence diagram](img/flows/flow-1-signup.svg)

1. The person fills the app's signup form. The app's server — never the
   browser — talks to the platform.
2. One call: `POST /auth/signup`, carrying the app's `clientId`. Gated by
   `SIGNUP_MODE` (closed by default); the password is checked against the
   NIST/OWASP policy here, at set time.
3. The platform creates the workspace, the founding user as tenant admin, and
   a 14-day `TRIAL` access row for the arriving app only — other apps stay
   denied by default.
4. A single-use verification link is mailed. SMTP resolves tenant config →
   platform default → environment fallback.
5. Until the link is clicked, any login attempt is refused with *Email not
   verified*.
6. Clicking the link is a new inbound request from the person — direction
   reverses; nothing was pushed to their browser.
7. The mailbox is proven; sign-in proceeds exactly as in Flow 2.

**Direction rules:** every solid arrow is user- or app-initiated, left to
right toward the platform. The platform initiates exactly one thing — the
email — and it never calls the app or the browser.

---

## 2 · A tenant site through the system

The everyday path: browser → edge → app, with login delegated to the platform
and everything after verified locally. The blue steps are the design's point —
after login, the app does not need the platform to be up.

![Tenant site sequence diagram](img/flows/flow-2-tenant-site.svg)

1. TLS terminates at the edge proxy; apps are never exposed on public ports.
2. The edge reaches the app by container name over the internal `web` network.
3. The app delegates credentials to the platform — it stores no passwords of
   its own in platform mode.
4. Four gates in order: workspace status, credentials, verified mailbox, and
   per-app enablement (`TRIAL` until its date, `ACTIVE`, or `PAST_DUE` within
   grace). No enablement row = refused.
5. Short-lived access token (RS256, 15 minutes) plus rotating refresh token
   return to the app.
6. **Pull, not push:** the app fetches the platform's public keys once and
   caches them. The platform never calls into an app.
7. Every later request is verified by signature locally; local tenant/user
   rows are provisioned just-in-time from the verified claims.
8. Business data lives in the app's own database, always tenant-scoped — the
   platform holds identity and billing, never app data.
9. Stripe events arrive at the platform on their own schedule and flip the
   enablement row; the change bites at the next login or token refresh, not
   mid-request.

**Direction rules:** the browser initiates everything on the left; the app
initiates toward the platform and its own DB; the only arrows pointing *into*
the platform uninvited are Stripe's webhooks — and nothing, ever, calls into
the browser.

---

## 3 · A tenant app asking evo-ai

Ask AI, as CivilCode runs it: the app's server proxies the
question with a service key, retrieval is strictly tenant-scoped, and the
relevance gate can refuse before any model is paid for.

*evo-ai is a separate, commercial service — this diagram documents how an app
built on EvoPlatform consumes it through the SDK's `AskAi` client, which is
optional.*

![Ask AI sequence diagram](img/flows/flow-3-ask-ai.svg)

1. The tenant is taken from the signed-in session — a caller can't name
   someone else's workspace.
2. The app's server holds one `svc_` key and asserts the tenant per request
   via `X-Data-Tenant`. Platform-mode apps may instead pass the user's JWT
   through — evo-ai then reads the tenant from verified claims, using the
   platform keys it pulls itself.
3. A question routed to analytics SQL must reference the tenant's own views —
   a SELECT touching none is not a records question and drops to the vector
   path, where the gate decides.
4. Lay phrasing is expanded to the corpus's own vocabulary before searching;
   the model never sees the rewrite — retrieval only.
5. Hybrid dense+BM25 search inside the tenant's own collection, filtered by
   `tenant_id` and `source_type` — isolation by construction.
6. The relevance gate refuses off-topic questions *before* any model is
   invoked: a refusal costs nothing and can't hallucinate.
7. The model answers only from the supplied context, billed to the tenant's
   own key when one is configured (fail-closed otherwise).
8. The answer travels back with its cited sources and explicit
   `gated`/`unconfigured` flags, so the app renders refusals as designed
   states, not errors.

**Direction rules:** initiation flows strictly left to right — browser → app →
evo-ai → stores/model — and only responses come back. evo-ai never calls the
app; the app never exposes the key; the browser never talks to evo-ai at all.
