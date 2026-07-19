import { Body, Controller, Get, HttpCode, Ip, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { config } from '../config';
import { AuthService } from './auth.service';
import { AccountFlowsService } from './account-flows.service';
import { SignupService } from './signup.service';
import { resetFormPage, resetInvalidPage, verifyResultPage } from './auth-pages';
import { EmailFlowDto, LoginDto, RefreshDto, ResetDto, SignupDto, SignupLinkDto, VerifyDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { KeysService } from '../core/keys.service';

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/** Minimal structural response type (matches the admin-ui controllers'
 *  approach — no @types/express dependency). */
interface HtmlRes {
  type(t: string): HtmlRes;
  send(body: string): void;
}

// The public credential surface gets the tighter per-IP budget.
@Throttle({ default: { limit: config.rateLimit.authPerMin, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private flows: AccountFlowsService,
    private signup: SignupService,
  ) {}

  /** Self-service signup (gated by SIGNUP_MODE). Login still requires the
   *  emailed verification, so the response carries no tokens. */
  @Post('signup')
  @HttpCode(200)
  signupPost(@Body() dto: SignupDto, @Ip() ip: string) {
    return this.signup.signup(dto, ip);
  }

  /** Platform admin: shareable signup link for SIGNUP_MODE=invite. */
  @Post('signup-links')
  @UseGuards(JwtAuthGuard, PlatformAdminGuard)
  signupLink(@Body() dto: SignupLinkDto) {
    return this.signup.issueSignupLink(dto.expiresInHours ?? 72);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto, ip);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: { user: unknown }) {
    return req.user;
  }

  // ---- email verification ----

  @Post('verify/send')
  @HttpCode(200)
  sendVerification(@Body() dto: EmailFlowDto) {
    return this.flows.sendVerification(dto);
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyDto) {
    return this.flows.confirmVerification(dto.token);
  }

  /** The page the emailed verification link lands on. */
  @Get('verify')
  async verifyPage(@Query('token') token: string | undefined, @Res() res: HtmlRes) {
    let ok = false;
    if (token && JWT_SHAPE.test(token)) {
      try {
        await this.flows.confirmVerification(token);
        ok = true;
      } catch {
        ok = false;
      }
    }
    res.type('html').send(verifyResultPage(ok));
  }

  // ---- password reset ----

  @Post('forgot')
  @HttpCode(200)
  forgot(@Body() dto: EmailFlowDto) {
    return this.flows.requestReset(dto);
  }

  @Post('reset')
  @HttpCode(200)
  reset(@Body() dto: ResetDto) {
    return this.flows.resetPassword(dto.token, dto.password);
  }

  /** The page the emailed reset link lands on: a minimal new-password form. */
  @Get('reset-page')
  resetPage(@Query('token') token: string | undefined, @Res() res: HtmlRes) {
    if (!token || !JWT_SHAPE.test(token)) {
      res.type('html').send(resetInvalidPage());
      return;
    }
    res.type('html').send(resetFormPage(token));
  }
}

// Apps poll JWKS on a cache TTL; never throttle key discovery.
@SkipThrottle()
@Controller('.well-known')
export class JwksController {
  constructor(private keys: KeysService) {}

  @Get('jwks.json')
  jwks() {
    return this.keys.jwks();
  }
}
