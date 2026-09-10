// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useFormStatus } from "react-dom";
import { useTenant } from "@/components/TenantProvider";
import { deleteTenantDb } from "@/lib/offline/tenantDb";

/**
 * The pending flag comes from useFormStatus rather than local state, and it
 * has to live in a CHILD of the form — that hook reports the enclosing
 * form's status, so a component that renders the <form> itself always reads
 * false. A `useState` set inside the action does not work either: React runs
 * a form action inside a transition and defers updates made there until the
 * action settles, so the button stayed enabled for the whole sign-out and
 * only claimed to be working once it was done (#221).
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="text-sm text-zinc-500 hover:text-zinc-800" disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

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
  return (
    <form
      action={async () => {
        try {
          await deleteTenantDb(tenantId);
        } catch {
          // Losing the local copy is the goal; failing to lose it must not
          // keep someone signed in.
        }
        await action();
      }}
    >
      <SubmitButton />
    </form>
  );
}
