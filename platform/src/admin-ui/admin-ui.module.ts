import { Module } from '@nestjs/common';
import { AdminUiController } from './admin-ui.controller';

@Module({
  controllers: [AdminUiController],
})
export class AdminUiModule {}
