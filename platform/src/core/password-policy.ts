// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * Single source of truth for the platform password policy — the NIST/OWASP
 * Standard. Enforced anywhere a password is SET (user create/update, signup,
 * invite acceptance, password reset), never at login, so tightening it can
 * not lock out an account whose password predates the change.
 *
 * Follows NIST SP 800-63B and OWASP ASVS: strength comes from LENGTH and
 * screening against known-bad values, NOT from composition rules.
 *
 * NIST explicitly says verifiers SHALL NOT impose composition rules ("must
 * contain a digit and a symbol") and SHALL NOT force periodic rotation.
 * Composition rules measurably push people toward predictable padding —
 * Summer2026!, Password1! — which are the first candidates any cracking
 * dictionary tries, while rejecting genuinely strong passphrases such as
 * "correct horse battery staple".
 *
 * Mirror this in any client that validates before submitting (see the admin
 * console's PW_POLICY in admin-ui/static/admin-ui.js).
 *
 * Kept in step with evo.ehs ehs/services/auth.py and
 * SWAG-Estimates src/lib/auth/password-policy.ts.
 */

/** OWASP ASVS floor. NIST's own floor is 8; 12 is the stricter of the two. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * bcrypt hashes only the first 72 bytes. Reject beyond it rather than
 * silently truncating, which would leave the tail of a long passphrase
 * protecting nothing.
 */
export const PASSWORD_MAX_BYTES = 72;

/** Longest straight run allowed anywhere: "abcd" is fine, "abcde" is not. */
export const MAX_SEQUENCE_RUN = 4;

/**
 * Human-readable policy, shown under every new-password field so the rules
 * are visible before submission rather than only on rejection.
 */
export const PASSWORD_RULES_TEXT =
  `At least ${PASSWORD_MIN_LENGTH} characters. Longer is stronger — a phrase ` +
  `of a few words works well, and spaces are allowed. No special-character ` +
  `requirements. Avoid common passwords and runs like abcde or 12345.`;

/** Retained for callers that show a single generic message. */
export const PASSWORD_POLICY_MESSAGE = PASSWORD_RULES_TEXT;

/** Rejected outright regardless of length — the most-guessed passwords. */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'letmein',
  'welcome', 'welcome1', 'qwerty', 'qwerty123', 'iloveyou', 'admin',
  'administrator', 'changeme', 'abc123', '111111', '123456', '1234567',
  '12345678', '123456789', '1234567890', 'monkey', 'dragon', 'sunshine',
  'princess', 'football', 'baseball', 'trustno1', 'evoplatform', 'evomedia',
]);

/**
 * Keyboard rows listed separately — concatenating them would treat
 * row-crossing strings like "opasd" (end of the QWERTY row, start of the
 * ASDF row) as a run, which they are not.
 */
const SEQUENCES = [
  '0123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
];

/**
 * True when a straight run longer than MAX_SEQUENCE_RUN appears anywhere in
 * the password — forwards or backwards. Matched as a substring, not just a
 * whole password, so padding a run out to reach the floor doesn't rescue it.
 */
function isSequential(candidate: string): boolean {
  const window = MAX_SEQUENCE_RUN + 1;
  if (candidate.length < window) return false;
  for (const seq of SEQUENCES) {
    const reversed = [...seq].reverse().join('');
    for (let i = 0; i + window <= candidate.length; i++) {
      const chunk = candidate.slice(i, i + window);
      if (seq.includes(chunk) || reversed.includes(chunk)) return true;
    }
  }
  return false;
}

/**
 * Blocklist check (NIST SP 800-63B: screen against known-bad values).
 *
 * Normalizes before comparing so padding a blocked word to reach the length
 * floor doesn't slip through: case, surrounding whitespace, a trailing run of
 * digits/symbols, and simple character substitutions are all folded away.
 * "Password123!" and "p@ssw0rd!!" both reduce to "password".
 */
function isCommon(password: string): boolean {
  const candidate = password.trim().toLowerCase();
  // A password of only whitespace trims to nothing, and nothing passes every
  // check below: it is in no list, strips to no suffix, and is not "one
  // character repeated" because a Set of an empty string has size 0. Twelve
  // spaces met the length rule and sailed through. Name it for what it is.
  if (!candidate) return true;
  if (COMMON_PASSWORDS.has(candidate)) return true;

  const trimmed = candidate.replace(
    /[0-9!@#$%^&*()\-_=+.,?/\\|[\]{}<>;:'"`~ ]+$/,
    '',
  );
  if (trimmed && COMMON_PASSWORDS.has(trimmed)) return true;

  const unleet = trimmed
    .replace(/@/g, 'a').replace(/0/g, 'o').replace(/1/g, 'i')
    .replace(/3/g, 'e').replace(/\$/g, 's').replace(/5/g, 's')
    .replace(/!/g, 'i').replace(/4/g, 'a').replace(/7/g, 't');
  if (unleet && COMMON_PASSWORDS.has(unleet)) return true;

  // Single repeated character, however long ("aaaaaaaaaaaa").
  if (new Set(candidate).size === 1) return true;
  return false;
}

/**
 * Validate a NEW password. Returns an error message, or null if it passes.
 */
export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Password must be ${PASSWORD_MAX_BYTES} characters or fewer`;
  }
  if (isSequential(password.trim().toLowerCase())) {
    return `Avoid runs of more than ${MAX_SEQUENCE_RUN} characters in a row (like abcde or 12345)`;
  }
  if (isCommon(password)) {
    return 'That password is too common — choose something less guessable';
  }
  return null;
}

export function meetsPasswordPolicy(pw: string): boolean {
  return validatePassword(pw) === null;
}

/**
 * DTO decorator for any field holding a NEW password. Replaces the previous
 * `@Matches(PASSWORD_POLICY_REGEX)`; a regex can express composition rules
 * but not a blocklist or a sequence check, so the policy needs real code.
 */
export function IsStrongPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && validatePassword(value) === null,
        defaultMessage: (args: ValidationArguments) =>
          typeof args.value === 'string'
            ? (validatePassword(args.value) ?? PASSWORD_RULES_TEXT)
            : 'Password is required',
      },
    });
  };
}
