// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { generateKeyPairSync } from 'crypto';
import jwt from 'jsonwebtoken';
import { EvoPlatform } from './client';
import { ConfigError, PlatformError, TokenError } from './errors';
import { Claims } from './types';

const KID = 'test-kid';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: KID };

function signToken(claims: object, opts: { expiresIn?: number; issuer?: string; kid?: string } = {}) {
  return jwt.sign(claims, privatePem, {
    algorithm: 'RS256',
    keyid: opts.kid ?? KID,
    expiresIn: opts.expiresIn ?? 60,
    issuer: opts.issuer ?? 'evoplatform',
  });
}

type FetchMock = jest.Mock & typeof fetch;

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function makeFetch(routes: Record<string, (init?: RequestInit) => unknown>): FetchMock {
  return jest.fn(async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const handler = routes[path];
    if (!handler) return fakeResponse(404, { message: `No route for ${path}` });
    return handler(init);
  }) as unknown as FetchMock;
}

const jwksRoute = () => fakeResponse(200, { keys: [jwk] });

describe('EvoPlatform.verifyToken', () => {
  it('verifies a valid token and returns claims', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    const token = signToken({ sub: 'u1', tenant_slug: 'acme', roles: ['admin'] });
    // audience: false - this test is about claim decoding, not app binding.
    const claims = (await platform.verifyToken(token, { audience: false })) as Claims;
    expect(claims.sub).toBe('u1');
    expect(claims.tenant_slug).toBe('acme');
    expect(claims.roles).toEqual(['admin']);
  });

  it('caches the JWKS across verifications', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await platform.verifyToken(signToken({ sub: 'u1' }), { audience: false });
    await platform.verifyToken(signToken({ sub: 'u2' }), { audience: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired token', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { expiresIn: -10 }), { audience: false }),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects a token minted for a different app (audience check)', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({
      platformUrl: 'http://platform.test',
      clientId: 'app_mine',
      fetchFn,
    });
    await expect(
      platform.verifyToken(signToken({ sub: 'u1', app: 'app_other' })),
    ).rejects.toThrow(/issued for app "app_other"/);
    // Unscoped tokens (platform-admin logins carry app: null) are foreign too.
    await expect(
      platform.verifyToken(signToken({ sub: 'u1', app: null })),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it('accepts a token minted for this app, and honors the opt-out', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({
      platformUrl: 'http://platform.test',
      clientId: 'app_mine',
      fetchFn,
    });
    const own = await platform.verifyToken(signToken({ sub: 'u1', app: 'app_mine' }));
    expect(own.app).toBe('app_mine');
    const foreign = await platform.verifyToken(signToken({ sub: 'u1', app: 'app_other' }), {
      audience: false,
    });
    expect(foreign.app).toBe('app_other');
  });

  // Was: "does not enforce audience when the client has no clientId". Skipping
  // silently degraded verification to "any token this platform ever issued",
  // with no way for a caller to notice - and role names are unique only per
  // app, so a token minted for app A carrying roles:['admin'] then granted
  // admin in app B. Opting out must be deliberate (security review #126).
  it('refuses to verify without a clientId rather than skipping the audience check', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await expect(
      platform.verifyToken(signToken({ sub: 'u1', app: 'app_any' })),
    ).rejects.toBeInstanceOf(ConfigError);
    // The explicit opt-out still works, for deliberately inspecting foreign tokens.
    const claims = await platform.verifyToken(signToken({ sub: 'u1', app: 'app_any' }), {
      audience: false,
    });
    expect(claims.app).toBe('app_any');
  });

  // Single-purpose tokens are signed with the same key and kid as access
  // tokens. The platform refuses them for itself (auth/jwt.guard.ts); the SDK
  // did not, so every app built on it was missing that guard. The passkey
  // login-options endpoint is unauthenticated and hands one to any caller.
  it.each(['email_verify', 'password_reset', 'signup_link', 'webauthn_auth', 'webauthn_reg'])(
    'rejects a single-purpose %s token presented as an access token',
    async (purpose) => {
      const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
      const platform = new EvoPlatform({
        platformUrl: 'http://platform.test',
        clientId: 'app_mine',
        fetchFn,
      });
      await expect(
        platform.verifyToken(signToken({ sub: 'u1', app: 'app_mine', purpose })),
      ).rejects.toThrow(/single-purpose/);
    },
  );

  // The opt-out is for foreign AUDIENCE, not for a different token type.
  it('rejects a purpose token even when the audience check is opted out', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await expect(
      platform.verifyToken(signToken({ sub: 'u1', purpose: 'webauthn_auth' }), {
        audience: false,
      }),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects a token from another issuer', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { issuer: 'someone-else' }), {
        audience: false,
      }),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects a tampered token', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    const token = signToken({ sub: 'u1' });
    await expect(
      platform.verifyToken(token.slice(0, -3) + 'abc', { audience: false }),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it('re-fetches the JWKS when it sees an unknown kid', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await platform.verifyToken(signToken({ sub: 'u1' }), { audience: false });
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { kid: 'rotated-kid' }), {
        audience: false,
      }),
    ).rejects.toBeInstanceOf(TokenError);
    expect(fetchFn).toHaveBeenCalledTimes(2); // second call = rotation attempt
  });
});

describe('EvoPlatform API calls', () => {
  it('login posts credentials and returns the result', async () => {
    const result = { accessToken: 'a', refreshToken: 'r', expiresIn: 900, user: { id: 'u1' } };
    const fetchFn = makeFetch({ '/auth/login': () => fakeResponse(200, result) });
    const platform = new EvoPlatform({
      platformUrl: 'http://platform.test',
      clientId: 'app_x',
      fetchFn,
    });
    const out = await platform.login({ tenantSlug: 'acme', email: 'a@b.c', password: 'pw' });
    expect(out.accessToken).toBe('a');
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.clientId).toBe('app_x'); // clientId auto-attached
  });

  it('maps platform errors to PlatformError with status and message', async () => {
    const fetchFn = makeFetch({
      '/auth/login': () => fakeResponse(401, { message: 'Invalid credentials' }),
    });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await expect(
      platform.login({ email: 'a@b.c', password: 'nope' }),
    ).rejects.toMatchObject({ name: 'PlatformError', status: 401, message: 'Invalid credentials' });
  });

  it('requires client credentials for pushEvent', async () => {
    const fetchFn = makeFetch({});
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await expect(platform.pushEvent({ action: 'x' })).rejects.toBeInstanceOf(ConfigError);
  });

  it('sends bearer auth for passkey registration options', async () => {
    const fetchFn = makeFetch({
      '/auth/passkeys/register/options': () =>
        fakeResponse(200, { options: {}, challengeToken: 'ct' }),
    });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await platform.passkeyRegisterOptions('tok123');
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok123');
  });

  it('attaches clientId on passkey login verify and uses GET for list', async () => {
    const fetchFn = makeFetch({
      '/auth/passkeys/login/verify': () => fakeResponse(200, { accessToken: 'a' }),
      '/auth/passkeys': () => fakeResponse(200, []),
    });
    const platform = new EvoPlatform({
      platformUrl: 'http://platform.test',
      clientId: 'app_x',
      fetchFn,
    });
    await platform.passkeyLoginVerify({ credential: {}, challengeToken: 'ct' });
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
    expect(body.clientId).toBe('app_x');
    await platform.listPasskeys('tok');
    expect((fetchFn.mock.calls[1][1] as RequestInit).method).toBe('GET');
  });

  it('sends client credential headers on pushEvent', async () => {
    const fetchFn = makeFetch({ '/events': () => fakeResponse(201, { id: 'e1' }) });
    const platform = new EvoPlatform({
      platformUrl: 'http://platform.test',
      clientId: 'app_x',
      clientSecret: 'shh',
      fetchFn,
    });
    await platform.pushEvent({ action: 'test.event' });
    const headers = (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-client-id']).toBe('app_x');
    expect(headers['x-client-secret']).toBe('shh');
  });
});

describe('EvoPlatform.getEntitlement', () => {
  it('is a GET with client credentials, an encoded tenant id, and no body', async () => {
    const fetchFn = makeFetch({
      '/billing/entitlement': (init) =>
        init?.body === undefined && (init?.method ?? 'GET') === 'GET'
          ? fakeResponse(200, { enabled: true, status: 'TRIAL', daysLeft: 5 })
          : fakeResponse(500, { message: 'entitlement must be a bodyless GET' }),
    });
    const platform = new EvoPlatform({
      platformUrl: 'http://platform.test',
      clientId: 'app_x',
      clientSecret: 'sec',
      fetchFn,
    });
    const out = await platform.getEntitlement({ tenantId: 't 1/x' });
    expect(out).toMatchObject({ enabled: true, status: 'TRIAL', daysLeft: 5 });
    const [url, init] = fetchFn.mock.calls[0];
    // Encoded, not interpolated raw — a slash in the id must not make a path.
    expect(new URL(String(url)).searchParams.get('tenantId')).toBe('t 1/x');
    expect((init?.headers as Record<string, string>)['x-client-id']).toBe('app_x');
  });

  it('refuses to run without client credentials — named at the call site', () => {
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn: makeFetch({}) });
    // Thrown synchronously, before any request is even constructed.
    expect(() => platform.getEntitlement({ tenantId: 't1' })).toThrow(ConfigError);
  });
});

// An unknown kid used to force a JWKS fetch on every token, and the JWKS
// endpoint is deliberately unthrottled: forged tokens against any app became
// requests against the platform, one for one (#162).
describe('JWKS refetch throttle', () => {
  afterEach(() => jest.useRealTimers());

  it('wastes at most one fetch per interval however many forged kids arrive', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await platform.verifyToken(signToken({ sub: 'u1' }), { audience: false });
    for (let i = 0; i < 5; i++) {
      await expect(
        platform.verifyToken(signToken({ sub: 'u1' }, { kid: `forged-${i}` }), { audience: false }),
      ).rejects.toBeInstanceOf(TokenError);
    }
    // One fetch for the real token, one wasted on the first forged kid, none
    // for the other four: a flood costs one request per interval.
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('refetches once the interval has passed, so key rotation still needs no redeploy', async () => {
    jest.useFakeTimers({ now: Date.now() });
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({
      platformUrl: 'http://platform.test',
      fetchFn,
      jwksMinRefreshMs: 1_000,
    });
    await platform.verifyToken(signToken({ sub: 'u1' }), { audience: false });
    // A forged kid wastes one fetch and opens the quiet interval ...
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { kid: 'forged' }), { audience: false }),
    ).rejects.toBeInstanceOf(TokenError);
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { kid: 'forged-again' }), { audience: false }),
    ).rejects.toBeInstanceOf(TokenError);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    // ... and once it has passed, an unknown kid fetches again.
    jest.setSystemTime(Date.now() + 1_500);
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { kid: 'rotated' }), { audience: false }),
    ).rejects.toBeInstanceOf(TokenError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
