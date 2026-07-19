"use client";

/**
 * Subscription controls for tenant admins (platform mode). Uses the same sudo
 * window as member management — unlock there first. Checkout subscribes this
 * workspace to THIS app; the platform webhook then drives access (paid →
 * active, payment failed → grace → suspended). The portal manages the payment
 * method, invoices, and cancellation.
 */
import { useState } from "react";
import { CreditCard } from "lucide-react";

export function BillingCard() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function go(path: string, which: string) {
    setError(null);
    setPending(which);
    try {
      const res = await fetch(path, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.status === 401) {
        setError("Unlock member management above first (confirm your password).");
        return;
      }
      if (!res.ok) {
        setError(
          (body && (body.error as string)) ||
            "Billing is not available right now — try again later.",
        );
        return;
      }
      if (body?.url) window.location.href = body.url as string;
      else setError("Billing did not return a checkout link.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-3 max-w-md">
      <p className="font-semibold text-zinc-900 flex items-center gap-2">
        <CreditCard size={16} /> Billing
      </p>
      <p className="text-sm text-zinc-500">
        Subscribe this workspace to the app, or manage the payment method, invoices, and
        cancellation. Handled securely by Stripe.
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => void go("/api/platform/members/billing/checkout", "checkout")}
          disabled={pending !== null}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          {pending === "checkout" ? "Opening…" : "Subscribe / upgrade"}
        </button>
        <button
          onClick={() => void go("/api/platform/members/billing/portal", "portal")}
          disabled={pending !== null}
          className="border border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 text-zinc-700 px-4 py-2 rounded-lg text-sm font-medium"
        >
          {pending === "portal" ? "Opening…" : "Manage billing"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
