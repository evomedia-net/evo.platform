export { EvoPlatform } from './client';
export { JwksCache } from './jwks';
export { requireAuth, requireRole } from './middleware';
export type { AuthableRequest, AuthableResponse } from './middleware';
export { ConfigError, PlatformError, TokenError } from './errors';
export type {
  Claims,
  EvoPlatformOptions,
  LoginParams,
  LoginResult,
  PushEventParams,
  SendEmailParams,
} from './types';
