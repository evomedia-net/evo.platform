// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { App } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ClientGuard } from '../auth/client.guard';
import { AuditService } from './audit.service';

export class PushEventDto {
  @IsString()
  action!: string;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  detail?: unknown;
}

/** Apps push their own audit events here, authenticated by client credentials. */
@Controller('events')
export class EventsController {
  constructor(private audit: AuditService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ClientGuard)
  push(@Body() dto: PushEventDto, @Req() req: { clientApp: App }) {
    return this.audit.record(dto.action, {
      tenantId: dto.tenantId,
      userId: dto.userId,
      appClientId: req.clientApp.clientId,
      detail: dto.detail,
    });
  }
}

@Controller('admin/audit')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
  ) {
    return this.audit.list({
      tenantId,
      action,
      from: parseDate(from),
      // A date-only "to" (YYYY-MM-DD) should include that whole day.
      to: parseDate(to, true),
      take: take ? Number(take) : undefined,
    });
  }
}

function parseDate(value?: string, endOfDayIfDateOnly = false): Date | undefined {
  if (!value) return undefined;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(endOfDayIfDateOnly && dateOnly ? `${value}T23:59:59.999` : value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
