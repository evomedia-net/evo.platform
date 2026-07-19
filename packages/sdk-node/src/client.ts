import jwt from 'jsonwebtoken';
import { JwksCache } from './jwks';
import { ConfigError, PlatformError, TokenError } from './errors';
import {
  AcceptInviteParams,
  Claims,
  CreateInviteParams,
  CreateMemberParams,
  EvoPlatformOptions,
  LoginParams,
  LoginResult,
  PasskeyInfo,
  PasskeyLoginOptionsResult,
  PasskeyRegisterOptionsResult,
  PushEventParams,
  SendEmailParams,
  TenantAppRoles,
  TenantInvite,
  TenantMember,
  UpdateMemberParams,
} from './types';

export class EvoPlatform {
  private readonly baseUrl: string;
  private readonly issuer: string;
  private readonly jwks: JwksCache;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: EvoPlatformOptions) {
    this.baseUrl = opts.platformUrl.replace(/\/+$/, '');
    this.issuer = opts.issuer ?? 'evoplatform';
    this.fetchFn = opts.fetchFn ?? fetch;
    this.jwks = new JwksCache(
      `${this.baseUrl}/.well-known/jwks.json`,
      opts.jwksTtlMs,
      this.fetchFn,
    );
  }

  /** Verify a platform-issued access token locally (cached JWKS, no platform call). */
  async verifyToken(token: string): Promise<Claims> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') throw new TokenError('Malformed token');
    const kid = decoded.header.kid;
    if (!kid) throw new TokenError('Token has no kid header');
    const pem = await this.jwks.getPem(kid);
    try {
      return jwt.verify(token, pem, {
        algorithms: ['RS256'],
        issuer: this.issuer,
      }) as unknown as Claims;
    } catch (err) {
      throw new TokenError(err instanceof Error ? err.message : 'Token verification failed');
    }
  }

  // ---- auth proxy (for apps that render their own login form) ----

  login(params: LoginParams): Promise<LoginResult> {
    return this.post('/auth/login', { ...params, clientId: this.opts.clientId });
  }

  refresh(refreshToken: string): Promise<LoginResult> {
    return this.post('/auth/refresh', { refreshToken });
  }

  logout(refreshToken: string): Promise<{ ok: boolean }> {
    return this.post('/auth/logout', { refreshToken });
  }

  // ---- email verification & password reset ----
  // Send endpoints always answer ok (no account enumeration). A login rejected
  // with "Email not verified" should offer sendVerificationEmail as the retry.

  sendVerificationEmail(params: { tenantSlug?: string; email: string }): Promise<{ ok: boolean }> {
    return this.post('/auth/verify/send', params);
  }

  verifyEmail(token: string): Promise<{ ok: boolean }> {
    return this.post('/auth/verify', { token });
  }

  forgotPassword(params: { tenantSlug?: string; email: string }): Promise<{ ok: boolean }> {
    return this.post('/auth/forgot', params);
  }

  /** Resets the password and revokes every session of that user. */
  resetPassword(token: string, password: string): Promise<{ ok: boolean }> {
    return this.post('/auth/reset', { token, password });
  }

  // ---- passkeys (WebAuthn) ----

  /**
   * Start passkey registration for the logged-in user (Bearer auth).
   * Pass the BROWSER page's origin when proxying server-side — the platform
   * derives the WebAuthn RP from it, and the ceremony runs on that page.
   */
  passkeyRegisterOptions(
    accessToken: string,
    opts: { origin?: string } = {},
  ): Promise<PasskeyRegisterOptionsResult> {
    return this.request('POST', '/auth/passkeys/register/options', {}, {
      ...bearer(accessToken),
      ...originHeader(opts.origin),
    });
  }

  /** Finish passkey registration with the browser's credential response. */
  passkeyRegisterVerify(
    accessToken: string,
    params: { credential: unknown; challengeToken: string; nickname?: string },
  ): Promise<PasskeyInfo> {
    return this.request('POST', '/auth/passkeys/register/verify', params, bearer(accessToken));
  }

  listPasskeys(accessToken: string): Promise<PasskeyInfo[]> {
    return this.request('GET', '/auth/passkeys', undefined, bearer(accessToken));
  }

  deletePasskey(accessToken: string, id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/auth/passkeys/${id}`, undefined, bearer(accessToken));
  }

  /** Start passkey login. `options` is null when the user has no passkeys.
   * Pass the browser page's origin when proxying server-side. */
  passkeyLoginOptions(
    params: { tenantSlug?: string; email: string },
    opts: { origin?: string } = {},
  ): Promise<PasskeyLoginOptionsResult> {
    return this.request('POST', '/auth/passkeys/login/options', params, originHeader(opts.origin));
  }

  /** Finish passkey login; returns the same session shape as password login. */
  passkeyLoginVerify(params: {
    credential: unknown;
    challengeToken: string;
  }): Promise<LoginResult> {
    return this.request('POST', '/auth/passkeys/login/verify', {
      ...params,
      clientId: this.opts.clientId,
    });
  }

  // ---- tenant member management (requires a tenant-admin user's token) ----
  // The platform scopes every call to the token's own tenant; there is no way
  // to name another tenant from this surface.

  listTenantMembers(accessToken: string): Promise<TenantMember[]> {
    return this.request('GET', '/tenant/users', undefined, bearer(accessToken));
  }

  /** Apps enabled for the tenant with their assignable roles — feeds role pickers. */
  listTenantRoles(accessToken: string): Promise<TenantAppRoles[]> {
    return this.request('GET', '/tenant/roles', undefined, bearer(accessToken));
  }

  createTenantMember(accessToken: string, params: CreateMemberParams): Promise<TenantMember> {
    return this.request('POST', '/tenant/users', params, bearer(accessToken));
  }

  updateTenantMember(
    accessToken: string,
    id: string,
    params: UpdateMemberParams,
  ): Promise<TenantMember> {
    return this.request('PATCH', `/tenant/users/${id}`, params, bearer(accessToken));
  }

  /** Soft-deactivate: the member can no longer sign in; restorable. */
  deactivateTenantMember(accessToken: string, id: string): Promise<TenantMember> {
    return this.request('DELETE', `/tenant/users/${id}`, undefined, bearer(accessToken));
  }

  restoreTenantMember(accessToken: string, id: string): Promise<TenantMember> {
    return this.request('POST', `/tenant/users/${id}/restore`, undefined, bearer(accessToken));
  }

  setTenantMemberRoles(
    accessToken: string,
    id: string,
    roleIds: string[],
  ): Promise<TenantMember> {
    return this.request('PUT', `/tenant/users/${id}/roles`, { roleIds }, bearer(accessToken));
  }

  // ---- invites (tenant-admin token; accept is public) ----

  listTenantInvites(accessToken: string): Promise<TenantInvite[]> {
    return this.request('GET', '/tenant/invites', undefined, bearer(accessToken));
  }

  /** Emails an accept link (24 h, single-use). Replaces any pending invite
   *  for the same address. */
  createTenantInvite(accessToken: string, params: CreateInviteParams): Promise<TenantInvite> {
    return this.request('POST', '/tenant/invites', params, bearer(accessToken));
  }

  /** Re-send with a fresh token; the previously emailed link stops working. */
  resendTenantInvite(accessToken: string, id: string): Promise<TenantInvite> {
    return this.request('POST', `/tenant/invites/${id}/resend`, undefined, bearer(accessToken));
  }

  revokeTenantInvite(accessToken: string, id: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/tenant/invites/${id}`, undefined, bearer(accessToken));
  }

  /** Public: finish an invite — the token from the email is the credential.
   *  The created account is email-verified by construction. */
  acceptInvite(params: AcceptInviteParams): Promise<{ ok: boolean; tenantSlug: string; email: string }> {
    return this.post('/auth/invites/accept', params);
  }

  // ---- client-credential services ----

  async sendEmail(params: SendEmailParams): Promise<{ ok: boolean; messageId: string }> {
    return this.post('/email/send', params, this.clientHeaders());
  }

  async pushEvent(params: PushEventParams): Promise<{ id: string }> {
    return this.post('/events', params, this.clientHeaders());
  }

  // ---- internals ----

  private clientHeaders(): Record<string, string> {
    if (!this.opts.clientId || !this.opts.clientSecret) {
      throw new ConfigError('clientId and clientSecret are required for this call');
    }
    return {
      'x-client-id': this.opts.clientId,
      'x-client-secret': this.opts.clientSecret,
    };
  }

  private post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    return this.request('POST', path, body, headers);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const message =
        typeof parsed === 'object' && parsed !== null && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : `Platform request failed with status ${res.status}`;
      throw new PlatformError(res.status, message, parsed);
    }
    return parsed as T;
  }
}

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function originHeader(origin?: string): Record<string, string> {
  return origin ? { Origin: origin } : {};
}
