import { verifySession } from "@/lib/auth/dal";
import { isPlatformMode } from "@/lib/platform";
import { MembersManager } from "@/components/members/MembersManager";
import { BillingCard } from "@/components/members/BillingCard";

/**
 * Workspace member management, for tenant admins (platform mode only). All
 * authority lives in the platform's /tenant/* API — this page is a thin
 * client over the member proxies.
 */
export default async function MembersPage() {
  await verifySession();

  if (!isPlatformMode()) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 max-w-md">
        <p className="font-semibold text-zinc-900">Members</p>
        <p className="text-sm text-zinc-500 mt-1">
          Member management is available when this app is connected to the platform. In
          standalone mode, accounts are created on the signup page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <MembersManager />
      <BillingCard />
    </div>
  );
}
