"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { login, type AuthFormState } from "../actions";
import { passkeysSupported, webauthnGet } from "@/lib/webauthn-browser";

const initialState: AuthFormState = { error: null };
const platformMode = process.env.NEXT_PUBLIC_PLATFORM_MODE === "1";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function signInWithPasskey() {
    setPasskeyError(null);
    const form = new FormData(formRef.current ?? undefined);
    const email = String(form.get("email") ?? "").trim();
    if (!email) {
      setPasskeyError("Enter your email first, then use your passkey");
      return;
    }
    if (!passkeysSupported()) {
      setPasskeyError("Passkeys are not supported in this browser");
      return;
    }
    setPasskeyPending(true);
    try {
      const res = await fetch("/api/platform/passkeys/login/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, workspace: String(form.get("workspace") ?? "").trim() }),
      });
      const start = await res.json();
      if (!res.ok || !start.options) {
        setPasskeyError("No passkeys are registered for this account");
        return;
      }
      const credential = await webauthnGet(start.options);
      const result = await signIn("platform-passkey", {
        credential: JSON.stringify(credential),
        challengeToken: start.challengeToken,
        redirect: false,
      });
      if (result?.error) {
        setPasskeyError("Passkey sign-in could not be verified");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setPasskeyError("Passkey sign-in was cancelled or failed");
    } finally {
      setPasskeyPending(false);
    }
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-900">Sign in</h2>

      {platformMode && (
        <div>
          <label htmlFor="workspace" className="block text-sm font-medium text-zinc-700 mb-1">
            Workspace <span className="text-zinc-400 font-normal">(optional)</span>
          </label>
          <input
            id="workspace"
            name="workspace"
            type="text"
            autoComplete="organization"
            placeholder="your-company"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

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
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {(state.error || passkeyError) && (
        <p className="text-sm text-red-600" role="alert">
          {state.error ?? passkeyError}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-blue-600 text-white py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      {platformMode && (
        <button
          type="button"
          onClick={signInWithPasskey}
          disabled={passkeyPending}
          className="w-full rounded-lg border border-zinc-300 text-zinc-700 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
        >
          {passkeyPending ? "Waiting for passkey…" : "Sign in with a passkey"}
        </button>
      )}

      <p className="text-sm text-zinc-500 text-center">
        No account?{" "}
        <Link href="/signup" className="text-blue-600 hover:underline">
          Create your company workspace
        </Link>
      </p>
    </form>
  );
}
