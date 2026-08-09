// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { KeysService } from './keys.service';
import { RetentionService } from './retention.service';
import { BootstrapAdminService } from './bootstrap-admin.service';
import { AuditService } from '../audit/audit.service';

@Global()
@Module({
  providers: [PrismaService, KeysService, AuditService, RetentionService, BootstrapAdminService],
  exports: [PrismaService, KeysService, AuditService],
})
export class CoreModule {}
