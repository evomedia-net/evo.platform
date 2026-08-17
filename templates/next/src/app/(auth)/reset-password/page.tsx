// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import Link from "next/link";
import { isPlatformMode } from "@/lib/platform";
import ResetPasswordForm from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

/**
 * Completion page for a locally issued reset link — standalone only.
 *
 * In platform mode the platform hosts its own reset page and its emails never
 * point here, so rather than render a form that cannot work, this says what
 * happened and sends the user back to a link that does.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; token?: string }>;
}) {
  const { email = "", token = "" } = await searchParams;

  if (isPlatformMode()) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">This link can&apos;t be used here</h2>
        <p className="text-sm text-zinc-600">
          Password resets are handled by the sign-in service for this deployment. Request a new link
          and use the page it sends you to.
        </p>
        <p className="text-sm text-zinc-500">
          <Link href="/forgot-password" className="text-blue-600 hover:underline">
            Request a reset link
          </Link>
        </p>
      </div>
    );
  }

  if (!email || !token) {
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

  return <ResetPasswordForm email={email} token={token} />;
}
