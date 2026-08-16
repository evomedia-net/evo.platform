// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The mail the platform sends, as editable copy.
 *
 * Only the *words* are editable — subject, heading, paragraphs, button label.
 * The surrounding HTML is the shared shell in email-layout.ts, which is what
 * makes every product's mail look like it came from the same company and
 * stops an editor from breaking the markup a reset email depends on. That is
 * a deliberate difference from evo.ehs, which stores whole HTML bodies: there
 * the templates are one product's, here they are every product's, and shells
 * that are copied per template drift apart.
 *
 * Each default below is the fallback when no row exists AND the repair when a
 * saved row turns out to be unusable. Mail is not allowed to depend on
 * anyone having opened the editor, and a password reset must not fail because
 * someone saved an empty heading.
 */

export interface TemplateCopy {
  subject: string;
  heading: string;
  /** One paragraph per line. */
  intro: string;
  actionLabel?: string | null;
  outro: string;
}

export interface TemplateSpec extends TemplateCopy {
  code: string;
  /** Shown in the console so an editor knows what they may reference. */
  variables: string[];
  /** What this message is for, in the console list. */
  description: string;
}

/**
 * `{{productName}}` is in every template: naming the product is what stopped
 * these emails reading as phishing (#103), so it is available everywhere
 * rather than per-template.
 */
const COMMON = ['productName'];

export const TEMPLATES: TemplateSpec[] = [
  {
    code: 'password_reset',
    description: 'Sent when someone asks to reset their password.',
    variables: [...COMMON, 'email', 'expiryMinutes'],
    subject: 'Reset your {{productName}} password',
    heading: 'Reset your {{productName}} password',
    intro:
      'Someone asked to reset the password for <strong>{{email}}</strong>. If that was you, set a new password now.',
    actionLabel: 'Reset my password',
    // expiryMinutes is a variable on purpose: the real number lives in
    // RESET_TTL_SEC, and copy that hardcodes it starts lying the first time
    // that changes.
    outro:
      'The link is valid for {{expiryMinutes}} minutes and can be used once.\n' +
      "If it wasn't you, ignore this email — your password is unchanged.",
  },
  {
    code: 'email_verify',
    description: 'Sent after sign-up, to prove the mailbox before first login.',
    variables: [...COMMON, 'email', 'expiryHours'],
    subject: 'Verify your email for {{productName}}',
    heading: 'Confirm your email address',
    intro:
      'Confirm that <strong>{{email}}</strong> is your address to activate your {{productName}} account.',
    actionLabel: 'Verify my email',
    outro:
      'The link is valid for {{expiryHours}} hours.\n' +
      "If you didn't create this account, ignore this email.",
  },
  {
    code: 'member_invite',
    description: 'Sent when an administrator invites someone into a workspace.',
    variables: [...COMMON, 'inviter', 'workspace', 'expiryHours'],
    subject: '{{inviter}} invited you to {{workspace}}',
    heading: 'You have been invited to {{workspace}}',
    intro: '{{inviter}} invited you to join <strong>{{workspace}}</strong> on {{productName}}.',
    actionLabel: 'Create your account',
    outro:
      'The link is valid for {{expiryHours}} hours and can be used once.\n' +
      "If you weren't expecting this, ignore this email.",
  },
  {
    code: 'workspace_list',
    description: 'Sent when someone asks which workspaces their address can sign in to.',
    variables: [...COMMON, 'workspaces', 'signInUrl'],
    subject: 'Your {{productName}} workspaces',
    heading: 'Workspaces for this address',
    intro:
      'This address can sign in to the following {{productName}} workspaces:\n{{workspaces}}',
    actionLabel: 'Go to sign in',
    outro: 'Use the workspace name when signing in.',
  },
];

export const TEMPLATE_BY_CODE = new Map(TEMPLATES.map((t) => [t.code, t]));

/** True when a saved row has everything a message needs to render. */
export function isUsable(copy: Partial<TemplateCopy> | null | undefined): copy is TemplateCopy {
  return Boolean(copy?.subject?.trim() && copy?.heading?.trim() && copy?.intro?.trim());
}
