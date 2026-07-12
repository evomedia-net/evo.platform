import { Module } from '@nestjs/common';
import { AuthController, JwksController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController, JwksController],
  providers: [AuthService],
})
export class AuthModule {}
