// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Requires JwtAuthGuard to have run first: @UseGuards(JwtAuthGuard, TenantAdminGuard).
 * The tenant scope comes from the verified token, never from client input, so a
 * tenant admin can only ever act inside their own tenant. Platform admins use
 * the /admin API instead — their tokens carry no tenant_id and fail here.
 */
@Injectable()
export class TenantAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.tenant_admin !== true || !req.user?.tenant_id) {
      throw new ForbiddenException('Tenant admin required');
    }
    return true;
  }
}
