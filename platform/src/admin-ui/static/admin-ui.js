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

/** Cents -> "$49.00", in whatever currency Stripe reported. */
function money(cents, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "usd").toUpperCase(),
    }).format((cents ?? 0) / 100);
  } catch {
    // An unknown currency code must not blank the whole price table.
    return `${((cents ?? 0) / 100).toFixed(2)} ${String(currency || "").toUpperCase()}`;
  }
}

/** How often it bills, in words: "Monthly", "Once", "Every 3 months". */
function cadence(interval, count) {
  const n = count ?? 1;
  if (interval === "once") return "Once";
  const single = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" };
  if (n === 1) return single[interval] ?? interval;
  return `Every ${n} ${interval}s`;
}

// Which folds the operator has opened. Views re-render wholesale after every
// mutation, and <details> loses its open attribute when its markup is replaced
// — so a card would slam shut the moment you changed anything inside it.
const OPEN = { app: new Set(), access: new Set(), tenant: new Set(), tpl: new Set() };
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement)) return;
  for (const kind of ["app", "access", "tenant", "tpl"]) {
    const id = d.dataset[`fold${kind[0].toUpperCase()}${kind.slice(1)}`];
    if (id) { d.open ? OPEN[kind].add(id) : OPEN[kind].delete(id); }
  }
}, true);


// ── rich text editor ────────────────────────────────────────────────────────
//
// contenteditable + document.execCommand, no dependency and no CDN — the same
// approach evo.ehs uses for its templates, which matters here because the
// console must keep working on a box with no outbound internet.
//
// execCommand is deprecated but unreplaced: there is still no standard API for
// "make the selection bold" in a contenteditable, and every browser we target
// implements it. The alternative is shipping a 200KB editor to format four
// paragraphs of email copy.

const RTE_BUTTONS = [
  ["bold", "<b>B</b>", "Bold"],
  ["italic", "<i>I</i>", "Italic"],
  ["underline", "<u>U</u>", "Underline"],
  ["|"],
  ["insertUnorderedList", "&bull;&mdash;", "Bullet list"],
  ["insertOrderedList", "1.", "Numbered list"],
  ["|"],
  ["createLink", "&#128279;", "Insert link"],
  ["unlink", "&#128279;&#x20e0;", "Remove link"],
  ["|"],
  ["removeFormat", "&#10005;", "Clear formatting"],
];

/**
 * Mount an editor into `host`. Returns { getHTML }.
 *
 * `tags` are the template's variables: picking one inserts it at the cursor,
 * which is the difference between an editor someone can use and one where they
 * have to remember that it is {{productName}} and not {{product_name}}.
 */
function mountRte(host, { value = "", tags = [] } = {}) {
  const buttons = RTE_BUTTONS.map(([cmd, label, title]) =>
    cmd === "|"
      ? '<span class="rte-sep"></span>'
      : `<button type="button" data-cmd="${cmd}" title="${title}">${label}</button>`,
  ).join("");
  const tagSelect = tags.length
    ? `<span class="rte-sep"></span>
       <select data-rte="tag" title="Insert a value the platform fills in when the mail is sent">
         <option value="">Insert variable…</option>
         ${tags.map((t) => `<option value="{{${esc(t)}}}">${esc(t)}</option>`).join("")}
       </select>`
    : "";

  host.innerHTML = `
    <div class="rte">
      <div class="rte-toolbar">
        ${buttons}${tagSelect}
        <span class="rte-sep"></span>
        <button type="button" data-rte="source" title="Edit the HTML directly">&lt;/&gt;</button>
      </div>
      <div class="rte-body" contenteditable="true"></div>
      <textarea class="rte-src" spellcheck="false"></textarea>
    </div>`;

  const wrap = host.querySelector(".rte");
  const body = host.querySelector(".rte-body");
  const src = host.querySelector(".rte-src");
  body.innerHTML = value || "<p></p>";

  // Toolbar state has to follow the caret, or the buttons lie about what the
  // selection already is.
  const sync = () => {
    for (const b of host.querySelectorAll("button[data-cmd]")) {
      let on = false;
      try { on = document.queryCommandState(b.dataset.cmd); } catch { /* not queryable */ }
      b.classList.toggle("on", on);
    }
  };
  body.addEventListener("keyup", sync);
  body.addEventListener("mouseup", sync);

  host.addEventListener("mousedown", (e) => {
    // Keep the selection: focus must not leave the body when a button is hit.
    if (e.target.closest("button[data-cmd], button[data-rte]")) e.preventDefault();
  });

  host.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cmd]");
    if (btn) {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      if (cmd === "createLink") {
        const url = prompt("Link to:");
        if (!url) return;
        document.execCommand("createLink", false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      body.focus();
      sync();
      return;
    }
    const act = e.target.closest('button[data-rte="source"]');
    if (act) {
      e.preventDefault();
      // Moving between the two views has to carry the content across, or
      // whichever one is hidden silently becomes the stale copy.
      if (wrap.classList.contains("src-open")) {
        body.innerHTML = src.value;
        wrap.classList.remove("src-open");
        body.focus();
      } else {
        src.value = body.innerHTML;
        wrap.classList.add("src-open");
        src.focus();
      }
    }
  });

  host.addEventListener("change", (e) => {
    const sel = e.target.closest('select[data-rte="tag"]');
    if (!sel || !sel.value) return;
    body.focus();
    document.execCommand("insertText", false, sel.value);
    sel.value = "";
  });

  return {
    getHTML: () => (wrap.classList.contains("src-open") ? src.value : body.innerHTML).trim(),
  };
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

const VIEWS = { tenants: viewTenants, users: viewUsers, apps: viewApps, revenue: viewRevenue, audit: viewAudit, smtp: viewSmtp, email: viewEmailTemplates };

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
      <td><div class="badges">${u.isPlatformAdmin ? '<span class="badge ok">admin</span>' : ""}${u.isTenantAdmin ? '<span class="badge ok" data-tip="Manages their own tenant\'s members from inside the apps.">tenant admin</span>' : ""}${u.emailVerifiedAt ? "" : '<span class="badge warn" data-tip="Mailbox not yet proven — sign-in is refused until the user clicks their verification email.">unverified</span>'}</div></td>
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
  await loadTenants();
  // Per-app tenant access (the enablement matrix, one column per card) and the
  // price list, fetched together so one slow card doesn't serialise the page.
  const [accessByApp, pricesByApp] = await Promise.all([
    Promise.all(S.apps.map(async (a) => [a.id, await api("GET", `/admin/apps/${a.id}/tenants`)])).then(Object.fromEntries),
    Promise.all(S.apps.map(async (a) => [a.id, await api("GET", `/admin/apps/${a.id}/prices`)])).then(Object.fromEntries),
  ]);
  for (const a of S.apps) a.prices = pricesByApp[a.id] ?? [];

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
     <details class="fold" data-fold-app="${a.id}"${OPEN.app.has(a.id) ? " open" : ""}>
      <summary>
        <h2>${esc(a.name)}${a.deletedAt ? ' <span class="badge bad">deleted</span>' : ""}</h2>
        <span class="muted">${a.prices.length ? `${a.prices.length} price${a.prices.length === 1 ? "" : "s"}` : "no prices"} &middot; ${a.roles.length} role${a.roles.length === 1 ? "" : "s"}</span>
      </summary>
      <div class="fold-body">
      <p>Client id: <code>${esc(a.clientId)}</code>
        ${a.deletedAt
          ? `<button class="btn sm" data-act="app-restore" data-id="${a.id}" data-name="${esc(a.name)}" data-tip="Bring this app back. Its client id, roles and tenant grants are intact, and sign-in through it starts working again.">Restore</button>
             <button class="btn sm danger" data-act="app-purge" data-id="${a.id}" data-name="${esc(a.name)}" data-tip="Erase this app permanently, with its roles, every user's assignments to them, and every tenant's access. This cannot be undone.">Purge</button>`
          : `<button class="btn sm" data-act="rotate" data-id="${a.id}" data-tip="Replace this app's client secret — do it if the secret may have leaked, when someone with access leaves, or on a rotation schedule. The old secret stops working immediately, so update the app's config right away.">Rotate secret</button>
             <button class="btn sm danger" data-act="app-delete" data-id="${a.id}" data-name="${esc(a.name)}" data-tip="Soft-delete: sign-in through this app stops immediately, but nothing is destroyed and it can be restored. The client id stays reserved so it cannot be re-registered underneath.">Delete</button>`}</p>
      <form class="inline" data-app-display="${a.id}" style="margin-top:6px">
        <label style="flex:1 1 260px" data-tip="What customers read: 'Acme Widgets', not the 'acme-widgets' registry slug. Used in email subject lines, the sender name, and the password-reset page - where a slug undermines the legitimacy the message needs. Empty falls back to a title-cased slug.">Display name <input name="displayName" placeholder="Acme Widgets" value="${esc(a.displayName ?? "")}" /></label>
        <button class="btn sm grow0">Save</button>
      </form>
      <form data-app-brand="${a.id}" style="margin-top:6px">
        <label style="display:block" data-tip="Brand identity served to this app at startup (#91): product name, wordmark halves, domains, support addresses, legal entity. The app merges it over the brand.json it ships, so anything left out here keeps whatever the app's own file says. Leave empty to serve nothing and let the app run entirely on its file.">Brand config (JSON)</label>
        <textarea name="brand" rows="10" spellcheck="false" placeholder='{"product":{"name":"Acme Widgets","wordmark":{"lead":"Acme","accent":" Widgets"}}}' style="width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px">${esc(a.brand ? JSON.stringify(a.brand, null, 2) : "")}</textarea>
        <button class="btn sm grow0" style="margin-top:6px">Save brand</button>
      </form>
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
      <h3 data-tip="What this app sells. Add as many tiers and billing periods as the product needs — the amount and cadence are read from Stripe, never typed here, so this table cannot disagree with what a customer is actually charged.">Prices</h3>
      <table>
        <tr><th>ProdID</th><th>StripeID</th><th>Name</th><th>Tier</th><th>Cost</th><th>Occurrence</th><th class="col-actions"></th></tr>
        ${a.prices.length === 0
          ? '<tr><td colspan="7" class="muted">Nothing to sell yet — add a Stripe price below.</td></tr>'
          : a.prices.map((p) => `<tr>
              <td><code>${esc(p.stripeProductId || "—")}</code></td>
              <td><code>${esc(p.stripePriceId)}</code></td>
              <td>${esc(p.productName || "—")}</td>
              <td><code>${esc(p.tier)}</code>${p.trialDays > 0 ? ` <span class="badge" data-tip="New subscriptions on this tier start with a free trial.">${p.trialDays}d trial</span>` : ""}${p.sellable ? "" : ' <span class="badge warn" data-tip="Not offered to new customers. Existing subscriptions on this tier keep working.">archived</span>'}</td>
              <td>${esc(money(p.unitAmount, p.currency))}</td>
              <td>${esc(cadence(p.interval, p.intervalCount))}</td>
              <td class="col-actions"><button class="btn sm danger" data-price-act="remove" data-app-id="${a.id}" data-price-id="${p.id}" data-price-tier="${esc(p.tier)}" data-tip="Stop selling this tier. Existing subscriptions are untouched — they live in Stripe, and cancelling them is a deliberate act there.">Remove</button></td>
            </tr>`).join("")}
      </table>
      <form class="inline" data-app-price="${a.id}" style="margin-top:10px">
        <label style="flex:0 0 260px" data-tip="A Stripe Price id (price_...). It is checked against Stripe before it is saved, and its product, amount and cadence are read from there.">Stripe price id <input name="priceId" placeholder="price_..." required /></label>
        <label style="flex:0 0 160px" data-tip="What this app calls the tier — apps ask for a price by tier name, so this is also what gets stamped on a workspace's plan.">Tier <input name="tier" placeholder="pro" required /></label>
        <button class="btn sm grow0">Add price</button>
      </form>
      <label class="check" style="display:block;margin-top:10px" data-tip="Checked: workspaces you create in this console start enabled on this app. Unchecked: access must be granted specifically — here, by signup through the app, or by subscription. Self-service signup is unaffected (it only ever enables the app arrived through).">
        <input type="checkbox" data-auto-enroll="${a.id}"${a.autoEnroll ? " checked" : ""} /> Auto-enroll new tenants
      </label>
      <details class="fold" data-fold-access="${a.id}"${OPEN.access.has(a.id) ? " open" : ""}>
        <summary>
          <h3 data-tip="Which workspaces may sign in to this app. Logins scoped to an app are refused unless the workspace is enabled here.">Tenant access</h3>
          <span class="muted">${S.tenants.filter((t) => !t.deletedAt).length} workspace${S.tenants.filter((t) => !t.deletedAt).length === 1 ? "" : "s"}</span>
        </summary>
        <div class="fold-body">
          <table><tr><th>Slug</th><th>Name</th><th>Access</th><th class="col-actions"></th></tr>${accessRows(a)}</table>
        </div>
      </details>
      </div>
     </details>
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

    const priceBtn = e.target.closest("button[data-price-act]");
    if (priceBtn) {
      const { appId, priceId, priceTier } = priceBtn.dataset;
      try {
        if (!(await confirmDialog(`Stop selling "${priceTier}"? Existing subscriptions on it keep billing — cancel those in Stripe if that is what you mean.`))) return;
        await api("DELETE", `/admin/apps/${appId}/prices/${priceId}`);
        toast("Price removed");
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
    const dispForm = e.target.closest("form[data-app-display]");
    if (dispForm) {
      e.preventDefault();
      const displayName = String(new FormData(dispForm).get("displayName") || "").trim();
      try {
        await api("PATCH", `/admin/apps/${dispForm.dataset.appDisplay}`, { displayName });
        toast("Display name saved"); route();
      } catch (err) { toast(err.message, true); }
      return;
    }

    const brandForm = e.target.closest("form[data-app-brand]");
    if (brandForm) {
      e.preventDefault();
      const raw = String(new FormData(brandForm).get("brand") || "").trim();
      let brand = null;
      if (raw) {
        try {
          brand = JSON.parse(raw);
        } catch (err) {
          // Refuse locally rather than posting invalid JSON: the operator
          // needs the parser's own message to find the missing comma.
          toast("Brand config is not valid JSON: " + err.message, true);
          return;
        }
      }
      try {
        await api("PATCH", `/admin/apps/${brandForm.dataset.appBrand}/brand`, { brand });
        toast(brand ? "Brand saved" : "Brand cleared - this app now uses its own file");
        await loadApps();
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }

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
      const f = new FormData(priceForm);
      const priceId = String(f.get("priceId") || "").trim();
      const tier = String(f.get("tier") || "").trim();
      // Shape check before the request; the server additionally asks Stripe
      // whether the price actually exists. A wrong id used to be accepted
      // silently and only surfaced at checkout, in front of a paying customer.
      if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
        toast("A Stripe price id looks like price_1A2b3C…", true);
        return;
      }
      if (!tier) { toast("Name the tier this price sells", true); return; }
      try {
        await api("POST", `/admin/apps/${priceForm.dataset.appPrice}/prices`, { stripePriceId: priceId, tier });
        toast("Price added"); route();
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


// ── email copy ──────────────────────────────────────────────────────────────
//
// Platform-level only: one voice across every product, so there is nothing
// tenant-scoped here. Editing words cannot break the message - the server
// falls back to the built-in copy whenever a saved row is unusable - which is
// why this page can be a plain textarea rather than a guarded HTML editor.

async function viewEmailTemplates() {
  const templates = await api("GET", "/admin/email-templates");

  const card = (t) => `
    <div class="card">
     <details class="fold" data-fold-tpl="${t.code}"${OPEN.tpl.has(t.code) ? " open" : ""}>
      <summary>
        <h2>${esc(t.code)}</h2>
        <span class="muted">${esc(t.description)}${t.customized ? " · edited" : " · default"}</span>
      </summary>
      <div class="fold-body">
        <form class="tpl-form" data-tpl="${t.code}">
          <p class="tpl-vars muted small">Variables:
            ${t.variables.map((v) => `<code>{{${esc(v)}}}</code>`).join(" ")}
            &mdash; escaped when substituted, so they cannot inject markup.</p>

          <label>Subject
            <input type="text" name="subject" value="${esc(t.subject)}" required /></label>

          <label>Heading
            <input type="text" name="heading" value="${esc(t.heading)}" required /></label>

          <label>Intro <span class="muted">(above the button)</span></label>
          <div data-rte-for="intro"></div>

          <label>Button label
            <input type="text" name="actionLabel" value="${esc(t.actionLabel)}" /></label>

          <label>Closing <span class="muted">(below the button)</span></label>
          <div data-rte-for="outro"></div>

          <div class="row">
            <button class="btn primary">Save</button>
            <button type="button" class="btn" data-tpl-act="preview" data-code="${t.code}">Preview</button>
            <button type="button" class="btn" data-tpl-act="test" data-code="${t.code}" data-tip="Sends the sample to an address you choose, which is the only way to see how it actually arrives.">Send test</button>
            ${t.customized ? `<button type="button" class="btn danger" data-tpl-act="reset" data-code="${t.code}">Revert to default</button>` : ""}
          </div>
        </form>
      </div>
     </details>
    </div>`;

  $("#content").innerHTML = `
    <div class="card">
      <h2>Email copy</h2>
      <p class="muted">What the platform's messages say. These apply to every product &mdash;
        the product name is a variable, so one wording serves all of them. Saving cannot break a
        message: if a template is left incomplete, the built-in copy is used instead.</p>
    </div>
    ${templates.map(card).join("")}`;

  // One editor per body field, keyed so the submit handler can read them back.
  const editors = new Map();
  for (const t of templates) {
    const form = $(`form[data-tpl="${t.code}"]`);
    for (const field of ["intro", "outro"]) {
      const host = form.querySelector(`[data-rte-for="${field}"]`);
      editors.set(`${t.code}:${field}`, mountRte(host, { value: t[field], tags: t.variables }));
    }
  }

  $("#content").addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-tpl]");
    if (!form) return;
    e.preventDefault();
    const code = form.dataset.tpl;
    const f = new FormData(form);
    try {
      await api("PUT", `/admin/email-templates/${code}`, {
        subject: String(f.get("subject") || ""),
        heading: String(f.get("heading") || ""),
        intro: editors.get(`${code}:intro`).getHTML(),
        actionLabel: String(f.get("actionLabel") || ""),
        outro: editors.get(`${code}:outro`).getHTML(),
      });
      toast("Saved"); route();
    } catch (err) { toast(err.message, true); }
  });

  $("#content").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-tpl-act]");
    if (!btn) return;
    const { tplAct, code } = btn.dataset;
    try {
      if (tplAct === "preview") {
        const msg = await api("GET", `/admin/email-templates/${code}/preview`);
        // srcdoc in a sandboxed frame: the preview is rendered mail, and it
        // must not be able to run anything against the console session.
        modal(`<h3>Subject: ${esc(msg.subject)}</h3>
          <iframe sandbox="" style="width:100%;height:420px;border:1px solid var(--border);border-radius:8px;background:#fff"
                  srcdoc="${esc(msg.html)}"></iframe>`);
      } else if (tplAct === "test") {
        const to = prompt("Send the sample to which address?");
        if (!to) return;
        await api("POST", `/admin/email-templates/${code}/test`, { to });
        toast("Test sent");
      } else if (tplAct === "reset") {
        if (!(await confirmDialog("Revert this template to the built-in copy? Your edits are discarded."))) return;
        await api("DELETE", `/admin/email-templates/${code}`);
        toast("Reverted to default"); route();
      }
    } catch (err) { toast(err.message, true); }
  });
}

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
