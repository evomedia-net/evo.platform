// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useState } from "react";
import { resendVerification } from "@/app/(auth)/actions";

/**
 * One-shot re-send button for the verification email (platform mode).
 *
 * A failure has to be said out loud (#224). The account cannot be signed into
 * until this email is clicked, so a silently swallowed failure reads as "sent,
 * still travelling" and the user waits for something that was never sent. The
 * catch is also what keeps the rejection from escaping the async handler as an
 * unhandled promise rejection.
 */
export function ResendVerification({ email, workspace }: { email: string; workspace?: string }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  if (sent) {
    return <p className="text-sm text-zinc-500">Verification email sent — check your inbox.</p>;
  }
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setFailed(false);
          try {
            await resendVerification(email, workspace);
            setSent(true);
          } catch {
            setFailed(true);
          } finally {
            setPending(false);
          }
        }}
        className="text-sm text-blue-600 hover:underline disabled:opacity-50"
      >
        {pending ? "Sending…" : "Re-send verification email"}
      </button>
      {failed && (
        <p className="text-sm text-red-600">
          We couldn&apos;t send it just now — try again in a moment.
        </p>
      )}
    </div>
  );
}
