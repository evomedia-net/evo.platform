// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/** A non-2xx response from a platform service (the platform itself, or evo-ai).
 *  Status 0 means the service could not be reached at all; 504 is a client-side
 *  timeout rather than a response. */
export class PlatformError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

/** Token failed local verification (bad signature, expired, wrong issuer, unknown kid). */
export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenError';
  }
}

/** SDK misconfiguration, e.g. calling a client-credential API without credentials. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
