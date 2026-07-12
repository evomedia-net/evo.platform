import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  /** Omit for a platform-level user (global admin candidate). */
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
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
  @MinLength(8)
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
