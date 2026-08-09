// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * PUBLIC_BASE_URL is the one setting whose being wrong breaks nothing at
 * runtime: the service starts, mail sends, and every emailed link is
 * unreachable. Production ran that way for weeks. These pin the fail-fast.
 */
import { resolvePublicBaseUrl } from './config';

describe('resolvePublicBaseUrl', () => {
  it('falls back to localhost outside production', () => {
    expect(resolvePublicBaseUrl({} as NodeJS.ProcessEnv)).toBe('http://localhost:8200');
  });

  it('refuses to start in production when it is unset', () => {
    expect(() => resolvePublicBaseUrl({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /not set in production/i,
    );
  });

  it.each(['http://localhost:8200', 'http://127.0.0.1:8200', 'https://localhost'])(
    'refuses a loopback URL in production: %s',
    (url) => {
      expect(() =>
        resolvePublicBaseUrl({ NODE_ENV: 'production', PUBLIC_BASE_URL: url } as NodeJS.ProcessEnv),
      ).toThrow(/unreachable for the recipient/i);
    },
  );

  it('names the consequence, not just the variable', () => {
    // A message that only says "invalid config" sends the reader to the code;
    // this one has to say what the user would have experienced.
    expect(() => resolvePublicBaseUrl({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(
      /verification, reset and invite email/i,
    );
  });

  it('accepts a real public URL and trims trailing slashes', () => {
    expect(
      resolvePublicBaseUrl({
        NODE_ENV: 'production',
        PUBLIC_BASE_URL: 'https://platform.evomedia.net//',
      } as NodeJS.ProcessEnv),
    ).toBe('https://platform.evomedia.net');
  });

  it('allows a loopback URL in development, where it is correct', () => {
    expect(
      resolvePublicBaseUrl({ PUBLIC_BASE_URL: 'http://localhost:8200' } as NodeJS.ProcessEnv),
    ).toBe('http://localhost:8200');
  });
});
