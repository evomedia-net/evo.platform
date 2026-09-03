// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

// These run the real helmet middleware against a stub response and read the
// headers it wrote. Asserting on the options object alone would pass while
// helmet ignored a misspelled key; the header string is what a browser sees.

import helmet from 'helmet';
import { securityHeaders } from './security-headers';

function headersFor(env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string | number | readonly string[]) => {
      headers[k.toLowerCase()] = String(v);
    },
    removeHeader: (k: string) => {
      delete headers[k.toLowerCase()];
    },
    getHeader: (k: string) => headers[k.toLowerCase()],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  helmet(securityHeaders(env))({} as any, res as any, () => undefined);
  return headers;
}

describe('securityHeaders', () => {
  const prod = headersFor({ NODE_ENV: 'production' });
  const dev = headersFor({ NODE_ENV: 'development' });

  it('allows script only from this origin, and never from attributes', () => {
    for (const h of [prod, dev]) {
      expect(h['content-security-policy']).toContain("script-src 'self'");
      expect(h['content-security-policy']).toContain("script-src-attr 'none'");
      expect(h['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
    }
  });

  it('refuses framing, plugins and foreign form targets', () => {
    expect(prod['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(prod['content-security-policy']).toContain("object-src 'none'");
    expect(prod['content-security-policy']).toContain("form-action 'self'");
    expect(prod['x-frame-options']).toBe('DENY');
  });

  it('keeps inline style, which the console and the mail preview need', () => {
    expect(prod['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('sends HSTS and upgrade-insecure-requests only in production', () => {
    expect(prod['strict-transport-security']).toMatch(/max-age=31536000/);
    expect(prod['strict-transport-security']).toContain('includeSubDomains');
    expect(prod['content-security-policy']).toContain('upgrade-insecure-requests');
    expect(dev['strict-transport-security']).toBeUndefined();
    expect(dev['content-security-policy']).not.toContain('upgrade-insecure-requests');
  });

  it('sets the remaining hardening headers', () => {
    expect(prod['x-content-type-options']).toBe('nosniff');
    expect(prod['referrer-policy']).toBe('no-referrer');
    expect(prod['cross-origin-embedder-policy']).toBeUndefined();
  });
});
