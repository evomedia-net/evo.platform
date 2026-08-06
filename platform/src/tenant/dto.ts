// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsStrongPassword } from '../core/password-policy';

/** Same person-profile shape as the admin users API. */
class MemberProfileFields {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

export class CreateMemberDto extends MemberProfileFields {
  @IsEmail()
  email!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;

  @IsOptional()
  @IsBoolean()
  isTenantAdmin?: boolean;
}

export class UpdateMemberDto extends MemberProfileFields {
  @IsOptional()
  @IsBoolean()
  isTenantAdmin?: boolean;
}

export class SetMemberRolesDto {
  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
}

export class CreateInviteDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];

  @IsOptional()
  @IsBoolean()
  isTenantAdmin?: boolean;
}

export class AcceptInviteDto extends MemberProfileFields {
  @IsString()
  token!: string;

  @IsString()
  @IsStrongPassword()
  password!: string;
}
