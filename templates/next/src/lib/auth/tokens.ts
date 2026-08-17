/**
 * Single-use, expiring tokens for password reset + invites, stored in the
 * Auth.js VerificationToken table. Only the sha256 of the raw token is
 * persisted — a DB leak reveals nothing usable.
 */
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

export type TokenPurpose = "reset" | "invite";

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const identifier = (purpose: TokenPurpose, email: string) => `${purpose}:${email}`;

/** Create a token for the email, replacing any outstanding one. */
export async function createToken(
  purpose: TokenPurpose,
  email: string,
  ttlMs: number,
): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const id = identifier(purpose, email);
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier: id } }),
    prisma.verificationToken.create({
      data: { identifier: id, token: hash(raw), expires: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return raw;
}

/** Validate + consume (delete) a token. Returns true when it was valid. */
export async function consumeToken(
  purpose: TokenPurpose,
  email: string,
  raw: string,
): Promise<boolean> {
  const id = identifier(purpose, email);
  const row = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: id, token: hash(raw) } },
  });
  if (!row) return false;
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: id, token: row.token } },
  });
  return row.expires.getTime() > Date.now();
}

export const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
