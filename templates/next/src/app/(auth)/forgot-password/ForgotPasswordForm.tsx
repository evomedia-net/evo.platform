// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type AuthFormState } from "../actions";
import { useAuthHandoff } from "@/lib/auth/useAuthHandoff";

const initialState: AuthFormState = { error: null };

/**
 * The confirmation is deliberately identical whether or not the address has
 * an account. Anything that distinguishes the two — different copy, a
 * different delay, an error — turns this form into a way to find out who has
 * an account here.
 */
export default function ForgotPasswordForm({ platformMode }: { platformMode: boolean }) {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);
  const [handoff, setHandoff] = useAuthHandoff();

  // useActionState hands back the *same object* until an action returns, so
  // an identity check against the initial state is what distinguishes "not
  // submitted yet" from "submitted and came back clean".
  if (state !== initialState && state.error === null) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-zinc-600">
          If that address has an account, we&apos;ve sent a link to reset the password. The link
          expires in an hour.
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
        <h2 className="text-lg font-semibold">Forgot your password?</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Enter your email and we&apos;ll send you a link to set a new one.
        </p>
      </div>

      {state.error && (
        <p className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {state.error}
        </p>
      )}

      {platformMode && (
        <div>
          <label htmlFor="workspace" className="block text-sm font-medium text-zinc-700">
            Workspace
          </label>
          <input
            id="workspace"
            name="workspace"
            type="text"
            autoComplete="organization"
            value={handoff.workspace}
            onChange={(e) => setHandoff({ workspace: e.target.value })}
            placeholder="your-workspace"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-zinc-500">
            The workspace you sign in to. Leave blank if your deployment has a default.
          </p>
        </div>
      )}

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
        {pending ? "Sending…" : "Email me a reset link"}
      </button>

      <p className="text-sm text-zinc-500 text-center">
        <Link href="/login" className="text-blue-600 hover:underline">
          Back to sign in
        </Link>
      </p>
      {platformMode && (
        <p className="text-sm text-zinc-500 text-center">
          Not sure which workspace?{" "}
          <Link href="/forgot-workspace" className="text-blue-600 hover:underline">
            Look it up
          </Link>
        </p>
      )}
    </form>
  );
}
