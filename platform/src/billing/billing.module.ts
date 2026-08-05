import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService],
  // AppsModule uses it to verify a Stripe price before saving it on an app.
  // Safe direction: BillingService depends on Prisma and Audit only, never on
  // AppsService, so there is no cycle.
  exports: [BillingService],
})
export class BillingModule {}
