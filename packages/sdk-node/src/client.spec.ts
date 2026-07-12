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
    const claims = (await platform.verifyToken(token)) as Claims;
    expect(claims.sub).toBe('u1');
    expect(claims.tenant_slug).toBe('acme');
    expect(claims.roles).toEqual(['admin']);
  });

  it('caches the JWKS across verifications', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await platform.verifyToken(signToken({ sub: 'u1' }));
    await platform.verifyToken(signToken({ sub: 'u2' }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('rejects an expired token', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { expiresIn: -10 })),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects a token from another issuer', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { issuer: 'someone-else' })),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it('rejects a tampered token', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    const token = signToken({ sub: 'u1' });
    await expect(platform.verifyToken(token.slice(0, -3) + 'abc')).rejects.toBeInstanceOf(
      TokenError,
    );
  });

  it('re-fetches the JWKS when it sees an unknown kid', async () => {
    const fetchFn = makeFetch({ '/.well-known/jwks.json': jwksRoute });
    const platform = new EvoPlatform({ platformUrl: 'http://platform.test', fetchFn });
    await platform.verifyToken(signToken({ sub: 'u1' }));
    await expect(
      platform.verifyToken(signToken({ sub: 'u1' }, { kid: 'rotated-kid' })),
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
