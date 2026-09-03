// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
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
  /* Names the product above the heading: someone who arrived from a reset
     email needs to see which product this page belongs to before typing a
     password into it (#103). */
  .brand { font-size: 13px; font-weight: 700; letter-spacing: .02em;
    text-transform: none; color: #1d4067; margin: 0 0 14px;
    padding-bottom: 10px; border-bottom: 1px solid #9fbadd; }
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

/**
 * The page's behaviour - reveal toggles, form submit, the success screen -
 * lives in /auth-pages.js and is told which flow it serves through data
 * attributes on the form. It used to be inline; the Content-Security-Policy
 * allows script only from this origin's own files, never inline (#156).
 */
const PAGE_SCRIPT = '<script src="/auth-pages.js"></script>';

/**
 * Terminal screens used to end at "you can close this tab" — correct but a dead
 * end, leaving someone who just set a password with nothing to click. Points at
 * the platform sign-in; app users reach their own app's sign-in from there.
 */
function signInButton(url = `${config.publicBaseUrl}/`): string {
  return `<a class="cta" href="${escapeHtml(url)}">Go to sign in</a>`;
}

/** Escape a registry value before it is embedded in a page. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(body: string, product = config.brand.platformName): string {
  const name = escapeHtml(product);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${name}</title>
<style>${SHELL_STYLE}</style></head><body><div class="card">
<p class="brand">${name}</p>${body}</div></body></html>`;
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
/**
 * @param product  Name shown to the user, resolved from the app registry.
 * @param signInUrl Where the success screen sends them - the app they started
 *                  from, not the operator console (#103). Registry-owned.
 */
export function resetFormPage(token: string, product?: string, signInUrl?: string): string {
  const home = signInUrl ?? `${config.publicBaseUrl}/`;
  return page(`
    <h1>Set a new password</h1>
    <p>${PASSWORD_RULES_TEXT}</p>
    <form id="f" data-flow="reset" data-token="${escapeHtml(token)}" data-min="${PASSWORD_MIN_LENGTH}" data-signin-url="${escapeHtml(home)}">
      ${passwordField('pw', 'New password')}
      ${passwordField('pw2', 'Confirm new password')}
      <p class="err" id="err"></p>
      <button type="submit">Reset password</button>
    </form>
    ${PAGE_SCRIPT}`, product);
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
    <form id="f" data-flow="invite" data-token="${escapeHtml(token)}" data-min="${PASSWORD_MIN_LENGTH}" data-signin-url="${escapeHtml(`${config.publicBaseUrl}/`)}">
      <input id="fn" type="text" placeholder="First name" autocomplete="given-name" />
      <input id="ln" type="text" placeholder="Last name" autocomplete="family-name" />
      ${passwordField('pw', 'Password')}
      ${passwordField('pw2', 'Confirm password')}
      <p class="err" id="err"></p>
      <button type="submit">Create account</button>
    </form>
    ${PAGE_SCRIPT}`);
}

export function inviteInvalidPage(): string {
  return page(`<h1>Invite invalid or expired</h1>
    <p>Invites work once and expire after 24 hours. Ask your workspace admin
    to send a fresh one.</p>`);
}
