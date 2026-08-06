// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class CheckoutDto {
  @IsString()
  tenantId!: string;

  /** Optional override; defaults to the calling app's registered price. */
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
