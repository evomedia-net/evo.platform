// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type AuthFormState } from "../actions";
import { ResendVerification } from "@/components/auth/ResendVerification";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from "@/lib/auth/password";

const initialState: AuthFormState = { error: null };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  // Platform mode lands here after a successful signup: the account exists
  // but can't sign in until the emailed verification link is clicked.
  if (state.notice) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-900">Check your email</h2>
        <p className="text-sm text-zinc-600">{state.notice}</p>
        {state.canResend && state.resendEmail && (
          <ResendVerification email={state.resendEmail} workspace={state.resendWorkspace} />
        )}
        <p className="text-sm text-zinc-500">
          Verified already?{" "}
          <Link href="/login" className="text-blue-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-900">Create your workspace</h2>

      <div>
        <label htmlFor="company" className="block text-sm font-medium text-zinc-700 mb-1">
          Company name
        </label>
        <input
          id="company"
          name="company"
          type="text"
          required
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-zinc-700 mb-1">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-zinc-700 mb-1">
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
        />
        <p className="mt-1 text-xs text-zinc-400">{PASSWORD_RULES_TEXT}</p>
      </div>

      {state.error && (
        <p className="text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create workspace"}
      </button>

      <p className="text-sm text-zinc-500 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-blue-600 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
