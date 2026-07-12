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
    @Query('take') take?: string,
  ) {
    return this.audit.list({ tenantId, action, take: take ? Number(take) : undefined });
  }
}
