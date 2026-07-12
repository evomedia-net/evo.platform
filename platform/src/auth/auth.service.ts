import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../core/prisma.service';
import { KeysService } from '../core/keys.service';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../core/crypto.util';
import { config } from '../config';
import { LoginDto } from './dto';

type UserWithRoles = Prisma.UserGetPayload<{
  include: { roles: { include: { role: { include: { app: true } } } } };
}>;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private keys: KeysService,
    private audit: AuditService,
  ) {}

  async login(dto: LoginDto, ip?: string) {
    let tenant: Tenant | null = null;
    if (dto.tenantSlug) {
      tenant = await this.prisma.tenant.findFirst({
        where: { slug: dto.tenantSlug, deletedAt: null },
      });
      if (!tenant) throw new UnauthorizedException('Invalid credentials');
      if (tenant.status === 'SUSPENDED') throw new ForbiddenException('Tenant is suspended');
    }

    const user = await this.prisma.user.findFirst({
      where: { tenantId: tenant?.id ?? null, email: dto.email.toLowerCase(), deletedAt: null },
      include: { roles: { include: { role: { include: { app: true } } } } },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const result = await this.issueTokens(user, tenant, dto.clientId);
    await this.audit.record('auth.login', {
      tenantId: tenant?.id,
      userId: user.id,
      appClientId: dto.clientId,
      ip,
    });
    return result;
  }

  async refresh(rawToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: {
        user: {
          include: {
            roles: { include: { role: { include: { app: true } } } },
            tenant: true,
          },
        },
      },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = stored.user;
    if (user.deletedAt) throw new UnauthorizedException('Invalid refresh token');
    const tenant = user.tenant;
    if (tenant && (tenant.deletedAt || tenant.status === 'SUSPENDED')) {
      throw new ForbiddenException('Tenant is suspended');
    }
    // Rotate: revoke the used token, issue a fresh pair
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(user, tenant ?? null, stored.appClientId ?? undefined);
  }

  async logout(rawToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  private rolesForApp(user: UserWithRoles, clientId?: string): string[] {
    return user.roles
      .filter((ur) => !clientId || ur.role.app.clientId === clientId)
      .map((ur) => ur.role.name);
  }

  private async issueTokens(user: UserWithRoles, tenant: Tenant | null, clientId?: string) {
    const accessToken = this.keys.sign(
      {
        sub: user.id,
        email: user.email,
        tenant_id: tenant?.id ?? null,
        tenant_slug: tenant?.slug ?? null,
        roles: this.rolesForApp(user, clientId),
        app: clientId ?? null,
        platform_admin: user.isPlatformAdmin,
      },
      config.accessTtlSec,
    );

    const rawRefresh = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawRefresh),
        appClientId: clientId ?? null,
        expiresAt: new Date(Date.now() + config.refreshTtlDays * 86_400_000),
      },
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      expiresIn: config.accessTtlSec,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformAdmin: user.isPlatformAdmin,
        tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name } : null,
      },
    };
  }
}
