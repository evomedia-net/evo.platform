/** Claims inside a platform-issued access token. */
export interface Claims {
  sub: string;
  email: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  roles: string[];
  app: string | null;
  platform_admin: boolean;
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
