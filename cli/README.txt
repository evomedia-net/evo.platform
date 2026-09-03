evo CLI
=======

Scaffold a new EvoPlatform app from a template.
    evo new <app-name> [--stack next] [--dir <parent>] [--port 4180] [--db-port 5446]

What it does:

1. Copies templates/<stack> (skipping node_modules, build output, .env)
2. Rewrites every identity: package name, UI titles, session-cookie name, Dexie
   database prefix, sync lock names, Docker container/volume/user/db names, ports
3. Vendors the SDK as a packed tarball (vendor/*.tgz) — Turbopack can't resolve
   file: symlinks outside the project root
4. Generates .env with a fresh AUTH_SECRET and matching DATABASE_URL
5. Prints the run checklist and the platform-registration steps

The generated app starts in standalone mode (own login, own Postgres, works
offline). Flipping it onto the platform later is env-only — see the checklist.

Stacks: next.

Dev
---
    npm install && npm run build   # dist/cli.js
    node dist/cli.js new demo-app --dir ../../..
    npm test
