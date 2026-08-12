// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import jwt from 'jsonwebtoken';
import { JwksCache } from './jwks';
import { ConfigError, PlatformError, TokenError } from './errors';
import {
  AcceptInviteParams,
  AppPrice,
  Claims,
  CreateInviteParams,
  CreateMemberParams,
  Entitlement,
  EvoPlatformOptions,
  LoginParams,
  LoginResult,
  PasskeyInfo,
  PasskeyLoginOptionsResult,
  PasskeyRegisterOptionsResult,
  PushEventParams,
  SendEmailParams,
  SignupParams,
  SignupResult,
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

  /**
   * Verify a platform-issued access token locally (cached JWKS, no platform
   * call). When this client is configured with a `clientId`, the token's `app`
   * claim must match it — a token minted for a different app, however
   * obtained, is rejected (pass `{ audience: false }` to opt out for the rare
   * case of deliberately inspecting foreign tokens).
   */
  async verifyToken(token: string, opts: { audience?: boolean } = {}): Promise<Claims> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') throw new TokenError('Malformed token');
    const kid = decoded.header.kid;
    if (!kid) throw new TokenError('Token has no kid header');
    const pem = await this.jwks.getPem(kid);
    let claims: Claims;
    try {
      claims = jwt.verify(token, pem, {
        algorithms: ['RS256'],
        issuer: this.issuer,
      }) as unknown as Claims;
    } catch (err) {
      throw new TokenError(err instanceof Error ? err.message : 'Token verification failed');
    }
    // Audience check: this app only ever accepts tokens minted for it.
    if (opts.audience !== false && this.opts.clientId && claims.app !== this.opts.clientId) {
      throw new TokenError(
        `Token was issued for app "${claims.app ?? 'none'}", not "${this.opts.clientId}"`,
      );
    }
    return claims;
  }

  // ---- auth proxy (for apps that render their own login form) ----

  login(params: LoginParams): Promise<LoginResult> {
    return this.post('/auth/login', { ...params, clientId: this.opts.clientId });
  }

  refresh(refreshToken: string): Promise<LoginResult> {
    return this.post('/auth/refresh', { refreshToken });
  }

  /** Self-service signup through THIS app: creates the workspace, its first
   *  tenant admin (unverified — they must click the verification email before
   *  first login), and a trial of this app. Gated by the platform's
   *  SIGNUP_MODE; carries no tokens. */
  signup(params: SignupParams): Promise<SignupResult> {
    return this.post('/auth/signup', { ...params, clientId: this.opts.clientId });
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

  /**
   * Ask the platform to email this address the workspaces it can sign in to.
   *
   * Always resolves { ok: true } - the platform answers identically whether or
   * not the address has any, because returning the list would let any caller
   * map an address to its workspaces. appName/appUrl are echoed into the email
   * so the user knows which product to go back to.
   */
  forgotWorkspace(params: {
    email: string;
    appName?: string;
    appUrl?: string;
  }): Promise<{ ok: boolean }> {
    return this.post('/auth/workspaces', params);
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

  /** The tenant's standing on THIS app — status, plan, trial/grace deadlines,
   *  and whether a login would be admitted right now. A cheap DB read on the
   *  platform (no Stripe round-trip), so calling it per page load is fine. */
  getEntitlement(params: { tenantId: string }): Promise<Entitlement> {
    return this.request(
      'GET',
      `/billing/entitlement?tenantId=${encodeURIComponent(params.tenantId)}`,
      undefined,
      this.clientHeaders(),
    );
  }

  /** What this app sells, cheapest first — enough to render a pricing table
   *  without holding any Stripe ids in your own code. */
  listPrices(): Promise<AppPrice[]> {
    return this.request('GET', '/billing/prices', undefined, this.clientHeaders());
  }

  /** Stripe Checkout for the tenant's subscription to THIS app. The webhook
   *  then drives the tenant's access to the app (paid → active, failed →
   *  grace → suspended). The redirect URLs must share an origin with the
   *  app's registered callback URLs, and the tenant must already have this
   *  app enabled.
   *
   *  Name the price by `tier` (+ `interval`, default monthly) so repricing is
   *  a console edit rather than a redeploy, or pass a `priceId` from
   *  listPrices(). An app selling exactly one price may omit both. */
  createCheckout(params: {
    tenantId: string;
    successUrl: string;
    cancelUrl: string;
    tier?: string;
    interval?: string;
    intervalCount?: number;
    priceId?: string;
    quantity?: number;
  }): Promise<{ url: string | null }> {
    return this.post('/billing/checkout', params, this.clientHeaders());
  }

  /** Stripe billing portal (payment method, invoices, cancel). */
  createBillingPortal(params: {
    tenantId: string;
    returnUrl: string;
  }): Promise<{ url: string | null }> {
    return this.post('/billing/portal', params, this.clientHeaders());
  }

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
