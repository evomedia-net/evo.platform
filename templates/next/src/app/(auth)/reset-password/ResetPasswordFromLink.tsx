// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { parseResetLink, type ResetLink } from "@/lib/auth/resetLink";
import ResetPasswordForm from "./ResetPasswordForm";

/**
 * Reads the address and token out of the URL fragment on the client. The
 * server never sees the fragment, which is the point (#163): the token is not
 * in any access log. The query-string fallback keeps links minted before the
 * change working until they expire.
 */
export default function ResetPasswordFromLink({
  fallback,
}: {
  fallback: { email?: string; token?: string };
}) {
  const [link, setLink] = useState<ResetLink | null | undefined>(undefined);

  useEffect(() => {
    setLink(parseResetLink(window.location.hash, fallback));
  }, [fallback]);

  if (link === undefined) return null;

  if (link === null) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Incomplete reset link</h2>
        <p className="text-sm text-zinc-600">
          That link is missing part of its address — some mail clients break long URLs across lines.
          Request a new one and click it directly from your inbox.
        </p>
        <p className="text-sm text-zinc-500">
          <Link href="/forgot-password" className="text-blue-600 hover:underline">
            Request a reset link
          </Link>
        </p>
      </div>
    );
  }

  return <ResetPasswordForm email={link.email} token={link.token} />;
}
