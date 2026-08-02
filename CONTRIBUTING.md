# Contributing

Thanks for taking a look. This is a small, actively-developed project, so
the process here is deliberately light.

Security problems are the exception: **don't** open a public issue for those
— see [SECURITY.md](SECURITY.md).

## Getting it running

Full setup is in [docs/INSTALL.md](docs/INSTALL.md). The short version:

```bash
cd platform
cp .env.example .env          # generate the secrets it names
docker compose up -d          # PostgreSQL + a dev mail sink
npm install
npx prisma migrate deploy
npm run start:dev
```

The admin console is then at `http://localhost:8200`, and the first admin is
created from the bootstrap variables in your `.env`.

## Running the tests

CI runs the same three suites, so run them before opening a pull request:

```bash
cd platform         && npm test    # service: unit + integration
cd packages/sdk-node && npm test   # SDK
cd cli              && npm test    # scaffolding CLI
```

`npx tsc --noEmit` should also be clean in each.

## Pull requests

- **One logical change per branch.** Small and focused beats large and
  sweeping — it reviews faster and reverts cleanly.
- **Branch names:** `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/`
  followed by a short kebab description.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) —
  `type(scope): summary`, imperative mood, lowercase, no trailing period.
- **Say what changed and why** in the description, plus how you tested it.
  If it's user-facing, note that too.
- **Tests come with the change.** Bug fixes should include a test that fails
  without the fix.
- **Match the surrounding code.** No reformatting unrelated lines; keep
  comment density and naming consistent with the file you're in.

## Reporting bugs

Open an issue with what you did, what happened, and what you expected —
plus the version or commit. A reproduction beats a description.

## A note on scope

EvoPlatform deliberately does **not** try to be everything. It owns tenancy,
authentication, roles, billing, email, and admin tooling; application
concerns belong in the app. Proposals that pull app-specific logic into the
platform are likely to be declined, so it's worth opening an issue to
discuss anything large before building it.
