// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';
import { securityHeaders } from './core/security-headers';
import { stopOnSignal } from './core/shutdown';

async function bootstrap() {
  // rawBody is required for Stripe webhook signature verification
  const app = await NestFactory.create(AppModule, { rawBody: true });
  // A stop has to end the app: without this a container's first process
  // ignores the stop signal and is killed at the timeout. Before listen(),
  // so it is never serving and unstoppable. See core/shutdown.ts.
  stopOnSignal(app);
  // Every response, the console included: CSP, HSTS in production, no
  // framing, no sniffing. See core/security-headers.ts for the reasoning.
  app.use(helmet(securityHeaders()));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  if (config.trustProxy) {
    // Behind nginx: rate limiting and the audit log must see the real client
    // IP, not the proxy's. A hop count, never `true` - see config.trustProxy.
    app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy);
  }
  await app.listen(config.port);
  console.log(`EvoPlatform service listening on :${config.port}`);
}

bootstrap();
