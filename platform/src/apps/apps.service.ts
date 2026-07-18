import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAppDto, CreateRoleDto, UpdateAppDto, UpdateRoleDto } from './dto';

const PUBLIC_FIELDS = {
  id: true,
  clientId: true,
  name: true,
  callbackUrls: true,
  createdAt: true,
  roles: { select: { id: true, name: true, description: true } },
} as const;

@Injectable()
export class AppsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  list() {
    return this.prisma.app.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'asc' } });
  }

  async get(id: string) {
    const app = await this.prisma.app.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!app) throw new NotFoundException('App not found');
    return app;
  }

  /** Returns the client secret exactly once; only its hash is stored. */
  async create(dto: CreateAppDto) {
    const existing = await this.prisma.app.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`App "${dto.name}" already exists`);

    const clientId = `app_${randomBytes(8).toString('hex')}`;
    const clientSecret = randomBytes(24).toString('base64url');
    const app = await this.prisma.app.create({
      data: {
        name: dto.name,
        clientId,
        clientSecretHash: await bcrypt.hash(clientSecret, 10),
        callbackUrls: dto.callbackUrls ?? [],
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record('app.created', { appClientId: clientId, detail: { name: dto.name } });
    return { ...app, clientSecret };
  }

  async update(id: string, dto: UpdateAppDto) {
    await this.get(id);
    return this.prisma.app.update({ where: { id }, data: dto, select: PUBLIC_FIELDS });
  }

  async rotateSecret(id: string) {
    const app = await this.get(id);
    const clientSecret = randomBytes(24).toString('base64url');
    await this.prisma.app.update({
      where: { id },
      data: { clientSecretHash: await bcrypt.hash(clientSecret, 10) },
    });
    await this.audit.record('app.secret_rotated', { appClientId: app.clientId });
    return { clientId: app.clientId, clientSecret };
  }

  /** Every non-deleted tenant's access state for this app (the matrix column). */
  async listTenants(appId: string) {
    await this.get(appId);
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, name: true, status: true },
    });
    const access = await this.prisma.appTenant.findMany({ where: { appId } });
    const byTenant = new Map(access.map((a) => [a.tenantId, a]));
    return tenants.map((t) => ({ ...t, access: byTenant.get(t.id) ?? null }));
  }

  async addRole(appId: string, dto: CreateRoleDto) {
    await this.get(appId);
    const existing = await this.prisma.role.findUnique({
      where: { appId_name: { appId, name: dto.name } },
    });
    if (existing) throw new ConflictException(`Role "${dto.name}" already exists for this app`);
    return this.prisma.role.create({
      data: { appId, name: dto.name, description: dto.description },
    });
  }

  async listRoles(appId: string) {
    await this.get(appId);
    return this.prisma.role.findMany({ where: { appId }, orderBy: { name: 'asc' } });
  }

  /**
   * Rename/redescribe a role. The JWT roles claim carries role NAMES, so a
   * rename takes effect in tokens at next login/refresh — apps matching on
   * the old name must be updated in step.
   */
  async updateRole(appId: string, roleId: string, dto: UpdateRoleDto) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, appId } });
    if (!role) throw new NotFoundException('Role not found');
    if (dto.name && dto.name !== role.name) {
      const clash = await this.prisma.role.findUnique({
        where: { appId_name: { appId, name: dto.name } },
      });
      if (clash) throw new ConflictException(`Role "${dto.name}" already exists for this app`);
    }
    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: { name: dto.name ?? undefined, description: dto.description ?? undefined },
    });
    await this.audit.record('app.role_renamed', {
      detail: { from: role.name, to: updated.name },
    });
    return updated;
  }

  /** Delete a role; every assignment of it is removed (cascade). */
  async removeRole(appId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, appId } });
    if (!role) throw new NotFoundException('Role not found');
    const assignmentsRemoved = await this.prisma.userRole.count({ where: { roleId } });
    await this.prisma.role.delete({ where: { id: roleId } });
    await this.audit.record('app.role_deleted', {
      detail: { role: role.name, assignmentsRemoved },
    });
    return { ok: true, assignmentsRemoved };
  }
}
