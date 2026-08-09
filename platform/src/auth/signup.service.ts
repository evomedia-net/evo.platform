// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../core/prisma.service';
import { KeysService } from '../core/keys.service';
import { AuditService } from '../audit/audit.service';
import { AccountFlowsService } from './account-flows.service';
import { config } from '../config';
import { SignupDto } from './dto';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Self-service signup: a company creates its own workspace through an app's
 * signup page — tenant + first tenant admin + a trial of the app they arrived
 * through, with zero platform-admin involvement. Gated by SIGNUP_MODE:
 * `closed` (default) refuses, `invite` requires a platform-admin-issued link
 * token, `open` is public. The first login still requires email verification
 * (the Phase 3 gate), so an unverified signup holds no usable account.
 */
@Injectable()
export class SignupService {
  constructor(
    private prisma: PrismaService,
    private keys: KeysService,
    private audit: AuditService,
    private flows: AccountFlowsService,
  ) {}

  /** Platform admin issues a shareable signup link for `invite` mode. */
  issueSignupLink(expiresInHours = 72) {
    const ttlSec = Math.max(1, Math.floor(expiresInHours * 3600));
    const token = this.keys.sign({ purpose: 'signup_link' }, ttlSec);
    return {
      token,
      url: `${config.publicBaseUrl}/auth/signup?inviteToken=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + ttlSec * 1000),
    };
  }

  private assertSignupAllowed(inviteToken?: string) {
    const mode = config.signup.mode;
    if (mode === 'open') return;
    if (mode === 'invite') {
      if (!inviteToken) throw new ForbiddenException('Signups are by invitation');
      try {
        const claims = this.keys.verify<Record<string, unknown>>(inviteToken);
        if (claims.purpose !== 'signup_link') throw new Error('wrong purpose');
        return;
      } catch {
        throw new ForbiddenException('Signup link is invalid or has expired');
      }
    }
    throw new ForbiddenException('Signups are closed');
  }

  async signup(dto: SignupDto, ip?: string) {
    this.assertSignupAllowed(dto.inviteToken);

    // Signups happen THROUGH an app; the trial is scoped to it.
    // A soft-deleted app must not accept new signups; findFirst because
    // deletedAt is not part of a unique index.
    const app = await this.prisma.app.findFirst({
      where: { clientId: dto.clientId, deletedAt: null },
    });
    if (!app) throw new BadRequestException('Unknown app');

    const email = dto.email.toLowerCase();

    let slug: string;
    if (dto.slug) {
      slug = dto.slug;
      const taken = await this.prisma.tenant.findUnique({ where: { slug } });
      if (taken) throw new ConflictException(`Workspace name "${slug}" is already taken`);
    } else {
      slug = slugify(dto.company) || 'workspace';
      if (await this.prisma.tenant.findUnique({ where: { slug } })) {
        // Auto-derived conflicts get a random suffix rather than an error.
        slug = `${slug.slice(0, 34)}-${randomBytes(2).toString('hex')}`;
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const trialEndsAt = new Date(Date.now() + config.signup.trialDays * 86_400_000);
    const name = [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim() || null;

    const { tenant } = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({ data: { slug, name: dto.company, plan: 'free' } });
      await tx.user.create({
        data: {
          tenantId: t.id,
          email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          name,
          // The founder runs their own workspace.
          isTenantAdmin: true,
          // Not verified: the Phase 3 login gate holds until the mailbox is proven.
          emailVerifiedAt: null,
        },
      });
      await tx.appTenant.create({
        data: { tenantId: t.id, appId: app.id, status: 'TRIAL', plan: 'free', trialEndsAt },
      });
      return { tenant: t };
    });

    await this.flows.sendVerification({ tenantSlug: tenant.slug, email });
    await this.audit.record('auth.signup', {
      tenantId: tenant.id,
      appClientId: dto.clientId,
      ip,
      detail: { slug: tenant.slug, email, trialEndsAt },
    });
    return {
      ok: true,
      tenantSlug: tenant.slug,
      verificationRequired: true,
      trialEndsAt,
    };
  }
}
