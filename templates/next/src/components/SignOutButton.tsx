// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { deleteTenantDb } from "@/lib/offline/tenantDb";

/**
 * Sign out, and take this tenant's offline data with it.
 *
 * The browser database is deleted BEFORE the session ends: once the server
 * action redirects, nothing on this page runs again. A machine shared at a
 * front desk should not hand the next person the previous one's projects
 * (#167).
 */
export function SignOutButton({ action }: { action: () => Promise<void> }) {
  const { tenantId } = useTenant();
  const [busy, setBusy] = useState(false);

  return (
    <form
      action={async () => {
        setBusy(true);
        try {
          await deleteTenantDb(tenantId);
        } catch {
          // Losing the local copy is the goal; failing to lose it must not
          // keep someone signed in.
        }
        await action();
      }}
    >
      <button className="text-sm text-zinc-500 hover:text-zinc-800" disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
