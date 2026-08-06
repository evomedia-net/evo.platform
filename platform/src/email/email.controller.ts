// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Body, Controller, Get, HttpCode, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { App } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ClientGuard } from '../auth/client.guard';
import { EmailService } from './email.service';
import { SendEmailDto, UpsertSmtpDto } from './dto';

@Controller('email')
export class EmailController {
  constructor(private email: EmailService) {}

  @Post('send')
  @HttpCode(200)
  @UseGuards(ClientGuard)
  send(@Body() dto: SendEmailDto, @Req() req: { clientApp: App }) {
    return this.email.send(dto, req.clientApp.clientId);
  }
}

@Controller('admin/smtp')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class SmtpAdminController {
  constructor(private email: EmailService) {}

  @Get()
  get(@Query('tenantId') tenantId?: string) {
    return this.email.getConfig(tenantId);
  }

  @Put()
  upsert(@Body() dto: UpsertSmtpDto) {
    return this.email.upsertConfig(dto);
  }
}
