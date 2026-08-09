// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useState } from "react";
import { resendVerification } from "@/app/(auth)/actions";

/** One-shot re-send button for the verification email (platform mode). */
export function ResendVerification({ email, workspace }: { email: string; workspace?: string }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  if (sent) {
    return <p className="text-sm text-zinc-500">Verification email sent — check your inbox.</p>;
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await resendVerification(email, workspace);
          setSent(true);
        } finally {
          setPending(false);
        }
      }}
      className="text-sm text-blue-600 hover:underline disabled:opacity-50"
    >
      {pending ? "Sending…" : "Re-send verification email"}
    </button>
  );
}
