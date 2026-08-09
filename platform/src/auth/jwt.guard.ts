// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { KeysService } from '../core/keys.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private keys: KeysService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    try {
      req.user = this.keys.verify(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // Single-purpose tokens (e.g. WebAuthn challenge tokens) are signed with
    // the same key but must never pass as access tokens.
    if (req.user?.purpose) throw new UnauthorizedException('Invalid or expired token');
    return true;
  }
}
