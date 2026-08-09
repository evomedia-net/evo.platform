// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { IsEnum, IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AppTenantStatus } from '@prisma/client';

/** Company profile shared by create and update. */
class TenantProfileFields {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;
}

export class CreateTenantDto extends TenantProfileFields {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'slug must be lowercase alphanumeric with dashes' })
  slug!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  plan?: string;
}

export class UpdateTenantDto extends TenantProfileFields {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  plan?: string;
}

export class SetAppAccessDto {
  @IsOptional()
  @IsEnum(AppTenantStatus)
  status?: AppTenantStatus;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsISO8601()
  trialEndsAt?: string;

  @IsOptional()
  @IsISO8601()
  graceUntil?: string;
}
