// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PasskeysController } from './passkeys.controller';
import { PasskeysService } from './passkeys.service';

@Module({
  imports: [AuthModule],
  controllers: [PasskeysController],
  providers: [PasskeysService],
})
export class PasskeysModule {}
