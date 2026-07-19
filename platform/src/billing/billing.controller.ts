import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ClientGuard } from '../auth/client.guard';
import { BillingService } from './billing.service';
import { CheckoutDto, PortalDto } from './dto';

@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService) {}

  /** Apps request a Stripe Checkout URL for a tenant's upgrade flow. */
  @Post('checkout')
  @HttpCode(200)
  @UseGuards(ClientGuard)
  checkout(@Body() dto: CheckoutDto) {
    return this.billing.checkout(dto);
  }

  /** Apps request a Stripe billing-portal URL (manage payment method, cancel). */
  @Post('portal')
  @HttpCode(200)
  @UseGuards(ClientGuard)
  portal(@Body() dto: PortalDto) {
    return this.billing.portal(dto);
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
