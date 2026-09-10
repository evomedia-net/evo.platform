// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { readBuildVersion } from './build-version';

/**
 * The build that is running, for zdeploy's deploy verification and the
 * fleet's versions dashboard. Both read it over the deploy channel — docker
 * exec or the server's own port — because the public edge blocks
 * /api/build-version on every vhost. Read once at startup: the stamp cannot
 * change under a running container. No database, so it answers during a
 * migration and is never a probe. Polled like JWKS, so never throttled.
 */
@SkipThrottle()
@Controller('api')
export class VersionController {
  private readonly version = readBuildVersion();

  @Get('build-version')
  buildVersion(): { version: string | null } {
    return { version: this.version };
  }
}
