import { Module } from '@nestjs/common';
import { AuthController, JwksController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountFlowsService } from './account-flows.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [AuthController, JwksController],
  providers: [AuthService, AccountFlowsService],
  exports: [AuthService],
})
export class AuthModule {}
