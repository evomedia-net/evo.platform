// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { PRODUCT_NAME } from "@/lib/product";
import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { isPlatformMode } from "@/lib/platform";
import { TenantProvider } from "@/components/TenantProvider";
import { SyncStatusButton } from "@/components/SyncStatusButton";
import { SignOutButton } from "@/components/SignOutButton";
import { signOutAction } from "./signout-action";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession();

  return (
    <TenantProvider
      value={{
        tenantId: session.tenantId,
        role: session.role,
        email: session.email,
        userId: session.userId,
      }}
    >
      <div className="min-h-screen flex flex-col">
        {/* Pinned: the home link and Sign out must stay reachable at every
            scroll position. Sticky keeps the header in normal flow, so the
            page needs no offset; z-20 clears any sticky table header (#209). */}
        <header className="sticky top-0 z-20 bg-white border-b border-zinc-200 px-4 py-2.5 flex items-center gap-3">
          <Link href="/" className="font-bold text-zinc-900">
            {PRODUCT_NAME}
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {isPlatformMode() && (
              <Link href="/members" className="text-sm text-zinc-500 hover:text-zinc-800 px-2">
                Members
              </Link>
            )}
            <SyncStatusButton />
            <Link
              href="/settings/account"
              className="text-sm text-zinc-500 hover:text-zinc-800 px-2"
            >
              {session.email}
            </Link>
            {/* Clears this tenant's browser database before the session ends (#167). */}
            <SignOutButton action={signOutAction} />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 max-w-3xl w-full mx-auto">{children}</main>
      </div>
    </TenantProvider>
  );
}
