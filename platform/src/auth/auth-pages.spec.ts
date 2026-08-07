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
import { inviteAcceptPage, resetFormPage } from './auth-pages';
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
