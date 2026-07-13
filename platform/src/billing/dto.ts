import { IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class CheckoutDto {
  @IsString()
  tenantId!: string;

  /** Stripe Price id (price_...) for the subscription. */
  @IsString()
  priceId!: string;

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
