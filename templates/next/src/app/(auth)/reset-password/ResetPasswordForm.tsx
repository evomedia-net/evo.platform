// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { resetPassword, type AuthFormState } from "../actions";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from "@/lib/auth/password-policy";

const initialState: AuthFormState = { error: null };

export default function ResetPasswordForm({ email, token }: { email: string; token: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Set a new password</h2>
        <p className="mt-1 text-sm text-zinc-600">
          for <span className="font-medium text-zinc-800">{email}</span>
        </p>
      </div>

      {/* The action re-validates both; these carry the link's identity. */}
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <p className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-zinc-700">
          New password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
        />
        <p className="mt-1 text-xs text-zinc-500">{PASSWORD_RULES_TEXT}</p>
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-zinc-700">
          Confirm new password
        </label>
        <PasswordInput id="confirm" name="confirm" autoComplete="new-password" />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Set password and sign in"}
      </button>

      <p className="text-sm text-zinc-500 text-center">
        <Link href="/login" className="text-blue-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
