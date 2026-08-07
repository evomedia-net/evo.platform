// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { z } from "zod";
// ── Password policy (NIST/OWASP Standard) ───────────────────────────────
//
// Follows NIST SP 800-63B and OWASP ASVS: strength comes from LENGTH and
// screening against known-bad values, NOT from composition rules.
//
// NIST explicitly says verifiers SHALL NOT impose composition rules
// ("must contain a digit and a symbol") and SHALL NOT force periodic
// rotation. Composition rules push people toward predictable padding —
// Summer2026!, Password1! — the first candidates any cracking dictionary
// tries, while rejecting strong passphrases like "correct horse battery
// staple".
//
// Keep in step with the same policy in SmartPlantEHS
// (smartplantpermits/services/auth.py) and EvoPlatform.

export const PASSWORD_MIN_LENGTH = 12;

/** bcrypt hashes only the first 72 bytes — reject beyond it rather than
 *  silently truncating, which would leave the tail protecting nothing. */
export const PASSWORD_MAX_BYTES = 72;

/** Longest straight run allowed anywhere: "abcd" fine, "abcde" not. */
export const MAX_SEQUENCE_RUN = 4;

/** Shown under every new-password field, so the rules are visible before
 *  submission rather than only on rejection. */
export const PASSWORD_RULES_TEXT =
  `At least ${PASSWORD_MIN_LENGTH} characters. Longer is stronger — a phrase ` +
  `of a few words works well, and spaces are allowed. No special-character ` +
  `requirements. Avoid common passwords and runs like abcde or 12345.`;

const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "letmein",
  "welcome", "welcome1", "qwerty", "qwerty123", "iloveyou", "admin",
  "administrator", "changeme", "abc123", "111111", "123456", "1234567",
  "12345678", "123456789", "1234567890", "monkey", "dragon", "sunshine",
  "princess", "football", "baseball", "trustno1", "evoplatform", "evoapp",
]);

// Keyboard rows listed separately — concatenating them would treat
// row-crossing strings like "opasd" as a run, which they are not.
const SEQUENCES = [
  "0123456789",
  "abcdefghijklmnopqrstuvwxyz",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

function isSequential(candidate: string): boolean {
  const window = MAX_SEQUENCE_RUN + 1;
  if (candidate.length < window) return false;
  for (const seq of SEQUENCES) {
    const reversed = [...seq].reverse().join("");
    for (let i = 0; i + window <= candidate.length; i++) {
      const chunk = candidate.slice(i, i + window);
      if (seq.includes(chunk) || reversed.includes(chunk)) return true;
    }
  }
  return false;
}

function isCommon(password: string): boolean {
  const candidate = password.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(candidate)) return true;

  // Strip a trailing run of digits/punctuation: "password123!" -> "password"
  const trimmed = candidate.replace(/[0-9!@#$%^&*()\-_=+.,?/\|[\]{}<>;:'"`~ ]+$/, "");
  if (trimmed && COMMON_PASSWORDS.has(trimmed)) return true;

  // Undo common leet substitutions, then re-test.
  const unleet = trimmed
    .replace(/@/g, "a").replace(/0/g, "o").replace(/1/g, "i")
    .replace(/3/g, "e").replace(/\$/g, "s").replace(/5/g, "s")
    .replace(/!/g, "i").replace(/4/g, "a").replace(/7/g, "t");
  if (unleet && COMMON_PASSWORDS.has(unleet)) return true;

  // Single repeated character, however long.
  if (new Set(candidate).size === 1) return true;
  return false;
}

/**
 * Validate a NEW password. Returns an error message, or null if valid.
 *
 * Applied when a password is SET or CHANGED — never at sign-in — so
 * tightening the policy can never lock out an existing account.
 */
export function validatePassword(password: string): string | null {
  if (!password) return "Password is required";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return `Password must be ${PASSWORD_MAX_BYTES} characters or fewer`;
  }
  if (isSequential(password.trim().toLowerCase())) {
    return `Avoid runs of more than ${MAX_SEQUENCE_RUN} characters in a row (like abcde or 12345)`;
  }
  if (isCommon(password)) {
    return "That password is too common — choose something less guessable";
  }
  return null;
}

/** Zod schema for any field holding a NEW password. */
export function newPassword() {
  return z.string().superRefine((value, ctx) => {
    const err = validatePassword(value);
    if (err) ctx.addIssue({ code: "custom", message: err });
  });
}
