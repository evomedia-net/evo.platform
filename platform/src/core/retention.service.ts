import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { config } from '../config';

/**
 * Data-retention sweeps: runs on boot and daily. Deletes audit events older
 * than RETENTION_AUDIT_DAYS (0 = keep forever) and refresh tokens whose
 * revocation/expiry is older than RETENTION_TOKEN_DAYS. Keeps the DB lean and
 * gives deployments a defensible retention story (GDPR storage limitation).
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), 86_400_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now: Date = new Date()) {
    const result = { auditEvents: 0, refreshTokens: 0 };
    try {
      if (config.retention.auditDays > 0) {
        const cutoff = new Date(now.getTime() - config.retention.auditDays * 86_400_000);
        result.auditEvents = (
          await this.prisma.auditEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
        ).count;
      }
      if (config.retention.tokenDays > 0) {
        const cutoff = new Date(now.getTime() - config.retention.tokenDays * 86_400_000);
        result.refreshTokens = (
          await this.prisma.refreshToken.deleteMany({
            where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
          })
        ).count;
      }
      if (result.auditEvents || result.refreshTokens) {
        this.log.log(
          `retention sweep: removed ${result.auditEvents} audit events, ${result.refreshTokens} refresh tokens`,
        );
      }
    } catch (err) {
      // A failed sweep must never take the service down; try again tomorrow.
      this.log.error('retention sweep failed', err as Error);
    }
    return result;
  }
}
