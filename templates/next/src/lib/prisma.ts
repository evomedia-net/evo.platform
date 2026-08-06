/**
 * Lazy PrismaClient — only instantiated on first use. This matters because
 * Next.js builds collect page data by *executing* server modules; constructing
 * the client at import time makes the build fail when DATABASE_URL isn't set,
 * which is exactly the case inside a Docker builder stage that only compiles
 * the bundle.
 *
 * Prisma 7 also requires an explicit driver adapter — `new PrismaClient()`
 * with no options now throws — so the pg adapter is wired in here.
 *
 * Re-uses a singleton across hot reloads in dev so the connection pool doesn't
 * multiply. Same pattern as SWAG-Estimates and EvoCivilCode.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function instantiate(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — see .env.example");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: ["warn", "error"] });
}

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const c = instantiate();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = c;
  return c;
}

/**
 * Drop-in replacement for the previous eager export: property reads and calls
 * forward to a lazily constructed real PrismaClient.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
