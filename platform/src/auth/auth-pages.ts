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
import { config } from '../config';
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from '../core/password-policy';

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
  /* Password field with an inline show/hide toggle, mirroring the console. */
  .pw-field { position: relative; }
  .pw-field input { padding-right: 40px; }
  .pw-field button.pw-toggle { position: absolute; right: 2px; top: 6px; bottom: 6px;
    width: 34px; margin: 0; padding: 0; display: flex; align-items: center;
    justify-content: center; background: none; border: 0; border-radius: 6px;
    color: #4a6b8a; cursor: pointer; }
  .pw-field button.pw-toggle:hover { background: none; color: #003366; }
  .pw-field button.pw-toggle:focus-visible { outline: 2px solid #336699; outline-offset: 1px; }
  a.cta { display: block; margin-top: 14px; padding: 10px; border-radius: 6px;
    background: #336699; color: #fff; font-size: 14px; font-weight: 600;
    text-decoration: none; }
  a.cta:hover { background: #003366; }
`;

/** Same icons and behavior as the admin console, so a password field looks and
 *  acts the same wherever someone meets one. Inline because these pages load
 *  no external assets of any kind. */
const EYE =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

/** A password input with its reveal toggle as a SIBLING — the delegated handler
 *  walks parentElement to find the input. */
function passwordField(id: string, placeholder: string): string {
  return `<div class="pw-field">
      <input id="${id}" type="password" placeholder="${placeholder}" autocomplete="new-password" required />
      <button type="button" class="pw-toggle" data-pw-toggle aria-label="Show password">${EYE}</button>
    </div>`;
}

/** One delegated listener covers every toggle on the page. */
const PW_TOGGLE_SCRIPT = `
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-pw-toggle]');
        if (!btn) return;
        const input = btn.parentElement.querySelector('input');
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        btn.innerHTML = reveal ? ${JSON.stringify(EYE_OFF)} : ${JSON.stringify(EYE)};
        btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
      });`;

/**
 * Terminal screens used to end at "you can close this tab" — correct but a dead
 * end, leaving someone who just set a password with nothing to click. Points at
 * the platform sign-in; app users reach their own app's sign-in from there.
 */
function signInButton(): string {
  return `<a class="cta" href="${config.publicBaseUrl}/">Go to sign in</a>`;
}

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
         <p>Your account is active.</p>
         ${signInButton()}`
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
      ${passwordField('pw', 'New password')}
      ${passwordField('pw2', 'Confirm new password')}
      <p class="err" id="err"></p>
      <button type="submit">Reset password</button>
    </form>
    <script>
      const token = ${JSON.stringify(token)};
      const MIN = ${PASSWORD_MIN_LENGTH};
      const SIGNIN_HTML = ${JSON.stringify(signInButton())};${PW_TOGGLE_SCRIPT}
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('err');
        const pw = document.getElementById('pw').value;
        if (pw !== document.getElementById('pw2').value) { err.textContent = 'Passwords do not match'; return; }
        // Length only. The server owns the policy and answers with the exact
        // reason; a second rule set here is what silently contradicted the
        // rules printed directly above it.
        if (pw.length < MIN) { err.textContent = 'Password must be at least ' + MIN + ' characters'; return; }
        err.textContent = '';
        const res = await fetch('/auth/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, password: pw }),
        });
        if (res.ok) {
          document.querySelector('.card').innerHTML =
            '<h1>Password updated</h1><p>All existing sessions were signed out. Sign in with your new password.</p>' + SIGNIN_HTML;
        } else {
          const body = await res.json().catch(() => null);
          const msg = body && (Array.isArray(body.message) ? body.message[0] : body.message);
          err.textContent = msg || 'This link no longer works — request a new one.';
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
      ${passwordField('pw', 'Password')}
      ${passwordField('pw2', 'Confirm password')}
      <p class="err" id="err"></p>
      <button type="submit">Create account</button>
    </form>
    <script>
      const token = ${JSON.stringify(token)};
      const MIN = ${PASSWORD_MIN_LENGTH};
      const SIGNIN_HTML = ${JSON.stringify(signInButton())};${PW_TOGGLE_SCRIPT}
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = document.getElementById('err');
        const pw = document.getElementById('pw').value;
        if (pw !== document.getElementById('pw2').value) { err.textContent = 'Passwords do not match'; return; }
        // Length only — see the note in resetFormPage.
        if (pw.length < MIN) { err.textContent = 'Password must be at least ' + MIN + ' characters'; return; }
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
            '<h1>Account created</h1><p>Sign in' + where + ' with your new password.</p>' + SIGNIN_HTML;
        } else {
          const body = await res.json().catch(() => null);
          const msg = body && (Array.isArray(body.message) ? body.message[0] : body.message);
          err.textContent = msg || 'This invite no longer works — ask for a new one.';
        }
      });
    </script>`);
}

export function inviteInvalidPage(): string {
  return page(`<h1>Invite invalid or expired</h1>
    <p>Invites work once and expire after 24 hours. Ask your workspace admin
    to send a fresh one.</p>`);
}
