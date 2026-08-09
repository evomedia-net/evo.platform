// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

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
  Entitlement,
  EvoPlatformOptions,
  LoginParams,
  LoginResult,
  PasskeyInfo,
  PasskeyLoginOptionsResult,
  PasskeyRegisterOptionsResult,
  PushEventParams,
  SendEmailParams,
} from './types';
