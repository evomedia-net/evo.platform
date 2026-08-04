import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsStrongPassword } from '../core/password-policy';

/** Simple person profile shared by create and update. Address/company details
 *  live on the Tenant, not the user. */
class ProfileFields {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  /** Legacy/explicit display name. Ignored when firstName/lastName are given. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

export class CreateUserDto extends ProfileFields {
  /** Omit for a platform-level user (global admin candidate). */
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsOptional()
  @IsBoolean()
  isPlatformAdmin?: boolean;

  @IsOptional()
  @IsBoolean()
  isTenantAdmin?: boolean;
}

export class UpdateUserDto extends ProfileFields {
  /** Changing this changes who can sign in, so it is platform-admin only and
   *  audited. Uniqueness within the tenant is enforced in the service, not
   *  here — Postgres treats NULLs as distinct, so platform-level users need a
   *  manual check. */
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @IsStrongPassword()
  password?: string;

  @IsOptional()
  @IsBoolean()
  isPlatformAdmin?: boolean;

  @IsOptional()
  @IsBoolean()
  isTenantAdmin?: boolean;
}

export class SetRolesDto {
  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
}
