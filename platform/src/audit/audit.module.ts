import { Module } from '@nestjs/common';
import { AuditController, EventsController } from './audit.controller';

@Module({
  controllers: [AuditController, EventsController],
})
export class AuditModule {}
