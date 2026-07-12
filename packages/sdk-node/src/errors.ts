/** A non-2xx response from the platform service. */
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
