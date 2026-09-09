// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import * as sdk from './index';
import { AskAi } from './askai';
import { EvoPlatform } from './client';
import { ConfigError, PlatformError, TokenError } from './errors';
import { JwksCache } from './jwks';
import { requireAuth, requireRole } from './middleware';

describe('index', () => {
  // The package entry is a list of re-exports. Checking identity, not just
  // presence, catches a re-export that points at a copy or the wrong module.
  it('re-exports the public surface by identity', () => {
    expect(sdk.EvoPlatform).toBe(EvoPlatform);
    expect(sdk.AskAi).toBe(AskAi);
    expect(sdk.JwksCache).toBe(JwksCache);
    expect(sdk.requireAuth).toBe(requireAuth);
    expect(sdk.requireRole).toBe(requireRole);
    expect(sdk.ConfigError).toBe(ConfigError);
    expect(sdk.PlatformError).toBe(PlatformError);
    expect(sdk.TokenError).toBe(TokenError);
  });
});
