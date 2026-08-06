FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
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
