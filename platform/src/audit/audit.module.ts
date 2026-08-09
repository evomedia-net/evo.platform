// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Module } from '@nestjs/common';
import { AuditController, EventsController } from './audit.controller';

@Module({
  controllers: [AuditController, EventsController],
})
export class AuditModule {}
