import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAppDto, CreateRoleDto, UpdateAppDto } from './dto';

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
}
