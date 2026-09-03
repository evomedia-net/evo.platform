// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// Behaviour for the pages emailed links land on: the password reveal toggles
// and the reset / invite forms. It is one file served from this origin because
// the Content-Security-Policy allows script only from 'self', never inline
// (#156). The page says which flow it is through data attributes on the form;
// nothing here is page-specific, and the token never appears in script text.
(() => {
  const EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  // One delegated listener covers every toggle on the page. The toggle is a
  // sibling of its input, which is why parentElement is enough.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pw-toggle]');
    if (!btn) return;
    const input = btn.parentElement.querySelector('input');
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    btn.innerHTML = reveal ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  });

  const form = document.getElementById('f');
  if (!form) return;
  const flow = form.dataset.flow;
  const token = form.dataset.token;
  const MIN = Number(form.dataset.min);
  const signInUrl = form.dataset.signinUrl;

  const field = (id) => {
    const el = document.getElementById(id);
    const v = el ? el.value.trim() : '';
    return v || undefined;
  };

  // Terminal screen, built with DOM calls rather than markup so nothing the
  // server answered is ever interpreted as HTML.
  const done = (title, text) => {
    const card = document.querySelector('.card');
    card.replaceChildren();
    const h = document.createElement('h1');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    const a = document.createElement('a');
    a.className = 'cta';
    a.href = signInUrl;
    a.textContent = 'Go to sign in';
    card.append(h, p, a);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    const pw = document.getElementById('pw').value;
    if (pw !== document.getElementById('pw2').value) {
      err.textContent = 'Passwords do not match';
      return;
    }
    // Length only. The server owns the policy and answers with the exact
    // reason; a second rule set here is what silently contradicted the rules
    // printed directly above it.
    if (pw.length < MIN) {
      err.textContent = 'Password must be at least ' + MIN + ' characters';
      return;
    }
    err.textContent = '';
    const invite = flow === 'invite';
    const res = await fetch(invite ? '/auth/invites/accept' : '/auth/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        invite
          ? { token, password: pw, firstName: field('fn'), lastName: field('ln') }
          : { token, password: pw },
      ),
    });
    if (res.ok) {
      if (invite) {
        const out = await res.json().catch(() => null);
        const where = out && out.tenantSlug ? ' to the "' + out.tenantSlug + '" workspace' : '';
        done('Account created', 'Sign in' + where + ' with your new password.');
      } else {
        done('Password updated', 'All existing sessions were signed out. Sign in with your new password.');
      }
    } else {
      const body = await res.json().catch(() => null);
      const msg = body && (Array.isArray(body.message) ? body.message[0] : body.message);
      err.textContent =
        msg ||
        (invite
          ? 'This invite no longer works — ask for a new one.'
          : 'This link no longer works — request a new one.');
    }
  });
})();
