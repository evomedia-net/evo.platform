import { Body, Controller, Get, HttpCode, Ip, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AccountFlowsService } from './account-flows.service';
import { resetFormPage, resetInvalidPage, verifyResultPage } from './auth-pages';
import { EmailFlowDto, LoginDto, RefreshDto, ResetDto, VerifyDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';
import { KeysService } from '../core/keys.service';

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/** Minimal structural response type (matches the admin-ui controllers'
 *  approach — no @types/express dependency). */
interface HtmlRes {
  type(t: string): HtmlRes;
  send(body: string): void;
}

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private flows: AccountFlowsService,
  ) {}

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

@Controller('.well-known')
export class JwksController {
  constructor(private keys: KeysService) {}

  @Get('jwks.json')
  jwks() {
    return this.keys.jwks();
  }
}
