// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * @vitest-environment jsdom
 *
 * The platform enforces every rule here — tenant scope, the tenant_admin
 * claim, self-lockout guards — so what these tests pin is that the UI renders
 * its answers faithfully and never keeps acting on a window that has lapsed.
 * The destructive actions (revoke an invite, deactivate a member) must ask
 * first, and must not fire when the answer is no.
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MembersManager } from "./MembersManager";

// Testing Library's auto-cleanup only registers itself when vitest runs with
// globals enabled, and this project keeps them off - so unmounting is ours to
// do. Without it every render stacks up in one document and the queries start
// finding the previous test's markup.
afterEach(cleanup);

const fetchMock = vi.fn();
const confirmMock = vi.fn(() => true);

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const status = (code: number, body: unknown = {}) => ({
  ok: false,
  status: code,
  json: async () => body,
});

const member = {
  id: "m1",
  email: "dana@acme.example",
  name: "Dana Diaz",
  firstName: "Dana",
  lastName: "Diaz",
  phone: "+1 555 0100",
  isTenantAdmin: false,
  deletedAt: null as string | null,
  roles: [] as { role: { id: string; name: string; app: { name: string; clientId: string } } }[],
};
const appRoles = [
  { app: "Demo", clientId: "app_demo", roles: [{ id: "r1", name: "Viewer" }, { id: "r2", name: "Editor" }] },
];
const hour = 60 * 60 * 1000;
const invite = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  email: "new@acme.example",
  isTenantAdmin: false,
  expiresAt: new Date(Date.now() + 24 * hour).toISOString(),
  acceptedAt: null,
  ...over,
});

/**
 * The mount effect asks for members, then roles and invites together. Queue
 * one full set of answers.
 */
function serve({
  members = [member],
  roles = appRoles,
  invites = [] as unknown[],
}: { members?: unknown[]; roles?: unknown[]; invites?: unknown[] } = {}) {
  fetchMock
    .mockResolvedValueOnce(ok(members))
    .mockResolvedValueOnce(ok(roles))
    .mockResolvedValueOnce(ok(invites));
}

/** Render with the sudo window already open, and wait for the list. */
async function open(opts?: Parameters<typeof serve>[0]) {
  const user = userEvent.setup();
  serve(opts);
  render(<MembersManager />);
  await screen.findByRole("button", { name: /invite member/i });
  return user;
}

const call = (path: string) => fetchMock.mock.calls.find((c) => c[0] === path);
/** The write to a path the list also GETs on every refresh. */
const wrote = (path: string, method: string) =>
  fetchMock.mock.calls.find((c) => c[0] === path && c[1]?.method === method);

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockReturnValue(true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", confirmMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("resuming a sudo window on mount", () => {
  it("skips the password when the cookie is still good", async () => {
    await open();
    expect(screen.getByText("Dana Diaz")).toBeTruthy();
    expect(document.querySelector("#sudo-password")).toBeNull();
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/platform/members",
      "/api/platform/members/roles",
      "/api/platform/members/invites",
    ]);
  });

  it("asks for the password when there is no live window", async () => {
    fetchMock.mockResolvedValue(status(401));
    render(<MembersManager />);
    await waitFor(() => expect(document.querySelector("#sudo-password")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });

  // A non-admin can unlock; the platform then refuses every call. Say why
  // rather than showing an empty list that fails on every click.
  it("explains a member who is not a tenant admin", async () => {
    fetchMock.mockResolvedValue(status(403));
    render(<MembersManager />);
    expect(await screen.findByText(/needs the tenant-admin role/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /invite member/i })).toBeNull();
  });

  it("keeps the list even when roles and invites are refused", async () => {
    fetchMock
      .mockResolvedValueOnce(ok([member]))
      .mockResolvedValueOnce(status(401))
      .mockResolvedValueOnce(status(401));
    render(<MembersManager />);
    expect(await screen.findByText("Dana Diaz")).toBeTruthy();
    expect(document.querySelector("select")).toBeNull();
  });
});

describe("the sudo gate", () => {
  it("sends the typed password and then loads everything", async () => {
    fetchMock.mockResolvedValueOnce(status(401)); // mount probe
    const user = userEvent.setup();
    render(<MembersManager />);
    await waitFor(() => expect(document.querySelector("#sudo-password")).not.toBeNull());

    fetchMock.mockResolvedValueOnce(ok({ ok: true, tenantAdmin: true }));
    serve();
    await user.type(document.querySelector<HTMLInputElement>("#sudo-password")!, "my-password");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("Dana Diaz")).toBeTruthy();
    expect(call("/api/platform/members/sudo")![1].body).toBe(
      JSON.stringify({ password: "my-password" }),
    );
  });

  it("refuses a wrong password and stays locked", async () => {
    fetchMock.mockResolvedValue(status(401));
    const user = userEvent.setup();
    render(<MembersManager />);
    await waitFor(() => expect(document.querySelector("#sudo-password")).not.toBeNull());

    await user.type(document.querySelector<HTMLInputElement>("#sudo-password")!, "wrong");
    await user.click(screen.getByRole("button", { name: "Unlock" }));

    expect(await screen.findByText("Invalid password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });
});

describe("the member list", () => {
  it("counts only the members who are still active", async () => {
    await open({
      members: [member, { ...member, id: "m2", email: "gone@acme.example", name: "Gone", deletedAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(screen.getByText(/Members \(1\)/)).toBeTruthy();
  });

  it("shows the address and phone, and falls back to the address for a nameless member", async () => {
    await open({ members: [{ ...member, name: null, phone: null }] });
    expect(screen.getAllByText("dana@acme.example").length).toBeGreaterThan(0);
    expect(screen.queryByText(/555 0100/)).toBeNull();
  });

  it("badges a tenant admin and a deactivated member", async () => {
    await open({
      members: [
        { ...member, isTenantAdmin: true },
        { ...member, id: "m2", name: "Gone", deletedAt: "2026-09-01T00:00:00.000Z" },
      ],
    });
    expect(screen.getByText("tenant admin")).toBeTruthy();
    expect(screen.getByText("deactivated")).toBeTruthy();
  });

  it("offers no role controls for a deactivated member, only Restore", async () => {
    await open({ members: [{ ...member, deletedAt: "2026-09-01T00:00:00.000Z" }] });
    expect(document.querySelector("select")).toBeNull();
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /admin/i })).toBeNull();
  });
});

describe("roles", () => {
  it("preselects the role the member already holds in each app", async () => {
    await open({
      members: [
        { ...member, roles: [{ role: { id: "r2", name: "Editor", app: { name: "Demo", clientId: "app_demo" } } }] },
      ],
    });
    expect(document.querySelector<HTMLSelectElement>("select")!.value).toBe("r2");
  });

  it("replaces this app's role and keeps the other apps' selections", async () => {
    const user = await open({
      members: [
        {
          ...member,
          roles: [
            { role: { id: "r9", name: "Admin", app: { name: "Other", clientId: "app_other" } } },
            { role: { id: "r1", name: "Viewer", app: { name: "Demo", clientId: "app_demo" } } },
          ],
        },
      ],
    });
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    serve();

    await user.selectOptions(document.querySelector("select")!, "r2");

    await waitFor(() => expect(call("/api/platform/members/m1/roles")).toBeTruthy());
    expect(JSON.parse(call("/api/platform/members/m1/roles")![1].body)).toEqual({
      roleIds: ["r9", "r2"],
    });
  });

  it("clears this app's role when the blank option is chosen", async () => {
    const user = await open({
      members: [
        { ...member, roles: [{ role: { id: "r1", name: "Viewer", app: { name: "Demo", clientId: "app_demo" } } }] },
      ],
    });
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    serve();

    await user.selectOptions(document.querySelector("select")!, "");

    await waitFor(() => expect(call("/api/platform/members/m1/roles")).toBeTruthy());
    expect(JSON.parse(call("/api/platform/members/m1/roles")![1].body)).toEqual({ roleIds: [] });
  });
});

describe("member actions", () => {
  it("promotes and demotes through the same control", async () => {
    const user = await open({ members: [{ ...member, isTenantAdmin: false }] });
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    serve({ members: [{ ...member, isTenantAdmin: true }] });

    await user.click(screen.getByRole("button", { name: "Make admin" }));

    await waitFor(() => expect(call("/api/platform/members/m1")).toBeTruthy());
    expect(JSON.parse(call("/api/platform/members/m1")![1].body)).toEqual({ isTenantAdmin: true });
    expect(await screen.findByRole("button", { name: "Revoke admin" })).toBeTruthy();
  });

  it("asks before deactivating, and does it when confirmed", async () => {
    const user = await open();
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    serve({ members: [{ ...member, deletedAt: "2026-09-09T00:00:00.000Z" }] });

    await user.click(screen.getByRole("button", { name: "Deactivate" }));

    expect(confirmMock).toHaveBeenCalledWith(
      "Deactivate dana@acme.example? They can no longer sign in; restorable.",
    );
    await waitFor(() =>
      expect(call("/api/platform/members/m1")![1]).toEqual({ method: "DELETE" }),
    );
  });

  it("does nothing when the deactivation is waved off", async () => {
    confirmMock.mockReturnValue(false);
    const user = await open();
    const before = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Deactivate" }));

    expect(confirmMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("restores a deactivated member", async () => {
    const user = await open({ members: [{ ...member, deletedAt: "2026-09-01T00:00:00.000Z" }] });
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    serve();

    await user.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(call("/api/platform/members/m1/restore")![1]).toEqual({ method: "POST" }),
    );
  });

  it("shows the platform's own refusal, and a fallback when it gives none", async () => {
    const user = await open();
    fetchMock.mockResolvedValueOnce(status(403, { error: "You cannot demote yourself" }));
    await user.click(screen.getByRole("button", { name: "Make admin" }));
    expect(await screen.findByText("You cannot demote yourself")).toBeTruthy();

    fetchMock.mockResolvedValueOnce(status(500, null));
    await user.click(screen.getByRole("button", { name: "Make admin" }));
    expect(await screen.findByText("Could not update member")).toBeTruthy();
  });
});

describe("invites", () => {
  it("opens and closes the invite panel", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    expect(screen.getByRole("button", { name: "Send invite" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull();
  });

  it("sends an invite and closes the panel", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    fetchMock.mockResolvedValueOnce(ok({ id: "i9" }));
    serve({ invites: [invite()] });

    await user.type(screen.getByPlaceholderText("Email"), "new@acme.example");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(wrote("/api/platform/members/invites", "POST")).toBeTruthy());
    expect(JSON.parse(wrote("/api/platform/members/invites", "POST")![1].body)).toEqual({
      email: "new@acme.example",
      isTenantAdmin: true,
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Send invite" })).toBeNull());
  });

  it("keeps the panel open when the invite is refused", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: /invite member/i }));
    fetchMock.mockResolvedValueOnce(status(409, { error: "Already a member" }));

    await user.type(screen.getByPlaceholderText("Email"), "dana@acme.example");
    await user.click(screen.getByRole("button", { name: "Send invite" }));

    expect(await screen.findByText("Already a member")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send invite" })).toBeTruthy();
  });

  it("lists a pending invite with its expiry, and badges an admin invite", async () => {
    const pending = invite({ isTenantAdmin: true });
    await open({ invites: [pending] });
    const row = screen.getByText("new@acme.example").closest("li")!;
    expect(within(row).getByText("tenant admin")).toBeTruthy();
    expect(
      within(row).getByText(`Expires ${new Date(pending.expiresAt).toLocaleString()}`),
    ).toBeTruthy();
  });

  it("marks an invite whose link has already expired", async () => {
    await open({ invites: [invite({ expiresAt: new Date(Date.now() - hour).toISOString() })] });
    expect(screen.getByText(/expired — re-send to issue a fresh link/i)).toBeTruthy();
  });

  it("hides invites that have already been accepted", async () => {
    await open({ invites: [invite({ acceptedAt: "2026-09-05T00:00:00.000Z" })] });
    expect(screen.queryByText("Pending invites")).toBeNull();
  });

  it("re-sends an invite", async () => {
    const user = await open({ invites: [invite()] });
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    serve({ invites: [invite()] });

    await user.click(screen.getByRole("button", { name: "Re-send" }));

    await waitFor(() =>
      expect(call("/api/platform/members/invites/i1/resend")![1]).toEqual({ method: "POST" }),
    );
  });

  it("asks before revoking, and does it when confirmed", async () => {
    const user = await open({ invites: [invite()] });
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));
    serve({ invites: [] });

    await user.click(screen.getByRole("button", { name: "Revoke" }));

    expect(confirmMock).toHaveBeenCalledWith(
      "Revoke the invite for new@acme.example? The emailed link stops working.",
    );
    await waitFor(() =>
      expect(wrote("/api/platform/members/invites/i1", "DELETE")).toBeTruthy(),
    );
  });

  it("does nothing when the revoke is waved off", async () => {
    confirmMock.mockReturnValue(false);
    const user = await open({ invites: [invite()] });
    const before = fetchMock.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Revoke" }));

    expect(fetchMock.mock.calls.length).toBe(before);
  });
});

describe("a lapsed sudo window", () => {
  // 15 minutes pass mid-session: the next refresh answers 401 and the card
  // must ask for the password again rather than showing a list it cannot use.
  it("locks the card again when a refresh is refused", async () => {
    const user = await open();
    fetchMock.mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(status(401));

    await user.click(screen.getByRole("button", { name: "Make admin" }));

    await waitFor(() => expect(document.querySelector("#sudo-password")).not.toBeNull());
  });

  it("switches to the not-an-admin message when a refresh answers 403", async () => {
    const user = await open();
    fetchMock.mockResolvedValueOnce(ok({ ok: true })).mockResolvedValueOnce(status(403));

    await user.click(screen.getByRole("button", { name: "Make admin" }));

    expect(await screen.findByText(/needs the tenant-admin role/i)).toBeTruthy();
  });
});
