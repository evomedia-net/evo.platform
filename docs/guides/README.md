# Guides

Running EvoPlatform on your own infrastructure. Written for someone who has not
used it before — every step says what to run, what you should see, and how to
tell it worked.

| Guide | What you get |
|---|---|
| **[Self-hosting EvoPlatform](01-self-hosting-evoplatform.md)** | Login, tenants, users, and roles on your own server, from a laptop trial through to production with TLS |

## What EvoPlatform is

The shared login and account layer for your applications: tenants whose data
never mixes, users with passwords and passkeys, per-app roles, outbound email,
an audit trail, and optional Stripe billing. One service, one PostgreSQL
database. Your apps verify the tokens it issues.

**It does not include an AI assistant.** That is evo-ai, a separate commercial
product with its own documentation. It can authenticate against an EvoPlatform
deployment, but neither one requires the other.

## Related documentation

- **[Developer guide](../INSTALL.md)** — building an app on the platform:
  `evo new`, platform mode, and the SDK
- **[Architecture](../ARCHITECTURE.md)** — how the pieces fit together
- **[Template contract](../TEMPLATE_CONTRACT.md)** — what a conforming app
  template must provide
