// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/** Claims inside a platform-issued access token. */
export interface Claims {
  sub: string;
  email: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  roles: string[];
  app: string | null;
  platform_admin: boolean;
  tenant_admin: boolean;
  iat: number;
  exp: number;
  iss: string;
}

export interface EvoPlatformOptions {
  /** Base URL of the platform service, e.g. https://platform.example.com */
  platformUrl: string;
  /** Client id of this app (from the platform admin). Needed for events/email. */
  clientId?: string;
  /** Client secret of this app. Server-side only — never ship to a browser. */
  clientSecret?: string;
  /** Expected JWT issuer. Default: "evoplatform". */
  issuer?: string;
  /** JWKS cache lifetime in ms. Default: 10 minutes. */
  jwksTtlMs?: number;
  /** Injectable fetch for testing. Default: global fetch. */
  fetchFn?: typeof fetch;
}

export interface LoginParams {
  /** Omit for platform-level (global admin) login. */
  tenantSlug?: string;
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    platformAdmin: boolean;
    tenantAdmin: boolean;
    tenant: { id: string; slug: string; name: string } | null;
  };
}

/** A tenant's standing on the calling app (GET /billing/entitlement). */
export interface Entitlement {
  /** Would a login for this app be admitted right now. */
  enabled: boolean;
  /** null = the app has no relationship with this tenant. */
  status: 'ACTIVE' | 'TRIAL' | 'PAST_DUE' | 'SUSPENDED' | null;
  plan: string | null;
  trialEndsAt: string | null;
  graceUntil: string | null;
  /** Days until the trial or grace deadline (rounded up); null when neither applies. */
  daysLeft: number | null;
}

export interface SendEmailParams {
  /** Omit to use the platform default SMTP config. */
  tenantId?: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface PushEventParams {
  action: string;
  tenantId?: string;
  userId?: string;
  detail?: unknown;
}

/** WebAuthn creation/request options as produced by the platform — pass straight
 * to the browser (navigator.credentials.create/get) after base64url decoding,
 * or hand to @simplewebauthn/browser's startRegistration/startAuthentication. */
export interface PasskeyRegisterOptionsResult {
  options: unknown;
  challengeToken: string;
}

export interface PasskeyLoginOptionsResult {
  /** null when the user has no registered passkeys — hide the passkey option. */
  options: unknown | null;
  challengeToken?: string;
}

export interface PasskeyInfo {
  id: string;
  nickname: string;
  transports: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** A user of the caller's own tenant, as returned by the /tenant/users API. */
export interface TenantMember {
  id: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  isTenantAdmin: boolean;
  createdAt: string;
  deletedAt: string | null;
  roles: { role: { id: string; name: string; app: { name: string; clientId: string } } }[];
}

/** An app enabled for the caller's tenant, with its assignable roles. */
export interface TenantAppRoles {
  app: string;
  clientId: string;
  status: string;
  roles: { id: string; name: string; description: string | null }[];
}

export interface SignupParams {
  company: string;
  /** Workspace slug; derived from company when omitted. */
  slug?: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  /** Required when the platform runs SIGNUP_MODE=invite. */
  inviteToken?: string;
}

export interface SignupResult {
  ok: boolean;
  tenantSlug: string;
  verificationRequired: boolean;
  trialEndsAt: string;
}

/** A pending (or accepted) invitation into the caller's tenant. */
export interface TenantInvite {
  id: string;
  email: string;
  roleIds: string[];
  isTenantAdmin: boolean;
  invitedById: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface CreateInviteParams {
  email: string;
  roleIds?: string[];
  isTenantAdmin?: boolean;
}

export interface AcceptInviteParams {
  token: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface CreateMemberParams {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isTenantAdmin?: boolean;
}

export interface UpdateMemberParams {
  firstName?: string;
  lastName?: string;
  phone?: string;
  isTenantAdmin?: boolean;
}

// ---- Ask AI (evo-ai) ----

export interface AskAiOptions {
  /** Base URL of the evo-ai service, e.g. https://ai.example.com */
  url: string;
  /**
   * Service key (`svc_...`) minted from evo-ai's `POST /admin/service-keys`.
   * SERVER-SIDE ONLY — a holder can name any tenant, so it must never reach a
   * browser. Omit when every call passes a user `accessToken` instead.
   */
  serviceKey?: string;
  /** Request timeout in ms. Default: 120000 — LLM answers are slow. */
  timeoutMs?: number;
  /** Injectable fetch for testing. Default: global fetch. */
  fetchFn?: typeof fetch;
}

export interface AskMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskParams {
  question: string;
  /**
   * Which customer's data to search. Required with a service key; rejected
   * with an `accessToken`, where the tenant comes from verified claims.
   * Derive it from your own session — never from anything the browser sent.
   */
  tenantId?: string;
  /** A platform-issued user token, as an alternative to the service key. */
  accessToken?: string;
  /** Prior turns, so follow-ups like "how many?" resolve. Keep it recent —
   *  every message is processed on each call. */
  history?: AskMessage[];
  /** Restrict which categories of indexed data may be searched, e.g.
   *  `['permit', 'incident']`. This is how the assistant inherits your app's
   *  permission model. Omit for everything. */
  sourceTypes?: string[];
  /** Named index to search. Default: "default". */
  collection?: string;
  /** Allow the assistant to propose actions (it only ever proposes — your app
   *  resolves, confirms with the user, and executes). Default: false. */
  allowActions?: boolean;
}

export interface AskSource {
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface AskResult {
  answer: string;
  /** The question actually executed, after follow-up condensation. */
  question: string;
  /** The records behind the answer. Show these. */
  sources: AskSource[];
  /** A proposed action awaiting your app's resolution and the user's
   *  confirmation, when `allowActions` was set. */
  actionProposal: Record<string, unknown> | null;
  /** Declined as unrelated to the indexed data, before any AI call. The
   *  product working correctly — render your own wording, not an error. */
  gated: boolean;
  /** No usable AI model for this tenant. An administrator problem: point
   *  them at setup rather than telling them to try again. */
  unconfigured: boolean;
}
