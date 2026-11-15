// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

import { INestApplication } from '@nestjs/common';

/** The signals that mean "stop": `docker stop` and a deploy send SIGTERM, Ctrl-C sends SIGINT. */
export const STOP_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/**
 * Let a stop signal end the app, in order.
 *
 * In its container the app is the first process, and a container's first
 * process only receives the signals it has a handler for. It had none for
 * the stop signal, so `docker stop` was ignored: Docker waited out its whole
 * timeout and then killed the process, on every stop and every deploy, with
 * requests in flight and database connections open (evo.platform#334).
 *
 * Nest's shutdown hooks are that handler. On a stop signal the app stops
 * taking requests and runs every provider's onModuleDestroy, the database
 * disconnect and the retention timer among them.
 *
 * `useProcessExit` matters for the same first-process reason. Without it
 * Nest ends by sending the signal to itself again, which a first process
 * ignores just as it ignored the original; the app would then end only if
 * nothing at all was left running in it. With it the process exits, code 0.
 *
 * Call this before listen(), so there is no moment when the app is serving
 * and cannot be stopped.
 */
export function stopOnSignal(app: INestApplication): void {
  app.enableShutdownHooks([...STOP_SIGNALS], { useProcessExit: true });
}
