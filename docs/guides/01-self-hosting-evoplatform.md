# Self-hosting EvoPlatform

Running EvoPlatform on your own server, from a bare machine to a working
login page on your own domain.

You do not need to have used EvoPlatform before. Every step says what to run,
what you should see, and how to tell it worked.

---

## What you are installing

EvoPlatform is the **shared login and account layer** for your applications.
It owns:

- **Tenants** — separate workspaces, one per customer or department, whose
  data never mixes
- **Users, passwords, and passkeys** — one sign-in that works across every app
  you connect
- **Roles** — who is allowed to do what, defined per app
- **Email** — outbound mail, with per-tenant SMTP settings
- **An audit trail** — who did what, when
- **Billing** (optional) — Stripe subscriptions per tenant

It is one service, backed by one PostgreSQL database. Your applications talk
to it over HTTPS and verify the tokens it issues.

**It does not include an AI assistant.** That is a separate service called
evo-ai — see [Adding Ask AI](02-adding-ask-ai.md) once this guide is done.

---

## Before you start

| You need | Version | How to check |
|---|---|---|
| Node.js | 20 or newer (22 LTS recommended) | `node --version` |
| npm | ships with Node | `npm --version` |
| Docker + Docker Compose | any recent release | `docker --version` |
| git | any recent release | `git --version` |

Nothing is installed globally beyond those four.

**Hardware:** the platform service itself is small — 1 vCPU and 1 GB RAM is
enough for the service and its database at low volume. Give it more if you
expect many concurrent logins.

**Time:** about 20 minutes to run it locally. Add 30–45 minutes for a
production server, most of it waiting on DNS.

---

## Which path are you on?

Read one of these two, not both.

| | **Trying it out** | **Running it for real** |
|---|---|---|
| Where | Your laptop | A server with a public hostname |
| Database | Docker container | Docker container with a real password |
| Email | Fake inbox in the browser | Your real mail relay |
| Reachable by | You only | The internet, over HTTPS |
| Follow | [Part A](#part-a-run-it-locally) | [Part A](#part-a-run-it-locally), then [Part B](#part-b-put-it-on-a-server) |

Start with Part A even if production is your goal. Getting it working locally
first means that when something breaks on the server, you already know what
"working" looks like.

---

## Part A: Run it locally

### A1. Get the code

```bash
git clone https://github.com/kellymichels/EvoPlatform.git
```

```bash
cd EvoPlatform/platform
```

### A2. Create your configuration file

```bash
cp .env.example .env
```

Now generate a secret and put it in that file. This value encrypts stored SMTP
passwords, so it needs to be long and random.

Node is already a prerequisite, so this works the same on Windows, macOS, and
Linux:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Open `.env` in an editor and replace the `SECRET_KEY=change-me` line with the
value you just generated:

```env
SECRET_KEY=<paste the generated value here>
```

Leave everything else alone for now. The defaults point at the database and
test-mail containers you are about to start.

> **Keep this file private.** `.env` is excluded from git on purpose. Never
> commit it or paste its contents into a chat, ticket, or email.

### A3. Start the database

```bash
docker compose up -d
```

This starts two containers: PostgreSQL on port 5433, and Mailpit — a fake mail
server that catches outgoing email so you can read it in a browser instead of
sending it to real people.

**Check it worked:**

```bash
docker compose ps
```

Both containers should say `running`. If a port is already taken, see
[Troubleshooting](#troubleshooting).

### A4. Install and set up

```bash
npm install
```

```bash
npx prisma migrate deploy
```

That creates all the database tables. You should see a list of applied
migrations ending in something like `All migrations have been successfully
applied.`

```bash
npx prisma generate
```

### A5. Create the first accounts

```bash
npm run seed
```

This creates a **platform administrator** (`admin@example.com`), a sample
tenant called `acme` with a user in it, and a sample app registration.

> **The passwords are printed once and never shown again.** Copy them
> somewhere safe right now, before you run anything else. If you lose them,
> re-running the seed is the quickest fix.

If you would rather choose the passwords yourself, set `SEED_ADMIN_PASSWORD`
and `SEED_OWNER_PASSWORD` in `.env` *before* running the seed.

### A6. Start the service

```bash
npm run start:dev
```

Leave this running. Open **http://localhost:8200** in a browser — you should
see the admin console sign-in page. Sign in with `admin@example.com` and the
password the seed printed.

**How to tell it really worked**, beyond the page loading — in a second
terminal:

```bash
curl http://localhost:8200/.well-known/jwks.json
```

You should get back JSON containing a `keys` array. That is the platform's
public signing key, which is how your applications will verify that a login
token genuinely came from this server. If you get JSON with a key in it, the
service is up and its signing keypair generated correctly.

On first boot the service creates an RSA keypair in `platform/keys/`. That
folder matters — see [Backups](#backups-what-actually-matters).

### A7. Look around the admin console

Everything below can be done in the browser at `http://localhost:8200`:

- **Tenants** — create a workspace for each customer or department
- **Users** — create people inside a tenant, assign their roles
- **Apps** — register an application that will use this platform for login.
  Registering returns a **client secret shown only once** — store it before
  closing the dialog.
- **Audit** — every administrative action, with who and when
- **SMTP** — mail settings, platform-wide or per tenant

Test email lands in Mailpit at **http://localhost:8025** — nothing is sent to
real addresses while you are on the local setup.

Everything in the console is also available over the REST API if you prefer to
script it; see the endpoint table in
[`platform/README.md`](../../platform/README.md).

**At this point you have a working platform.** If you only wanted to evaluate
it, stop here. To connect an application to it, see
[the developer guide](../INSTALL.md). To put this on a real server, continue.

---

## Part B: Put it on a server

Everything up to "Go live" is safe and reversible. Going live means a public
URL, a DNS record, and a TLS certificate — real, outward-facing changes. Do
that part deliberately.

### B1. Choose the hostname first

Pick a subdomain now, before installing anything:

```
platform.yourcompany.com
```

**This decision is hard to undo.** The hostname becomes the issuer identity
stamped into every login token, and the basis for passkey registration.
Changing it later invalidates every token that has been issued and every
passkey that has been registered — every user has to sign in again and
re-register their passkey. Choose once.

### B2. Get the code onto the server

SSH to the server, then:

```bash
git clone https://github.com/kellymichels/EvoPlatform.git ~/stack/evoplatform
```

```bash
cd ~/stack/evoplatform/platform
```

```bash
cp .env.prod.example .env
```

Fill in `.env` with real values:

| Setting | What to put |
|---|---|
| `DB_PASSWORD` | A strong generated password, not one you invent |
| `SECRET_KEY` | Generate it the same way as in A2 — a *different* value from your laptop |
| `DATABASE_URL` | Must contain the same `DB_PASSWORD` you just set |
| `SMTP_*` | Your real mail relay — Mailpit is for local use only |
| `WEBAUTHN_BASE_DOMAINS` | Your base domain, e.g. `yourcompany.com` |

Leave the Stripe settings blank unless you are billing customers today; you can
add them later without downtime.

### B3. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

Watch it boot. It applies its database migrations automatically and generates
its signing keypair into a Docker volume. Press `Ctrl+C` to stop watching the
logs — that does not stop the service.

Create the administrator account:

```bash
docker compose -f docker-compose.prod.yml exec app npx tsx prisma/seed.ts
```

Save the printed credentials immediately.

The service is now listening on `127.0.0.1:8200` — reachable from the server
itself, but **not** from the internet. That is intentional.

**Check it worked:**

```bash
curl http://127.0.0.1:8200/.well-known/jwks.json
```

### B4. Put nginx in front of it

The platform speaks plain HTTP. nginx handles HTTPS and forwards requests to
it. Create a server block:

```nginx
server {
    server_name platform.yourcompany.com;
    location / {
        proxy_pass http://127.0.0.1:8200;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> **The three `proxy_set_header` lines are not optional.** The platform works
> out the passkey origin from the incoming request. If nginx does not pass the
> real hostname and protocol through, passkey sign-in fails with a confusing
> "unrecognized origin" error once you are behind HTTPS.

Then get a certificate:

```bash
sudo certbot --nginx -d platform.yourcompany.com
```

### B5. Go live

Add a DNS **A record** pointing `platform` at your server's IP address, in
whatever service manages your domain's DNS.

DNS takes anywhere from a minute to a few hours to propagate. Once it
resolves, open `https://platform.yourcompany.com` — you should get the admin
console over HTTPS, with a valid certificate, and be able to sign in with the
administrator account you created in B3.

---

## After it is running

### Backups: what actually matters

Two things, and one of them is easy to overlook.

**The database** holds your tenants, users, and audit history.

**The signing keys** are in the `evoplatform_keys` Docker volume. If you lose
them, every user is logged out permanently and every registered passkey stops
working. There is no recovery — the keys cannot be regenerated to match. Back
up this volume, and make sure your backups leave the server.

`platform/scripts/backup.sh` dumps both. Schedule it with cron and copy the
output somewhere off-box.

### Updating

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Database migrations run automatically when the service starts.

### Stopping and rolling back

```bash
docker compose -f docker-compose.prod.yml down
```

Stops the service. Your data survives.

> **Do not add `-v` to that command** unless you intend to erase everything.
> `down -v` deletes the data volumes — database *and* signing keys — with no
> confirmation prompt.

### Adding billing later

Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to `.env`, point a Stripe
webhook at `https://platform.yourcompany.com/billing/webhook` with the events
`customer.subscription.*`, `invoice.paid`, and `invoice.payment_failed`, then
re-run the `up -d` command to reload. Until those keys are set, the billing
endpoints deliberately return 503 rather than failing in some subtler way.

---

## Configuration reference

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8200` | Port the service listens on |
| `DATABASE_URL` | compose Postgres | Where the database is |
| `SECRET_KEY` | — **set this** | Encrypts stored SMTP passwords |
| `KEYS_DIR` | `./keys` | Where the signing keypair lives |
| `JWT_ISSUER` | `evoplatform` | Issuer name stamped into tokens |
| `ACCESS_TOKEN_TTL_SEC` | `900` | How long a login token lasts (15 min) |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | How long a session can be renewed |
| `RETENTION_AUDIT_DAYS` | `0` | Audit history to keep; `0` = forever |
| `RETENTION_TOKEN_DAYS` | `30` | Expired token records to keep |
| `SMTP_HOST` / `PORT` / `SECURE` / `USERNAME` / `PASSWORD` / `FROM` | Mailpit | Fallback mail settings |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | unset | Billing; endpoints 503 until set |
| `BILLING_GRACE_DAYS` | `7` | Grace period before an unpaid tenant is locked out |
| `WEBAUTHN_RP_NAME` | `EvoPlatform` | Name users see in the passkey prompt |
| `WEBAUTHN_BASE_DOMAINS` | empty | Domains passkeys may be used on |

**How email settings are chosen**, in order: the tenant's own SMTP config, then
the platform-wide config, then the `SMTP_*` values above. The first one that
exists wins.

---

## Troubleshooting

| Symptom | What is happening |
|---|---|
| `docker compose up -d` fails with a port conflict | Something already uses 5433, 1025, or 8025. Stop it, or change the port in `docker-compose.yml` |
| `npx prisma migrate dev` complains it is "interactive" | Use `npx prisma migrate deploy` instead — that is the non-interactive command for applying existing migrations |
| Windows: `EPERM ... query_engine-windows.dll.node` | The running service has the file locked. Stop it, run `npx prisma generate`, start it again |
| `POST /email/send` returns 503 | No mail settings anywhere. Locally, start Mailpit with `docker compose up -d mail`; in production, fill in `SMTP_*` |
| `POST /billing/*` returns 503 | Billing is not configured. Expected until you add the Stripe keys |
| Passkey rejected: "Unrecognized origin" | The site's address is not loopback and does not match `WEBAUTHN_BASE_DOMAINS`, or nginx is not forwarding `X-Forwarded-Proto` |
| Everyone logged out after a restart | The signing keypair changed. Restore the `evoplatform_keys` volume from backup, or accept that everyone signs in again |
| Apps cannot verify tokens after a key rotation | Normal and self-correcting — apps refetch the signing keys automatically when they see an unfamiliar key |

---

## Next

- **[Adding Ask AI](02-adding-ask-ai.md)** — the AI assistant, on your server
  or fully offline
- **[Developer guide](../INSTALL.md)** — scaffolding an app with `evo new`,
  connecting an existing app, and the SDK
