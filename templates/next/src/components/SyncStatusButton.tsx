// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

/**
 * Sync trigger + status indicator. Syncs on mount, when the browser comes
 * back online, when the data layer signals a write ("evoapp:sync"), every
 * 30s, and on click.
 */
import { useCallback, useEffect, useState } from "react";
import { CloudOff, RefreshCw, Check, AlertTriangle } from "lucide-react";
import { useTenant } from "@/components/TenantProvider";
import { runSync, type SyncStatus } from "@/lib/sync/client";

export function SyncStatusButton() {
  const { db } = useTenant();
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle", lastSyncedAt: null });

  const sync = useCallback(async () => {
    setStatus({ kind: "syncing" });
    setStatus(await runSync(db));
  }, [db]);

  useEffect(() => {
    void sync();
    const onSignal = () => void sync();
    window.addEventListener("online", onSignal);
    window.addEventListener("evoapp:sync", onSignal);
    const interval = setInterval(onSignal, 30_000);
    return () => {
      window.removeEventListener("online", onSignal);
      window.removeEventListener("evoapp:sync", onSignal);
      clearInterval(interval);
    };
  }, [sync]);

  const label =
    status.kind === "syncing"
      ? "Syncing…"
      : status.kind === "offline"
        ? "Offline — changes saved locally"
        : status.kind === "error"
          ? status.message
          : status.lastSyncedAt
            ? `Synced ${new Date(status.lastSyncedAt).toLocaleTimeString()}`
            : "Not synced yet";

  const Icon =
    status.kind === "syncing"
      ? RefreshCw
      : status.kind === "offline"
        ? CloudOff
        : status.kind === "error"
          ? AlertTriangle
          : Check;

  return (
    <button
      onClick={() => void sync()}
      title="Click to sync now"
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
        status.kind === "error"
          ? "border-amber-300 text-amber-700 bg-amber-50"
          : "border-zinc-200 text-zinc-500 bg-white hover:bg-zinc-50"
      }`}
    >
      <Icon size={13} className={status.kind === "syncing" ? "animate-spin" : ""} />
      {label}
    </button>
  );
}
