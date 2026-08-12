// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ClientGuard } from '../auth/client.guard';
import { BillingService, CallingApp } from './billing.service';
import { CheckoutDto, EntitlementQueryDto, PortalDto } from './dto';

@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService) {}

  /** The tenant's standing on the calling app — status, plan, trial/grace
   *  deadlines, and whether a login would be admitted right now. A pure DB
   *  read, cheap enough to call per page load. */
  @Get('entitlement')
  @UseGuards(ClientGuard)
  entitlement(@Query() query: EntitlementQueryDto, @Req() req: { clientApp: CallingApp }) {
    return this.billing.entitlement(query.tenantId, req.clientApp);
  }

  /** What this app sells, cheapest first — enough to render a pricing table
   *  without holding any Stripe ids in the app's own code. */
  @Get('prices')
  @UseGuards(ClientGuard)
  prices(@Req() req: { clientApp: CallingApp }) {
    return this.billing.listPrices(req.clientApp.id);
  }

  /** Apps request a Stripe Checkout URL for the tenant's subscription to THIS
   *  app (the caller's identity comes from ClientGuard). */
  @Post('checkout')
  @HttpCode(200)
  @UseGuards(ClientGuard)
  checkout(@Body() dto: CheckoutDto, @Req() req: { clientApp: CallingApp }) {
    return this.billing.checkout(dto, req.clientApp);
  }

  /** Apps request a Stripe billing-portal URL (manage payment method, cancel). */
  @Post('portal')
  @HttpCode(200)
  @UseGuards(ClientGuard)
  portal(@Body() dto: PortalDto, @Req() req: { clientApp: CallingApp }) {
    return this.billing.portal(dto, req.clientApp);
  }

  /** Stripe webhook — authenticated by signature, not by client credentials.
   *  Never throttled: retries arrive in bursts and dropping one delays state. */
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<{ rawBody?: Buffer }>,
    @Headers('stripe-signature') signature?: string,
  ) {
    const event = this.billing.verifyAndParseEvent(req.rawBody, signature);
    return this.billing.handleEvent(event);
  }
}
