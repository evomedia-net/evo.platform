# Security Policy

EvoPlatform handles authentication, session issuance, tenant isolation, and
password storage. A flaw in any of those affects every application built on
it, so security reports are welcome and taken seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/kellymichels/EvoPlatform/security/advisories/new)
(Security → Report a vulnerability). That creates a private advisory only
you and the maintainer can see.

Useful things to include, as far as you have them:

- What the issue lets an attacker do, and what access they'd need first
- Steps to reproduce, or a proof of concept
- Affected version or commit
- Any suggested fix

## What to expect

This is a small project maintained by one person, so this is a statement of
intent rather than a service-level guarantee:

- **Acknowledgement** as soon as the report is seen.
- **An assessment** — whether it reproduces, and how it's rated — once
  investigated.
- **Credit** in the advisory and release notes, unless you'd rather not be
  named.

Please give a reasonable window to ship a fix before disclosing publicly.

## Supported versions

EvoPlatform is pre-1.0. Only the current `main` branch is supported —
fixes land there, and there are no backports to earlier tags.

## Scope

**In scope** — anything in this repository: the platform service, the Node
SDK, the `evo` CLI, and the starter templates. Particularly:

- Authentication and token handling (JWT/JWKS signing, verification, refresh,
  passkeys)
- Cross-tenant data access, or any bypass of per-app access enablement
- Privilege escalation between roles (member → tenant admin → platform admin)
- Password storage and reset/invite/verification token flows
- Injection, SSRF, or anything exposing the admin console to unauthenticated
  callers

**Out of scope** — deployments (the operator's own servers, DNS, or TLS
configuration), third-party dependency vulnerabilities with no exploitable
path through this code, and findings from automated scanners with no
demonstrated impact.

## Deploying safely

Two operator responsibilities the code cannot enforce, both covered in
[docs/INSTALL.md](docs/INSTALL.md) and [docs/DEPLOY.md](docs/DEPLOY.md):

- **Change the bootstrap admin credentials.** The first-boot admin is created
  from environment variables. Leaving the example values in place leaves a
  known account on a public host.
- **Keep signing keys outside the deploy tree**, and back them up separately.
  Losing them invalidates every issued token; leaking them lets anyone mint
  valid ones.
