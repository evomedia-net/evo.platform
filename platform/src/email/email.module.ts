import { Module } from '@nestjs/common';
import { EmailController, SmtpAdminController } from './email.controller';
import { EmailService } from './email.service';

@Module({
  controllers: [EmailController, SmtpAdminController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
