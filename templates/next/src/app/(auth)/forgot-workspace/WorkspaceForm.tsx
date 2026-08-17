// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestWorkspaceList, type AuthFormState } from "../actions";
import { useAuthHandoff } from "@/lib/auth/useAuthHandoff";

const initialState: AuthFormState = { error: null };

/**
 * "Which workspace am I in?"
 *
 * The answer arrives by email and is never in the response, so the mapping
 * from an address to its workspaces is not readable by whoever typed the
 * address into this box.
 */
export default function WorkspaceForm({ platformMode }: { platformMode: boolean }) {
  const [state, formAction, pending] = useActionState(requestWorkspaceList, initialState);
  const [handoff, setHandoff] = useAuthHandoff();

  if (state !== initialState && state.error === null) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-zinc-600">
          If that address belongs to any workspaces, we&apos;ve emailed you the list.
        </p>
        <p className="text-sm text-zinc-500">
          <Link href="/login" className="text-blue-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Forgot your workspace?</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {platformMode
            ? "Enter your email and we'll send you the workspaces it can sign in to."
            : "This deployment has a single workspace — leave the field blank when you sign in."}
        </p>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {state.error}
        </p>
      )}

      {platformMode && (
        <>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={handoff.email}
              onChange={(e) => setHandoff({ email: e.target.value })}
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "Sending…" : "Email me my workspaces"}
          </button>
        </>
      )}

      <p className="text-sm text-zinc-500 text-center">
        <Link href="/login" className="text-blue-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
