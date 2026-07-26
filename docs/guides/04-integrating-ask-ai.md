# Integrating Ask AI into your app

Putting the assistant inside your own product, instead of sending people to
evo-ai's built-in chat page.

Assumes Ask AI is installed ([guide 2](02-adding-ask-ai.md)) and has data in it
([guide 3](03-connecting-your-data.md)).

---

## Do you need to integrate at all?

evo-ai ships a working chat page at `/ui` — questions, answers, and the sources
behind each one. If that is enough, put it behind your reverse proxy and stop
here.

Integrate when you want the assistant **where the work happens**: a panel
inside your app, answers that link to your records, questions scoped to what
the signed-in user is allowed to see.

---

## One endpoint

Everything below is the same call:

```
POST /query
```

```json
{
  "question": "which permits expire this quarter?",
  "history": [],
  "source_types": null,
  "collection": "default"
}
```

And the response:

```json
{
  "answer": "Three permits expire this quarter: ...",
  "question": "which permits expire this quarter?",
  "sources": [ { "text": "...", "score": 0.81, "metadata": {} } ],
  "gated": false,
  "unconfigured": false
}
```

Four fields deserve attention:

- **`sources`** — the records behind the answer. Show these. An assistant that
  cites its work gets trusted and corrected; one that does not gets believed
  when it should not be.
- **`question`** — the question actually run. With follow-ups, evo-ai rewrites
  *"how many?"* into a standalone question using the history you sent. Useful
  for logs and for showing users what was understood.
- **`gated`** — the question was refused as unrelated to the indexed data,
  before any AI call. Render your own wording rather than the generic text.
- **`unconfigured`** — no usable AI model for this tenant. An administrator
  problem, not a user one; say so differently.

**There is no SDK method for this yet.** The EvoPlatform SDK covers tenants,
users, and tokens, not evo-ai — so this is a plain HTTP call today. Tracked in
[EvoPlatform#20](https://github.com/kellymichels/EvoPlatform/issues/20).

---

## Pick your pattern

| | **A. Embed the chat page** | **B. Your server relays** | **C. Browser calls directly** |
|---|---|---|---|
| Work involved | Minutes | A few hours | An hour |
| Your app needs | Nothing | A server | To be in platform mode |
| Credential | None | One service key, server-side | The user's own login token |
| Who decides what data is visible | evo-ai | **Your app** | The token |
| Works with your own login system | Yes | **Yes** | No |
| Answers can link to your records | No | **Yes** | Limited |

**Choose B if your app has its own login.** It is what SmartPlantEHS does, and
the only pattern that lets your app filter what the assistant may draw on.

**Choose C if your app is already in platform mode** and you want the shortest
path to a working panel.

---

## Pattern A: Embed the chat page

```html
<iframe src="https://ai.yourcompany.com/ui" style="width:100%;height:600px;border:0"></iframe>
```

Set `CORS_ORIGINS` in evo-ai's `.env` to your app's address, and put evo-ai
behind TLS. Fastest way to have something working; the page cannot know
anything about the user viewing it.

---

## Pattern B: Your server relays the question

Your application server holds one credential and calls evo-ai on the user's
behalf. The browser never sees it.

```
Browser  ──►  Your server  ──►  evo-ai
             (holds the key,
              decides the scope)
```

### 1. Mint a service key

Once, from evo-ai. Not per customer:

```bash
curl -X POST http://localhost:8000/admin/service-keys \
  -H "Authorization: Bearer <platform admin token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app"}'
```

> **The key is shown once and stored only as a hash.** Save it into your
> application's secrets now. Losing it means minting a new one.

### 2. Call evo-ai from your server

Two headers do the work: the key authenticates *your application*, and
`X-Data-Tenant` states *which customer* this question is for.

```python
import httpx

def ask(tenant_id: str, question: str, history=None, source_types=None):
    response = httpx.post(
        f"{EVOAI_URL}/query",
        headers={
            "Authorization": f"Bearer {EVOAI_SERVICE_KEY}",
            "X-Data-Tenant": str(tenant_id),
        },
        json={
            "question": question,
            "history": history or [],
            "source_types": source_types,
        },
        timeout=120.0,
    )
    response.raise_for_status()
    return response.json()
```

> **Always pass the signed-in user's own tenant.** evo-ai trusts this header
> completely — it is the mechanism by which your server, which already knows
> who is logged in, tells evo-ai which data to search. Deriving it from
> anything the browser sent would let a user read another customer's records.

### 3. Three details that are not obvious

**Use a long timeout.** 120 seconds. A language model composing an answer over
retrieved records is not a fast API call, and a 30-second default will cut off
answers that were about to succeed.

**Return errors, do not raise them.** A failed question should render in the
chat as a message the user can retry, not a stack trace or a blank panel.
SmartPlantEHS returns a result object carrying either an answer or an error
string.

**Log the real cause, show a vague message.** The user gets *"Ask AI is
unreachable right now"*; your logs get the exception type, the tenant, and the
HTTP body. Without that split, a production failure is invisible — you will
have unhappy users and nothing to debug from.

### 4. Restrict what the assistant can draw on

`source_types` limits which categories of data are searched. Pass the ones the
signed-in user is allowed to see:

```python
allowed = ["permit", "incident"]          # from your own permission checks
if user.can_see_people:
    allowed.append("user")

result = ask(tenant.id, question, source_types=allowed)
```

Questions needing excluded data are declined. This is how the assistant
inherits your existing permission model instead of quietly bypassing it — a
read-only user should not learn things through the chat panel that the rest of
your app would not show them.

### Worked example

[`smartplantpermits/services/evoai.py`](https://github.com/kellymichels/smartplantehs/blob/main/smartplantpermits/services/evoai.py)
is this pattern in production: the result object, the error split, the
`source_types` filtering, and a `gated` flag so the product renders its own
refusal wording.

---

## Pattern C: The browser calls evo-ai directly

If your app is in platform mode, the user's login token already carries their
tenant. Send it straight to evo-ai — no service key, no relay.

```javascript
const response = await fetch(`${EVOAI_URL}/query`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ question, history }),
});
const { answer, sources, gated } = await response.json();
```

evo-ai verifies the token against your platform's public keys and reads the
tenant from the verified claims. A user cannot ask about another customer's
data because the tenant is not theirs to state.

Requirements:

- Your app is in platform mode
- evo-ai's `EVOPLATFORM_JWKS_URL` points at your platform
- `CORS_ORIGINS` lists your app's address
- evo-ai is reachable from the browser, over TLS

**The trade-off:** your server is not in the loop, so it cannot narrow
`source_types` per user. Every user of a tenant can reach everything indexed
for that tenant. Fine when they all have the same access; use pattern B when
they do not.

---

## Multi-turn conversations

Send the previous exchanges and follow-ups work:

```json
{
  "question": "how many?",
  "history": [
    { "role": "user", "content": "which permits expire this quarter?" },
    { "role": "assistant", "content": "Three permits expire..." }
  ]
}
```

evo-ai rewrites the follow-up into a standalone question before searching —
`"how many?"` becomes something closer to *"how many permits expire this
quarter?"*. The rewritten form comes back in `question`.

Keep history to recent turns. Every message is processed on each call, so an
unbounded transcript costs latency and, on a cloud model, money.

---

## Before you ship

- **Show the sources.** The single highest-value thing in the response.
- **Handle `gated` separately from an error.** A refusal is the product working
  correctly; showing it as a failure teaches people to distrust it.
- **Handle `unconfigured` separately too.** It means an administrator has not
  finished setup — point them at the admin, not at "try again."
- **Put a permission check on the panel.** Access to the assistant should be a
  deliberate grant, not implied by having a login.
- **Never put the service key in the browser.** It can assert any tenant. In
  pattern B it stays server-side; if it can reach client JavaScript, the
  pattern is broken.
- **Test the empty case.** Ask something outside your data and confirm the
  refusal renders sensibly.

---

## Troubleshooting

| Symptom | What is happening |
|---|---|
| `400 Service calls must set X-Data-Tenant` | Service key used without the tenant header. It authenticates the app, not the customer |
| `401 Unknown service key` | Wrong, revoked, or truncated key — the full value starts `svc_` |
| Every question refused, data is definitely indexed | Wrong tenant in `X-Data-Tenant`. You are searching an empty tenant's index |
| Browser blocked by CORS | Add your app's address to `CORS_ORIGINS` and restart evo-ai |
| Requests time out around 30s | Client timeout too low; use 120s |
| Answers ignore recent changes | The source has not re-synced — see [guide 3](03-connecting-your-data.md) |
| `unconfigured: true` | No usable model for that tenant — an API key is missing |

---

## Next

- **[Air-gapped installation](05-air-gapped-install.md)** — running with no
  internet connection
