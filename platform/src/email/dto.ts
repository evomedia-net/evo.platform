// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { IsBoolean, IsEmail, IsInt, IsOptional, IsString } from 'class-validator';

export class SendEmailDto {
  /**
   * Display name on the From header. A bare address reads as machine noise;
   * "SWAG Estimates <noreply@…>" tells a recipient which product is writing
   * before they open anything (#103). The address itself is never caller-set -
   * it comes from the resolved SMTP config.
   */
  @IsOptional()
  @IsString()
  fromName?: string;

  /** Omit to use the platform default SMTP config. */
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsEmail()
  to!: string;

  @IsString()
  subject!: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  html?: string;
}

export class UpsertSmtpDto {
  /** Omit for the platform default config (NULL-tenant row). */
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsString()
  host!: string;

  @IsInt()
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  fromAddress!: string;
}
