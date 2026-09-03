// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { App } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ClientGuard } from '../auth/client.guard';
import { AuditService } from './audit.service';

export class PushEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
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

/** Apps push their own audit events here, authenticated by client credentials.
 *  The service, not the controller, decides what an app may write: the tenant
 *  must be one it is enabled for, the user must belong to it, and the action
 *  must not wear a platform namespace (#154). */
@Controller('events')
export class EventsController {
  constructor(private audit: AuditService) {}

  @Post()
  @HttpCode(201)
  @UseGuards(ClientGuard)
  push(@Body() dto: PushEventDto, @Req() req: { clientApp: App }) {
    return this.audit.recordFromApp(req.clientApp, dto);
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
