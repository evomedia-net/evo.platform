// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// The controller is deliberately thin — every route hands straight to a
// service — so these tests pin exactly two things: that each route calls the
// right service with the right arguments, and that the two HTML-answering
// routes (the emailed verify/reset landing pages) render the correct page
// for good, bad, and absent tokens. The delegation sounds too trivial to
// test until a route is quietly rewired to the wrong flow.

import { AuthController, JwksController } from './auth.controller';

const auth = {
  login: jest.fn().mockResolvedValue({ accessToken: 'a' }),
  refresh: jest.fn().mockResolvedValue({ accessToken: 'b' }),
  logout: jest.fn().mockResolvedValue({ ok: true }),
};
const flows = {
  sendVerification: jest.fn().mockResolvedValue({ ok: true }),
  confirmVerification: jest.fn().mockResolvedValue({ ok: true }),
  listWorkspaces: jest.fn().mockResolvedValue({ ok: true }),
  requestReset: jest.fn().mockResolvedValue({ ok: true }),
  resetPassword: jest.fn().mockResolvedValue({ ok: true }),
  productForResetToken: jest.fn().mockResolvedValue({ name: 'evo.demo', signInUrl: 'https://demo' }),
};
const signup = {
  signup: jest.fn().mockResolvedValue({ ok: true }),
  issueSignupLink: jest.fn().mockResolvedValue({ url: 'https://x' }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctrl = new AuthController(auth as any, flows as any, signup as any);

function htmlRes() {
  const res = { sent: '', type: jest.fn(), send: jest.fn() };
  res.type.mockReturnValue(res);
  res.send.mockImplementation((body: string) => { res.sent = body; });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return res as any;
}

const GOOD_SHAPE = 'aaaa.bbbb.cccc'; // matches JWT_SHAPE without being a real token

beforeEach(() => jest.clearAllMocks());

describe('AuthController delegation', () => {
  it('signup passes the caller ip through for rate limiting', async () => {
    await ctrl.signupPost({ email: 'a@b.c' } as never, '10.0.0.9');
    expect(signup.signup).toHaveBeenCalledWith({ email: 'a@b.c' }, '10.0.0.9');
  });

  it('signup-links defaults the expiry to 72 hours', async () => {
    await ctrl.signupLink({} as never);
    expect(signup.issueSignupLink).toHaveBeenCalledWith(72);
    await ctrl.signupLink({ expiresInHours: 4 } as never);
    expect(signup.issueSignupLink).toHaveBeenLastCalledWith(4);
  });

  it('login / refresh / logout hand to AuthService', async () => {
    await ctrl.login({ email: 'a@b.c', password: 'x' } as never, '10.0.0.9');
    expect(auth.login).toHaveBeenCalledWith({ email: 'a@b.c', password: 'x' }, '10.0.0.9');
    await ctrl.refresh({ refreshToken: 'r1' } as never);
    expect(auth.refresh).toHaveBeenCalledWith('r1');
    await ctrl.logout({ refreshToken: 'r1' } as never);
    expect(auth.logout).toHaveBeenCalledWith('r1');
  });

  it('me answers with whatever the guard attached', () => {
    expect(ctrl.me({ user: { sub: 'u1' } })).toEqual({ sub: 'u1' });
  });

  it('verification and reset flows hand to AccountFlowsService', async () => {
    await ctrl.sendVerification({ email: 'a@b.c' } as never);
    expect(flows.sendVerification).toHaveBeenCalled();
    await ctrl.verify({ token: 't' } as never);
    expect(flows.confirmVerification).toHaveBeenCalledWith('t');
    await ctrl.workspaces({ email: 'a@b.c' } as never);
    expect(flows.listWorkspaces).toHaveBeenCalled();
    await ctrl.forgot({ email: 'a@b.c' } as never);
    expect(flows.requestReset).toHaveBeenCalled();
    await ctrl.reset({ token: 't', password: 'p' } as never);
    expect(flows.resetPassword).toHaveBeenCalledWith('t', 'p');
  });
});

describe('the emailed verify landing page', () => {
  it('confirms a well-shaped token and renders success', async () => {
    const res = htmlRes();
    await ctrl.verifyPage(GOOD_SHAPE, res);
    expect(flows.confirmVerification).toHaveBeenCalledWith(GOOD_SHAPE);
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.sent.toLowerCase()).toContain('verified');
  });

  it('renders failure when confirmation throws, without leaking the error', async () => {
    flows.confirmVerification.mockRejectedValueOnce(new Error('boom-internal-detail'));
    const res = htmlRes();
    await ctrl.verifyPage(GOOD_SHAPE, res);
    expect(res.sent).not.toContain('boom-internal-detail'); // friendly page, no raw error
  });

  it('never calls the service for a malformed or missing token', async () => {
    for (const bad of [undefined, 'not-a-jwt', '<script>x</script>']) {
      const res = htmlRes();
      await ctrl.verifyPage(bad as never, res);
      expect(res.sent).toBeTruthy();
    }
    expect(flows.confirmVerification).not.toHaveBeenCalled();
  });
});

describe('the emailed reset landing page', () => {
  it('shows the invalid page for a missing or malformed token', async () => {
    for (const bad of [undefined, 'nope']) {
      const res = htmlRes();
      await ctrl.resetPage(bad as never, res);
      expect(res.sent).toBeTruthy();
    }
    expect(flows.productForResetToken).not.toHaveBeenCalled();
  });

  it('renders the form naming the product the token belongs to', async () => {
    const res = htmlRes();
    await ctrl.resetPage(GOOD_SHAPE, res);
    expect(flows.productForResetToken).toHaveBeenCalledWith(GOOD_SHAPE);
    expect(res.sent).toContain('evo.demo');
  });
});

describe('JwksController', () => {
  it('serves the key set straight from KeysService', () => {
    const keys = { jwks: jest.fn().mockReturnValue({ keys: [] }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(new JwksController(keys as any).jwks()).toEqual({ keys: [] });
  });
});
