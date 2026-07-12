import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { KeysService } from './keys.service';
import { AuditService } from '../audit/audit.service';

@Global()
@Module({
  providers: [PrismaService, KeysService, AuditService],
  exports: [PrismaService, KeysService, AuditService],
})
export class CoreModule {}
