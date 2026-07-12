import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PasskeyCredential, User } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { KeysService } from '../core/keys.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';
import { RpContext } from './rp';

/**
 * Owns the WebAuthn ceremony (build challenge → verify response) and
 * credential storage. It does NOT decide whether an account may log in —
 * that's AuthService.completeLogin(), so password and passkey logins enforce
 * identical account rules.
 *
 * Ceremonies are stateless: the challenge travels in a short-lived
 * single-purpose JWT ("challenge token") signed with the platform key. The
 * JwtAuthGuard rejects any token carrying a `purpose` claim, so challenge
 * tokens can never pass as access tokens.
 */
@Injectable()
export class PasskeysService {
  constructor(
    private prisma: PrismaService,
    private keys: KeysService,
    private audit: AuditService,
  ) {}

  // ---- challenge tokens ----

  private challengeToken(purpose: string, userId: string, challenge: string, rp: RpContext) {
    return this.keys.sign(
      { purpose, uid: userId, challenge, rp_id: rp.rpId, origin: rp.origin },
      config.webauthn.challengeTtlSec,
    );
  }

  private readChallengeToken(token: string, expectedPurpose: string) {
    let claims: { purpose?: string; uid?: string; challenge?: string; rp_id?: string; origin?: string };
    try {
      claims = this.keys.verify(token);
    } catch {
      throw new UnauthorizedException('Passkey ceremony expired — try again');
    }
    if (
      claims.purpose !== expectedPurpose ||
      !claims.uid ||
      !claims.challenge ||
      !claims.rp_id ||
      !claims.origin
    ) {
      throw new UnauthorizedException('Passkey ceremony expired — try again');
    }
    return claims as { uid: string; challenge: string; rp_id: string; origin: string };
  }

  // ---- registration ----

  async registrationOptions(userId: string, rp: RpContext) {
    const user = await this.requireUser(userId);
    const existing = await this.prisma.passkeyCredential.findMany({
      where: { userId: user.id },
    });
    const options = await generateRegistrationOptions({
      rpName: config.webauthn.rpName,
      rpID: rp.rpId,
      userID: Buffer.from(user.id, 'utf8'),
      userName: user.email,
      userDisplayName: user.name || user.email,
      attestationType: 'none',
      authenticatorSelection: { userVerification: 'preferred', residentKey: 'preferred' },
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: strToTransports(c.transports),
      })),
    });
    return {
      options,
      challengeToken: this.challengeToken('webauthn_reg', user.id, options.challenge, rp),
    };
  }

  async verifyRegistration(
    userId: string,
    credential: RegistrationResponseJSON,
    challengeToken: string,
    nickname?: string,
  ) {
    const ticket = this.readChallengeToken(challengeToken, 'webauthn_reg');
    if (ticket.uid !== userId) {
      throw new UnauthorizedException('Passkey ceremony expired — try again');
    }
    const user = await this.requireUser(userId);

    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: ticket.challenge,
        expectedRPID: ticket.rp_id,
        expectedOrigin: ticket.origin,
        requireUserVerification: false,
      });
    } catch {
      // Never leak which part of verification failed
      throw new BadRequestException('Passkey registration could not be verified');
    }
    if (!verified.verified || !verified.registrationInfo) {
      throw new BadRequestException('Passkey registration could not be verified');
    }

    const info = verified.registrationInfo;
    const row = await this.prisma.passkeyCredential.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        credentialId: info.credential.id,
        publicKey: Buffer.from(info.credential.publicKey),
        signCount: info.credential.counter,
        transports: transportsToStr(credential.response?.transports),
        aaguid: info.aaguid || null,
        nickname: (nickname ?? 'Passkey').trim().slice(0, 100) || 'Passkey',
      },
    });
    await this.audit.record('auth.passkey_registered', {
      tenantId: user.tenantId ?? undefined,
      userId: user.id,
      detail: { nickname: row.nickname },
    });
    return this.publicShape(row);
  }

  // ---- login ceremony (account gating happens in AuthService.completeLogin) ----

  /** Returns null options when the user has no passkeys — callers hide the option. */
  async loginOptions(tenantSlug: string | undefined, email: string, rp: RpContext) {
    const user = await this.findLoginUser(tenantSlug, email);
    const creds = user
      ? await this.prisma.passkeyCredential.findMany({ where: { userId: user.id } })
      : [];
    if (!user || creds.length === 0) return { options: null };

    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      userVerification: 'preferred',
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: strToTransports(c.transports),
      })),
    });
    return {
      options,
      challengeToken: this.challengeToken('webauthn_auth', user.id, options.challenge, rp),
    };
  }

  /**
   * Verify a login assertion. The credential row is looked up scoped to the
   * challenge-token's user — a credential is never trusted on its own.
   * Returns the verified user id; the caller must still run the shared
   * account gate before issuing tokens.
   */
  async verifyLogin(credential: AuthenticationResponseJSON, challengeToken: string) {
    const ticket = this.readChallengeToken(challengeToken, 'webauthn_auth');
    const row = await this.prisma.passkeyCredential.findFirst({
      where: { credentialId: credential.id, userId: ticket.uid },
    });
    if (!row) throw new UnauthorizedException('Passkey sign-in could not be verified');

    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: credential,
        expectedChallenge: ticket.challenge,
        expectedRPID: ticket.rp_id,
        expectedOrigin: ticket.origin,
        requireUserVerification: false,
        credential: {
          id: row.credentialId,
          publicKey: new Uint8Array(row.publicKey),
          counter: row.signCount,
          transports: strToTransports(row.transports),
        },
      });
    } catch {
      throw new UnauthorizedException('Passkey sign-in could not be verified');
    }
    if (!verified.verified) {
      throw new UnauthorizedException('Passkey sign-in could not be verified');
    }

    await this.prisma.passkeyCredential.update({
      where: { id: row.id },
      data: { signCount: verified.authenticationInfo.newCounter, lastUsedAt: new Date() },
    });
    return { userId: row.userId };
  }

  // ---- management ----

  async list(userId: string) {
    const rows = await this.prisma.passkeyCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.publicShape(r));
  }

  /** Scoped to userId so a user can't delete another user's credential by guessing ids. */
  async remove(userId: string, id: string) {
    const { count } = await this.prisma.passkeyCredential.deleteMany({
      where: { id, userId },
    });
    if (count === 0) throw new BadRequestException('Passkey not found');
    await this.audit.record('auth.passkey_deleted', { userId, detail: { credentialRowId: id } });
    return { ok: true };
  }

  // ---- helpers ----

  private async requireUser(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  async findLoginUser(tenantSlug: string | undefined, email: string) {
    if (tenantSlug) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { slug: tenantSlug, deletedAt: null },
      });
      if (!tenant) return null;
      return this.prisma.user.findFirst({
        where: { tenantId: tenant.id, email: email.toLowerCase(), deletedAt: null },
      });
    }
    return this.prisma.user.findFirst({
      where: { tenantId: null, email: email.toLowerCase(), deletedAt: null },
    });
  }

  private publicShape(row: PasskeyCredential) {
    return {
      id: row.id,
      nickname: row.nickname,
      transports: row.transports,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    };
  }
}

function transportsToStr(transports?: string[]): string | null {
  return transports?.length ? transports.join(',') : null;
}

function strToTransports(raw: string | null): AuthenticatorTransportFuture[] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? (parts as AuthenticatorTransportFuture[]) : undefined;
}
