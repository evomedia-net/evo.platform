// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTenantDto, SetAppAccessDto, UpdateTenantDto } from './dto';

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  list(includeDeleted = false) {
    return this.prisma.tenant.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Slug "${dto.slug}" is already taken`);
    const { slug, name, plan, ...profile } = dto;
    const tenant = await this.prisma.tenant.create({
      data: { slug, name, plan: plan ?? 'free', ...profile },
    });
    // Admin-created tenants get every auto-enroll app, so manual onboarding
    // stays one step. Apps with autoEnroll=false require a specific grant
    // (console, signup-through, or subscription); self-service signup enables
    // only the app arrived through.
    const apps = await this.prisma.app.findMany({
      where: { autoEnroll: true },
      select: { id: true },
    });
    if (apps.length > 0) {
      await this.prisma.appTenant.createMany({
        data: apps.map((a) => ({ tenantId: tenant.id, appId: a.id, plan: tenant.plan })),
      });
    }
    await this.audit.record('tenant.created', { tenantId: tenant.id, detail: { slug } });
    return tenant;
  }

  /** All registered apps with this tenant's access state for each. */
  async listApps(tenantId: string) {
    await this.get(tenantId);
    const apps = await this.prisma.app.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, clientId: true, name: true },
    });
    const access = await this.prisma.appTenant.findMany({ where: { tenantId } });
    const byApp = new Map(access.map((a) => [a.appId, a]));
    return apps.map((app) => ({ ...app, access: byApp.get(app.id) ?? null }));
  }

  /** Enable an app for the tenant, or change the terms of existing access. */
  async setAppAccess(tenantId: string, appId: string, dto: SetAppAccessDto) {
    await this.get(tenantId);
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) throw new NotFoundException('App not found');
    const changes = {
      status: dto.status ?? undefined,
      plan: dto.plan ?? undefined,
      trialEndsAt: dto.trialEndsAt ? new Date(dto.trialEndsAt) : undefined,
      graceUntil: dto.graceUntil ? new Date(dto.graceUntil) : undefined,
    };
    const access = await this.prisma.appTenant.upsert({
      where: { tenantId_appId: { tenantId, appId } },
      create: { tenantId, appId, ...changes, plan: dto.plan ?? 'free' },
      update: changes,
    });
    await this.audit.record('tenant.app_access_set', {
      tenantId,
      appClientId: app.clientId,
      detail: { app: app.name, status: access.status, plan: access.plan },
    });
    return access;
  }

  /** Disable an app for the tenant entirely — logins scoped to it are refused. */
  async removeAppAccess(tenantId: string, appId: string) {
    await this.get(tenantId);
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) throw new NotFoundException('App not found');
    await this.prisma.appTenant.deleteMany({ where: { tenantId, appId } });
    await this.audit.record('tenant.app_access_removed', {
      tenantId,
      appClientId: app.clientId,
      detail: { app: app.name },
    });
    return { ok: true };
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.get(id);
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  /** Soft delete — restorable, records intact. */
  async remove(id: string) {
    await this.get(id);
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record('tenant.deleted', { tenantId: id });
    return tenant;
  }

  async restore(id: string) {
    await this.get(id);
    const tenant = await this.prisma.tenant.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.record('tenant.restored', { tenantId: id });
    return tenant;
  }

  async suspend(id: string) {
    await this.get(id);
    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });
    await this.audit.record('tenant.suspended', { tenantId: id });
    return tenant;
  }

  async activate(id: string) {
    await this.get(id);
    const tenant = await this.prisma.tenant.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit.record('tenant.activated', { tenantId: id });
    return tenant;
  }

  /**
   * Full export of the tenant's platform-owned data (portability/backup).
   * App domain data lives in each app's own database and is exported there.
   * Secrets never leave: password hashes and SMTP passwords are omitted.
   */
  async exportTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        users: { include: { roles: { include: { role: { include: { app: true } } } } } },
        smtpConfig: true,
        appTenants: { include: { app: { select: { name: true, clientId: true } } } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const auditEvents = await this.prisma.auditEvent.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: 'asc' },
    });
    await this.audit.record('tenant.exported', { tenantId: id });

    const { users, smtpConfig, appTenants, ...tenantFields } = tenant;
    return {
      exportedAt: new Date().toISOString(),
      note: "Platform-owned data only. App domain data lives in each app's own database.",
      tenant: tenantFields,
      appAccess: appTenants.map((a) => ({
        app: a.app.name,
        clientId: a.app.clientId,
        status: a.status,
        plan: a.plan,
        trialEndsAt: a.trialEndsAt,
        graceUntil: a.graceUntil,
      })),
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        createdAt: u.createdAt,
        deletedAt: u.deletedAt,
        roles: u.roles.map((r) => ({ app: r.role.app.name, role: r.role.name })),
      })),
      smtpConfig: smtpConfig
        ? {
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure,
            username: smtpConfig.username,
            fromAddress: smtpConfig.fromAddress,
            hasPassword: Boolean(smtpConfig.passwordEnc),
          }
        : null,
      auditEvents,
    };
  }

  /**
   * Hard delete (erasure). Deliberately two-step: the tenant must already be
   * soft-deleted, so a single mistaken click can never destroy data. Removes
   * the tenant's users (cascading refresh tokens, passkeys, role links), SMTP
   * config, audit events, and finally the tenant row itself.
   */
  async purge(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!tenant.deletedAt) {
      throw new ConflictException('Purge requires the tenant to be soft-deleted first');
    }
    const counts = await this.prisma.$transaction(async (tx) => {
      const auditEvents = await tx.auditEvent.deleteMany({ where: { tenantId: id } });
      await tx.smtpConfig.deleteMany({ where: { tenantId: id } });
      await tx.appTenant.deleteMany({ where: { tenantId: id } });
      await tx.invite.deleteMany({ where: { tenantId: id } });
      const users = await tx.user.deleteMany({ where: { tenantId: id } });
      await tx.tenant.delete({ where: { id } });
      return { users: users.count, auditEvents: auditEvents.count };
    });
    await this.audit.record('tenant.purged', { detail: { slug: tenant.slug, ...counts } });
    return { ok: true, ...counts };
  }
}
