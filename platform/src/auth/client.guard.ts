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
    const app = await this.prisma.app.findUnique({ where: { clientId } });
    if (!app || !(await bcrypt.compare(clientSecret, app.clientSecretHash))) {
      throw new UnauthorizedException('Invalid client credentials');
    }
    req.clientApp = app;
    return true;
  }
}
