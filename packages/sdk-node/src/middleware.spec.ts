// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { EvoPlatform } from './client';
import { TokenError } from './errors';
import { AuthableRequest, requireAuth, requireRole } from './middleware';
import { Claims } from './types';

const claims = { sub: 'u1', roles: ['admin', 'member'] } as unknown as Claims;

/** A response recorder shaped like the AuthableResponse contract. */
function makeRes() {
  const seen = { status: 0, body: undefined as unknown };
  const res = {
    status(code: number) {
      seen.status = code;
      return {
        json(body: unknown) {
          seen.body = body;
          return body;
        },
      };
    },
  };
  return { res, seen };
}

/** Only verifyToken is reached through the middleware, so that is all it needs. */
function platformThat(verify: (token: string) => Promise<Claims>): EvoPlatform {
  return { verifyToken: jest.fn(verify) } as unknown as EvoPlatform;
}

describe('requireAuth', () => {
  it('answers 401 when there is no Authorization header, without verifying anything', async () => {
    const platform = platformThat(async () => claims);
    const { res, seen } = makeRes();
    const next = jest.fn();
    await requireAuth(platform)({ headers: {} }, res, next);
    expect(seen).toEqual({ status: 401, body: { message: 'Missing bearer token' } });
    expect(next).not.toHaveBeenCalled();
    expect(platform.verifyToken).not.toHaveBeenCalled();
  });

  it('answers 401 for a scheme other than Bearer', async () => {
    const platform = platformThat(async () => claims);
    const { res, seen } = makeRes();
    const next = jest.fn();
    await requireAuth(platform)({ headers: { authorization: 'Basic dXNlcjpwdw==' } }, res, next);
    expect(seen.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(platform.verifyToken).not.toHaveBeenCalled();
  });

  it('reads the first value when the header is repeated', async () => {
    const platform = platformThat(async () => claims);
    const { res } = makeRes();
    const next = jest.fn();
    await requireAuth(platform)(
      { headers: { authorization: ['Bearer first', 'Bearer second'] } },
      res,
      next,
    );
    expect(platform.verifyToken).toHaveBeenCalledWith('first');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('attaches the claims as req.evo and calls next', async () => {
    const platform = platformThat(async () => claims);
    const { res, seen } = makeRes();
    const next = jest.fn();
    const req: AuthableRequest = { headers: { authorization: 'Bearer tok' } };
    await requireAuth(platform)(req, res, next);
    expect(platform.verifyToken).toHaveBeenCalledWith('tok');
    expect(req.evo).toBe(claims);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(seen.status).toBe(0); // nothing written
  });

  it('answers 401 when verification fails, and does not call next', async () => {
    const platform = platformThat(async () => {
      throw new TokenError('expired');
    });
    const { res, seen } = makeRes();
    const next = jest.fn();
    const req: AuthableRequest = { headers: { authorization: 'Bearer stale' } };
    await requireAuth(platform)(req, res, next);
    expect(seen).toEqual({ status: 401, body: { message: 'Invalid or expired token' } });
    expect(req.evo).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole', () => {
  it('calls next when the claims carry the role', () => {
    const { res, seen } = makeRes();
    const next = jest.fn();
    requireRole('admin')({ headers: {}, evo: claims }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(seen.status).toBe(0);
  });

  it('answers 403 when the role is missing', () => {
    const { res, seen } = makeRes();
    const next = jest.fn();
    requireRole('billing')({ headers: {}, evo: claims }, res, next);
    expect(seen).toEqual({ status: 403, body: { message: 'Role "billing" required' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 403 when requireAuth has not run', () => {
    // No req.evo at all: the role check must fail closed, not throw.
    const { res, seen } = makeRes();
    const next = jest.fn();
    requireRole('admin')({ headers: {} }, res, next);
    expect(seen.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
