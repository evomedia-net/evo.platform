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
import { EmailTemplateService } from '../email/email-template.service';
import { resolveProduct } from './product';

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
    private templates: EmailTemplateService,
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

  async sendVerification(input: { tenantSlug?: string; email: string; clientId?: string }) {
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
   * The calling app is named so the user knows which product they were trying
   * to reach - one platform serves several. It is identified by ``clientId``
   * and resolved through the registry: this endpoint is unauthenticated, so a
   * caller-supplied product name or return URL would let anyone put their own
   * sender name and link into a mail carrying the platform's identity.
   */
  async listWorkspaces(input: { email: string; clientId?: string }) {
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

    // One line per workspace. Kept as text rather than a <ul> so the same
    // value reads correctly in both parts of the message.
    const lines = tenants.map((t) => `${t.slug} — ${t.name}`).join('\n');
    // Registry-owned, exactly as requestReset does it: the name and the
    // link both come from the app record, never from the request body.
    const product = await resolveProduct(this.prisma, input.clientId);
    const msg = await this.templates.render(
      'workspace_list',
      { productName: product.name, workspaces: lines, signInUrl: product.signInUrl },
      product.signInUrl,
    );
    await this.email.send({
      to: email,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      fromName: product.name,
    });
    await this.audit.record('auth.workspaces_listed', { userId: users[0]?.id });
    return ok;
  }

  async requestReset(input: { tenantSlug?: string; email: string; clientId?: string }) {
    const ok = { ok: true };
    if (!allowSend(`reset:${input.email.toLowerCase()}`)) return ok;
    const user = await this.findByEmail(input);
    if (!user) return ok;

    const product = await resolveProduct(this.prisma, input.clientId);
    // The clientId rides inside the signed token so the reset page can name
    // the product and send the user home afterwards. The URL itself is never
    // carried here - the page resolves it from the registry at render time.
    const token = jwt.sign(
      { purpose: 'password_reset', sub: user.id, ...(input.clientId ? { app: input.clientId } : {}) },
      this.resetSecret(user),
      { expiresIn: RESET_TTL_SEC },
    );
    const link = `${config.publicBaseUrl}/auth/reset-page?token=${encodeURIComponent(token)}`;
    const msg = await this.templates.render(
      'password_reset',
      {
        productName: product.name,
        email: user.email,
        expiryMinutes: String(Math.round(RESET_TTL_SEC / 60)),
      },
      link,
    );
    await this.email.send({
      tenantId: user.tenantId ?? undefined,
      to: user.email,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      fromName: product.name,
    });
    await this.audit.record('auth.reset_requested', {
      tenantId: user.tenantId ?? undefined,
      userId: user.id,
      appClientId: input.clientId,
    });
    return ok;
  }

  /**
   * Which product a reset link belongs to, for branding the landing page.
   *
   * The token is decoded, not verified: the signing secret is derived from the
   * user's current password hash, so verifying here would mean a lookup to
   * decide nothing more than a heading. Safe because the only thing read is an
   * `app` claim used to select a registered app - the name and URL come from
   * the registry, never from the token - and because this grants nothing. The
   * real verification happens in resetPassword().
   */
  async productForResetToken(token: string) {
    let clientId: string | undefined;
    try {
      const decoded = jwt.decode(token);
      if (decoded && typeof decoded !== 'string' && typeof decoded.app === 'string') {
        clientId = decoded.app;
      }
    } catch {
      // A malformed token still gets a page; it fails on submit.
    }
    return resolveProduct(this.prisma, clientId);
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
