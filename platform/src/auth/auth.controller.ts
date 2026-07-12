import { Body, Controller, Get, HttpCode, Ip, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto } from './dto';
import { JwtAuthGuard } from './jwt.guard';
import { KeysService } from '../core/keys.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

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
}

@Controller('.well-known')
export class JwksController {
  constructor(private keys: KeysService) {}

  @Get('jwks.json')
  jwks() {
    return this.keys.jwks();
  }
}
