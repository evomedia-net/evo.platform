import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class RegisterVerifyDto {
  /** The browser's PublicKeyCredential, serialized (navigator.credentials.create → toJSON). */
  @IsObject()
  credential!: Record<string, unknown>;

  @IsString()
  challengeToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string;
}

export class LoginOptionsDto {
  /** Omit for platform-level (global admin) login. */
  @IsOptional()
  @IsString()
  tenantSlug?: string;

  @IsEmail()
  email!: string;
}

export class LoginVerifyDto {
  /** The browser's PublicKeyCredential, serialized (navigator.credentials.get → toJSON). */
  @IsObject()
  credential!: Record<string, unknown>;

  @IsString()
  challengeToken!: string;

  /** App client id; scopes the roles claim, same as password login. */
  @IsOptional()
  @IsString()
  clientId?: string;
}
