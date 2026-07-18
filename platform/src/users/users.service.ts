import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, UpdateUserDto } from './dto';

const PUBLIC_FIELDS = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  firstName: true,
  lastName: true,
  phone: true,
  isPlatformAdmin: true,
  isTenantAdmin: true,
  createdAt: true,
  deletedAt: true,
  roles: { select: { role: { select: { id: true, name: true, appId: true } } } },
} as const;

const PROFILE_KEYS = ['firstName', 'lastName', 'phone'] as const;

interface ProfileInput {
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
}

/** Pick only the profile keys present on the DTO (so an update never nulls a
 *  field the caller didn't mention). */
function profileData(dto: ProfileInput): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of PROFILE_KEYS) if (dto[k] !== undefined) out[k] = dto[k];
  return out;
}

function fullName(first?: string | null, last?: string | null): string | null {
  return [first, last].filter(Boolean).join(' ').trim() || null;
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  list(tenantId?: string | null, includeDeleted = false) {
    return this.prisma.user.findMany({
      where: {
        ...(tenantId !== undefined ? { tenantId } : {}),
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto) {
    const email = dto.email.toLowerCase();
    const tenantId = dto.tenantId ?? null;
    // Postgres treats NULLs as distinct in unique constraints, so enforce
    // (null tenant, email) uniqueness here rather than in the schema.
    const existing = await this.prisma.user.findFirst({ where: { tenantId, email } });
    if (existing) throw new ConflictException('A user with that email already exists');

    const name =
      dto.firstName || dto.lastName ? fullName(dto.firstName, dto.lastName) : (dto.name ?? null);
    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        ...profileData(dto),
        name,
        passwordHash: await bcrypt.hash(dto.password, 10),
        isPlatformAdmin: dto.isPlatformAdmin ?? false,
        isTenantAdmin: dto.isTenantAdmin ?? false,
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record('user.created', { tenantId: tenantId ?? undefined, userId: user.id });
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.get(id);
    // Recompute the display name when either name part changes, merging with
    // whatever's already stored so a single-field edit keeps the other half.
    let name: string | null | undefined;
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      name = fullName(
        dto.firstName ?? existing.firstName,
        dto.lastName ?? existing.lastName,
      );
    } else if (dto.name !== undefined) {
      name = dto.name;
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        ...profileData(dto),
        ...(name !== undefined ? { name } : {}),
        isPlatformAdmin: dto.isPlatformAdmin,
        isTenantAdmin: dto.isTenantAdmin,
        ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10) } : {}),
      },
      select: PUBLIC_FIELDS,
    });
  }

  async remove(id: string) {
    await this.get(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record('user.deleted', { userId: id });
    return user;
  }

  async restore(id: string) {
    await this.get(id);
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: null },
      select: PUBLIC_FIELDS,
    });
  }

  /**
   * Hard delete (erasure). Requires prior soft-delete, same safety pattern as
   * tenant purge. Audit rows survive but are unlinked from the user id, so
   * the trail keeps its shape without pointing at an erased person.
   */
  async purge(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.deletedAt) {
      throw new ConflictException('Purge requires the user to be soft-deleted first');
    }
    await this.prisma.$transaction([
      this.prisma.auditEvent.updateMany({ where: { userId: id }, data: { userId: null } }),
      this.prisma.user.delete({ where: { id } }),
    ]);
    await this.audit.record('user.purged', { tenantId: user.tenantId ?? undefined });
    return { ok: true };
  }

  async setRoles(id: string, roleIds: string[]) {
    await this.get(id);
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) }),
    ]);
    return this.get(id);
  }
}
