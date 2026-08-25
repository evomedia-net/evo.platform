// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { RevenueService } from './revenue.service';
import { StripeHealthService } from './stripe-health.service';
import { BillingReadinessService } from './billing-readiness.service';

/**
 * Operator-only. These read the deployment's own Stripe account, so a tenant
 * has no more business here than in the Stripe dashboard itself.
 */
@Controller('revenue')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class RevenueController {
  constructor(
    private revenue: RevenueService,
    private health: StripeHealthService,
    private readiness: BillingReadinessService,
  ) {}

  /** Figures pulled from Stripe now — or the last good pull, marked stale,
   *  with the outage classified (Stripe's side vs ours). */
  @Get('summary')
  summary() {
    return this.revenue.report();
  }

  /** Just the connectivity verdict, cheap enough to poll. */
  /** Could this deployment take a real payment right now — and if not, what
   *  is missing. Configuration, not connectivity: /health answers whether
   *  Stripe is reachable, this answers whether we are set up to use it. */
  @Get('billing-readiness')
  billingReadiness() {
    return this.readiness.check();
  }

  @Get('health')
  healthCheck() {
    return this.health.check();
  }

  @Get('export.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="revenue.csv"')
  async exportCsv(): Promise<string> {
    return this.revenue.toCsv(await this.revenue.report());
  }
}
