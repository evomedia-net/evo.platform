// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class EntitlementQueryDto {
  @IsString()
  tenantId!: string;
}

export class CheckoutDto {
  @IsString()
  tenantId!: string;

  /** Accepted only when it names the app's registered price (kept for wire
   *  compatibility; the registry is the sole source of what an app sells). */
  @IsOptional()
  @IsString()
  priceId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsUrl({ require_tld: false })
  successUrl!: string;

  @IsUrl({ require_tld: false })
  cancelUrl!: string;
}

export class PortalDto {
  @IsString()
  tenantId!: string;

  @IsUrl({ require_tld: false })
  returnUrl!: string;
}
