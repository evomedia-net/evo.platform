import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { AuthModule } from './auth/auth.module';
import { PasskeysModule } from './passkeys/passkeys.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { AppsModule } from './apps/apps.module';
import { AuditModule } from './audit/audit.module';
import { BillingModule } from './billing/billing.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    PasskeysModule,
    TenantsModule,
    UsersModule,
    AppsModule,
    AuditModule,
    BillingModule,
    EmailModule,
  ],
})
export class AppModule {}
