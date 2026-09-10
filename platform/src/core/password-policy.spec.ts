// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  MAX_SEQUENCE_RUN,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_TEXT,
  meetsPasswordPolicy,
  validatePassword,
} from './password-policy';

/**
 * Password policy — NIST/OWASP Standard.
 *
 * Per NIST SP 800-63B and OWASP ASVS: enforce LENGTH and screen against
 * known-bad values; do NOT impose composition rules. These tests pin both
 * halves — that strong passphrases are accepted, and that the composition
 * rules we deliberately do not have stay absent.
 *
 * Kept in step with SmartPlantEHS tests/test_password_policy.py and
 * SWAG-Estimates src/lib/auth/password-policy.test.ts.
 */
describe('password policy', () => {
  it('uses the OWASP 12-character floor', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it.each([
    'correct horse battery staple', // spaces allowed
    'correcthorsebatterystaple',
    'Tr0ub4dor&3xyzab',
    'the quick brown fox jumps',
    'aaaaaaaaaaaab', // not a single repeated char
  ])('accepts the strong passphrase %j', (pw) => {
    expect(validatePassword(pw)).toBeNull();
    expect(meetsPasswordPolicy(pw)).toBe(true);
  });

  it.each(['', 'short1!', 'elevenchar', 'elevenchars'])(
    'rejects %j as too short',
    (pw) => {
      expect(validatePassword(pw)).not.toBeNull();
    },
  );

  it('rejects past the bcrypt limit instead of truncating', () => {
    // bcrypt hashes only the first 72 bytes; silently truncating would mean
    // the tail of a long passphrase protects nothing.
    expect(validatePassword('a1! ' + 'x'.repeat(200))).not.toBeNull();
    // Multi-byte passwords are measured in BYTES, not characters.
    const accented = 'é'.repeat(40);
    expect(Buffer.byteLength(accented, 'utf8')).toBeGreaterThan(
      PASSWORD_MAX_BYTES,
    );
    expect(validatePassword(accented)).not.toBeNull();
  });

  it.each([
    'password1234',
    'Password123!', // blocked word padded to reach the length floor
    'p@ssw0rd!!!!', // blocked word with leet substitutions
    'letmein12345',
    'aaaaaaaaaaaa', // single repeated character
    '123456789012',
  ])('rejects the common/padded variant %j', (pw) => {
    expect(validatePassword(pw)).not.toBeNull();
  });

  it('enforces no composition rules', () => {
    // This is the behaviour change from the old regex policy, which demanded
    // 2 digits and 2 special characters. NIST SP 800-63B says verifiers SHALL
    // NOT impose composition rules — a long letters-only passphrase is strong.
    // (Examples must not themselves be keyboard/alphabet runs, which are
    // blocked as known-bad regardless of composition.)
    expect(validatePassword('wanderingmountain')).toBeNull(); // letters only
    expect(validatePassword('thequickbrownfox')).toBeNull(); // no digit
    expect(validatePassword('Thequickbrownfox9')).toBeNull(); // no symbol
  });

  it.each([
    'abcdefghijklmnop', // whole string is a run
    '123456789012',
    'ponmlkjihgfedcba', // backwards
    'myPassw0rd-abcde', // 5-run embedded in an otherwise fine password
    'summer12345mount',
    'qwertyMountain77', // keyboard row
    'zyxwvuMountain12', // reverse alphabet
  ])('rejects the run in %j', (pw) => {
    // Rejected anywhere in the password, not only when the whole string is
    // one run — padding a run out to reach the floor must not rescue it.
    expect(validatePassword(pw)).not.toBeNull();
  });

  it('allows runs up to the limit', () => {
    // Four in a row is incidental, not a pattern — must stay allowed.
    expect(MAX_SEQUENCE_RUN).toBe(4);
    expect(validatePassword('myPassw0rd-abcd!')).toBeNull();
  });

  it('does not treat the keyboard as one long sequence', () => {
    // Concatenating the rows would flag row-crossing strings like "opasd"
    // (end of the QWERTY row, start of the ASDF row) as a run.
    expect(validatePassword('opasdMountain123')).toBeNull();
  });

  it('promises only what the validator enforces', () => {
    // The hint under each password field is user-facing copy: it must not
    // claim requirements that are not actually applied.
    const text = PASSWORD_RULES_TEXT.toLowerCase();
    expect(PASSWORD_RULES_TEXT).toContain(String(PASSWORD_MIN_LENGTH));
    for (const phantom of [
      'uppercase',
      'capital',
      'must contain a number',
      'must include a symbol',
      '2 numbers',
      '2 special',
    ]) {
      expect(text).not.toContain(phantom);
    }
  });

  // Twelve spaces met the length rule and passed every screen: the candidate
  // trims to nothing, no list contains nothing, and a Set of an empty string
  // has size 0 - so the one rule meant to catch it saw nothing to check (#213).
  it('rejects a password that is only whitespace', () => {
    expect(validatePassword(' '.repeat(12))).toMatch(/too common/);
    expect(validatePassword('\t'.repeat(12) + '  ')).toMatch(/too common/);
  });
});
