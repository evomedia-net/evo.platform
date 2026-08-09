// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

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

export type UserWithRoles = Prisma.UserGetPayload<{
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

    return this.completeLogin(user, tenant, dto.clientId, { ip, method: 'password' });
  }

  /**
   * Shared final gate for every login method (password, passkey). Account and
   * tenant checks live here so all methods enforce identical rules — the
   * ceremony/credential check alone never grants a session.
   */
  async completeLogin(
    user: UserWithRoles,
    tenant: Tenant | null,
    clientId: string | undefined,
    meta: { ip?: string; method: string },
  ) {
    if (user.deletedAt) throw new UnauthorizedException('Invalid credentials');
    // Hard gate: a mailbox that was never proven cannot sign in. Distinct
    // message so apps can offer a "re-send verification email" action.
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('Email not verified');
    }
    if (tenant) {
      // PAST_DUE keeps working until the billing grace window closes
      const graceExpired =
        tenant.status === 'PAST_DUE' && tenant.graceUntil != null && tenant.graceUntil < new Date();
      if (tenant.deletedAt || tenant.status === 'SUSPENDED' || graceExpired) {
        throw new ForbiddenException('Tenant is suspended');
      }
    }
    await this.assertAppEnabled(tenant, clientId);
    const result = await this.issueTokens(user, tenant, clientId);
    await this.audit.record('auth.login', {
      tenantId: tenant?.id,
      userId: user.id,
      appClientId: clientId,
      ip: meta.ip,
      detail: { method: meta.method },
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
    if (!user.emailVerifiedAt) throw new ForbiddenException('Email not verified');
    const tenant = user.tenant;
    if (tenant && (tenant.deletedAt || tenant.status === 'SUSPENDED')) {
      throw new ForbiddenException('Tenant is suspended');
    }
    await this.assertAppEnabled(tenant ?? null, stored.appClientId ?? undefined);
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

  /**
   * App-enablement gate: a session scoped to an app (clientId) requires an
   * enabled AppTenant row for the user's tenant. Platform-level logins (no
   * tenant) and tenant logins without an app scope are not gated here —
   * those are governed by the tenant checks above.
   */
  private async assertAppEnabled(tenant: Tenant | null, clientId?: string) {
    if (!tenant || !clientId) return;
    // A soft-deleted app is not enabled for anyone. findFirst because deletedAt
    // is not part of a unique index; a null result falls through to the same
    // "not enabled" branch an unknown clientId already took.
    const app = await this.prisma.app.findFirst({ where: { clientId, deletedAt: null } });
    const enablement = app
      ? await this.prisma.appTenant.findUnique({
          where: { tenantId_appId: { tenantId: tenant.id, appId: app.id } },
        })
      : null;
    if (!enablement) throw new ForbiddenException('App is not enabled for this workspace');
    const now = new Date();
    if (enablement.status === 'SUSPENDED') {
      throw new ForbiddenException('App access is suspended for this workspace');
    }
    if (
      enablement.status === 'TRIAL' &&
      enablement.trialEndsAt != null &&
      enablement.trialEndsAt < now
    ) {
      throw new ForbiddenException('Trial has ended for this workspace');
    }
    if (
      enablement.status === 'PAST_DUE' &&
      enablement.graceUntil != null &&
      enablement.graceUntil < now
    ) {
      throw new ForbiddenException('App access is suspended for this workspace');
    }
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
        tenant_admin: user.isTenantAdmin,
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
        tenantAdmin: user.isTenantAdmin,
        tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name } : null,
      },
    };
  }
}
