// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { IsArray, IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateAppDto {
  @IsString()
  name!: string;

  /** Customer-facing product name ("ProvenSheet"); defaults from the slug. */
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  callbackUrls?: string[];

  /** false = admin-created tenants are not auto-enabled on this app. */
  @IsOptional()
  @IsBoolean()
  autoEnroll?: boolean;
}

export class UpdateAppDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** Customer-facing product name, shown in emails and recovery pages. */
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  callbackUrls?: string[];

  /** false = admin-created tenants are not auto-enabled on this app. */
  @IsOptional()
  @IsBoolean()
  autoEnroll?: boolean;
}

export class AddPriceDto {
  /** Stripe Price id (price_...). Validated against Stripe before it is saved. */
  @IsString()
  stripePriceId!: string;

  /** What the app calls this tier. Free text — the platform never enumerates
   *  tiers, because it does not know what any given app sells. */
  @IsString()
  tier!: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateRoleDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
