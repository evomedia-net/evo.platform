import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { AppsModule } from './apps/apps.module';
import { AuditModule } from './audit/audit.module';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    CoreModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    AppsModule,
    AuditModule,
    EmailModule,
  ],
})
export class AppModule {}
