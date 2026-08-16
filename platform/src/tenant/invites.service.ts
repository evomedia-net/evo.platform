// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../core/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { EmailTemplateService } from '../email/email-template.service';
import { sha256 } from '../core/crypto.util';
import { config } from '../config';
import { AcceptInviteDto, CreateInviteDto } from './dto';

const INVITE_TTL_MS = 24 * 3600 * 1000;

// tokenHash never leaves the service; the raw token exists only in the email.
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  roleIds: true,
  isTenantAdmin: true,
  invitedById: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
} as const;

function fullName(first?: string | null, last?: string | null): string | null {
  return [first, last].filter(Boolean).join(' ').trim() || null;
}

/** Tenant/user names are interpolated into email HTML — escape them. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Invites: the self-service replacement for admin-set temporary passwords.
 * The mailbox owner proves control by following the emailed link (24 h,
 * single-use, re-send rotates the token) and chooses their own password —
 * so accepting doubles as email verification. Tenant scope comes from the
 * inviting admin's token; the public accept path is scoped by the token hash.
 */
@Injectable()
export class InvitesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private email: EmailService,
    private templates: EmailTemplateService,
  ) {}

  list(tenantId: string) {
    return this.prisma.invite.findMany({
      where: { tenantId },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Create-time role check is strict: bad input should fail loudly. */
  private async assertRolesEnabled(tenantId: string, roleIds: string[]): Promise<string[]> {
    const unique = [...new Set(roleIds)];
    if (unique.length === 0) return unique;
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
    return unique;
  }

  /** Accept-time role check is lenient: apps disabled since the invite was
   *  sent silently drop out; the membership itself still stands. */
  private async stillEnabledRoles(tenantId: string, roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds } },
      select: { id: true, appId: true },
    });
    const enabled = await this.prisma.appTenant.findMany({
      where: { tenantId, appId: { in: roles.map((r) => r.appId) } },
      select: { appId: true },
    });
    const enabledApps = new Set(enabled.map((e) => e.appId));
    return roles.filter((r) => enabledApps.has(r.appId)).map((r) => r.id);
  }

  async create(tenantId: string, actorId: string, dto: CreateInviteDto) {
    const email = dto.email.toLowerCase();
    const member = await this.prisma.user.findFirst({ where: { tenantId, email } });
    if (member) throw new ConflictException('Already a member of this workspace');
    const roleIds = await this.assertRolesEnabled(tenantId, dto.roleIds ?? []);

    // One live invite per address: a new one replaces (and kills) the old.
    await this.prisma.invite.deleteMany({ where: { tenantId, email, acceptedAt: null } });

    const raw = randomBytes(32).toString('base64url');
    const invite = await this.prisma.invite.create({
      data: {
        tenantId,
        email,
        roleIds,
        isTenantAdmin: dto.isTenantAdmin ?? false,
        invitedById: actorId,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
      select: PUBLIC_FIELDS,
    });
    await this.sendInviteEmail(tenantId, email, raw, actorId);
    await this.audit.record('tenant.invite_created', {
      tenantId,
      userId: actorId,
      detail: { email },
    });
    return invite;
  }

  async resend(tenantId: string, actorId: string, id: string) {
    const invite = await this.prisma.invite.findFirst({ where: { id, tenantId } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.acceptedAt) throw new ConflictException('Invite was already accepted');

    const raw = randomBytes(32).toString('base64url');
    const updated = await this.prisma.invite.update({
      where: { id },
      data: { tokenHash: sha256(raw), expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      select: PUBLIC_FIELDS,
    });
    await this.sendInviteEmail(tenantId, invite.email, raw, actorId);
    await this.audit.record('tenant.invite_resent', {
      tenantId,
      userId: actorId,
      detail: { email: invite.email },
    });
    return updated;
  }

  async revoke(tenantId: string, actorId: string, id: string) {
    const invite = await this.prisma.invite.findFirst({ where: { id, tenantId } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.acceptedAt) throw new ConflictException('Invite was already accepted');
    await this.prisma.invite.delete({ where: { id } });
    await this.audit.record('tenant.invite_revoked', {
      tenantId,
      userId: actorId,
      detail: { email: invite.email },
    });
    return { ok: true };
  }

  /** Public accept: single-use, expiring, useless once the tenant is gone. */
  async accept(dto: AcceptInviteDto) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: sha256(dto.token) },
      include: { tenant: true },
    });
    const invalid = new BadRequestException('Invite link is invalid or has expired');
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) throw invalid;
    if (invite.tenant.deletedAt || invite.tenant.status === 'SUSPENDED') throw invalid;

    const existing = await this.prisma.user.findFirst({
      where: { tenantId: invite.tenantId, email: invite.email },
    });
    if (existing) throw new ConflictException('This email already has an account in the workspace');

    const roleIds = await this.stillEnabledRoles(invite.tenantId, invite.roleIds);
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          tenantId: invite.tenantId,
          email: invite.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          name: fullName(dto.firstName, dto.lastName),
          passwordHash,
          isTenantAdmin: invite.isTenantAdmin,
          // Following the emailed link IS the mailbox proof.
          emailVerifiedAt: new Date(),
        },
      });
      if (roleIds.length > 0) {
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: u.id, roleId })) });
      }
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      return u;
    });
    await this.audit.record('tenant.invite_accepted', {
      tenantId: invite.tenantId,
      userId: user.id,
      detail: { email: invite.email },
    });
    return { ok: true, tenantSlug: invite.tenant.slug, email: invite.email };
  }

  private async sendInviteEmail(tenantId: string, to: string, rawToken: string, actorId?: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    const inviter = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId } })
      : null;
    const who = inviter?.name || inviter?.email || 'An administrator';
    const workspace = tenant?.name ?? 'a workspace';
    const link = `${config.publicBaseUrl}/auth/invites/accept-page?token=${encodeURIComponent(rawToken)}`;
    const msg = await this.templates.render(
      'member_invite',
      { productName: 'EvoPlatform', inviter: who, workspace, expiryHours: '24' },
      link,
    );
    await this.email.send({
      tenantId,
      to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}
