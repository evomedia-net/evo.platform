// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Prisma 7 requires the datasource URL to live in this config file rather than
// in schema.prisma. The seed command also moves here — Prisma 7 dropped
// support for the old `package.json#prisma` block.
//
// Deliberately NO imports, matching the pattern proven in ProvenSheet and
// EvoCivilCode: the Prisma CLI auto-loads `.env` from the project root before
// evaluating this file, and `prisma/config`'s defineConfig is a type helper
// whose runtime value is a plain object. Keeping this file dependency-free
// means it behaves identically in dev, in CI, and inside the container.

const config = {
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
};

export default config;
