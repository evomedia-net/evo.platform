// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The rules a user is SHOWN must match the rules that are ENFORCED.
 *
 * When the policy moved to the NIST/OWASP Standard (#31, #32), three surfaces
 * kept describing the composition rule that had just been deleted: the
 * password-reset page, the invite/verify page, and the console's new-user
 * tooltip. Someone read "8 characters, 2 numbers, 2 special characters", typed
 * exactly that, and was rejected by a policy wanting 12+ and no symbols — with
 * the contradiction on the same screen (#41).
 *
 * These tests read the actual source files rather than the rendered output, so
 * they fail on a hardcoded string reappearing anywhere, not just on the two
 * that were wrong.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from './password-policy';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const AUTH_PAGES = src('auth', 'auth-pages.ts');
const ADMIN_UI = src('admin-ui', 'static', 'admin-ui.js');

/** The composition rule that no longer exists, in the wordings it appeared in. */
const DELETED_RULE = [/\b8 characters\b/, /\b2 numbers\b/, /\b2 special characters\b/];

describe('user-facing password rules match the enforced policy', () => {
  it('the reset and invite pages read the shared constant', () => {
    // Both pages, so neither can be fixed while the other is missed.
    expect(AUTH_PAGES).toContain('PASSWORD_RULES_TEXT');
    expect(AUTH_PAGES.match(/\$\{PASSWORD_RULES_TEXT\}/g)?.length).toBe(2);
  });

  it('no page hardcodes the deleted composition rule', () => {
    for (const pattern of DELETED_RULE) {
      expect(AUTH_PAGES).not.toMatch(pattern);
      expect(ADMIN_UI).not.toMatch(pattern);
    }
  });

  it("the console's client-side copy matches the server constant", () => {
    // admin-ui.js is a static file and cannot import TypeScript, so it carries
    // its own copy for pre-submit feedback. That copy is the thing most likely
    // to drift, so it is compared literally rather than trusted.
    const msg = ADMIN_UI.match(/const PW_POLICY_MSG\s*=\s*([\s\S]*?);/)?.[1] ?? '';
    const assembled = msg
      .replace(/PW_MIN_LENGTH/g, String(PASSWORD_MIN_LENGTH))
      .replace(/["+\n\r]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const expected = PASSWORD_RULES_TEXT.replace(/\s+/g, ' ').trim();
    expect(assembled).toBe(expected);
  });

  it('the shared constant still states the length it enforces', () => {
    // Guards the other direction: a reworded constant that stops mentioning the
    // minimum would leave every surface silently vaguer.
    expect(PASSWORD_RULES_TEXT).toContain(String(PASSWORD_MIN_LENGTH));
  });
});
