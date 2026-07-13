import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces unique salted hashes", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });
});
