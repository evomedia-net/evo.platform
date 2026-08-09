// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { InviteAcceptController } from './invite-accept.controller';
import { TenantService } from './tenant.service';
import { InvitesService } from './invites.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [TenantController, InviteAcceptController],
  providers: [TenantService, InvitesService],
})
export class TenantModule {}
