// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Prisma 7 requires the datasource URL to live in this config file rather than
// in schema.prisma.
//
// Deliberately NO imports here (pattern proven in SWAG-Estimates and
// EvoCivilCode):
//   - `dotenv` — the Prisma CLI auto-loads `.env` from the project root, and
//     dotenv is tree-shaken out of Next.js standalone builds.
//   - `prisma/config` (defineConfig) — purely a type helper; the runtime value
//     is a plain object, and the `prisma` package is also tree-shaken out of
//     standalone builds, so importing from it would crash a production
//     `prisma migrate deploy` run inside a container.

const config = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
};

export default config;
