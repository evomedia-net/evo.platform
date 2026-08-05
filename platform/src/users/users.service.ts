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
  emailVerifiedAt: true,
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
        // Admin handed the credentials over directly — that is the identity proof.
        emailVerifiedAt: new Date(),
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record('user.created', { tenantId: tenantId ?? undefined, userId: user.id });
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.get(id);

    // Email is the login identity, so a change here changes who can sign in.
    // Same manual uniqueness check as create(): Postgres treats NULLs as
    // distinct in unique constraints, so platform-level users (tenantId null)
    // are not covered by the schema constraint. `not: { id }` so saving the
    // form without touching the address is not a conflict with yourself.
    let email: string | undefined;
    if (dto.email !== undefined) {
      email = dto.email.toLowerCase();
      if (email !== existing.email) {
        const clash = await this.prisma.user.findFirst({
          where: { tenantId: existing.tenantId, email, id: { not: id } },
        });
        if (clash) throw new ConflictException('A user with that email already exists');
      }
    }
    // Demoting the last platform admin locks the console exactly as deleting
    // them would, so it fails the same way.
    if (dto.isPlatformAdmin === false) await this.assertNotLastPlatformAdmin(existing);

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
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...profileData(dto),
        ...(name !== undefined ? { name } : {}),
        // emailVerifiedAt is deliberately NOT cleared. Sign-in is refused for
        // an unverified mailbox, so clearing it would lock the account out
        // until someone clicked a link — including the platform admin renaming
        // their own account, who would then have no way back in. An admin
        // typing the address is the same identity proof create() relies on.
        ...(email !== undefined ? { email } : {}),
        isPlatformAdmin: dto.isPlatformAdmin,
        isTenantAdmin: dto.isTenantAdmin,
        ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10) } : {}),
      },
      select: PUBLIC_FIELDS,
    });

    if (email !== undefined && email !== existing.email) {
      // Recorded because it changes who can sign in. Both addresses are kept:
      // the old one is what makes an unexpected change traceable afterwards.
      await this.audit.record('user.email_changed', {
        tenantId: existing.tenantId ?? undefined,
        userId: id,
        detail: { from: existing.email, to: email },
      });
    }

    return user;
  }

  /**
   * Refuse an action that would leave the platform with no way in. The admin
   * console has no recovery path: with the last platform admin gone, tenants,
   * apps and users can only be reached by editing the database directly.
   */
  private async assertNotLastPlatformAdmin(user: {
    id: string;
    isPlatformAdmin: boolean;
    deletedAt: Date | null;
  }) {
    if (!user.isPlatformAdmin || user.deletedAt) return;
    const others = await this.prisma.user.count({
      where: { isPlatformAdmin: true, deletedAt: null, id: { not: user.id } },
    });
    if (others === 0) {
      throw new ConflictException(
        'This is the last platform admin — promote another account before removing this one',
      );
    }
  }

  async remove(id: string) {
    const existing = await this.get(id);
    await this.assertNotLastPlatformAdmin(existing);
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
