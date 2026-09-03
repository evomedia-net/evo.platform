// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use server";

import { signOut } from "@/auth";

/** Ends the session and lands on the sign-in page. The client clears the
 *  tenant's browser database first (#167); this only runs afterwards. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
