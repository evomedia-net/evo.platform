export { EvoPlatform } from './client';
export { AskAi } from './askai';
export { JwksCache } from './jwks';
export { requireAuth, requireRole } from './middleware';
export type { AuthableRequest, AuthableResponse } from './middleware';
export { ConfigError, PlatformError, TokenError } from './errors';
export type {
  AskAiOptions,
  AskMessage,
  AskParams,
  AskResult,
  AskSource,
  Claims,
  EvoPlatformOptions,
  LoginParams,
  LoginResult,
  PasskeyInfo,
  PasskeyLoginOptionsResult,
  PasskeyRegisterOptionsResult,
  PushEventParams,
  SendEmailParams,
} from './types';
