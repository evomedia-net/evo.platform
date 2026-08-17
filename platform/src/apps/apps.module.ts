// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Module } from '@nestjs/common';
import { AppsController, BrandController } from './apps.controller';
import { AppsService } from './apps.service';
import { BrandService } from './brand.service';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [AppsController, BrandController],
  providers: [AppsService, BrandService],
})
export class AppsModule {}
