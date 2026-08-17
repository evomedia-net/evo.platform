# Renaming a product

Three products have been renamed in two weeks — SmartPlant EHS → evo.ehs,
then SWAG Estimates → ProvenSheet, plus the prefix drop on DocketMail and
CivilCode. Each was forced or shaped by something learned during the previous
one. This is what to do, in order, and the traps that actually bit.

Written for the fleet. The evo.ehs-specific inventory lives in that repo at
`md/rebrand_inventory.md`; this covers the parts every product shares.

---

## What the platform now does for you

Since [#103](https://github.com/evomedia-net/evo.platform/issues/103) the
platform names the product itself. **`App.displayName`**, set once in the
console under Apps, decides:

- the subject line of every platform email ("Reset your ProvenSheet password")
- the sender name (`ProvenSheet <noreply@evomedia.net>`)
- the product name on the platform-hosted reset and verification pages
- where those pages send a user afterwards — the app's first registered
  callback URL, not the operator console

**No deploy.** Setting that one field renamed ProvenSheet's entire email and
recovery surface in about ten seconds. Do it first: it is the cheapest,
highest-visibility part of a rename.

Everything else below is work the platform cannot do for you.

---

## What must never be renamed

Getting this wrong is worse than not renaming at all, because the damage is
silent.

**Storage identifiers.** Browser databases and storage keys are how a client
finds work already on disk. ProvenSheet keeps `SWAGOfflineDB`,
`SWAG_{tenantId}` and `swag_user_settings` under the old name deliberately —
renaming them would orphan every offline user's cached estimates behind a name
nothing reads. No error, no warning, just missing work.

**Domain vocabulary.** "SWAG" is also an estimating term: ProvenSheet still
computes a *SWAG Number* and a *Total SWAG*. That is what the product does,
not what the company is called, and it survives the rename. Separate the two
before touching anything — a find-and-replace cannot.

**Tenant slugs.** They appear in live URLs and customer bookmarks. A slug is
an identifier, not branding.

**Repo names and container names.** `evo.*` repos and `<product>_<role>`
containers are an internal namespace. They can be renamed, but that is
infrastructure work with its own cutover, not part of a branding change.

---

## Order of operations

Ordering matters: several steps gate the ones after them, and two of these
were discovered by doing them in the wrong order.

1. **Certificate** for the new domain, with both apex and wildcard SANs, DNS
   validation. Route 53 zones cannot be renamed, and ACM validation records
   are domain-bound — plan for new records rather than edits.

2. **DNS**: apex, `www`, wildcard.

3. **nginx**: the new vhost, plus an explicit `server_name` block for `docs.`
   — otherwise it matches the tenant wildcard and the app reads "docs" as a
   workspace slug. Point the old host at **410, not 503**: 410 asks search
   engines to drop the pages, which is the point of a rename.

4. **Mail**: MX pointing at the host the TLS certificate actually names — an
   MX at `mail.<newdomain>` gives every sender a certificate mismatch. Then
   SPF, DKIM, DMARC. Postfix aliases go in **before** the `@domain` catch-all,
   or the catch-all swallows them; and an alias *shadows a mailbox of the same
   name*, so remove it before creating the real account or SMTP AUTH breaks.

5. **`WEBAUTHN_BASE_DOMAINS`** must include the new domain before anyone tries
   a passkey on it. Absent, `deriveRpContext()` returns null for every
   non-loopback origin and the ceremony fails with "Unrecognized origin" — the
   fleet ran that way for weeks without noticing, because loopback still works
   in development.

6. **`App.displayName`** in the console, and the new domain added to the app's
   **callback URLs**. Order matters here too: the *first* http callback URL is
   where a completed password reset sends the user, so put the primary domain
   first.

7. **App code**: the product name in the UI. Extract it rather than
   find-and-replace — one constant or one component, so the next rename is a
   line. ProvenSheet uses `src/lib/product.ts`; DocketMail and CivilCode each
   have a `Wordmark` component.

8. **Deploy, then verify on the running container** — not on the deploy
   script's exit code. Fetch the real page and read the title. A green deploy
   of correct code served the old name for days once, because the migration
   had not run with the image.

9. **Docs content and screenshots**, which carry the wordmark in pixels no
   config can reach.

---

## Traps that cost real time

**A passkey does not survive a domain change.** `rpId` is the *base* domain, so
a credential registered on `swag.evomedia.net` has `rpId=evomedia.net` while
one registered on `provensheet.com` has `rpId=provensheet.com`. WebAuthn scopes
credentials to the rpId: **every user must re-register their passkey on the new
domain.** Nothing to fix — but tell people, and move them to the new domain
sooner rather than later.

**A two-tone wordmark cannot be expressed as one string.** "evo.docketmail"
rendered the prefix in an accent colour. Dropping the prefix means deciding
where the accent goes rather than flattening it — **Docket**Mail, **Civil**Code.
A `wordmark: { lead, accent }` config field exists for this reason.

**Vendored SDK tarballs pin by version *and* integrity hash.** Replacing the
file without bumping the version makes `npm install` report *"up to date"*
while serving the cached old copy — the new methods are simply absent at build
time, and the error appears somewhere unrelated. Bump the version.

**Stripe product names are free to change**; price ids are not, and do not
need to. Rename the products in the dashboard; nothing in the platform
references their names.

**The email and the app must agree.** Setting `displayName` renames the mail
immediately, so an app whose UI still shows the old name now contradicts the
message that sent the user there. Do step 6 and step 7 in the same session.

---

## What a config layer should and should not cover

[#91](https://github.com/evomedia-net/evo.platform/issues/91) proposes serving
brand config from the platform. Worth splitting by where it renders:

**Platform-served is right for** anything the *platform* emits — email subject
lines, sender names, its own hosted pages. That already works, via
`App.displayName`, and extending it (tagline, support address, legal line)
costs little.

**Platform-served is wrong for the app's own chrome.** A login page wordmark
fetched at runtime means a network round trip before the most critical page
can render, a flash of unbranded UI, and nothing at all in standalone mode
where there is no platform. Each app already keeps its name in exactly one
place; the marginal gain does not pay for a runtime dependency on the login
screen.

The honest measure: renaming three apps' UI cost about twenty minutes each,
*after* each had been reduced to one constant. The expensive parts of a rename
are in the ordered list above, and a config file does not touch any of them.
