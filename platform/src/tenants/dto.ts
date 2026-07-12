import { IsOptional, IsString, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'slug must be lowercase alphanumeric with dashes' })
  slug!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  plan?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  plan?: string;
}
