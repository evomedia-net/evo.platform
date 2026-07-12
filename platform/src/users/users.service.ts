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
  isPlatformAdmin: true,
  createdAt: true,
  deletedAt: true,
  roles: { select: { role: { select: { id: true, name: true, appId: true } } } },
} as const;

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

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        name: dto.name,
        passwordHash: await bcrypt.hash(dto.password, 10),
        isPlatformAdmin: dto.isPlatformAdmin ?? false,
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record('user.created', { tenantId: tenantId ?? undefined, userId: user.id });
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.get(id);
    return this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name,
        isPlatformAdmin: dto.isPlatformAdmin,
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

  async setRoles(id: string, roleIds: string[]) {
    await this.get(id);
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: id } }),
      this.prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) }),
    ]);
    return this.get(id);
  }
}
