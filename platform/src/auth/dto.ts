import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

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
