import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

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
