import jwt from 'jsonwebtoken';
import { JwksCache } from './jwks';
import { ConfigError, PlatformError, TokenError } from './errors';
import {
  Claims,
  EvoPlatformOptions,
  LoginParams,
  LoginResult,
  PasskeyInfo,
  PasskeyLoginOptionsResult,
  PasskeyRegisterOptionsResult,
  PushEventParams,
  SendEmailParams,
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

  // ---- passkeys (WebAuthn) ----

  /** Start passkey registration for the logged-in user (Bearer auth). */
  passkeyRegisterOptions(accessToken: string): Promise<PasskeyRegisterOptionsResult> {
    return this.request('POST', '/auth/passkeys/register/options', {}, bearer(accessToken));
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

  /** Start passkey login. `options` is null when the user has no passkeys. */
  passkeyLoginOptions(params: {
    tenantSlug?: string;
    email: string;
  }): Promise<PasskeyLoginOptionsResult> {
    return this.request('POST', '/auth/passkeys/login/options', params);
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
