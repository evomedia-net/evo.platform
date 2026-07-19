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
