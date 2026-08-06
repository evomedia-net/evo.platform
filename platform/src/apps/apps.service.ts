import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { CreateAppDto, CreateRoleDto, UpdateAppDto, UpdateRoleDto } from './dto';

const PUBLIC_FIELDS = {
  id: true,
  clientId: true,
  name: true,
  callbackUrls: true,
  stripePriceId: true,
  autoEnroll: true,
  createdAt: true,
  deletedAt: true,
  roles: { select: { id: true, name: true, description: true } },
} as const;

@Injectable()
export class AppsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private billing: BillingService,
  ) {}

  /** Soft-deleted apps are hidden unless asked for, matching tenants and users.
   *  The console passes includeDeleted so it can offer Restore. */
  list(includeDeleted = false) {
    return this.prisma.app.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Finds deleted apps too: restore and purge both need to load one. */
  async get(id: string) {
    const app = await this.prisma.app.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!app) throw new NotFoundException('App not found');
    return app;
  }

  /** Reversible. Sign-in through this app stops, but nothing is destroyed and
   *  the clientId stays reserved so it cannot be re-registered underneath. */
  async remove(id: string) {
    const existing = await this.get(id);
    if (existing.deletedAt) throw new ConflictException('App is already deleted');
    const app = await this.prisma.app.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record('app.deleted', { appClientId: existing.clientId });
    return app;
  }

  async restore(id: string) {
    const existing = await this.get(id);
    if (!existing.deletedAt) throw new ConflictException('App is not deleted');
    const app = await this.prisma.app.update({
      where: { id },
      data: { deletedAt: null },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record('app.restored', { appClientId: existing.clientId });
    return app;
  }

  /** Hard delete (erasure). Two-step like the tenant purge: the app must already
   *  be soft-deleted, so one mistaken click can never destroy credentials and
   *  every tenant's access to them. Roles, role assignments and tenant grants go
   *  with it via the schema's onDelete: Cascade — counted first so the audit
   *  record says what was actually destroyed. */
  async purge(id: string) {
    const app = await this.get(id);
    if (!app.deletedAt) {
      throw new ConflictException('Purge requires the app to be soft-deleted first');
    }
    const [roles, tenants] = await Promise.all([
      this.prisma.role.count({ where: { appId: id } }),
      this.prisma.appTenant.count({ where: { appId: id } }),
    ]);
    await this.prisma.app.delete({ where: { id } });
    await this.audit.record('app.purged', {
      detail: { name: app.name, clientId: app.clientId, roles, tenants },
    });
    return { ok: true, roles, tenants };
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
        autoEnroll: dto.autoEnroll ?? true,
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record('app.created', { appClientId: clientId, detail: { name: dto.name } });
    return { ...app, clientSecret };
  }

  async update(id: string, dto: UpdateAppDto) {
    const before = await this.get(id);
    // A price that doesn't exist is only discovered at checkout otherwise.
    // Empty string means "clear it", so only a non-empty value is checked.
    if (dto.stripePriceId) await this.billing.assertPriceUsable(dto.stripePriceId);
    const updated = await this.prisma.app.update({
      where: { id },
      data: {
        name: dto.name,
        callbackUrls: dto.callbackUrls,
        autoEnroll: dto.autoEnroll,
        // Empty string clears the price (app becomes non-sellable).
        ...(dto.stripePriceId !== undefined
          ? { stripePriceId: dto.stripePriceId || null }
          : {}),
      },
      select: PUBLIC_FIELDS,
    });

    // Update was the one mutation here with no audit event, and it is the one
    // that changes autoEnroll — whether every new workspace is automatically
    // granted this app — plus callbackUrls (where auth codes may go) and
    // stripePriceId (what a customer is billed). An unexplained autoEnroll
    // flip on a production app is what surfaced this (#54): the change could
    // not be reconstructed because nothing recorded it. from/to per changed
    // field, in the user.email_changed style — the old value is what makes an
    // unexpected change traceable afterwards.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of ['name', 'callbackUrls', 'autoEnroll', 'stripePriceId'] as const) {
      const prev = before[field];
      const next = updated[field];
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        changes[field] = { from: prev, to: next };
      }
    }
    if (Object.keys(changes).length > 0) {
      await this.audit.record('app.updated', {
        appClientId: before.clientId,
        detail: changes,
      });
    }

    return updated;
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
