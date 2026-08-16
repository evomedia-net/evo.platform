// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { EmailTemplateService } from './email-template.service';
import { EmailService } from './email.service';
import { SaveTemplateDto, TestSendDto } from './dto';

/**
 * Platform-level email copy. Platform-admin only: these templates are what
 * every product's mail says, so they are not tenant-scoped and not delegated.
 */
@Controller('admin/email-templates')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class EmailTemplateController {
  constructor(
    private templates: EmailTemplateService,
    private email: EmailService,
  ) {}

  @Get()
  list() {
    return this.templates.list();
  }

  /** Render with sample values, so copy can be checked before it reaches anyone. */
  @Get(':code/preview')
  preview(@Param('code') code: string) {
    return this.templates.render(code, this.templates.sampleVars(code), 'https://example.com/link');
  }

  @Put(':code')
  save(
    @Param('code') code: string,
    @Body() dto: SaveTemplateDto,
    @Req() req: { user?: { sub?: string } },
  ) {
    return this.templates.save(code, dto, req.user?.sub);
  }

  /** Remove the override; the built-in default takes over again. */
  @Delete(':code')
  reset(@Param('code') code: string, @Req() req: { user?: { sub?: string } }) {
    return this.templates.reset(code, req.user?.sub);
  }

  /** Send the rendered sample to a real mailbox — the only way to know how it
   *  actually arrives, which is the whole point of editing it. */
  @Post(':code/test')
  async test(@Param('code') code: string, @Body() dto: TestSendDto) {
    const msg = await this.templates.render(
      code,
      this.templates.sampleVars(code),
      'https://example.com/link',
    );
    await this.email.send({
      to: dto.to,
      subject: `[test] ${msg.subject}`,
      text: msg.text,
      html: msg.html,
      fromName: this.templates.sampleVars(code).productName,
    });
    return { ok: true };
  }
}
