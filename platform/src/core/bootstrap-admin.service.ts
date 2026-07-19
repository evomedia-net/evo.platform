import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';
import { AuditService } from '../audit/audit.service';
import { PASSWORD_POLICY_REGEX } from './password-policy';
import { config } from '../config';

/**
 * First-boot platform-admin bootstrap: when BOOTSTRAP_ADMIN_EMAIL and
 * BOOTSTRAP_ADMIN_PASSWORD are set and NO platform admin exists yet, create
 * one — the production replacement for the dev seed script. Deliberately
 * inert on every later boot (an admin exists), so leaving the env vars in
 * place is harmless and a lost-admin recovery is: set vars, restart.
 */
@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly log = new Logger(BootstrapAdminService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.run();
    } catch (err) {
      // Never block boot on bootstrap problems; the console still works for
      // an existing admin and the error says exactly what to fix.
      this.log.error(`admin bootstrap failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async run(): Promise<{ created: boolean; reason: string }> {
    const { email, password } = config.bootstrapAdmin;
    if (!email || !password) return { created: false, reason: 'not configured' };

    const existing = await this.prisma.user.count({
      where: { isPlatformAdmin: true, deletedAt: null },
    });
    if (existing > 0) {
      this.log.log(`admin bootstrap skipped: ${existing} platform admin(s) already exist`);
      return { created: false, reason: 'admin exists' };
    }
    if (!PASSWORD_POLICY_REGEX.test(password)) {
      this.log.error(
        'admin bootstrap refused: BOOTSTRAP_ADMIN_PASSWORD does not meet the password policy',
      );
      return { created: false, reason: 'weak password' };
    }

    const user = await this.prisma.user.create({
      data: {
        tenantId: null,
        email: email.toLowerCase(),
        passwordHash: await bcrypt.hash(password, 10),
        isPlatformAdmin: true,
        // Env-provisioned by the operator — that is the identity proof.
        emailVerifiedAt: new Date(),
      },
    });
    await this.audit.record('admin.bootstrapped', { userId: user.id, detail: { email } });
    this.log.log(`admin bootstrap: created platform admin ${email}`);
    return { created: true, reason: 'created' };
  }
}
