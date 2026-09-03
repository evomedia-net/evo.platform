// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsStrongPassword } from '../core/password-policy';

export class LoginDto {
  /** Omit for platform-level (global admin) login. */
  @IsOptional()
  @IsString()
  tenantSlug?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  /** App client id; scopes the roles claim to that app. */
  @IsOptional()
  @IsString()
  clientId?: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

/** Verification / reset requests: tenant + email, like login. */
export class WorkspaceLookupDto {
  @IsEmail()
  email!: string;

  /**
   * The app asking on the user's behalf. Only the id is accepted - never a
   * product name or return URL. Both are looked up in the app registry, so
   * nothing a caller supplies can put an arbitrary sender name or destination
   * inside a platform-sent email.
   *
   * This DTO used to take `appName` and `appUrl` directly. The endpoint is
   * unauthenticated, so that let anyone send a named victim a mail from the
   * platform's own SPF/DKIM-aligned identity, listing their real workspaces,
   * with a sign-in button pointing wherever the caller liked. EmailFlowDto
   * below was hardened for exactly this; its sibling was missed.
   */
  @IsOptional()
  @IsString()
  clientId?: string;
}

export class EmailFlowDto {
  @IsOptional()
  @IsString()
  tenantSlug?: string;

  @IsEmail()
  email!: string;

  /**
   * The app asking on the user's behalf. Without it the platform cannot name
   * the product in the email or send the user back where they started, which
   * is how a SWAG reset used to end at the operator console (#103).
   *
   * Only the id is accepted — never a product name or return URL. Both are
   * looked up in the app registry, so nothing a caller supplies can put an
   * arbitrary destination inside a password-reset email.
   */
  @IsOptional()
  @IsString()
  clientId?: string;
}

export class VerifyDto {
  @IsString()
  token!: string;
}

export class ResetDto {
  @IsString()
  token!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;
}

export class SignupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  company!: string;

  /** Workspace slug; derived from company when omitted. */
  @IsOptional()
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'slug must be lowercase alphanumeric with dashes' })
  @MaxLength(40)
  slug?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  /** The app whose signup page the company arrived through; its trial starts. */
  @IsString()
  clientId!: string;

  /** Required when SIGNUP_MODE=invite. */
  @IsOptional()
  @IsString()
  inviteToken?: string;
}

export class SignupLinkDto {
  /**
   * 1 to 720 hours (30 days). This carried @IsOptional() alone: a string
   * became NaN, and a large number became a years-long shareable signup
   * link (#160).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  expiresInHours?: number;
}
