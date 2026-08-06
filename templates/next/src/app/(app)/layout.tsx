// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { isPlatformMode } from "@/lib/platform";
import { signOut } from "@/auth";
import { TenantProvider } from "@/components/TenantProvider";
import { SyncStatusButton } from "@/components/SyncStatusButton";

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
        <header className="bg-white border-b border-zinc-200 px-4 py-2.5 flex items-center gap-3">
          <Link href="/" className="font-bold text-zinc-900">
            Evo App
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
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="text-sm text-zinc-500 hover:text-zinc-800">Sign out</button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 max-w-3xl w-full mx-auto">{children}</main>
      </div>
    </TenantProvider>
  );
}
