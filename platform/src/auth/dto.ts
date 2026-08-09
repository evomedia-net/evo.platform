// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
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

  /** Shown in the email so the user knows which product they were signing in
   *  to - one platform serves several apps. */
  @IsOptional()
  @IsString()
  appName?: string;

  @IsOptional()
  @IsString()
  appUrl?: string;
}

export class EmailFlowDto {
  @IsOptional()
  @IsString()
  tenantSlug?: string;

  @IsEmail()
  email!: string;
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
  @IsOptional()
  expiresInHours?: number;
}
