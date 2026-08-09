// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { config } from './config';

async function bootstrap() {
  // rawBody is required for Stripe webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  if (config.trustProxy) {
    // Behind nginx: rate limiting must see the real client IP, not the proxy's.
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  await app.listen(config.port);
  console.log(`EvoPlatform service listening on :${config.port}`);
}

bootstrap();
