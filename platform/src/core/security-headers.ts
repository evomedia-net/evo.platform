// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import type { HelmetOptions } from 'helmet';

/**
 * The response headers every platform reply carries (#156).
 *
 * The console keeps the admin's tokens in sessionStorage, so before this the
 * only thing between a future XSS and full platform-admin takeover was that
 * every interpolation happened to be escaped. A Content-Security-Policy makes
 * that defence in depth: nothing but this origin's own files can run script,
 * and no attribute can. The console, the recovery pages, the scripts they
 * use and their fonts are all served by this process, so 'self' is enough -
 * which is why the recovery pages moved their handlers into /auth-pages.js
 * and the console's footer script into admin-ui.js.
 *
 * Styles allow inline. The console sets widths and colours through style
 * attributes, the recovery pages inline their one stylesheet, and the
 * template preview renders mail whose layout is inline by necessity. Inline
 * style cannot run script, and a scripted attribute is already refused by
 * script-src-attr.
 *
 * Two directives are production-only, because on a plain-http dev origin
 * they do harm: upgrade-insecure-requests would send the browser to
 * https://localhost, and a browser that has once seen HSTS for localhost
 * refuses plain http to every other dev server on the machine.
 */
export function securityHeaders(env: NodeJS.ProcessEnv = process.env): HelmetOptions {
  const production = env.NODE_ENV === 'production';
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        ...(production ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    strictTransportSecurity: production
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
    xFrameOptions: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    // Off: it would require every cross-origin resource to opt in, and the
    // platform embeds none. Left explicit so nobody re-enables it by accident.
    crossOriginEmbedderPolicy: false,
  };
}
