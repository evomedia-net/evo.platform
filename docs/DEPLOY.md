# Deploying the EvoPlatform service

Deploys the platform service as a Docker Compose stack behind an nginx reverse
proxy that terminates TLS — the same pattern the other services on the host use.
The app never faces the internet directly; nginx does.

> First deploy is a real, outward-facing step (a public URL, DNS, a TLS cert).
> Do it deliberately. Everything before "Go live" is safe and reversible.

## 0. Decide the hostname

Pick a subdomain, e.g. `platform.example.com` (or `auth.example.com`). It becomes
the JWT issuer origin and the WebAuthn RP base — changing it later invalidates
issued tokens and passkeys, so choose once.

## 1. Get the code onto the host

```bash
# on the host, in your stack dir (e.g. ~/stack/evoplatform)
git clone <repo> .            # or copy platform/ over
cd platform
cp .env.prod.example .env
```

Fill in `.env` with real values — strong `DB_PASSWORD`, `SECRET_KEY`
(`openssl rand -base64 32`), the matching `DATABASE_URL`, real `SMTP_*`, and
`WEBAUTHN_BASE_DOMAINS=<your base domain>`. Leave Stripe blank until you have keys.

## 2. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app   # watch it boot + migrate
```

On first boot the app runs `prisma migrate deploy` and generates its RSA signing
keypair into the `evoplatform_keys` volume. Then seed a platform admin:

```bash
docker compose -f docker-compose.prod.yml exec app npx tsx prisma/seed.ts
# or create one via the API; either way, capture the printed credentials.
```

The app now listens on `127.0.0.1:8200` — not publicly reachable yet.

## 3. nginx + TLS

Point a server block at the app and let certbot issue the cert:

```nginx
server {
    server_name platform.example.com;
    location / {
        proxy_pass http://127.0.0.1:8200;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`X-Forwarded-*` matter: the platform derives the WebAuthn origin from the request,
so nginx must forward the real host/proto or passkey ceremonies fail behind TLS.

```bash
sudo certbot --nginx -d platform.example.com
```

## 4. Go live

Add the DNS A record (`platform` → the host IP) in your DNS provider. Once it
resolves, browse to `https://platform.example.com` — the admin console loads and
you can sign in with the seeded admin.

## 5. After go-live

- **Stripe**: add `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` to `.env`, point a
  Stripe webhook at `https://platform.example.com/billing/webhook`
  (events: `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`),
  then `docker compose -f docker-compose.prod.yml up -d` to reload.
- **Backups**: schedule `scripts/backup.sh` (cron) — it dumps the DB and the
  signing keys. Ship the output off-box. The keys especially: losing the
  `evoplatform_keys` volume logs every user out permanently.
- **Updating**: `git pull && docker compose -f docker-compose.prod.yml up -d --build`
  (migrations run automatically on start).

## Rollback

`docker compose -f docker-compose.prod.yml down` stops it (volumes/data survive).
`down -v` also drops the data volumes — only for a clean teardown.
