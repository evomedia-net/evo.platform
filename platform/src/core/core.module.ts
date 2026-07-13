import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { KeysService } from './keys.service';
import { RetentionService } from './retention.service';
import { AuditService } from '../audit/audit.service';

@Global()
@Module({
  providers: [PrismaService, KeysService, AuditService, RetentionService],
  exports: [PrismaService, KeysService, AuditService],
})
export class CoreModule {}
