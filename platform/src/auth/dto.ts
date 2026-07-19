import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { PASSWORD_POLICY_MESSAGE, PASSWORD_POLICY_REGEX } from '../core/password-policy';

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
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
}
