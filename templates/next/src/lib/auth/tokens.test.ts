// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Single-use tokens. The property that matters: only the sha256 of the raw
 * token is ever stored, so a database leak reveals nothing usable.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
    verificationToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { consumeToken, createToken, INVITE_TTL_MS, RESET_TTL_MS } from "./tokens";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => vi.clearAllMocks());

describe("createToken", () => {
  it("returns a raw token and stores only its hash, replacing any outstanding one", async () => {
    const before = Date.now();
    const raw = await createToken("reset", "a@b.c", RESET_TTL_MS);

    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "reset:a@b.c" },
    });
    const created = vi.mocked(prisma.verificationToken.create).mock.calls[0]![0].data;
    expect(created.identifier).toBe("reset:a@b.c");
    expect(created.token).toBe(sha256(raw));
    expect(created.token).not.toContain(raw);
    expect((created.expires as Date).getTime()).toBeGreaterThanOrEqual(before + RESET_TTL_MS);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("keys invites separately from resets for the same address", async () => {
    await createToken("invite", "a@b.c", INVITE_TTL_MS);
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "invite:a@b.c" },
    });
  });
});

describe("consumeToken", () => {
  it("is false for an unknown token, and deletes nothing", async () => {
    vi.mocked(prisma.verificationToken.findUnique).mockResolvedValue(null as never);
    expect(await consumeToken("reset", "a@b.c", "nope")).toBe(false);
    expect(prisma.verificationToken.delete).not.toHaveBeenCalled();
  });

  it("looks the token up by its hash, deletes it, and is true while unexpired", async () => {
    vi.mocked(prisma.verificationToken.findUnique).mockResolvedValue({
      token: sha256("raw-1"),
      expires: new Date(Date.now() + 60_000),
    } as never);

    expect(await consumeToken("reset", "a@b.c", "raw-1")).toBe(true);
    expect(prisma.verificationToken.findUnique).toHaveBeenCalledWith({
      where: { identifier_token: { identifier: "reset:a@b.c", token: sha256("raw-1") } },
    });
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
      where: { identifier_token: { identifier: "reset:a@b.c", token: sha256("raw-1") } },
    });
  });

  // Deleted either way: an expired token is spent, not saved for later.
  it("is false for an expired token, which is still consumed", async () => {
    vi.mocked(prisma.verificationToken.findUnique).mockResolvedValue({
      token: sha256("raw-2"),
      expires: new Date(Date.now() - 1),
    } as never);
    expect(await consumeToken("reset", "a@b.c", "raw-2")).toBe(false);
    expect(prisma.verificationToken.delete).toHaveBeenCalledTimes(1);
  });
});

describe("lifetimes", () => {
  it("are an hour for resets and a week for invites", () => {
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
