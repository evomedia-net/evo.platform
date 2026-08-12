// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
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

  /** Accepted only when it names one of the app's registered prices. */
  @IsOptional()
  @IsString()
  priceId?: string;

  /** Select by what the app sells instead of a Stripe id, so repricing is a
   *  console edit rather than a redeploy. Ignored when priceId is given. */
  @IsOptional()
  @IsString()
  tier?: string;

  /** Billing period of the chosen tier; defaults to a monthly price. */
  @IsOptional()
  @IsString()
  interval?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalCount?: number;

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
