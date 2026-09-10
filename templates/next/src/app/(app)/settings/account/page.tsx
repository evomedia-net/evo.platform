// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useActionState, useState } from "react";
import { KeyRound } from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from "@/lib/auth/password-policy";
import { PasskeysCard } from "@/components/auth/PasskeysCard";
import { changePassword, type AccountActionState } from "./actions";

const initial: AccountActionState = { error: null };
const platformMode = process.env.NEXT_PUBLIC_PLATFORM_MODE === "1";

export default function AccountPage() {
  const { email } = useTenant();
  const [state, formAction, pending] = useActionState(changePassword, initial);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && next !== confirm;

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 md:p-6 rounded-2xl border border-zinc-200 shadow-sm">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 mb-1">Account</h2>
        <p className="text-sm text-zinc-500">{email}</p>
      </div>

      {!platformMode && (
        <form
          action={formAction}
          className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-3 max-w-md"
        >
          <p className="font-semibold text-zinc-900 flex items-center gap-2">
            <KeyRound size={16} /> Change password
          </p>
          <div>
            <label htmlFor="current" className="block text-sm font-medium text-zinc-700 mb-1">
              Current password
            </label>
            <PasswordInput id="current" name="current" autoComplete="current-password" />
          </div>
          <div>
            <label htmlFor="next" className="block text-sm font-medium text-zinc-700 mb-1">
              New password
            </label>
            <PasswordInput
              id="next"
              name="next"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={next}
              onChange={setNext}
            />
            <p className="mt-1 text-xs text-zinc-500">{PASSWORD_RULES_TEXT}</p>
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-zinc-700 mb-1">
              Confirm new password
            </label>
            <PasswordInput
              id="confirm"
              name="confirm"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              value={confirm}
              onChange={setConfirm}
            />
            {mismatch && <p className="mt-1 text-xs text-red-600">Passwords don&apos;t match.</p>}
          </div>
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
          <button
            type="submit"
            disabled={pending || mismatch}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {pending ? "Saving…" : "Update password"}
          </button>
        </form>
      )}

      <PasskeysCard />
    </div>
  );
}
