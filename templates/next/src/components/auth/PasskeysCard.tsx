// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

/**
 * Passkey management for the Account page (platform mode only). Uses a
 * GitHub-style sudo window: re-enter the password once, then list / add /
 * remove passkeys for 15 minutes. Ceremonies run against the EvoPlatform
 * service through the /api/platform/passkeys proxies.
 */
import { useState } from "react";
import { Fingerprint } from "lucide-react";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { passkeysSupported, webauthnCreate } from "@/lib/webauthn-browser";

interface PasskeyInfo {
  id: string;
  nickname: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function PasskeysCard() {
  const [unlocked, setUnlocked] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [nickname, setNickname] = useState("");

  if (process.env.NEXT_PUBLIC_PLATFORM_MODE !== "1") return null;

  async function refresh() {
    const res = await fetch("/api/platform/passkeys");
    if (!res.ok) {
      setUnlocked(false);
      return;
    }
    setPasskeys(await res.json());
  }

  async function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const password = String(new FormData(e.currentTarget).get("sudo-password") ?? "");
      const res = await fetch("/api/platform/passkeys/sudo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Invalid password");
        return;
      }
      setUnlocked(true);
      await refresh();
    } finally {
      setPending(false);
    }
  }

  async function addPasskey() {
    setError(null);
    if (!passkeysSupported()) {
      setError("Passkeys are not supported in this browser");
      return;
    }
    setPending(true);
    try {
      const optRes = await fetch("/api/platform/passkeys/register/options", { method: "POST" });
      if (!optRes.ok) {
        setUnlocked(false);
        return;
      }
      const { options, challengeToken } = await optRes.json();
      const credential = await webauthnCreate(options);
      const verifyRes = await fetch("/api/platform/passkeys/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential, challengeToken, nickname: nickname || undefined }),
      });
      if (!verifyRes.ok) {
        setError("Passkey could not be registered");
        return;
      }
      setNickname("");
      await refresh();
    } catch {
      setError("Passkey setup was cancelled or failed");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/platform/passkeys/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not remove passkey");
      return;
    }
    await refresh();
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-3 max-w-md">
      <p className="font-semibold text-zinc-900 flex items-center gap-2">
        <Fingerprint size={16} /> Passkeys
      </p>
      <p className="text-sm text-zinc-500">
        Sign in with Windows Hello, Touch ID, or a security key instead of your password.
      </p>

      {!unlocked ? (
        <form onSubmit={unlock} className="space-y-3">
          <div>
            <label htmlFor="sudo-password" className="block text-sm font-medium text-zinc-700 mb-1">
              Confirm your password to manage passkeys
            </label>
            <PasswordInput id="sudo-password" name="sudo-password" autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {pending ? "Checking…" : "Unlock"}
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          {passkeys.length === 0 ? (
            <p className="text-sm text-zinc-400">No passkeys yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {passkeys.map((pk) => (
                <li key={pk.id} className="py-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-800">{pk.nickname}</p>
                    <p className="text-xs text-zinc-400">
                      Added {new Date(pk.createdAt).toLocaleDateString()}
                      {pk.lastUsedAt &&
                        ` · last used ${new Date(pk.lastUsedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => remove(pk.id)}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Name (e.g. Work laptop)"
              maxLength={100}
              className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={addPasskey}
              disabled={pending}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {pending ? "Waiting…" : "Add passkey"}
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
