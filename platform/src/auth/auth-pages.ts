// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Minimal self-contained HTML for the two pages email links land on. No
 * external assets of any kind (fonts are system-stack per project rule);
 * brand palette inlined. Apps can host richer pages later — these make the
 * flows complete with nothing but the platform.
 *
 * Password rules are read from PASSWORD_RULES_TEXT rather than written out
 * here. These pages are where someone actually chooses a password, so text
 * that drifts from the enforcement contradicts itself on the same screen —
 * which is exactly what happened when the policy moved to the NIST/OWASP
 * Standard and these strings kept describing the deleted composition rule.
 */
import { PASSWORD_RULES_TEXT } from '../core/password-policy';

const SHELL_STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #cfe0f0; font-family: system-ui, "Segoe UI", sans-serif; color: #14304a; }
  .card { background: #c3d7f0; border: 1px solid #9fbadd; border-radius: 10px;
    padding: 28px 34px; max-width: 420px; text-align: center;
    box-shadow: 0 2px 10px rgba(0, 51, 102, 0.12); }
  h1 { font-size: 20px; margin: 0 0 10px; color: #003366; }
  p { font-size: 14px; line-height: 1.5; margin: 0 0 8px; }
  .err { color: #a33; min-height: 18px; font-size: 13px; }
  input { width: 100%; box-sizing: border-box; margin: 6px 0; padding: 9px 10px;
    border: 1px solid #9fbadd; border-radius: 6px; font-size: 14px; }
  button { width: 100%; margin-top: 10px; padding: 10px; border: 0; border-radius: 6px;
    background: #336699; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #003366; }
`;

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/><title>EvoPlatform</title>
<style>${SHELL_STYLE}</style></head><body><div class="card">${body}</div></body></html>`;
}

export function verifyResultPage(ok: boolean): string {
  return page(
    ok
      ? `<h1>Email verified</h1>
         <p>Your account is active. You can close this tab and sign in.</p>`
      : `<h1>Link invalid or expired</h1>
         <p>This verification link no longer works. Request a new one from the
         sign-in screen, or ask your administrator.</p>`,
  );
}

/** token must already be validated as JWT-shaped before being embedded. */
export function resetFormPage(token: string): string {
  return page(`
    <h1>Set a new password</h1>
    <p>${PASSWORD_RULES_TEXT}</p>
    <form id="f">
      <input id="pw" type="password" placeholder="New password" autocomplete="new-password" required />
      <input id="pw2" type="password" placeholder="Confirm new password" autocomplete="new-password" required />
      <p class="err" id="err"></p>
      <button type="submit">Reset password</button>
    </form>
    <script>
      const token = ${JSON.stringify(token)};
      const policy = /^(?=(?:.*\\d){2,})(?=(?:.*[^A-Za-z0-9]){2,}).{8,}$/;
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('err');
        const pw = document.getElementById('pw').value;
        if (pw !== document.getElementById('pw2').value) { err.textContent = 'Passwords do not match'; return; }
        if (!policy.test(pw)) { err.textContent = 'Password does not meet the policy above'; return; }
        err.textContent = '';
        const res = await fetch('/auth/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, password: pw }),
        });
        if (res.ok) {
          document.querySelector('.card').innerHTML =
            '<h1>Password updated</h1><p>All existing sessions were signed out. You can close this tab and sign in with your new password.</p>';
        } else {
          const body = await res.json().catch(() => null);
          err.textContent = (body && body.message) || 'This link no longer works — request a new one.';
        }
      });
    </script>`);
}

export function resetInvalidPage(): string {
  return page(`<h1>Link invalid or expired</h1>
    <p>Reset links work once and expire after 30 minutes. Request a new one
    from the sign-in screen.</p>`);
}

/** token must already be validated as base64url-shaped before being embedded. */
export function inviteAcceptPage(token: string): string {
  return page(`
    <h1>Create your account</h1>
    <p>Choose a password. ${PASSWORD_RULES_TEXT}</p>
    <form id="f">
      <input id="fn" type="text" placeholder="First name" autocomplete="given-name" />
      <input id="ln" type="text" placeholder="Last name" autocomplete="family-name" />
      <input id="pw" type="password" placeholder="Password" autocomplete="new-password" required />
      <input id="pw2" type="password" placeholder="Confirm password" autocomplete="new-password" required />
      <p class="err" id="err"></p>
      <button type="submit">Create account</button>
    </form>
    <script>
      const token = ${JSON.stringify(token)};
      const policy = /^(?=(?:.*\\d){2,})(?=(?:.*[^A-Za-z0-9]){2,}).{8,}$/;
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('err');
        const pw = document.getElementById('pw').value;
        if (pw !== document.getElementById('pw2').value) { err.textContent = 'Passwords do not match'; return; }
        if (!policy.test(pw)) { err.textContent = 'Password does not meet the policy above'; return; }
        err.textContent = '';
        const res = await fetch('/auth/invites/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token,
            password: pw,
            firstName: document.getElementById('fn').value.trim() || undefined,
            lastName: document.getElementById('ln').value.trim() || undefined,
          }),
        });
        if (res.ok) {
          const out = await res.json().catch(() => null);
          const where = out && out.tenantSlug ? ' to the "' + out.tenantSlug + '" workspace' : '';
          document.querySelector('.card').innerHTML =
            '<h1>Account created</h1><p>You can close this tab and sign in' + where + ' with your new password.</p>';
        } else {
          const body = await res.json().catch(() => null);
          err.textContent = (body && body.message) || 'This invite no longer works — ask for a new one.';
        }
      });
    </script>`);
}

export function inviteInvalidPage(): string {
  return page(`<h1>Invite invalid or expired</h1>
    <p>Invites work once and expire after 24 hours. Ask your workspace admin
    to send a fresh one.</p>`);
}
