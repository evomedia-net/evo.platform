// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../core/prisma.service';

/** Authenticates a registered app via x-client-id / x-client-secret headers. */
@Injectable()
export class ClientGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const clientId = req.headers['x-client-id'];
    const clientSecret = req.headers['x-client-secret'];
    if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
      throw new UnauthorizedException('Missing client credentials');
    }
    // findFirst, not findUnique: a soft-deleted app must stop authenticating,
    // and deletedAt is not part of a unique index. Answering "invalid client
    // credentials" rather than "deleted" is deliberate - an unauthenticated
    // caller learns nothing about which client ids exist.
    const app = await this.prisma.app.findFirst({ where: { clientId, deletedAt: null } });
    if (!app || !(await bcrypt.compare(clientSecret, app.clientSecretHash))) {
      throw new UnauthorizedException('Invalid client credentials');
    }
    req.clientApp = app;
    return true;
  }
}
