// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/** Requires JwtAuthGuard to have run first: @UseGuards(JwtAuthGuard, PlatformAdminGuard) */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.platform_admin !== true) {
      throw new ForbiddenException('Platform admin required');
    }
    return true;
  }
}
