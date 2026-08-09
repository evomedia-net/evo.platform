// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { BadRequestException, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac } from 'crypto';
import { User } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { KeysService } from '../core/keys.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { config } from '../config';

const VERIFY_TTL_SEC = 24 * 3600;
const RESET_TTL_SEC = 30 * 60;

/**
 * Minimal in-memory limiter for the two public email-sending endpoints, so an
 * unauthenticated caller cannot turn the platform into a mail cannon for a
 * known address. Per-process only — the full @nestjs/throttler rollout is
 * Phase 7; this is the stopgap the email endpoints cannot ship without.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
function allowSend(key: string, max = 5, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/**
 * Email verification + password reset. Both flows answer identically whether
 * or not the account exists (no enumeration), and both tokens are useless as
 * API credentials: verification links are platform-signed JWTs carrying a
 * `purpose` claim (JwtAuthGuard rejects those), and reset links are HMAC-signed
 * with a per-user secret derived from the CURRENT password hash — the moment
 * the password changes, every outstanding reset link dies. Single-use without
 * storing anything.
 */
@Injectable()
export class AccountFlowsService {
  constructor(
    private prisma: PrismaService,
    private keys: KeysService,
    private audit: AuditService,
    private email: EmailService,
  ) {}

  private async findByEmail(input: { tenantSlug?: string; email: string }): Promise<User | null> {
    const email = input.email.toLowerCase();
    if (input.tenantSlug) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { slug: input.tenantSlug, deletedAt: null },
      });
      if (!tenant) return null;
      return this.prisma.user.findFirst({ where: { tenantId: tenant.id, email, deletedAt: null } });
    }

    const platformLevel = await this.prisma.user.findFirst({
      where: { tenantId: null, email, deletedAt: null },
    });
    if (platformLevel) return platformLevel;

    // A platform admin's row may live inside a tenant, and the console has no
    // workspace to offer someone who only knows they are an admin — without
    // this their reset mail is silently never sent. Only ever one candidate:
    // ambiguity must not pick an account on the user's behalf. Reset is safe
    // to widen this way because the link goes to the address that owns it;
    // login deliberately does NOT, since the session it mints carries tenant
    // claims that must be chosen explicitly.
    const admins = await this.prisma.user.findMany({
      where: { email, deletedAt: null, isPlatformAdmin: true },
      take: 2,
    });
    return admins.length === 1 ? admins[0] : null;
  }

  // ---- email verification ----

  async sendVerification(input: { tenantSlug?: string; email: string }) {
    const ok = { ok: true };
    if (!allowSend(`verify:${input.email.toLowerCase()}`)) return ok;
    const user = await this.findByEmail(input);
    if (!user || user.emailVerifiedAt) return ok;

    const token = this.keys.sign({ purpose: 'email_verify', sub: user.id }, VERIFY_TTL_SEC);
    const link = `${config.publicBaseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
    await this.email.send({
      tenantId: user.tenantId ?? undefined,
      to: user.email,
      subject: 'Verify your email address',
      text: `Confirm this is your email address to activate your account:\n\n${link}\n\nThe link is valid for 24 hours. If you didn't create this account, ignore this email.`,
      html: `<p>Confirm this is your email address to activate your account:</p><p><a href="${link}">Verify my email</a></p><p>The link is valid for 24 hours. If you didn't create this account, ignore this email.</p>`,
    });
    await this.audit.record('auth.verification_sent', {
      tenantId: user.tenantId ?? undefined,
      userId: user.id,
    });
    return ok;
  }

  async confirmVerification(token: string) {
    let claims: Record<string, unknown>;
    try {
      claims = this.keys.verify(token);
    } catch {
      throw new BadRequestException('Invalid or expired link');
    }
    if (claims.purpose !== 'email_verify' || typeof claims.sub !== 'string') {
      throw new BadRequestException('Invalid or expired link');
    }
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.deletedAt) throw new BadRequestException('Invalid or expired link');
    if (!user.emailVerifiedAt) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.record('auth.email_verified', {
        tenantId: user.tenantId ?? undefined,
        userId: user.id,
      });
    }
    return { ok: true };
  }

  // ---- password reset ----

  /** Per-user token secret; changes with every password change. */
  private resetSecret(user: { id: string; passwordHash: string }): string {
    return createHmac('sha256', config.secretKey)
      .update(`reset:${user.id}:${user.passwordHash}`)
      .digest('hex');
  }

  /**
   * Email the workspaces an address can sign in to.
   *
   * Answered by mail, never in the response: returning the list would let
   * anyone map an address to the workspaces it belongs to, which is worse
   * than plain account enumeration - it leaks the customer relationship.
   *
   * ``appName`` lets the calling app say where to sign in, since one platform
   * serves several and the workspace list alone would not tell the user which
   * product they were trying to reach.
   */
  async listWorkspaces(input: { email: string; appName?: string; appUrl?: string }) {
    const ok = { ok: true };
    const email = input.email.toLowerCase();
    if (!allowSend(`workspaces:${email}`)) return ok;

    const users = await this.prisma.user.findMany({
      where: { email, deletedAt: null, tenantId: { not: null } },
      include: { tenant: true },
    });
    const tenants = users
      .map((u) => u.tenant)
      .filter((t): t is NonNullable<typeof t> => !!t && !t.deletedAt)
      .sort((a, b) => a.slug.localeCompare(b.slug));
    if (!tenants.length) return ok;

    const plural = tenants.length > 1 ? 's' : '';
    const product = input.appName ? ` for ${input.appName}` : '';
    const where = input.appUrl ? `\n\nSign in at ${input.appUrl}` : '';
    const lines = tenants.map((t) => `  ${t.slug}  (${t.name})`).join('\n');
    await this.email.send({
      to: email,
      subject: `Your workspaces${product}`,
      text:
        `This address can sign in to the following workspace${plural}${product}:` +
        `\n\n${lines}${where}\n\nUse the workspace name on the left when signing in.`,
      html:
        `<p>This address can sign in to the following workspace${plural}${product}:</p>` +
        `<ul>${tenants.map((t) => `<li><code>${t.slug}</code> &mdash; ${t.name}</li>`).join('')}</ul>` +
        (input.appUrl ? `<p><a href="${input.appUrl}">Sign in</a></p>` : '') +
        `<p>Use the workspace name when signing in.</p>`,
    });
    await this.audit.record('auth.workspaces_listed', { userId: users[0]?.id });
    return ok;
  }

  async requestReset(input: { tenantSlug?: string; email: string }) {
    const ok = { ok: true };
    if (!allowSend(`reset:${input.email.toLowerCase()}`)) return ok;
    const user = await this.findByEmail(input);
    if (!user) return ok;

    const token = jwt.sign({ purpose: 'password_reset', sub: user.id }, this.resetSecret(user), {
      expiresIn: RESET_TTL_SEC,
    });
    const link = `${config.publicBaseUrl}/auth/reset-page?token=${encodeURIComponent(token)}`;
    await this.email.send({
      tenantId: user.tenantId ?? undefined,
      to: user.email,
      subject: 'Reset your password',
      text: `Someone asked to reset the password for this account. If that was you, set a new password here:\n\n${link}\n\nThe link is valid for 30 minutes and can be used once. If it wasn't you, ignore this email — your password is unchanged.`,
      html: `<p>Someone asked to reset the password for this account. If that was you, set a new password here:</p><p><a href="${link}">Reset my password</a></p><p>The link is valid for 30 minutes and can be used once. If it wasn't you, ignore this email — your password is unchanged.</p>`,
    });
    await this.audit.record('auth.reset_requested', {
      tenantId: user.tenantId ?? undefined,
      userId: user.id,
    });
    return ok;
  }

  async resetPassword(token: string, password: string) {
    const decoded = jwt.decode(token);
    if (
      !decoded ||
      typeof decoded === 'string' ||
      decoded.purpose !== 'password_reset' ||
      typeof decoded.sub !== 'string'
    ) {
      throw new BadRequestException('Invalid or expired link');
    }
    const user = await this.prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user || user.deletedAt) throw new BadRequestException('Invalid or expired link');
    try {
      jwt.verify(token, this.resetSecret(user));
    } catch {
      throw new BadRequestException('Invalid or expired link');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          // Clicking an emailed link proves mailbox control.
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        },
      }),
      // A reset means the old credentials may be compromised: end every session.
      this.prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record('auth.password_reset', {
      tenantId: user.tenantId ?? undefined,
      userId: user.id,
    });
    return { ok: true };
  }
}
