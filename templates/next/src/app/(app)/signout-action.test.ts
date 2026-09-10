// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({ signOut: vi.fn() }));

import { signOut } from "@/auth";
import { signOutAction } from "./signout-action";

describe("signOutAction", () => {
  it("ends the session and lands on the sign-in page", async () => {
    await signOutAction();
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
  });
});
