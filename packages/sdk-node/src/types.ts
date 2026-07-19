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
