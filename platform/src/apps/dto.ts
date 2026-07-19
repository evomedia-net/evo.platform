import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateAppDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  callbackUrls?: string[];
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
