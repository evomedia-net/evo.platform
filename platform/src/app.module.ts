import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config';
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
    // Per-IP rate limiting, enforced globally via APP_GUARD. The public auth
    // surface tightens this with class-level @Throttle overrides; the Stripe
    // webhook and JWKS opt out with @SkipThrottle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: config.rateLimit.defaultPerMin }]),
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
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
