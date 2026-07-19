import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Throttle } from '@nestjs/throttler';
import { config } from '../config';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../core/prisma.service';
import { PasskeysService } from './passkeys.service';
import { deriveRpContext, RpContext } from './rp';
import { LoginOptionsDto, LoginVerifyDto, RegisterVerifyDto } from './dto';

interface AuthedRequest {
  user: { sub: string };
  headers: Record<string, string | string[] | undefined>;
}

function rpFromRequest(req: { headers: Record<string, string | string[] | undefined> }): RpContext {
  const origin = req.headers['origin'];
  const host = req.headers['host'];
  const originHeader =
    (Array.isArray(origin) ? origin[0] : origin) ??
    // Non-browser clients (curl, SDK server-side) send no Origin; fall back to
    // Host. Loopback is http, anything else is assumed https.
    (typeof host === 'string'
      ? `${/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? 'http' : 'https'}://${host}`
      : undefined);
  const rp = deriveRpContext(originHeader);
  if (!rp) throw new ForbiddenException('Unrecognized origin for passkey ceremony');
  return rp;
}

@Throttle({ default: { limit: config.rateLimit.authPerMin, ttl: 60_000 } })
@Controller('auth/passkeys')
export class PasskeysController {
  constructor(
    private passkeys: PasskeysService,
    private auth: AuthService,
    private prisma: PrismaService,
  ) {}

  // ---- registration + management (logged-in user, own credentials only) ----

  @Post('register/options')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  registerOptions(@Req() req: AuthedRequest) {
    return this.passkeys.registrationOptions(req.user.sub, rpFromRequest(req));
  }

  @Post('register/verify')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  registerVerify(@Req() req: AuthedRequest, @Body() dto: RegisterVerifyDto) {
    return this.passkeys.verifyRegistration(
      req.user.sub,
      dto.credential as unknown as RegistrationResponseJSON,
      dto.challengeToken,
      dto.nickname,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: AuthedRequest) {
    return this.passkeys.list(req.user.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.passkeys.remove(req.user.sub, id);
  }

  // ---- login (public) ----

  @Post('login/options')
  @HttpCode(200)
  loginOptions(@Req() req: AuthedRequest, @Body() dto: LoginOptionsDto) {
    return this.passkeys.loginOptions(dto.tenantSlug, dto.email, rpFromRequest(req));
  }

  @Post('login/verify')
  @HttpCode(200)
  async loginVerify(@Req() req: AuthedRequest, @Body() dto: LoginVerifyDto, @Ip() ip: string) {
    const { userId } = await this.passkeys.verifyLogin(
      dto.credential as unknown as AuthenticationResponseJSON,
      dto.challengeToken,
    );
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: { include: { app: true } } } },
        tenant: true,
      },
    });
    if (!user) throw new BadRequestException('Passkey sign-in could not be verified');
    // Same account/tenant gate as password login — the ceremony alone never
    // grants a session.
    return this.auth.completeLogin(user, user.tenant ?? null, dto.clientId, {
      ip,
      method: 'passkey',
    });
  }
}
