// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * These pages are where someone actually chooses a password. A second rule set
 * embedded here silently contradicted the rules printed on the same screen —
 * a 15-character passphrase was rejected while the text above it said spaces
 * and no special characters were fine. The server owns the policy; the page
 * checks length only.
 */
import { inviteAcceptPage, resetFormPage, verifyResultPage } from './auth-pages';
import { config } from '../config';
import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_TEXT } from '../core/password-policy';

describe.each([
  ['reset', resetFormPage('tok')],
  ['invite', inviteAcceptPage('tok')],
])('%s page password rules', (_name, html) => {
  it('carries no composition rule of its own', () => {
    // The deleted regex demanded 2 digits and 2 symbols.
    expect(html).not.toContain('[^A-Za-z0-9]');
    expect(html).not.toMatch(/\{2,\}/);
    expect(html).not.toContain('does not meet the policy');
  });

  it('checks the policy minimum length, not the old 8', () => {
    expect(html).toContain(`const MIN = ${PASSWORD_MIN_LENGTH}`);
    expect(html).not.toContain('.{8,}');
  });

  it('prints the policy text people are actually held to', () => {
    expect(html).toContain(PASSWORD_RULES_TEXT);
  });

  it('surfaces the server message, including validator arrays', () => {
    expect(html).toContain('Array.isArray(body.message)');
  });
});

describe.each([
  ['reset', resetFormPage('tok')],
  ['invite', inviteAcceptPage('tok')],
])('%s page password visibility', (_name, html) => {
  it('gives every password field a show/hide toggle', () => {
    const fields = (html.match(/type="password"/g) ?? []).length;
    // Count the attribute in MARKUP only — the delegated handler's selector
    // string contains the same token.
    const toggles = (html.match(/class="pw-toggle" data-pw-toggle/g) ?? []).length;
    expect(fields).toBeGreaterThan(0);
    expect(toggles).toBe(fields);
  });

  it('labels the toggle for screen readers and swaps the label on reveal', () => {
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain("'Hide password'");
  });

  it('keeps the toggle a sibling of its input, which the handler relies on', () => {
    expect(html).toContain("btn.parentElement.querySelector('input')");
  });
});

describe('terminal screens offer a way forward', () => {
  it('verify success links to sign in', () => {
    expect(verifyResultPage(true)).toContain('Go to sign in');
    expect(verifyResultPage(true)).not.toContain('close this tab');
  });

  it.each([
    ['reset', resetFormPage('tok')],
    ['invite', inviteAcceptPage('tok')],
  ])('%s success screen carries the sign-in button', (_name, html) => {
    expect(html).toContain('SIGNIN_HTML');
    expect(html).toContain('Go to sign in');
  });

  it('points the button at the configured public URL, not a hardcoded host', () => {
    expect(verifyResultPage(true)).toContain(`href="${config.publicBaseUrl}/"`);
  });
});
