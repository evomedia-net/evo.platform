// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/* EvoPlatform admin console. Vanilla JS on purpose: no build step, no deps,
 * three static files. All authorization lives in the API guards — this is a
 * thin client over /admin/* with the admin's own JWT (15-min access token,
 * auto-refreshed via the rotating refresh token). */
"use strict";

// ── theme ───────────────────────────────────────────────────────────────────
// Applied before first paint (this script is at end of <body>). Explicit
// choice wins; otherwise follow the OS preference.
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("evoadmin.theme", theme);
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "light" ? "☾" : "☀"; // moon / sun
}
(function initTheme() {
  const saved = localStorage.getItem("evoadmin.theme");
  const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches;
  applyTheme(saved || (prefersLight ? "light" : "dark"));
})();
document.getElementById("theme-toggle")?.addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
});

const $ = (sel) => document.querySelector(sel);
const S = {
  access: sessionStorage.getItem("evoadmin.access"),
  refresh: sessionStorage.getItem("evoadmin.refresh"),
  email: sessionStorage.getItem("evoadmin.email"),
  userId: sessionStorage.getItem("evoadmin.userId"),
  userName: sessionStorage.getItem("evoadmin.userName"),
  tenants: [],
  apps: [],
};

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function toast(msg, isErr) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = isErr ? "err" : "";
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 4000);
}

function modal(html) {
  $("#modal-body").innerHTML = html;
  $("#modal").hidden = false;
}
$("#modal-close").addEventListener("click", () => ($("#modal").hidden = true));

/**
 * Themed Yes/No confirmation. Resolves true only on Yes; backdrop click,
 * No, and Escape all resolve false. Focus starts on No so a stray Enter
 * never confirms a destructive action.
 */
/** Two dialogs, both of which must be answered Yes, for anything that erases
 *  data permanently. Purge is not undoable — there is no recycle bin behind it
 *  — so the second prompt exists to break the rhythm of clicking Yes. Anything
 *  reversible (soft delete, restore) keeps a single confirm. */
async function confirmDestructive(message) {
  if (!(await confirmDialog(message))) return false;
  return confirmDialog("Are you, like, really sure?");
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="card modal-card">
      <p style="margin:0 0 4px">${esc(message)}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="btn" data-c="no">No</button>
        <button class="btn danger" data-c="yes">Yes</button>
      </div></div>`;
    const finish = (v) => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(v);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") finish(false);
      if (ev.key === "Enter" && ev.target.dataset?.c) finish(ev.target.dataset.c === "yes");
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) return finish(false); // backdrop
      const b = e.target.closest("button[data-c]");
      if (b) finish(b.dataset.c === "yes");
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector('[data-c="no"]').focus();
  });
}

// ── auth + api ──────────────────────────────────────────────────────────────

function setSession(access, refresh, user) {
  S.access = access; S.refresh = refresh;
  S.email = user.email; S.userId = user.id; S.userName = user.name || "";
  sessionStorage.setItem("evoadmin.access", access);
  sessionStorage.setItem("evoadmin.refresh", refresh);
  sessionStorage.setItem("evoadmin.email", S.email);
  sessionStorage.setItem("evoadmin.userId", S.userId);
  sessionStorage.setItem("evoadmin.userName", S.userName);
}

function clearSession() {
  S.access = S.refresh = S.email = S.userId = S.userName = null;
  sessionStorage.clear();
}

async function raw(method, path, body, token) {
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function api(method, path, body) {
  let r = await raw(method, path, body, S.access);
  if (r.status === 401 && S.refresh) {
    const rr = await raw("POST", "/auth/refresh", { refreshToken: S.refresh });
    if (rr.ok) {
      setSession(rr.data.accessToken, rr.data.refreshToken, rr.data.user);
      r = await raw(method, path, body, S.access);
    }
  }
  if (r.status === 401) { showLogin(); throw new Error("Session expired — sign in again"); }
  if (!r.ok) throw new Error(r.data?.message || `Request failed (${r.status})`);
  return r.data;
}

// ── login / shell ───────────────────────────────────────────────────────────

function showLogin() {
  clearSession();
  $("#app-view").hidden = true;
  // Prefill the workspace that last signed in successfully. A tenant-homed
  // platform admin has no way to know their account is not platform-level,
  // and a blank workspace fails for them with a bare "Invalid credentials"
  // (#96) - remembering the answer beats explaining the distinction.
  const last = localStorage.getItem("evo.lastWorkspace");
  const ws = $("#login-workspace");
  if (last && !ws.value) ws.value = last;
  $("#login-view").hidden = false;
}

function showApp() {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  // Greet by name when we have one, falling back to email.
  $("#who").textContent = S.userName ? `${S.userName} (${S.email})` : S.email || "";
  route();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#login-error");
  err.hidden = true;
  // tenantSlug is omitted when blank: the API resolves a platform-level
  // account then, and sending an empty string would look up a tenant named "".
  const workspace = $("#login-workspace").value.trim().toLowerCase();
  const r = await raw("POST", "/auth/login", {
    email: $("#login-email").value.trim(),
    password: $("#login-password").value,
    ...(workspace ? { tenantSlug: workspace } : {}),
  });
  if (!r.ok) {
    err.textContent = r.data?.message || "Sign-in failed";
    // Static, account-independent nudge (#96): a blank workspace only ever
    // matches platform-level rows, and most admin accounts live in a
    // workspace. Same text for every email, so it reveals nothing.
    if (!workspace) err.textContent += " — if your account belongs to a workspace, enter it above.";
    err.hidden = false;
    return;
  }
  if (!r.data.user?.platformAdmin) {
    err.textContent = "This console requires a platform admin account";
    err.hidden = false;
    return;
  }
  localStorage.setItem("evo.lastWorkspace", workspace);
  setSession(r.data.accessToken, r.data.refreshToken, r.data.user);
  showApp();
});

/* Reset request. POST /auth/forgot already exists and is documented as
   single-use, 30-minute, and deliberately identical whether or not an account
   exists — so the console must not reveal more than the API does. The note
   below says the same thing on success and on failure for that reason. */
$("#forgot-link").addEventListener("click", async () => {
  const email = $("#login-email").value.trim();
  const note = $("#forgot-note");
  const err = $("#login-error");
  err.hidden = true;
  if (!email) {
    // Not a privacy leak: this is about the empty box, not about the account.
    note.textContent = "Enter your email address above first, then click again.";
    note.hidden = false;
    return;
  }
  // Same workspace resolution as sign-in: without it the lookup only sees
  // platform-level accounts, and a tenant-homed admin's reset mail is
  // silently never sent (the API answers ok either way, by design).
  const fWorkspace = $("#login-workspace").value.trim().toLowerCase();
  const r = await raw("POST", "/auth/forgot", {
    email,
    ...(fWorkspace ? { tenantSlug: fWorkspace } : {}),
  });
  if (!r.ok) {
    // Distinguishing a failed request from an unknown account leaks nothing —
    // the server said nothing about the account either way. Claiming a link is
    // "on its way" when the request never succeeded just makes someone wait for
    // an email that will never arrive.
    note.hidden = true;
    err.textContent = r.data?.message || "Could not send a reset link — try again shortly.";
    err.hidden = false;
    return;
  }
  note.textContent =
    "If an account exists for that address, a reset link is on its way. " +
    "It is valid for 30 minutes and works once.";
  note.hidden = false;
});

$("#logout").addEventListener("click", async () => {
  if (S.refresh) await raw("POST", "/auth/logout", { refreshToken: S.refresh });
  showLogin();
});

// ── routing ─────────────────────────────────────────────────────────────────

const VIEWS = { tenants: viewTenants, users: viewUsers, apps: viewApps, revenue: viewRevenue, audit: viewAudit, smtp: viewSmtp };

async function route() {
  const name = (location.hash.replace("#/", "") || "tenants").split("?")[0];
  const view = VIEWS[name] || viewTenants;
  document.querySelectorAll("#nav a").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === `#/${name}`));
  // Swap in a fresh content node so per-view delegated listeners can't stack
  // across renders (a stacked listener would fire an action N times).
  const stale = $("#content");
  const fresh = stale.cloneNode(false);
  stale.replaceWith(fresh);
  fresh.innerHTML = `<p class="muted">Loading…</p>`;
  try { await view(); } catch (e) { fresh.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
window.addEventListener("hashchange", route);

async function loadTenants() { S.tenants = await api("GET", "/admin/tenants?includeDeleted=true"); }
/* includeDeleted, matching tenants and users: the console is where you restore
   or purge something, so it has to be able to see it. */
async function loadApps() { S.apps = await api("GET", "/admin/apps?includeDeleted=true"); }
const tenantName = (id) => S.tenants.find((t) => t.id === id)?.slug || (id ? id.slice(0, 8) : "platform");
const fmt = (d) => (d ? new Date(d).toLocaleString() : "");

function act(fn) {
  // Wrap row-action handlers: run, toast errors, re-render current view.
  return async (...args) => {
    try { await fn(...args); route(); } catch (e) { toast(e.message, true); }
  };
}

// ── tenants ─────────────────────────────────────────────────────────────────

const TENANT_PROFILE_KEYS = [
  "phone", "addressLine1", "addressLine2", "city", "state", "postalCode", "country",
];

/** Create-tenant form as a dismissible overlay (triggered by "+ New tenant").
 *  A tenant is a company, so it carries the full address. */
function newTenantModal() {
  modal(`<h2>New tenant</h2>
    <form class="userform" id="tenant-create">
      <label>Slug <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" placeholder="acme" /></label>
      <label>Name <input name="name" required placeholder="Acme Widgets" /></label>
      <label>Plan <input name="plan" placeholder="free" /></label>
      <label>Phone <input name="phone" /></label>
      <label class="full">Address line 1 <input name="addressLine1" /></label>
      <label class="full">Address line 2 <input name="addressLine2" /></label>
      <label>City <input name="city" /></label>
      <label>State / Province <input name="state" /></label>
      <label>Postal code <input name="postalCode" /></label>
      <label>Country <input name="country" /></label>
      <div class="actions"><button class="btn primary">Create tenant</button></div>
    </form>`);
  $("#tenant-create").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const profile = {};
    for (const k of TENANT_PROFILE_KEYS) {
      const val = (f.get(k) || "").trim();
      if (val) profile[k] = val;
    }
    try {
      await api("POST", "/admin/tenants", {
        slug: f.get("slug"),
        name: f.get("name"),
        ...(f.get("plan") ? { plan: f.get("plan") } : {}),
        ...profile,
      });
      $("#modal").hidden = true;
      toast("Tenant created");
      route();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

async function viewTenants() {
  await loadTenants();
  const rows = S.tenants.map((t) => {
    const state = t.deletedAt
      ? `<span class="badge bad">deleted</span>`
      : t.status === "ACTIVE"
        ? `<span class="badge ok">active</span>`
        : t.status === "PAST_DUE"
          ? `<span class="badge warn"${t.graceUntil ? ` data-tip="Payment failed — logins keep working until the grace window closes on ${esc(fmt(t.graceUntil))}, then this tenant is blocked."` : ""}>past due</span>`
          : `<span class="badge bad">suspended</span>`;
    const actions = t.deletedAt
      ? `<button class="btn sm" data-act="restore" data-id="${t.id}" data-tip="Bring this soft-deleted tenant back; its data is intact.">Restore</button>
         <button class="btn sm" data-act="export" data-id="${t.id}" data-slug="${esc(t.slug)}" data-tip="Download this tenant's data as JSON. Worth doing before you purge — purge cannot be undone.">Export</button>
         <button class="btn sm danger" data-act="purge" data-id="${t.id}" data-slug="${esc(t.slug)}" data-tip="Erase permanently: users, audit history, SMTP config and app access. This cannot be undone.">Purge</button>`
      : `${t.status === "SUSPENDED"
          ? `<button class="btn sm" data-act="activate" data-id="${t.id}" data-tip="Re-enable logins for this tenant.">Activate</button>`
          : `<button class="btn sm" data-act="suspend" data-id="${t.id}" data-tip="Block all logins to this tenant. Reversible — data is kept.">Suspend</button>`}
         <button class="btn sm" data-act="rename" data-id="${t.id}" data-name="${esc(t.name)}" data-tip="Change the workspace's display name. The slug is its permanent identity and does not change, so nothing that references this tenant breaks.">Rename</button>
         <button class="btn sm danger" data-act="delete" data-id="${t.id}" data-tip="Soft-delete — hides the tenant but keeps its data; restorable.">Delete</button>`;
    return `<tr><td><code>${esc(t.slug)}</code></td><td>${esc(t.name)}</td>
      <td>${esc(t.plan)}</td><td class="col-status">${state}</td><td class="muted">${esc(fmt(t.createdAt))}</td>
      <td class="col-actions">${actions}</td></tr>`;
  }).join("");

  $("#content").innerHTML = `
    <div class="card">
      <div class="cardhead">
        <h2>Tenants (${S.tenants.length})</h2>
        <span class="spacer"></span>
        <button class="btn primary" id="new-tenant-btn">+ New tenant</button>
      </div>
      <table><tr><th>Slug</th><th>Name</th><th>Plan</th><th class="col-status">Status</th><th>Created</th><th class="col-actions"></th></tr>${rows}</table>
    </div>`;

  $("#new-tenant-btn").addEventListener("click", newTenantModal);

  $("#content").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const { act: a, id, slug } = btn.dataset;
    if (a === "delete" && !(await confirmDialog("Soft-delete this tenant? It can be restored."))) return;
    if (a === "purge" && !(await confirmDestructive(
      `Permanently erase "${slug}" and everything it owns — users, audit history, SMTP config and app access? This cannot be undone.`,
    ))) return;
    try {
      if (a === "export") {
        // Straight to a file: the payload is a whole tenant, so rendering it
        // in a toast or a modal would be useless at any real size.
        const r = await api("GET", `/admin/tenants/${id}/export`);
        download(`tenant-${slug}.json`, "application/json", JSON.stringify(r, null, 2));
        toast("Export downloaded");
        return;
      }
      if (a === "rename") {
        const next = prompt("Workspace display name:", btn.dataset.name);
        if (next === null || !next.trim() || next.trim() === btn.dataset.name) return;
        await api("PATCH", `/admin/tenants/${id}`, { name: next.trim() });
        toast("Workspace renamed");
      }
      else if (a === "delete") await api("DELETE", `/admin/tenants/${id}`);
      else if (a === "purge") await api("DELETE", `/admin/tenants/${id}/purge`);
      else await api("POST", `/admin/tenants/${id}/${a}`);
      toast(a === "purge" ? `Tenant "${slug}" permanently erased` : `Tenant ${a}d`);
      route();
    } catch (err) { toast(err.message, true); }
  });
}

// ── users ───────────────────────────────────────────────────────────────────

const PROFILE_KEYS = ["firstName", "lastName", "phone"];

/** Shared profile inputs for the create form and edit modal, pre-filled from u.
 *  Users are people — just name + phone; company address lives on the tenant. */
function profileFields(u = {}) {
  const v = (k) => esc(u[k] ?? "");
  return `
    <label>First name <input name="firstName" value="${v("firstName")}" /></label>
    <label>Last name <input name="lastName" value="${v("lastName")}" /></label>
    <label class="full">Phone <input name="phone" value="${v("phone")}" /></label>`;
}

/** Collect profile fields from a form. `all=true` includes blanks (edit: allow
 *  clearing); otherwise only non-empty (create: omit blanks). */
function collectProfile(f, all = false) {
  const out = {};
  for (const k of PROFILE_KEYS) {
    const val = (f.get(k) || "").trim();
    if (all || val) out[k] = val;
  }
  return out;
}

function editUserModal(u) {
  modal(`<h2>Edit user</h2>
    <form class="userform" id="user-edit">
      <label>Email <input name="email" type="email" required value="${esc(u.email)}" data-tip="The sign-in identity. Changing it changes the address this person signs in with, and is recorded in the audit log." /></label>
      ${profileFields(u)}
      <label class="full check" data-tip="Lets this user manage their own tenant's members (invite, edit, deactivate, roles) from inside the apps — without platform access."><input type="checkbox" name="isTenantAdmin"${u.isTenantAdmin ? " checked" : ""} /> Tenant admin</label>
      <div class="actions"><button class="btn primary">Save changes</button></div>
    </form>`);
  $("#user-edit").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const f = new FormData(e.target);
      await api("PATCH", `/admin/users/${u.id}`, {
        email: f.get("email"),
        ...collectProfile(f, true),
        isTenantAdmin: f.get("isTenantAdmin") === "on",
      });
      $("#modal").hidden = true;
      toast("User updated");
      route();
    } catch (err) {
      toast(err.message, true);
    }
  });
}

/** Create-user form as a dismissible overlay (triggered by "+ New user"),
 *  matching the New Tenant overlay. */
function newUserModal() {
  modal(`<h2>New user</h2>
    <form class="userform" id="user-create">
      <label>Tenant <select name="tenantId">
        <option value="">Platform-level</option>
        ${S.tenants.filter((t) => !t.deletedAt).map((t) => `<option value="${t.id}">${esc(t.slug)}</option>`).join("")}
      </select></label>
      <label>Email <input name="email" type="email" required /></label>
      ${profileFields()}
      ${pwField("password", "Password", { cls: "full" })}
      ${pwField("confirm", "Confirm password", { cls: "full" })}
      <p class="muted full">${PW_POLICY_MSG}</p>
      <p id="pw-err" class="error full" hidden></p>
      <label class="full check"><input type="checkbox" name="isPlatformAdmin" /> Platform admin</label>
      <label class="full check" data-tip="Lets this user manage their own tenant's members (invite, edit, deactivate, roles) from inside the apps — without platform access."><input type="checkbox" name="isTenantAdmin" /> Tenant admin</label>
      <div class="actions"><button class="btn primary">Create user</button></div>
    </form>`);
  $("#user-create").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const password = f.get("password");
    const err = $("#pw-err");
    // Checked before the request so the problem lands next to the field, and
    // so a rejected password never costs the admin the rest of the form.
    if (pwFormError(err, password, f.get("confirm"))) return;
    try {
      await api("POST", "/admin/users", {
        ...(f.get("tenantId") ? { tenantId: f.get("tenantId") } : {}),
        email: f.get("email"), password,
        ...collectProfile(f),
        isPlatformAdmin: f.get("isPlatformAdmin") === "on",
        isTenantAdmin: f.get("isTenantAdmin") === "on",
      });
      $("#modal").hidden = true;
      toast("User created");
      route();
    } catch (e2) {
      // Keep the overlay open with everything the admin typed still there.
      err.textContent = e2.message;
      err.hidden = false;
    }
  });
}

async function viewUsers() {
  await Promise.all([loadTenants(), loadApps()]);
  const filter = sessionStorage.getItem("evoadmin.userFilter") || "";
  const q = filter === "" ? "" : `&tenantId=${encodeURIComponent(filter)}`;
  const users = await api("GET", `/admin/users?includeDeleted=true${q}`);

  const tenantOpts = (sel) => `
    <option value="">All</option>
    <option value="platform"${sel === "platform" ? " selected" : ""}>Platform-level</option>
    ${S.tenants.filter((t) => !t.deletedAt).map((t) =>
      `<option value="${t.id}"${sel === t.id ? " selected" : ""}>${esc(t.slug)}</option>`).join("")}`;

  // One dropdown per app: pick a role (or —) and it saves immediately.
  const roleCell = (u) =>
    S.apps
      .filter((a) => a.roles.length)
      .map((a) => {
        const current = u.roles.find((r) => a.roles.some((ar) => ar.id === r.role.id));
        return `<div class="roleselect"><span class="muted">${esc(a.name)}</span>
          <select data-user-roles="${u.id}">
            <option value="">&mdash;</option>
            ${a.roles.map((ar) =>
              `<option value="${ar.id}"${current?.role.id === ar.id ? " selected" : ""}>${esc(ar.name)}</option>`).join("")}
          </select></div>`;
      })
      .join("") || '<span class="muted">no roles defined</span>';

  const rows = users.map((u) => `<tr>
      <td>${esc(u.email)}${u.deletedAt ? ' <span class="badge bad">deleted</span>' : ""}</td>
      <td>${esc(u.name ?? "")}</td>
      <td><code>${esc(tenantName(u.tenantId))}</code></td>
      <td>${u.isPlatformAdmin ? '<span class="badge ok">admin</span>' : ""}${u.isTenantAdmin ? ' <span class="badge ok" data-tip="Manages their own tenant\'s members from inside the apps.">tenant admin</span>' : ""}${u.emailVerifiedAt ? "" : ' <span class="badge warn" data-tip="Mailbox not yet proven — sign-in is refused until the user clicks their verification email.">unverified</span>'}</td>
      <td>${roleCell(u)}</td>
      <td>${u.deletedAt
        ? `<button class="btn sm" data-act="restore" data-id="${u.id}" data-tip="Bring this soft-deleted user back.">Restore</button>
           <button class="btn sm danger" data-act="purge" data-id="${u.id}" data-email="${esc(u.email)}" data-tip="Erase this user permanently, including sessions, passkeys and role assignments. This cannot be undone.">Purge</button>`
        : `<button class="btn sm" data-act="edit" data-id="${u.id}" data-tip="Edit this user's name, phone, and address.">Edit</button>
           <button class="btn sm" data-act="password" data-id="${u.id}" data-email="${esc(u.email)}" data-tip="Set a new password for this user. In platform mode this is the reset path for delegated apps too.">Password</button>
           <button class="btn sm danger" data-act="delete" data-id="${u.id}" data-email="${esc(u.email)}" data-tip="Soft-delete this user; restorable.">Delete</button>`}
      </td></tr>`).join("");

  $("#content").innerHTML = `
    <div class="card">
      <div class="cardhead">
        <h2>Users (${users.length})</h2>
        <span class="spacer"></span>
        <button class="btn primary" id="new-user-btn">+ New user</button>
      </div>
      <form class="inline"><label style="flex:0 0 220px">Filter by tenant
        <select id="user-filter">${tenantOpts(filter)}</select></label></form>
      <table><tr><th>Email</th><th>Name</th><th>Tenant</th><th></th><th>Roles</th><th></th></tr>${rows}</table>
    </div>`;

  $("#new-user-btn").addEventListener("click", newUserModal);

  $("#user-filter").addEventListener("change", (e) => {
    sessionStorage.setItem("evoadmin.userFilter", e.target.value);
    route();
  });

  $("#content").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const { act: a, id } = btn.dataset;
    if (a === "password") { setPasswordModal(id, btn.dataset.email); return; }
    if (a === "edit") { editUserModal(users.find((x) => x.id === id)); return; }
    try {
      if (a === "delete") {
        if (!(await confirmDialog(`Delete user "${btn.dataset.email}"? It can be restored.`))) return;
        await api("DELETE", `/admin/users/${id}`); toast("User deleted"); route();
      }
      else if (a === "restore") { await api("POST", `/admin/users/${id}/restore`); toast("User restored"); route(); }
      else if (a === "purge") {
        if (!(await confirmDestructive(
          `Permanently erase "${btn.dataset.email}", including their sessions, passkeys and role assignments? This cannot be undone.`,
        ))) return;
        await api("DELETE", `/admin/users/${id}/purge`);
        toast(`User "${btn.dataset.email}" permanently erased`);
        route();
      }
    } catch (err) { toast(err.message, true); }
  });

  // Role dropdowns save on change: collect every app-select for the user and
  // PUT the full assignment set.
  $("#content").addEventListener("change", async (e) => {
    const sel = e.target.closest("select[data-user-roles]");
    if (!sel) return;
    const id = sel.dataset.userRoles;
    const roleIds = [...document.querySelectorAll(`select[data-user-roles="${id}"]`)]
      .map((s) => s.value)
      .filter(Boolean);
    try {
      await api("PUT", `/admin/users/${id}/roles`, { roleIds });
      toast("Roles updated");
    } catch (err) {
      toast(err.message, true);
      route(); // reset the selects to server truth
    }
  });
}

/* Mirrors the server policy (src/core/password-policy.ts) — the NIST/OWASP
 * Standard: length + a known-bad blocklist, no composition rules. The server
 * is authoritative; this is just fast feedback. Keep the two in step. */
const PW_MIN_LENGTH = 12;
const PW_MAX_BYTES = 72;
const PW_MAX_RUN = 4;
const PW_POLICY_MSG =
  "At least " + PW_MIN_LENGTH + " characters. Longer is stronger — a phrase of a few " +
  "words works well, and spaces are allowed. No special-character requirements. " +
  "Avoid common passwords and runs like abcde or 12345.";
const PW_COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "letmein",
  "welcome", "welcome1", "qwerty", "qwerty123", "iloveyou", "admin",
  "administrator", "changeme", "abc123", "111111", "123456", "1234567",
  "12345678", "123456789", "1234567890", "monkey", "dragon", "sunshine",
  "princess", "football", "baseball", "trustno1", "evoplatform", "evomedia",
]);
/* Rows kept separate: concatenating them would flag row-crossing strings
 * like "opasd" as a run, which they are not. */
const PW_SEQUENCES = [
  "0123456789", "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop", "asdfghjkl", "zxcvbnm",
];

function pwIsSequential(candidate) {
  const win = PW_MAX_RUN + 1;
  if (candidate.length < win) return false;
  for (const seq of PW_SEQUENCES) {
    const rev = [...seq].reverse().join("");
    for (let i = 0; i + win <= candidate.length; i++) {
      const chunk = candidate.slice(i, i + win);
      if (seq.includes(chunk) || rev.includes(chunk)) return true;
    }
  }
  return false;
}

function pwIsCommon(pw) {
  const c = pw.trim().toLowerCase();
  if (PW_COMMON.has(c)) return true;
  const trimmed = c.replace(/[0-9!@#$%^&*()\-_=+.,?/\|[\]{}<>;:'"`~ ]+$/, "");
  if (trimmed && PW_COMMON.has(trimmed)) return true;
  const unleet = trimmed
    .replace(/@/g, "a").replace(/0/g, "o").replace(/1/g, "i")
    .replace(/3/g, "e").replace(/\$/g, "s").replace(/5/g, "s")
    .replace(/!/g, "i").replace(/4/g, "a").replace(/7/g, "t");
  if (unleet && PW_COMMON.has(unleet)) return true;
  return new Set(c).size === 1;
}

/* Returns an error string, or null when the password passes. */
function pwPolicyError(pw) {
  if (!pw) return "Password is required";
  if (pw.length < PW_MIN_LENGTH) return "Password must be at least " + PW_MIN_LENGTH + " characters";
  if (new TextEncoder().encode(pw).length > PW_MAX_BYTES) {
    return "Password must be " + PW_MAX_BYTES + " characters or fewer";
  }
  if (pwIsSequential(pw.trim().toLowerCase())) {
    return "Avoid runs of more than " + PW_MAX_RUN + " characters in a row (like abcde or 12345)";
  }
  if (pwIsCommon(pw)) return "That password is too common — choose something less guessable";
  return null;
}
const EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

/* Reveal toggles, delegated from document rather than per-form. The set-password
   modal used to bind its own click handler, which meant the login field - static
   markup in index.html, not built by a modal - had no way to get one. One
   listener covers every [data-pw-toggle] on the page, including markup that did
   not exist when it was registered. */
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pw-toggle]");
  if (!btn) return;
  const input = btn.parentElement.querySelector("input");
  if (!input) return;
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  btn.innerHTML = reveal ? EYE_OFF : EYE;
  btn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
});

/* index.html cannot inline the icon without duplicating the SVG, so the static
   login toggle is filled in here — the eye stays defined in exactly one place. */
document.querySelectorAll("[data-pw-toggle]:empty").forEach((b) => (b.innerHTML = EYE));

function pwField(name, label, opts = {}) {
  const { required = true, placeholder = "", cls = "" } = opts;
  // The toggle must stay a SIBLING of the input (the delegated handler walks
  // parentElement), so the label is tied by for/id rather than by wrapping —
  // wrapping would put the button inside the label as well.
  const id = `pw-${name}`;
  return `<label class="${cls}" for="${id}">${label}</label>
    <div class="pw-field ${cls}">
      <input id="${id}" name="${name}" type="password"${required ? " required" : ""} autocomplete="new-password"${
        placeholder ? ` placeholder="${placeholder}"` : ""
      } />
      <button type="button" class="pw-toggle" data-pw-toggle aria-label="Show password">${EYE}</button>
    </div>`;
}

/* Shared by every form that SETS a password: confirm must match, and the
   policy is checked client-side so the user is told what is wrong next to the
   field instead of via a toast from the server. Returns true when it handled
   an error (caller should stop). */
function pwFormError(errEl, password, confirm) {
  errEl.hidden = true;
  const problem =
    password !== confirm ? "Passwords don't match." : pwPolicyError(password);
  if (!problem) return false;
  errEl.textContent = problem;
  errEl.hidden = false;
  return true;
}

/** Admin-set a user's password. In platform mode the platform owns passwords,
 *  so this is the reset path for delegated apps too. */
function setPasswordModal(userId, email) {
  modal(`<h2>Set password</h2>
    <p class="muted">For <b>${esc(email)}</b>. ${PW_POLICY_MSG}</p>
    <form id="set-pw-form">
      ${pwField("password", "New password")}
      ${pwField("confirm", "Confirm password")}
      <p id="pw-err" class="error" hidden></p>
      <button class="btn primary" style="margin-top:12px">Save password</button>
    </form>`);
  const form = $("#set-pw-form");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const password = f.get("password");
    const confirm = f.get("confirm");
    const err = $("#pw-err");
    if (pwFormError(err, password, confirm)) return;
    try {
      await api("PATCH", `/admin/users/${userId}`, { password });
      $("#modal").hidden = true;
      toast("Password updated");
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
    }
  });
}

// ── apps ────────────────────────────────────────────────────────────────────

function secretModal(clientId, secret) {
  modal(`<h2>App credentials</h2>
    <p class="muted">The secret is shown <b>once</b> — store it now.</p>
    <p>Client id<br/><code>${esc(clientId)}</code></p>
    <p>Client secret<br/><code>${esc(secret)}</code></p>`);
}

const ACCESS_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED"];

async function viewApps() {
  await loadApps();
  // Per-app tenant access (the enablement matrix, one column per card)
  const accessByApp = Object.fromEntries(await Promise.all(
    S.apps.map(async (a) => [a.id, await api("GET", `/admin/apps/${a.id}/tenants`)]),
  ));

  const accessRows = (a) => accessByApp[a.id].map((t) => {
    const acc = t.access;
    const detail = acc?.status === "TRIAL" && acc.trialEndsAt
      ? `<span class="muted">ends ${esc(fmt(acc.trialEndsAt))}</span>`
      : acc?.status === "PAST_DUE" && acc.graceUntil
        ? `<span class="muted">grace until ${esc(fmt(acc.graceUntil))}</span>`
        : "";
    return `<tr><td><code>${esc(t.slug)}</code></td><td>${esc(t.name)}</td>
      <td>${acc
        ? `<select data-access-app="${a.id}" data-access-tenant="${t.id}" data-tip="Access state for this workspace on ${esc(a.name)} only — its other apps are unaffected. Suspended refuses logins to this app; trial and past due refuse once their end dates pass.">
            ${ACCESS_STATUSES.map((s) => `<option value="${s}"${acc.status === s ? " selected" : ""}>${s.toLowerCase().replace("_", " ")}</option>`).join("")}
          </select> ${detail}`
        : '<span class="badge warn">not enabled</span>'}</td>
      <td class="col-actions">${acc
        ? `<button class="btn sm danger" data-access-act="disable" data-app-id="${a.id}" data-tenant-id="${t.id}" data-tenant-slug="${esc(t.slug)}" data-app-name="${esc(a.name)}" data-tip="Remove this workspace's access to ${esc(a.name)} entirely — logins to this app are refused. The workspace and its other apps are untouched.">Disable</button>`
        : `<button class="btn sm" data-access-act="enable" data-app-id="${a.id}" data-tenant-id="${t.id}" data-tip="Let this workspace sign in to ${esc(a.name)}.">Enable</button>`}
      </td></tr>`;
  }).join("");

  const cards = S.apps.map((a) => `
    <div class="card">
      <h2>${esc(a.name)}${a.deletedAt ? ' <span class="badge bad">deleted</span>' : ""}</h2>
      <p>Client id: <code>${esc(a.clientId)}</code>
        ${a.deletedAt
          ? `<button class="btn sm" data-act="app-restore" data-id="${a.id}" data-name="${esc(a.name)}" data-tip="Bring this app back. Its client id, roles and tenant grants are intact, and sign-in through it starts working again.">Restore</button>
             <button class="btn sm danger" data-act="app-purge" data-id="${a.id}" data-name="${esc(a.name)}" data-tip="Erase this app permanently, with its roles, every user's assignments to them, and every tenant's access. This cannot be undone.">Purge</button>`
          : `<button class="btn sm" data-act="rotate" data-id="${a.id}" data-tip="Replace this app's client secret — do it if the secret may have leaked, when someone with access leaves, or on a rotation schedule. The old secret stops working immediately, so update the app's config right away.">Rotate secret</button>
             <button class="btn sm danger" data-act="app-delete" data-id="${a.id}" data-name="${esc(a.name)}" data-tip="Soft-delete: sign-in through this app stops immediately, but nothing is destroyed and it can be restored. The client id stays reserved so it cannot be re-registered underneath.">Delete</button>`}</p>
      <form class="inline" data-app-callbacks="${a.id}" style="margin-top:6px">
        <label style="flex:1 1 340px" data-tip="Where this app may receive auth codes, comma-separated. Billing enforces these: checkout and portal redirect URLs must share an origin with one of them, so an app with none registered cannot start a checkout.">Callback URLs <input name="callbacks" placeholder="https://app.example.com/cb" value="${esc(a.callbackUrls.join(", "))}" /></label>
        <button class="btn sm grow0">Save</button>
      </form>
      <div class="chips">${a.roles.map((r) => `<span class="chip">${esc(r.name)}
        <button data-role-act="rename" data-app-id="${a.id}" data-role-id="${r.id}" data-role-name="${esc(r.name)}" data-tip="Rename this role. Tokens carry role names, so it applies at next login/refresh.">&#9998;</button>
        <button data-role-act="delete" data-app-id="${a.id}" data-role-id="${r.id}" data-role-name="${esc(r.name)}" data-tip="Delete this role and remove it from every user that has it.">&times;</button>
      </span>`).join("")}</div>
      <form class="inline" data-app="${a.id}" style="margin-top:10px">
        <label style="flex:0 0 200px">Add role <input name="role" list="role-suggestions" placeholder="admin" required /></label>
        <button class="btn sm grow0">Add</button>
      </form>
      <form class="inline" data-app-price="${a.id}" style="margin-top:10px">
        <label style="flex:0 0 280px" data-tip="Stripe Price id (price_...) sold as this app's subscription. Checkout uses it; webhook events then drive each workspace's access to this app. Leave empty while the app isn't sellable.">Stripe price <input name="priceId" placeholder="price_..." value="${esc(a.stripePriceId ?? "")}" /></label>
        <button class="btn sm grow0">Save</button>
      </form>
      <label class="check" style="display:block;margin-top:10px" data-tip="Checked: workspaces you create in this console start enabled on this app. Unchecked: access must be granted specifically — here, by signup through the app, or by subscription. Self-service signup is unaffected (it only ever enables the app arrived through).">
        <input type="checkbox" data-auto-enroll="${a.id}"${a.autoEnroll ? " checked" : ""} /> Auto-enroll new tenants
      </label>
      <h3 data-tip="Which workspaces may sign in to this app. Logins scoped to an app are refused unless the workspace is enabled here.">Tenant access</h3>
      <table><tr><th>Slug</th><th>Name</th><th>Access</th><th class="col-actions"></th></tr>${accessRows(a)}</table>
    </div>`).join("");

  // Role names are app-defined, so this can't be a fixed dropdown — an app may
  // legitimately need "estimator" or "dispatcher". Suggesting the names already
  // in use keeps the common cases one click away and stops the same role being
  // spelled three ways across apps, which matters because role names travel in
  // JWT claims and apps string-match them.
  const roleSuggestions = [...new Set(S.apps.flatMap((a) => a.roles.map((r) => r.name)))].sort();

  $("#content").innerHTML = `
    <datalist id="role-suggestions">
      ${roleSuggestions.map((n) => `<option value="${esc(n)}"></option>`).join("")}
    </datalist>
    <div class="card">
      <h2>Register app</h2>
      <form class="inline" id="app-create">
        <label>Name <input name="name" required placeholder="my-app" /></label>
        <label>Callback URLs (comma-separated) <input name="callbacks" placeholder="https://app.example.com/cb" /></label>
        <button class="btn primary grow0">Register</button>
      </form>
    </div>
    ${cards}`;

  $("#app-create").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const f = new FormData(e.target);
      const created = await api("POST", "/admin/apps", {
        name: f.get("name"),
        callbackUrls: String(f.get("callbacks") || "").split(",").map((s) => s.trim()).filter(Boolean),
      });
      secretModal(created.clientId, created.clientSecret);
      route();
    } catch (err) { toast(err.message, true); }
  });

  $("#content").addEventListener("click", async (e) => {
    const roleBtn = e.target.closest("button[data-role-act]");
    if (roleBtn) {
      const { roleAct, appId, roleId, roleName } = roleBtn.dataset;
      try {
        if (roleAct === "rename") {
          const next = prompt(`Rename role "${roleName}" to:`, roleName);
          if (!next || !next.trim() || next.trim() === roleName) return;
          await api("PATCH", `/admin/apps/${appId}/roles/${roleId}`, { name: next.trim() });
          toast("Role renamed — takes effect in tokens at next login/refresh");
        } else {
          if (!(await confirmDialog(`Delete role "${roleName}"? It will be removed from every user that has it.`))) return;
          const out = await api("DELETE", `/admin/apps/${appId}/roles/${roleId}`);
          toast(`Role deleted (${out.assignmentsRemoved} assignment${out.assignmentsRemoved === 1 ? "" : "s"} removed)`);
        }
        route();
      } catch (err) { toast(err.message, true); }
      return;
    }

    const accessBtn = e.target.closest("button[data-access-act]");
    if (accessBtn) {
      const { accessAct, appId, tenantId, tenantSlug, appName } = accessBtn.dataset;
      try {
        if (accessAct === "disable") {
          if (!(await confirmDialog(`Disable ${appName} for "${tenantSlug}"? Logins to this app will be refused until re-enabled.`))) return;
          await api("DELETE", `/admin/tenants/${tenantId}/apps/${appId}`);
          toast("App disabled for workspace");
        } else {
          await api("PUT", `/admin/tenants/${tenantId}/apps/${appId}`, {});
          toast("App enabled for workspace");
        }
        route();
      } catch (err) { toast(err.message, true); }
      return;
    }

    const life = e.target.closest("button[data-act^=app-]");
    if (life) {
      const { act, id, name } = life.dataset;
      try {
        if (act === "app-delete") {
          if (!(await confirmDialog(
            `Soft-delete "${name}"? Sign-in through this app stops immediately, but nothing is destroyed and it can be restored.`,
          ))) return;
          await api("DELETE", `/admin/apps/${id}`);
          toast(`App "${name}" deleted`);
        } else if (act === "app-restore") {
          await api("POST", `/admin/apps/${id}/restore`);
          toast(`App "${name}" restored`);
        } else if (act === "app-purge") {
          if (!(await confirmDestructive(
            `Permanently erase "${name}", its roles, every user's assignments to them, and every tenant's access to it? This cannot be undone.`,
          ))) return;
          await api("DELETE", `/admin/apps/${id}/purge`);
          toast(`App "${name}" permanently erased`);
        }
        route();
      } catch (err) { toast(err.message, true); }
      return;
    }

    const btn = e.target.closest("button[data-act=rotate]");
    if (!btn) return;
    if (!(await confirmDialog("Rotate this app's secret? The old secret stops working immediately."))) return;
    try {
      const out = await api("POST", `/admin/apps/${btn.dataset.id}/rotate-secret`);
      secretModal(out.clientId, out.clientSecret);
    } catch (err) { toast(err.message, true); }
  });

  // Access dropdowns and the auto-enroll toggle save on change; on error
  // re-render to server truth.
  $("#content").addEventListener("change", async (e) => {
    const auto = e.target.closest("input[data-auto-enroll]");
    if (auto) {
      try {
        await api("PATCH", `/admin/apps/${auto.dataset.autoEnroll}`, { autoEnroll: auto.checked });
        toast(auto.checked ? "New tenants will be auto-enrolled" : "Auto-enroll off — access now needs a specific grant");
      } catch (err) {
        toast(err.message, true);
        route();
      }
      return;
    }
    const sel = e.target.closest("select[data-access-app]");
    if (!sel) return;
    try {
      await api("PUT", `/admin/tenants/${sel.dataset.accessTenant}/apps/${sel.dataset.accessApp}`, {
        status: sel.value,
      });
      toast("Access updated");
    } catch (err) {
      toast(err.message, true);
      route();
    }
  });

  $("#content").addEventListener("submit", async (e) => {
    const cbForm = e.target.closest("form[data-app-callbacks]");
    if (cbForm) {
      e.preventDefault();
      // Split on commas, drop blanks — so "a, b," and "a,b" mean the same, and
      // clearing the box clears the list rather than saving one empty string.
      const urls = String(new FormData(cbForm).get("callbacks") || "")
        .split(",").map((u) => u.trim()).filter(Boolean);
      const bad = urls.find((u) => !/^https?:\/\/\S+$/.test(u));
      if (bad) { toast(`Not a URL: ${bad}`, true); return; }
      try {
        await api("PATCH", `/admin/apps/${cbForm.dataset.appCallbacks}`, { callbackUrls: urls });
        toast(urls.length ? "Callback URLs saved" : "Callback URLs cleared"); route();
      } catch (err) { toast(err.message, true); }
      return;
    }

    const priceForm = e.target.closest("form[data-app-price]");
    if (priceForm) {
      e.preventDefault();
      const priceId = String(new FormData(priceForm).get("priceId") || "").trim();
      // Shape check before the request; the server additionally asks Stripe
      // whether the price actually exists. A wrong id used to be accepted
      // silently and only surfaced at checkout, in front of a paying customer.
      if (priceId && !/^price_[A-Za-z0-9]+$/.test(priceId)) {
        toast("A Stripe price id looks like price_1A2b3C… (empty clears it)", true);
        return;
      }
      try {
        await api("PATCH", `/admin/apps/${priceForm.dataset.appPrice}`, { stripePriceId: priceId });
        toast("Stripe price saved"); route();
      } catch (err) { toast(err.message, true); }
      return;
    }
    const form = e.target.closest("form[data-app]");
    if (!form) return;
    e.preventDefault();
    try {
      await api("POST", `/admin/apps/${form.dataset.app}/roles`, { name: new FormData(form).get("role") });
      toast("Role added"); route();
    } catch (err) { toast(err.message, true); }
  });
}

// ── audit ───────────────────────────────────────────────────────────────────

// ── revenue ─────────────────────────────────────────────────────────────────
//
// Figures are PULLED from Stripe at read time (see the platform's
// RevenueService): Stripe is the system of record, so this page presents its
// numbers rather than authoring any. When Stripe is unreachable the API
// serves the last good pull marked stale, and this view says so plainly —
// whose fault it is, and how old the figures are — instead of passing cached
// numbers off as current.

function money(cents, ccy) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy.toUpperCase() })
      .format(cents / 100);
  } catch { return `${(cents / 100).toFixed(2)} ${ccy.toUpperCase()}`; }
}

function healthBanner(r) {
  if (!r.stale) return "";
  const h = r.health || {};
  const asOf = r.snapshot ? fmt(r.snapshot.fetchedAt) : null;
  const cause = h.state === "stripe_down"
    ? `The problem is on <strong>Stripe's side</strong>${h.stripeStatusIndicator ? ` (their status page reports “${esc(h.stripeStatusIndicator)}”)` : ""} —
       <a href="https://status.stripe.com/" target="_blank" rel="noopener">status.stripe.com</a>`
    : `Neither Stripe nor its status page is reachable — the problem is most likely
       on <strong>our side</strong> (network/egress), not Stripe`;
  const figures = asOf
    ? `Showing the last figures pulled at <strong>${esc(asOf)}</strong> — they are not current.`
    : `No earlier figures are available to show.`;
  return `<div class="card banner-warn">
    <h2>Stripe is unreachable</h2>
    <p>${cause}.</p>
    <p>${figures}</p>
  </div>`;
}

async function viewRevenue() {
  const r = await api("GET", "/revenue/summary");
  const s = r.snapshot;

  if (!s) {
    $("#content").innerHTML = healthBanner(r) || `<p class="error">No revenue data.</p>`;
    return;
  }

  const sub = s.subscriptions;
  const currencies = [...new Set([
    ...Object.keys(s.billed.grossYtd), ...Object.keys(s.billed.refundsYtd),
  ])].sort();

  // Status tiles: text carries the state — status colors stay reserved.
  const statusTiles = Object.entries(sub.byStatus).sort()
    .map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${esc(k)}</div></div>`)
    .join("");
  const netTiles = currencies.map((c) => `
    <div class="stat"><div class="v">${esc(money(s.billed.netYtd[c] ?? 0, c))}</div>
    <div class="l">net YTD (${esc(c.toUpperCase())}) · gross ${esc(money(s.billed.grossYtd[c] ?? 0, c))}
      · refunds ${esc(money(s.billed.refundsYtd[c] ?? 0, c))}
      · tax ${esc(money(s.billed.taxYtd[c] ?? 0, c))}</div></div>`).join("");

  // By plan: single series, sorted by count, value in text ink at the row end.
  const plans = Object.entries(sub.byPlan).sort((a, b) => b[1] - a[1]);
  const maxPlan = Math.max(1, ...plans.map(([, v]) => v));
  const planRows = plans.map(([key, v]) => {
    const [app, plan, interval] = key.split("|");
    return `<div class="hbar" data-tip="${esc(app)} — ${esc(plan)}, billed ${esc(interval)}ly">
      <span>${esc(app)} · ${esc(plan)} <span class="muted">(${esc(interval)})</span></span>
      <span class="track"><span class="fill" style="width:${(v / maxPlan) * 100}%"></span></span>
      <span class="n">${v}</span>
    </div>`;
  }).join("") || `<p class="muted">No subscriptions yet.</p>`;

  // Monthly gross vs refunds, one chart per currency — never summed across.
  const monthCharts = currencies.map((ccy) => {
    const months = [...new Set([
      ...Object.keys(s.billed.grossByMonth), ...Object.keys(s.billed.refundsByMonth),
    ])].sort();
    if (!months.length) return "";
    const gross = months.map((m) => s.billed.grossByMonth[m]?.[ccy] ?? 0);
    const refunds = months.map((m) => s.billed.refundsByMonth[m]?.[ccy] ?? 0);
    const peak = Math.max(1, ...gross, ...refunds);
    const cols = months.map((m, i) => `
      <div class="m" data-tip="${esc(m)}: gross ${esc(money(gross[i], ccy))}, refunds ${esc(money(refunds[i], ccy))}">
        <div class="bars">
          <div class="bar" style="height:${(gross[i] / peak) * 100}%;background:var(--chart-1)"></div>
          <div class="bar" style="height:${(refunds[i] / peak) * 100}%;background:var(--chart-2)"></div>
        </div>
        <span class="ml">${esc(m.slice(5))}</span>
      </div>`).join("");
    return `<div class="card">
      <div class="cardhead"><h2>Billed by month (${esc(ccy.toUpperCase())})</h2>
        <span class="spacer"></span>
        <span class="legend"><span><i style="background:var(--chart-1)"></i>Gross</span>
        <span><i style="background:var(--chart-2)"></i>Refunds</span></span>
      </div>
      <div class="cols">${cols}</div>
    </div>`;
  }).join("");

  // The table view: every number on the page, readable without color.
  const months = [...new Set([
    ...Object.keys(s.billed.grossByMonth), ...Object.keys(s.billed.refundsByMonth),
  ])].sort();
  const tableRows = months.flatMap((m) => currencies.map((ccy) => {
    const g = s.billed.grossByMonth[m]?.[ccy] ?? 0;
    const rf = s.billed.refundsByMonth[m]?.[ccy] ?? 0;
    if (!g && !rf) return "";
    return `<tr><td>${esc(m)}</td><td>${esc(ccy.toUpperCase())}</td>
      <td class="n">${esc(money(g, ccy))}</td><td class="n">${esc(money(rf, ccy))}</td>
      <td class="n">${esc(money(g - rf, ccy))}</td></tr>`;
  })).join("");

  const pulled = r.stale
    ? ""
    : `<span class="muted">Pulled live from Stripe · ${esc(fmt(s.fetchedAt))} · refunds counted in the month they were issued</span>`;

  $("#content").innerHTML = `
    ${healthBanner(r)}
    <div class="card">
      <div class="cardhead"><h2>Revenue</h2><span class="spacer"></span>
        ${pulled}
        <button class="btn sm grow0" id="rev-export-csv"
          data-tip="Download every figure on this page as CSV." data-tip-pos="bottom">Save CSV</button>
      </div>
      <div class="stat-tiles">
        <div class="stat"><div class="v">${sub.total}</div><div class="l">subscriptions</div></div>
        ${statusTiles}
        <div class="stat"><div class="v">${sub.canceledDuringTrial}</div><div class="l">canceled during trial</div></div>
        ${netTiles}
      </div>
    </div>
    <div class="card"><div class="cardhead"><h2>Subscriptions by plan</h2></div>${planRows}</div>
    ${monthCharts}
    ${tableRows ? `<div class="card"><div class="cardhead"><h2>Monthly detail</h2></div>
      <table><tr><th>Month</th><th>Currency</th><th>Gross</th><th>Refunds</th><th>Net</th></tr>${tableRows}</table></div>` : ""}
  `;

  $("#rev-export-csv").addEventListener("click", async () => {
    try {
      const res = await fetch("/revenue/export.csv", { headers: { Authorization: `Bearer ${S.access}` } });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      download(`revenue-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv", await res.text());
      toast("Revenue exported");
    } catch (err) { toast(err.message, true); }
  });
}

async function viewAudit() {
  await loadTenants();
  const p = new URLSearchParams(sessionStorage.getItem("evoadmin.auditQ") || "take=100");
  const events = await api("GET", `/admin/audit?${p}`);
  const rows = events.map((ev) => `<tr>
    <td class="muted">${esc(fmt(ev.createdAt))}</td>
    <td><code>${esc(ev.action)}</code></td>
    <td>${esc(tenantName(ev.tenantId))}</td>
    <td class="muted">${esc(ev.userId ? ev.userId.slice(0, 8) : "")}</td>
    <td class="muted">${esc(ev.appClientId ?? "")}</td>
    <td class="muted">${esc(ev.detail ? JSON.stringify(ev.detail).slice(0, 120) : "")}</td>
  </tr>`).join("");

  $("#content").innerHTML = `
    <div class="card">
      <form class="inline" id="audit-filter">
        <label>Action <input name="action" value="${esc(p.get("action") ?? "")}" placeholder="auth.login" /></label>
        <label>Tenant <select name="tenantId">
          <option value="">All</option>
          ${S.tenants.map((t) => `<option value="${t.id}"${p.get("tenantId") === t.id ? " selected" : ""}>${esc(t.slug)}</option>`).join("")}
        </select></label>
        <label class="grow0">From <input name="from" type="date" value="${esc(p.get("from") ?? "")}" /></label>
        <label class="grow0">To <input name="to" type="date" value="${esc(p.get("to") ?? "")}" /></label>
        <label class="grow0">Max <input name="take" type="number" value="${esc(p.get("take") ?? "100")}" style="width:80px" /></label>
        <button class="btn primary grow0">Apply</button>
      </form>
    </div>
    <div class="card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <h2 style="margin:0">Audit (${events.length})</h2>
        <span class="spacer"></span>
        <button class="btn sm grow0" id="audit-export-csv" data-tip="Download the full filtered range as a spreadsheet-friendly CSV file." data-tip-pos="bottom">Save CSV</button>
        <button class="btn sm grow0" id="audit-export-json" data-tip="Download the full filtered range as structured JSON." data-tip-pos="bottom">Save JSON</button>
      </div>
      <table><tr><th>Time</th><th>Action</th><th>Tenant</th><th>User</th><th>App</th><th>Detail</th></tr>${rows}</table>
    </div>`;

  $("#audit-filter").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const q = new URLSearchParams();
    for (const k of ["action", "tenantId", "from", "to"]) if (f.get(k)) q.set(k, f.get(k));
    q.set("take", f.get("take") || "100");
    sessionStorage.setItem("evoadmin.auditQ", q.toString());
    route();
  });

  // Export downloads exactly what the current filter selects (server truth —
  // re-fetched, not just the rows on screen, so Max doesn't silently cap it).
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  $("#audit-export-json").addEventListener("click", async () => {
    try {
      const all = await api("GET", `/admin/audit?${withTake(p, 10000)}`);
      download(`audit-${stamp()}.json`, "application/json", JSON.stringify(all, null, 2));
      toast(`Exported ${all.length} events`);
    } catch (err) { toast(err.message, true); }
  });
  $("#audit-export-csv").addEventListener("click", async () => {
    try {
      const all = await api("GET", `/admin/audit?${withTake(p, 10000)}`);
      download(`audit-${stamp()}.csv`, "text/csv", toCsv(all));
      toast(`Exported ${all.length} events`);
    } catch (err) { toast(err.message, true); }
  });
}

function withTake(params, take) {
  const q = new URLSearchParams(params);
  q.set("take", String(take));
  return q.toString();
}

function toCsv(events) {
  const cols = ["createdAt", "action", "tenantId", "userId", "appClientId", "ip", "detail"];
  const cell = (v) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...events.map((e) => cols.map((c) => cell(e[c])).join(","))].join("\r\n");
}

function download(filename, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── smtp ────────────────────────────────────────────────────────────────────

async function viewSmtp() {
  await loadTenants();
  const scope = sessionStorage.getItem("evoadmin.smtpScope") || "";
  const q = scope ? `?tenantId=${encodeURIComponent(scope)}` : "";
  const cfg = await api("GET", `/admin/smtp${q}`);

  $("#content").innerHTML = `
    <div class="card">
      <form class="inline"><label style="flex:0 0 220px">Scope
        <select id="smtp-scope">
          <option value="">Platform default</option>
          ${S.tenants.filter((t) => !t.deletedAt).map((t) =>
            `<option value="${t.id}"${scope === t.id ? " selected" : ""}>${esc(t.slug)}</option>`).join("")}
        </select></label>
        ${cfg ? `<span class="badge ${cfg.hasPassword ? "ok" : "warn"} grow0">${cfg.hasPassword ? "password stored (encrypted)" : "no password"}</span>` : `<span class="badge warn grow0">not configured</span>`}
      </form>
    </div>
    <div class="card" style="max-width:520px">
      <h2>${scope ? "Tenant SMTP" : "Platform default SMTP"}</h2>
      <form id="smtp-form">
        <label>Host <input name="host" required value="${esc(cfg?.host ?? "")}" /></label>
        <label>Port <input name="port" type="number" required value="${esc(cfg?.port ?? 587)}" /></label>
        <label style="display:block;margin:8px 0"><input type="checkbox" name="secure"${cfg?.secure ? " checked" : ""}/>implicit TLS (port 465)</label>
        <label>Username <input name="username" value="${esc(cfg?.username ?? "")}" /></label>
        ${pwField("password", "Password", {
          required: false,
          placeholder: "leave blank for none / to clear",
        })}
        <label>From address <input name="fromAddress" required value="${esc(cfg?.fromAddress ?? "")}" /></label>
        <p class="muted">Resolution per send: tenant config → platform default → env fallback.</p>
        <button class="btn primary">Save</button>
      </form>
    </div>`;

  $("#smtp-scope").addEventListener("change", (e) => {
    sessionStorage.setItem("evoadmin.smtpScope", e.target.value);
    route();
  });

  $("#smtp-form").addEventListener("submit", act(async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("PUT", "/admin/smtp", {
      ...(scope ? { tenantId: scope } : {}),
      host: f.get("host"),
      port: Number(f.get("port")),
      secure: f.get("secure") === "on",
      ...(f.get("username") ? { username: f.get("username") } : {}),
      ...(f.get("password") ? { password: f.get("password") } : {}),
      fromAddress: f.get("fromAddress"),
    });
    toast("SMTP config saved");
  }));
}

// ── boot ────────────────────────────────────────────────────────────────────

if (S.access) showApp();
else showLogin();
