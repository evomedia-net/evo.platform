/**
 * Single source of truth for the platform password policy, enforced anywhere a
 * password is set (user create/update). Mirror this in any client that wants
 * to validate before submitting (see the admin console's PW_POLICY_RE).
 *
 * Policy: at least 8 characters, including at least 2 digits and at least 2
 * special (non-alphanumeric) characters.
 */
export const PASSWORD_POLICY_REGEX =
  /^(?=(?:.*\d){2,})(?=(?:.*[^A-Za-z0-9]){2,}).{8,}$/;

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include at least 2 numbers and 2 special characters';

export function meetsPasswordPolicy(pw: string): boolean {
  return PASSWORD_POLICY_REGEX.test(pw);
}
