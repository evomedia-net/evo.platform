import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { StripeHealthService } from './stripe-health.service';

@Module({
  imports: [EmailModule],
  controllers: [RevenueController],
  providers: [RevenueService, StripeHealthService],
})
export class RevenueModule {}
