// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

"use client";

/**
 * Member management for tenant admins (platform mode only). Same sudo flow as
 * passkeys: confirm your password once, then manage members for 15 minutes.
 * The platform enforces everything — tenant scope, the tenant_admin claim,
 * self-lockout guards, role/app enablement — this UI just renders its answers.
 */
import { useCallback, useEffect, useState } from "react";
import { Users } from "lucide-react";
import { PasswordInput } from "@/components/auth/PasswordInput";

interface MemberRole {
  role: { id: string; name: string; app: { name: string; clientId: string } };
}
interface Member {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isTenantAdmin: boolean;
  deletedAt: string | null;
  roles: MemberRole[];
}
interface AppRoles {
  app: string;
  clientId: string;
  roles: { id: string; name: string }[];
}
interface Invite {
  id: string;
  email: string;
  isTenantAdmin: boolean;
  expiresAt: string;
  acceptedAt: string | null;
  /** Computed at fetch time (render must stay pure — no Date.now() there). */
  expired: boolean;
}

function annotateInvites(list: Omit<Invite, "expired">[]): Invite[] {
  const now = Date.now();
  return list.map((i) => ({ ...i, expired: new Date(i.expiresAt).getTime() < now }));
}

async function jsonOrError(res: Response): Promise<{ ok: boolean; body: unknown }> {
  const body = await res.json().catch(() => null);
  return { ok: res.ok, body };
}

function errorText(body: unknown, fallback: string): string {
  return typeof body === "object" && body !== null && "error" in body
    ? String((body as { error: unknown }).error)
    : fallback;
}

export function MembersManager() {
  const [unlocked, setUnlocked] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [appRoles, setAppRoles] = useState<AppRoles[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [notAdmin, setNotAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/platform/members");
    if (res.status === 401) {
      setUnlocked(false);
      return;
    }
    if (res.status === 403) {
      setNotAdmin(true);
      return;
    }
    if (res.ok) {
      setMembers(await res.json());
      const [rolesRes, invitesRes] = await Promise.all([
        fetch("/api/platform/members/roles"),
        fetch("/api/platform/members/invites"),
      ]);
      if (rolesRes.ok) setAppRoles(await rolesRes.json());
      if (invitesRes.ok) setInvites(annotateInvites(await invitesRes.json()));
    }
  }, []);

  useEffect(() => {
    // Resume an existing sudo window (cookie still valid) without re-prompting.
    void (async () => {
      const res = await fetch("/api/platform/members");
      if (res.ok) {
        setUnlocked(true);
        setMembers(await res.json());
        const [rolesRes, invitesRes] = await Promise.all([
          fetch("/api/platform/members/roles"),
          fetch("/api/platform/members/invites"),
        ]);
        if (rolesRes.ok) setAppRoles(await rolesRes.json());
        if (invitesRes.ok) setInvites(annotateInvites(await invitesRes.json()));
      } else if (res.status === 403) {
        setUnlocked(true);
        setNotAdmin(true);
      }
    })();
  }, []);

  async function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const password = String(new FormData(e.currentTarget).get("sudo-password") ?? "");
      const res = await fetch("/api/platform/members/sudo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Invalid password");
        return;
      }
      setUnlocked(true);
      await refresh();
    } finally {
      setPending(false);
    }
  }

  async function act(input: RequestInfo, init: RequestInit, fallback: string) {
    setError(null);
    setPending(true);
    try {
      const { ok, body } = await jsonOrError(await fetch(input, init));
      if (!ok) {
        setError(errorText(body, fallback));
        return false;
      }
      await refresh();
      return true;
    } finally {
      setPending(false);
    }
  }

  async function sendInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const sent = await act(
      "/api/platform/members/invites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(f.get("email") ?? ""),
          isTenantAdmin: f.get("isTenantAdmin") === "on",
        }),
      },
      "Could not send invite",
    );
    if (sent) setShowInvite(false);
  }

  function setRoles(member: Member, appClientId: string, roleId: string) {
    // One role per app: keep the other apps' selections, replace this app's.
    const keep = member.roles
      .filter((r) => r.role.app.clientId !== appClientId)
      .map((r) => r.role.id);
    const roleIds = roleId ? [...keep, roleId] : keep;
    void act(
      `/api/platform/members/${member.id}/roles`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleIds }),
      },
      "Could not update roles",
    );
  }

  const inputCls =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  if (notAdmin) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 max-w-md">
        <p className="font-semibold text-zinc-900 flex items-center gap-2">
          <Users size={16} /> Members
        </p>
        <p className="text-sm text-zinc-500 mt-1">
          Managing members needs the tenant-admin role. Ask an admin of your workspace to
          grant it.
        </p>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-3 max-w-md">
        <p className="font-semibold text-zinc-900 flex items-center gap-2">
          <Users size={16} /> Members
        </p>
        <form onSubmit={unlock} className="space-y-3">
          <div>
            <label htmlFor="sudo-password" className="block text-sm font-medium text-zinc-700 mb-1">
              Confirm your password to manage members
            </label>
            <PasswordInput id="sudo-password" name="sudo-password" autoComplete="current-password" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {pending ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center gap-2">
        <p className="font-semibold text-zinc-900 flex items-center gap-2">
          <Users size={16} /> Members ({members.filter((m) => !m.deletedAt).length})
        </p>
        <button
          onClick={() => setShowInvite((s) => !s)}
          className="ml-auto bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
        >
          {showInvite ? "Cancel" : "+ Invite member"}
        </button>
      </div>

      {showInvite && (
        <form onSubmit={sendInvite} className="space-y-3 border border-zinc-200 rounded-xl p-4">
          <p className="text-sm text-zinc-500">
            They&rsquo;ll get an email link (valid 24 hours) to choose their own password.
          </p>
          <input name="email" type="email" required placeholder="Email" className={inputCls} />
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="isTenantAdmin" /> Tenant admin (can manage members)
          </label>
          <button
            type="submit"
            disabled={pending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            {pending ? "Sending…" : "Send invite"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {invites.some((i) => !i.acceptedAt) && (
        <div>
          <p className="text-sm font-medium text-zinc-700 mb-1">Pending invites</p>
          <ul className="divide-y divide-zinc-100">
            {invites
              .filter((i) => !i.acceptedAt)
              .map((i) => {
                const expired = i.expired;
                return (
                  <li key={i.id} className="py-2 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-800 truncate">
                        {i.email}
                        {i.isTenantAdmin && (
                          <span className="ml-2 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                            tenant admin
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {expired
                          ? "Expired — re-send to issue a fresh link"
                          : `Expires ${new Date(i.expiresAt).toLocaleString()}`}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        void act(
                          `/api/platform/members/invites/${i.id}/resend`,
                          { method: "POST" },
                          "Could not re-send invite",
                        )
                      }
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Re-send
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Revoke the invite for ${i.email}? The emailed link stops working.`)) {
                          void act(
                            `/api/platform/members/invites/${i.id}`,
                            { method: "DELETE" },
                            "Could not revoke invite",
                          );
                        }
                      }}
                      className="text-sm text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      <ul className="divide-y divide-zinc-100">
        {members.map((m) => (
          <li key={m.id} className="py-3 flex flex-wrap items-center gap-3">
            {/* basis-full puts the name and email on their own line when the row
                is narrow, and sm:min-w-* makes the role controls wrap below
                rather than squeezing it. With only min-w-0 + flex-1 the identity
                block absorbed every pixel the selects wanted, so a member showed
                as "De..." over "dem..." - a members list that cannot tell you
                which member it means. */}
            <div className="min-w-0 basis-full sm:basis-auto sm:flex-1 sm:min-w-[14rem]">
              <p className="text-sm font-medium text-zinc-800 truncate">
                {m.name || m.email}
                {m.isTenantAdmin && (
                  <span className="ml-2 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                    tenant admin
                  </span>
                )}
                {m.deletedAt && (
                  <span className="ml-2 text-xs bg-zinc-100 text-zinc-500 border border-zinc-200 rounded-full px-2 py-0.5">
                    deactivated
                  </span>
                )}
              </p>
              <p className="text-xs text-zinc-400 truncate">
                {m.email}
                {m.phone ? ` · ${m.phone}` : ""}
              </p>
            </div>

            {!m.deletedAt &&
              appRoles.map((a) => {
                const current = m.roles.find((r) => r.role.app.clientId === a.clientId);
                return (
                  <label key={a.clientId} className="text-xs text-zinc-500 flex items-center gap-1">
                    {a.app}
                    <select
                      value={current?.role.id ?? ""}
                      onChange={(e) => setRoles(m, a.clientId, e.target.value)}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-xs"
                    >
                      <option value="">—</option>
                      {a.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}

            {m.deletedAt ? (
              <button
                onClick={() =>
                  void act(
                    `/api/platform/members/${m.id}/restore`,
                    { method: "POST" },
                    "Could not restore member",
                  )
                }
                className="text-sm text-blue-600 hover:underline"
              >
                Restore
              </button>
            ) : (
              <>
                <button
                  onClick={() =>
                    void act(
                      `/api/platform/members/${m.id}`,
                      {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ isTenantAdmin: !m.isTenantAdmin }),
                      },
                      "Could not update member",
                    )
                  }
                  className="text-sm text-zinc-500 hover:underline"
                  title={m.isTenantAdmin ? "Remove tenant-admin role" : "Make tenant admin"}
                >
                  {m.isTenantAdmin ? "Revoke admin" : "Make admin"}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Deactivate ${m.email}? They can no longer sign in; restorable.`)) {
                      void act(
                        `/api/platform/members/${m.id}`,
                        { method: "DELETE" },
                        "Could not deactivate member",
                      );
                    }
                  }}
                  className="text-sm text-red-600 hover:underline"
                >
                  Deactivate
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
