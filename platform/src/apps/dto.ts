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
}

export class CreateRoleDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
