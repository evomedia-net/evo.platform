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

// ── auth + api ──────────────────────────────────────────────────────────────

function setSession(access, refresh, email) {
  S.access = access; S.refresh = refresh; S.email = email;
  sessionStorage.setItem("evoadmin.access", access);
  sessionStorage.setItem("evoadmin.refresh", refresh);
  sessionStorage.setItem("evoadmin.email", email);
}

function clearSession() {
  S.access = S.refresh = S.email = null;
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
      setSession(rr.data.accessToken, rr.data.refreshToken, rr.data.user.email);
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
  $("#login-view").hidden = false;
}

function showApp() {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  $("#who").textContent = S.email || "";
  route();
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#login-error");
  err.hidden = true;
  const r = await raw("POST", "/auth/login", {
    email: $("#login-email").value.trim(),
    password: $("#login-password").value,
  });
  if (!r.ok) { err.textContent = r.data?.message || "Sign-in failed"; err.hidden = false; return; }
  if (!r.data.user?.platformAdmin) {
    err.textContent = "This console requires a platform admin account";
    err.hidden = false;
    return;
  }
  setSession(r.data.accessToken, r.data.refreshToken, r.data.user.email);
  showApp();
});

$("#logout").addEventListener("click", async () => {
  if (S.refresh) await raw("POST", "/auth/logout", { refreshToken: S.refresh });
  showLogin();
});

// ── routing ─────────────────────────────────────────────────────────────────

const VIEWS = { tenants: viewTenants, users: viewUsers, apps: viewApps, audit: viewAudit, smtp: viewSmtp };

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
async function loadApps() { S.apps = await api("GET", "/admin/apps"); }
const tenantName = (id) => S.tenants.find((t) => t.id === id)?.slug || (id ? id.slice(0, 8) : "platform");
const fmt = (d) => (d ? new Date(d).toLocaleString() : "");

function act(fn) {
  // Wrap row-action handlers: run, toast errors, re-render current view.
  return async (...args) => {
    try { await fn(...args); route(); } catch (e) { toast(e.message, true); }
  };
}

// ── tenants ─────────────────────────────────────────────────────────────────

async function viewTenants() {
  await loadTenants();
  const rows = S.tenants.map((t) => {
    const state = t.deletedAt
      ? `<span class="badge bad">deleted</span>`
      : t.status === "ACTIVE"
        ? `<span class="badge ok">active</span>`
        : t.status === "PAST_DUE"
          ? `<span class="badge warn">past due${t.graceUntil ? " · grace to " + esc(fmt(t.graceUntil)) : ""}</span>`
          : `<span class="badge bad">suspended</span>`;
    const actions = t.deletedAt
      ? `<button class="btn sm" data-act="restore" data-id="${t.id}">Restore</button>`
      : `${t.status === "SUSPENDED"
          ? `<button class="btn sm" data-act="activate" data-id="${t.id}">Activate</button>`
          : `<button class="btn sm" data-act="suspend" data-id="${t.id}">Suspend</button>`}
         <button class="btn sm danger" data-act="delete" data-id="${t.id}">Delete</button>`;
    return `<tr><td><code>${esc(t.slug)}</code></td><td>${esc(t.name)}</td>
      <td>${esc(t.plan)}</td><td>${state}</td><td class="muted">${esc(fmt(t.createdAt))}</td>
      <td>${actions}</td></tr>`;
  }).join("");

  $("#content").innerHTML = `
    <div class="card">
      <h2>New tenant</h2>
      <form class="inline" id="tenant-create">
        <label>Slug <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" placeholder="acme" /></label>
        <label>Name <input name="name" required placeholder="Acme Widgets" /></label>
        <label>Plan <input name="plan" placeholder="free" /></label>
        <button class="btn primary grow0">Create</button>
      </form>
    </div>
    <div class="card"><h2>Tenants (${S.tenants.length})</h2>
      <table><tr><th>Slug</th><th>Name</th><th>Plan</th><th>Status</th><th>Created</th><th></th></tr>${rows}</table>
    </div>`;

  $("#tenant-create").addEventListener("submit", act(async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("POST", "/admin/tenants", {
      slug: f.get("slug"), name: f.get("name"),
      ...(f.get("plan") ? { plan: f.get("plan") } : {}),
    });
    toast("Tenant created");
  }));

  $("#content").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const { act: a, id } = btn.dataset;
    if (a === "delete" && !confirm("Soft-delete this tenant? It can be restored.")) return;
    try {
      if (a === "delete") await api("DELETE", `/admin/tenants/${id}`);
      else await api("POST", `/admin/tenants/${id}/${a}`);
      toast(`Tenant ${a}d`);
      route();
    } catch (err) { toast(err.message, true); }
  });
}

// ── users ───────────────────────────────────────────────────────────────────

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
      <td>${u.isPlatformAdmin ? '<span class="badge ok">admin</span>' : ""}</td>
      <td>${roleCell(u)}</td>
      <td>${u.deletedAt
        ? `<button class="btn sm" data-act="restore" data-id="${u.id}">Restore</button>`
        : `<button class="btn sm danger" data-act="delete" data-id="${u.id}">Delete</button>`}
      </td></tr>`).join("");

  $("#content").innerHTML = `
    <div class="card">
      <h2>New user</h2>
      <form class="inline" id="user-create">
        <label>Tenant <select name="tenantId">
          <option value="">Platform-level</option>
          ${S.tenants.filter((t) => !t.deletedAt).map((t) => `<option value="${t.id}">${esc(t.slug)}</option>`).join("")}
        </select></label>
        <label>Email <input name="email" type="email" required /></label>
        <label>Password <input name="password" type="text" required minlength="8" /></label>
        <label>Name <input name="name" /></label>
        <label class="grow0"><input type="checkbox" name="isPlatformAdmin" />platform admin</label>
        <button class="btn primary grow0">Create</button>
      </form>
    </div>
    <div class="card">
      <form class="inline"><label style="flex:0 0 220px">Filter by tenant
        <select id="user-filter">${tenantOpts(filter)}</select></label></form>
      <table><tr><th>Email</th><th>Name</th><th>Tenant</th><th></th><th>Roles</th><th></th></tr>${rows}</table>
    </div>`;

  $("#user-filter").addEventListener("change", (e) => {
    sessionStorage.setItem("evoadmin.userFilter", e.target.value);
    route();
  });

  $("#user-create").addEventListener("submit", act(async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api("POST", "/admin/users", {
      ...(f.get("tenantId") ? { tenantId: f.get("tenantId") } : {}),
      email: f.get("email"), password: f.get("password"),
      ...(f.get("name") ? { name: f.get("name") } : {}),
      isPlatformAdmin: f.get("isPlatformAdmin") === "on",
    });
    toast("User created");
  }));

  $("#content").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const { act: a, id } = btn.dataset;
    try {
      if (a === "delete") { await api("DELETE", `/admin/users/${id}`); toast("User deleted"); route(); }
      else if (a === "restore") { await api("POST", `/admin/users/${id}/restore`); toast("User restored"); route(); }
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

// ── apps ────────────────────────────────────────────────────────────────────

function secretModal(clientId, secret) {
  modal(`<h2>App credentials</h2>
    <p class="muted">The secret is shown <b>once</b> — store it now.</p>
    <p>Client id<br/><code>${esc(clientId)}</code></p>
    <p>Client secret<br/><code>${esc(secret)}</code></p>`);
}

async function viewApps() {
  await loadApps();
  const cards = S.apps.map((a) => `
    <div class="card">
      <h2>${esc(a.name)}</h2>
      <p>Client id: <code>${esc(a.clientId)}</code>
        <button class="btn sm" data-act="rotate" data-id="${a.id}">Rotate secret</button></p>
      <p class="muted">Callbacks: ${a.callbackUrls.map((u) => `<code>${esc(u)}</code>`).join(" ") || "—"}</p>
      <div class="chips">${a.roles.map((r) => `<span class="chip">${esc(r.name)}
        <button data-role-act="rename" data-app-id="${a.id}" data-role-id="${r.id}" data-role-name="${esc(r.name)}" title="Rename role">&#9998;</button>
        <button data-role-act="delete" data-app-id="${a.id}" data-role-id="${r.id}" data-role-name="${esc(r.name)}" title="Delete role">&times;</button>
      </span>`).join("")}</div>
      <form class="inline" data-app="${a.id}" style="margin-top:10px">
        <label style="flex:0 0 200px">Add role <input name="role" placeholder="admin" required /></label>
        <button class="btn sm grow0">Add</button>
      </form>
    </div>`).join("");

  $("#content").innerHTML = `
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
          if (!confirm(`Delete role "${roleName}"? It will be removed from every user that has it.`)) return;
          const out = await api("DELETE", `/admin/apps/${appId}/roles/${roleId}`);
          toast(`Role deleted (${out.assignmentsRemoved} assignment${out.assignmentsRemoved === 1 ? "" : "s"} removed)`);
        }
        route();
      } catch (err) { toast(err.message, true); }
      return;
    }

    const btn = e.target.closest("button[data-act=rotate]");
    if (!btn) return;
    if (!confirm("Rotate this app's secret? The old secret stops working immediately.")) return;
    try {
      const out = await api("POST", `/admin/apps/${btn.dataset.id}/rotate-secret`);
      secretModal(out.clientId, out.clientSecret);
    } catch (err) { toast(err.message, true); }
  });

  $("#content").addEventListener("submit", async (e) => {
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
        <button class="btn sm grow0" id="audit-export-csv">Save CSV</button>
        <button class="btn sm grow0" id="audit-export-json">Save JSON</button>
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
        <label>Password <input name="password" type="password" placeholder="leave blank for none / to clear" /></label>
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
