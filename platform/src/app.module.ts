import { Module } from '@nestjs/common';
import { AdminUiModule } from './admin-ui/admin-ui.module';
import { CoreModule } from './core/core.module';
import { AuthModule } from './auth/auth.module';
import { PasskeysModule } from './passkeys/passkeys.module';
import { TenantsModule } from './tenants/tenants.module';
import { TenantModule } from './tenant/tenant.module';
import { UsersModule } from './users/users.module';
import { AppsModule } from './apps/apps.module';
import { AuditModule } from './audit/audit.module';
import { BillingModule } from './billing/billing.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    AdminUiModule,
    CoreModule,
    AuthModule,
    PasskeysModule,
    TenantsModule,
    TenantModule,
    UsersModule,
    AppsModule,
    AuditModule,
    BillingModule,
    EmailModule,
  ],
})
export class AppModule {}
