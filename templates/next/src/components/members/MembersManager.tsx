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
  const [notAdmin, setNotAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

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
      const rolesRes = await fetch("/api/platform/members/roles");
      if (rolesRes.ok) setAppRoles(await rolesRes.json());
    }
  }, []);

  useEffect(() => {
    // Resume an existing sudo window (cookie still valid) without re-prompting.
    void (async () => {
      const res = await fetch("/api/platform/members");
      if (res.ok) {
        setUnlocked(true);
        setMembers(await res.json());
        const rolesRes = await fetch("/api/platform/members/roles");
        if (rolesRes.ok) setAppRoles(await rolesRes.json());
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

  async function createMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const created = await act(
      "/api/platform/members",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: String(f.get("email") ?? ""),
          password: String(f.get("password") ?? ""),
          firstName: String(f.get("firstName") ?? "") || undefined,
          lastName: String(f.get("lastName") ?? "") || undefined,
          phone: String(f.get("phone") ?? "") || undefined,
          isTenantAdmin: f.get("isTenantAdmin") === "on",
        }),
      },
      "Could not create member",
    );
    if (created) setShowCreate(false);
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
          onClick={() => setShowCreate((s) => !s)}
          className="ml-auto bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
        >
          {showCreate ? "Cancel" : "+ Add member"}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createMember} className="grid grid-cols-2 gap-3 border border-zinc-200 rounded-xl p-4">
          <input name="firstName" placeholder="First name" className={inputCls} />
          <input name="lastName" placeholder="Last name" className={inputCls} />
          <input name="email" type="email" required placeholder="Email" className={inputCls} />
          <input name="phone" placeholder="Phone" className={inputCls} />
          <div className="col-span-2">
            <PasswordInput
              id="member-password"
              name="password"
              autoComplete="new-password"
              placeholder="Temporary password (min 8 chars, 2 numbers, 2 special)"
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="isTenantAdmin" /> Tenant admin (can manage members)
          </label>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              {pending ? "Creating…" : "Create member"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="divide-y divide-zinc-100">
        {members.map((m) => (
          <li key={m.id} className="py-3 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
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
