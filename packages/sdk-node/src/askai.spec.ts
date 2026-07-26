import { AskAi } from './askai';
import { ConfigError, PlatformError } from './errors';

type FetchMock = jest.Mock & typeof fetch;

const QUERY_OK = {
  answer: 'Three permits expire this quarter.',
  question: 'which permits expire this quarter?',
  sources: [{ text: 'Permit A...', score: 0.81, metadata: { source_type: 'permit' } }],
  gated: false,
  unconfigured: false,
};

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function makeFetch(handler: (url: string, init?: RequestInit) => unknown): FetchMock {
  return jest.fn(async (url: string | URL, init?: RequestInit) =>
    handler(String(url), init),
  ) as unknown as FetchMock;
}

const okFetch = () => makeFetch(() => fakeResponse(200, QUERY_OK));

function headersOf(fetchFn: FetchMock): Record<string, string> {
  return (fetchFn.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
}

function bodyOf(fetchFn: FetchMock): Record<string, any> {
  return JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string);
}

describe('AskAi construction', () => {
  it('requires a url', () => {
    expect(() => new AskAi({ url: '' })).toThrow(ConfigError);
  });

  it('strips trailing slashes so the path is not doubled', async () => {
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test///', serviceKey: 'svc_k', fetchFn });
    await ai.ask({ question: 'q', tenantId: 't1' });
    expect(fetchFn.mock.calls[0][0]).toBe('http://ai.test/query');
  });
});

describe('AskAi service-key auth', () => {
  it('sends the key and names the tenant', async () => {
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_secret', fetchFn });
    await ai.ask({ question: 'q', tenantId: 'tenant-42' });

    const headers = headersOf(fetchFn);
    expect(headers.Authorization).toBe('Bearer svc_secret');
    expect(headers['X-Data-Tenant']).toBe('tenant-42');
  });

  it('refuses to call without a tenant, rather than letting evo-ai 400', async () => {
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_secret', fetchFn });
    await expect(ai.ask({ question: 'q' })).rejects.toBeInstanceOf(ConfigError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses when neither a service key nor a token is available', async () => {
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test', fetchFn });
    await expect(ai.ask({ question: 'q', tenantId: 't1' })).rejects.toBeInstanceOf(ConfigError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('AskAi user-token auth', () => {
  it('sends the token and no tenant header — the tenant is in the claims', async () => {
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test', fetchFn });
    await ai.ask({ question: 'q', accessToken: 'user.jwt.here' });

    const headers = headersOf(fetchFn);
    expect(headers.Authorization).toBe('Bearer user.jwt.here');
    expect(headers['X-Data-Tenant']).toBeUndefined();
  });

  it('rejects a token and a tenantId together instead of silently ignoring one', async () => {
    // Sending both is a misunderstanding worth surfacing: evo-ai would take
    // the tenant from the claims, so the caller's tenantId has no effect and
    // they would believe they had scoped the request when they had not.
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    await expect(
      ai.ask({ question: 'q', accessToken: 'jwt', tenantId: 'other-tenant' }),
    ).rejects.toBeInstanceOf(ConfigError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('prefers the user token when the client also holds a service key', async () => {
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    await ai.ask({ question: 'q', accessToken: 'jwt' });
    expect(headersOf(fetchFn).Authorization).toBe('Bearer jwt');
  });
});

describe('AskAi request body', () => {
  it('defaults history, collection, and the action switch', async () => {
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    await ai.ask({ question: 'q', tenantId: 't1' });

    expect(bodyOf(fetchFn)).toEqual({
      question: 'q',
      history: [],
      source_types: null,
      collection: 'default',
      allow_actions: false,
    });
  });

  it('maps camelCase params onto the API snake_case', async () => {
    const fetchFn = okFetch();
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    await ai.ask({
      question: 'q',
      tenantId: 't1',
      sourceTypes: ['permit', 'incident'],
      collection: 'archive',
      allowActions: true,
      history: [{ role: 'user', content: 'earlier' }],
    });

    const body = bodyOf(fetchFn);
    expect(body.source_types).toEqual(['permit', 'incident']);
    expect(body.collection).toBe('archive');
    expect(body.allow_actions).toBe(true);
    expect(body.history).toEqual([{ role: 'user', content: 'earlier' }]);
  });
});

describe('AskAi response', () => {
  it('returns the answer and its sources', async () => {
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn: okFetch() });
    const result = await ai.ask({ question: 'q', tenantId: 't1' });

    expect(result.answer).toBe('Three permits expire this quarter.');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].score).toBe(0.81);
    expect(result.gated).toBe(false);
  });

  it('surfaces a refusal as a normal result, not an error', async () => {
    // The single most important behaviour here: a gated question is the
    // product working correctly. Throwing would push callers into rendering
    // it as a failure, which teaches users to distrust the assistant.
    const fetchFn = makeFetch(() =>
      fakeResponse(200, { answer: "Records don't cover that.", gated: true }),
    );
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    const result = await ai.ask({ question: 'write me a poem', tenantId: 't1' });

    expect(result.gated).toBe(true);
    expect(result.answer).toContain("don't cover");
  });

  it('surfaces unconfigured as a normal result too', async () => {
    const fetchFn = makeFetch(() => fakeResponse(200, { answer: '', unconfigured: true }));
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    expect((await ai.ask({ question: 'q', tenantId: 't1' })).unconfigured).toBe(true);
  });

  it('maps action_proposal to actionProposal', async () => {
    const fetchFn = makeFetch(() =>
      fakeResponse(200, { answer: 'ok', action_proposal: { kind: 'assign' } }),
    );
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    const result = await ai.ask({ question: 'q', tenantId: 't1', allowActions: true });
    expect(result.actionProposal).toEqual({ kind: 'assign' });
  });

  it('falls back to the asked question when the API omits the condensed one', async () => {
    const fetchFn = makeFetch(() => fakeResponse(200, { answer: 'ok' }));
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    expect((await ai.ask({ question: 'original', tenantId: 't1' })).question).toBe('original');
  });
});

describe('AskAi failures', () => {
  it('throws PlatformError carrying the status and evo-ai detail', async () => {
    const fetchFn = makeFetch(() =>
      fakeResponse(400, { detail: 'Service calls must set X-Data-Tenant' }),
    );
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });

    await expect(ai.ask({ question: 'q', tenantId: 't1' })).rejects.toMatchObject({
      name: 'PlatformError',
      status: 400,
      message: 'Service calls must set X-Data-Tenant',
    });
  });

  it('reports a timeout as 504 rather than a bare DOMException', async () => {
    const fetchFn = makeFetch(() => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    });
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn, timeoutMs: 50 });

    await expect(ai.ask({ question: 'q', tenantId: 't1' })).rejects.toMatchObject({
      status: 504,
      message: 'Ask AI request timed out after 50ms',
    });
  });

  it('reports an unreachable service as status 0', async () => {
    const fetchFn = makeFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    await expect(ai.ask({ question: 'q', tenantId: 't1' })).rejects.toMatchObject({ status: 0 });
  });

  it('does not choke on a non-JSON error body', async () => {
    const fetchFn = makeFetch(() => ({
      ok: false,
      status: 502,
      text: async () => '<html>gateway</html>',
    }));
    const ai = new AskAi({ url: 'http://ai.test', serviceKey: 'svc_k', fetchFn });
    await expect(ai.ask({ question: 'q', tenantId: 't1' })).rejects.toBeInstanceOf(PlatformError);
  });
});

describe('AskAi.health', () => {
  it('is true when the service answers', async () => {
    const fetchFn = makeFetch(() => fakeResponse(200, { status: 'ok' }));
    expect(await new AskAi({ url: 'http://ai.test', fetchFn }).health()).toBe(true);
  });

  it('is false rather than throwing when it does not', async () => {
    const fetchFn = makeFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    expect(await new AskAi({ url: 'http://ai.test', fetchFn }).health()).toBe(false);
  });
});
