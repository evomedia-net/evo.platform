// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateMemberDto, UpdateMemberDto } from './dto';

const MEMBER_FIELDS = {
  id: true,
  email: true,
  name: true,
  firstName: true,
  lastName: true,
  phone: true,
  isTenantAdmin: true,
  createdAt: true,
  deletedAt: true,
  roles: {
    select: {
      role: {
        select: { id: true, name: true, app: { select: { name: true, clientId: true } } },
      },
    },
  },
} as const;

function fullName(first?: string | null, last?: string | null): string | null {
  return [first, last].filter(Boolean).join(' ').trim() || null;
}

/**
 * Member management for tenant admins. Every method takes tenantId from the
 * caller's verified token (via the controller) — it never appears in a DTO,
 * so requests cannot reach into another tenant. actorId is the admin acting,
 * used for audit trails and self-lockout protection.
 */
@Injectable()
export class TenantService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** Deactivated members are included: admins see and can restore them. */
  list(tenantId: string) {
    return this.prisma.user.findMany({
      where: { tenantId },
      select: MEMBER_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Apps enabled for this tenant with their roles — feeds role pickers. */
  async listRoles(tenantId: string) {
    const access = await this.prisma.appTenant.findMany({
      where: { tenantId },
      include: {
        app: {
          select: {
            name: true,
            clientId: true,
            roles: { select: { id: true, name: true, description: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return access.map((a) => ({
      app: a.app.name,
      clientId: a.app.clientId,
      status: a.status,
      roles: a.app.roles,
    }));
  }

  /** 404 (not 403) for users outside the tenant — their existence is not revealed. */
  private async getMember(tenantId: string, id: string) {
    const member = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: MEMBER_FIELDS,
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async create(tenantId: string, actorId: string, dto: CreateMemberDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findFirst({ where: { tenantId, email } });
    if (existing) throw new ConflictException('A member with that email already exists');
    const member = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        name: fullName(dto.firstName, dto.lastName),
        passwordHash: await bcrypt.hash(dto.password, 10),
        isTenantAdmin: dto.isTenantAdmin ?? false,
        // isPlatformAdmin is deliberately not settable from this surface
        // Tenant admin handed the credentials over directly — identity proven.
        emailVerifiedAt: new Date(),
      },
      select: MEMBER_FIELDS,
    });
    await this.audit.record('tenant.member_created', {
      tenantId,
      userId: actorId,
      detail: { memberId: member.id, email },
    });
    return member;
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateMemberDto) {
    const existing = await this.getMember(tenantId, id);
    if (id === actorId && dto.isTenantAdmin === false) {
      throw new ConflictException('You cannot remove your own tenant-admin role');
    }
    let name: string | null | undefined;
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      name = fullName(dto.firstName ?? existing.firstName, dto.lastName ?? existing.lastName);
    }
    const member = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(name !== undefined ? { name } : {}),
        isTenantAdmin: dto.isTenantAdmin,
      },
      select: MEMBER_FIELDS,
    });
    await this.audit.record('tenant.member_updated', {
      tenantId,
      userId: actorId,
      detail: { memberId: id },
    });
    return member;
  }

  /** Soft-deactivate: the member can no longer sign in; restorable. */
  async deactivate(tenantId: string, actorId: string, id: string) {
    await this.getMember(tenantId, id);
    if (id === actorId) {
      throw new ConflictException('You cannot deactivate your own account');
    }
    const member = await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: MEMBER_FIELDS,
    });
    await this.audit.record('tenant.member_deactivated', {
      tenantId,
      userId: actorId,
      detail: { memberId: id },
    });
    return member;
  }

  async restore(tenantId: string, actorId: string, id: string) {
    await this.getMember(tenantId, id);
    const member = await this.prisma.user.update({
      where: { id },
      data: { deletedAt: null },
      select: MEMBER_FIELDS,
    });
    await this.audit.record('tenant.member_restored', {
      tenantId,
      userId: actorId,
      detail: { memberId: id },
    });
    return member;
  }

  /** Replace the member's role set. Only roles of apps enabled for this tenant. */
  async setRoles(tenantId: string, actorId: string, id: string, roleIds: string[]) {
    await this.getMember(tenantId, id);
    const unique = [...new Set(roleIds)];
    if (unique.length > 0) {
      const roles = await this.prisma.role.findMany({
        where: { id: { in: unique } },
        select: { id: true, appId: true },
      });
      if (roles.length !== unique.length) throw new NotFoundException('Role not found');
      const enabled = await this.prisma.appTenant.findMany({
        where: { tenantId, appId: { in: roles.map((r) => r.appId) } },
        select: { appId: true },
      });
      const enabledApps = new Set(enabled.map((e) => e.appId));
      if (roles.some((r) => !enabledApps.has(r.appId))) {
        throw new ForbiddenException('Role belongs to an app not enabled for this workspace');
      }
    }
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({
        data: unique.map((roleId) => ({ userId: id, roleId })),
      }),
    ]);
    await this.audit.record('tenant.member_roles_set', {
      tenantId,
      userId: actorId,
      detail: { memberId: id, roleCount: unique.length },
    });
    return this.getMember(tenantId, id);
  }
}
