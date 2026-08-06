// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateAppDto {
  @IsString()
  name!: string;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  callbackUrls?: string[];

  /** Stripe Price (price_...) sold as this app's subscription; empty clears it. */
  @IsOptional()
  @IsString()
  stripePriceId?: string;

  /** false = admin-created tenants are not auto-enabled on this app. */
  @IsOptional()
  @IsBoolean()
  autoEnroll?: boolean;
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
