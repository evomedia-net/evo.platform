import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTenantDto, UpdateTenantDto } from './dto';

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
    await this.audit.record('tenant.created', { tenantId: tenant.id, detail: { slug } });
    return tenant;
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
}
