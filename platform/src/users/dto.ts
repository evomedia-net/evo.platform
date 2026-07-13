import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, Matches } from 'class-validator';
import { PASSWORD_POLICY_MESSAGE, PASSWORD_POLICY_REGEX } from '../core/password-policy';

export class CreateUserDto {
  /** Omit for a platform-level user (global admin candidate). */
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isPlatformAdmin?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  password?: string;

  @IsOptional()
  @IsBoolean()
  isPlatformAdmin?: boolean;
}

export class SetRolesDto {
  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
}
