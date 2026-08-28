// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { ConfigError, PlatformError } from './errors';
import { AskAiOptions, AskParams, AskResult } from './types';

/** Default request timeout. An LLM composing an answer over retrieved records
 *  is not a fast API call — the usual 30s client default cuts off answers that
 *  were about to succeed. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Client for evo-ai, the Ask AI service.
 *
 * evo-ai is a SEPARATE service from the platform, with its own URL and its own
 * credentials, so this is a sibling of {@link EvoPlatform} rather than a method
 * on it.
 *
 * Two ways to authenticate, matching the two ways an app is built:
 *
 * - **Service key** — your server holds one `svc_` key and names the tenant per
 *   request. Use when your app has its own login. The key authenticates the
 *   *application*; `tenantId` states which customer's data to search.
 * - **User access token** — pass a platform-issued token straight through and
 *   evo-ai reads the tenant from its verified claims. Use when your app is in
 *   platform mode.
 *
 * ```ts
 * const ai = new AskAi({ url: process.env.EVOAI_URL!, serviceKey: process.env.EVOAI_SERVICE_KEY });
 * const { answer, sources, gated } = await ai.ask({
 *   question: 'which permits expire this quarter?',
 *   tenantId: session.tenantId,
 *   sourceTypes: ['permit'],
 * });
 * ```
 */
export class AskAi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: AskAiOptions) {
    if (!opts.url) throw new ConfigError('AskAi requires a url');
    this.baseUrl = opts.url.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /**
   * Ask a question against one tenant's indexed data.
   *
   * Throws {@link PlatformError} on any non-2xx response or timeout — a
   * refusal is NOT an error. Check `gated` (the question was declined as
   * unrelated to the indexed data, before any AI call) and `unconfigured`
   * (no usable model for this tenant, which is an administrator problem)
   * and render those differently from a failure.
   */
  async ask(params: AskParams): Promise<AskResult> {
    const body = {
      question: params.question,
      history: params.history ?? [],
      source_types: params.sourceTypes ?? null,
      collection: params.collection ?? 'default',
      allow_actions: params.allowActions ?? false,
      // Asserts WHICH user is asking, the way X-Data-Tenant asserts which
      // customer. evo-ai keys conversation memory on the pair; a service key
      // is one identity, so omitting this pools every user of a tenant into
      // one memory. Null is the "no user context" case, not an error.
      user_id: params.userId ?? null,
    };

    const res = await this.send('/query', body, this.authHeaders(params));
    return {
      answer: res.answer ?? '',
      // The question actually executed: with history, evo-ai condenses a
      // follow-up like "how many?" into a standalone question before
      // searching. Worth logging, and worth showing when it surprises a user.
      question: res.question ?? params.question,
      sources: res.sources ?? [],
      actionProposal: res.action_proposal ?? null,
      gated: Boolean(res.gated),
      unconfigured: Boolean(res.unconfigured),
    };
  }

  /** Liveness check. Cheap enough for a readiness probe. */
  async health(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ---- internals ----

  private authHeaders(params: AskParams): Record<string, string> {
    if (params.accessToken) {
      // The tenant comes from the token's verified claims. Naming one here
      // too would be ignored, so reject it rather than imply it took effect.
      if (params.tenantId) {
        throw new ConfigError(
          'Pass either accessToken or tenantId, not both — with a user token ' +
            'the tenant comes from its verified claims',
        );
      }
      return { Authorization: `Bearer ${params.accessToken}` };
    }

    if (!this.opts.serviceKey) {
      throw new ConfigError(
        'AskAi.ask needs either a serviceKey on the client or an accessToken on the call',
      );
    }
    if (!params.tenantId) {
      // evo-ai answers 400 for this; failing here names the actual mistake.
      throw new ConfigError(
        'tenantId is required when authenticating with a service key — the key ' +
          'identifies your application, not the customer',
      );
    }
    return {
      Authorization: `Bearer ${this.opts.serviceKey}`,
      'X-Data-Tenant': String(params.tenantId),
    };
  }

  private async send(
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // A timeout is the most likely failure here, so make it legible rather
      // than surfacing a bare DOMException with no context.
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new PlatformError(504, `Ask AI request timed out after ${this.timeoutMs}ms`);
      }
      throw new PlatformError(
        0,
        `Ask AI is unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      const detail =
        typeof parsed === 'object' && parsed !== null && 'detail' in parsed
          ? String((parsed as { detail: unknown }).detail)
          : `Ask AI request failed with status ${res.status}`;
      throw new PlatformError(res.status, detail, parsed);
    }
    return (parsed ?? {}) as Record<string, any>;
  }
}
