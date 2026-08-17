"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Carries what the user already typed across the auth screens.
 *
 * The flow this fixes: type your email (and workspace), get the password
 * wrong, click "Forgot password" — and land on a blank form demanding the
 * same details again. Same for "Forgot workspace", and for "Back to sign in"
 * on the way back. The details are already known; asking twice is the app
 * wasting the user's time at the exact moment they are already frustrated.
 *
 * Why sessionStorage and not a `?email=` query param: an email address in a
 * URL is written to server access logs, the browser's history, and any
 * Referer header sent to third parties. sessionStorage stays on the client,
 * is scoped to the one tab, and is discarded when that tab closes — which is
 * also the right lifetime for a half-finished sign-in on a shared machine.
 *
 * Passwords are never stored here. Only the non-secret identifiers.
 */
const KEY = "auth_handoff";

export interface AuthHandoff {
  email: string;
  workspace: string;
}

const EMPTY: AuthHandoff = { email: "", workspace: "" };

function read(): AuthHandoff {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<AuthHandoff>;
    return {
      email: typeof parsed.email === "string" ? parsed.email : "",
      workspace: typeof parsed.workspace === "string" ? parsed.workspace : "",
    };
  } catch {
    // Private-browsing modes can throw on sessionStorage access, and a
    // corrupted value should never break a login form.
    return EMPTY;
  }
}

function write(v: AuthHandoff): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage disabled or full — prefill is a convenience, never a dependency */
  }
}

/** Clear the handoff (called once a sign-in succeeds). */
export function clearAuthHandoff(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Returns the shared email/workspace and a patch function. Seeded on mount
 * rather than in a lazy initializer: these forms are server-rendered, so
 * reading storage during the first render would produce markup the server
 * cannot match and React would discard it with a hydration warning.
 */
export function useAuthHandoff(): [AuthHandoff, (patch: Partial<AuthHandoff>) => void] {
  const [handoff, setHandoff] = useState<AuthHandoff>(EMPTY);

  useEffect(() => {
    const stored = read();
    if (stored.email || stored.workspace) setHandoff(stored);
  }, []);

  const update = useCallback((patch: Partial<AuthHandoff>) => {
    setHandoff((prev) => {
      const next = { ...prev, ...patch };
      write(next);
      return next;
    });
  }, []);

  return [handoff, update];
}
