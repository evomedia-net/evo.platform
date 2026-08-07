# Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

FROM node:22-alpine AS build
WORKDIR /app
# Schema + config are copied before npm ci because the postinstall hook runs
# prisma generate, which needs them. The explicit generate below still matters:
# a cached npm-ci layer can hold a stale client when only the schema changed.
COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# Prisma 7 reads the datasource URL and migrations path from this file; the
# `migrate deploy` in CMD crash-loops without it.
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY package*.json ./
# Apply schema migrations before serving, in the IMAGE rather than in a
# compose file. The deployed compose (deploy/docker-compose.yml) is not in
# git, so a command set there is invisible to review and drifts silently —
# which is how a release shipped against a database missing the column it
# had just started selecting. The failure surfaced as "Internal server
# error" on two admin pages, not as a deploy that failed.
#
# `migrate deploy` is idempotent: applies what is pending, no-ops otherwise.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
