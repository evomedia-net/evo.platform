import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { config } from '../config';
import { InvitesService } from './invites.service';
import { AcceptInviteDto } from './dto';
import { inviteAcceptPage, inviteInvalidPage } from '../auth/auth-pages';

// Invite tokens are 32 random bytes base64url-encoded (43 chars).
const TOKEN_SHAPE = /^[\w-]{40,64}$/;

/** Minimal structural response type (no @types/express dependency). */
interface HtmlRes {
  type(t: string): HtmlRes;
  send(body: string): void;
}

/** Public: where the emailed invite link lands. No auth — the token is the
 *  credential, and it is single-use, expiring, and stored only as a hash. */
@Throttle({ default: { limit: config.rateLimit.authPerMin, ttl: 60_000 } })
@Controller('auth/invites')
export class InviteAcceptController {
  constructor(private invites: InvitesService) {}

  @Post('accept')
  @HttpCode(200)
  accept(@Body() dto: AcceptInviteDto) {
    return this.invites.accept(dto);
  }

  /** The self-contained account-creation form. */
  @Get('accept-page')
  acceptPage(@Query('token') token: string | undefined, @Res() res: HtmlRes) {
    if (!token || !TOKEN_SHAPE.test(token)) {
      res.type('html').send(inviteInvalidPage());
      return;
    }
    res.type('html').send(inviteAcceptPage(token));
  }
}
