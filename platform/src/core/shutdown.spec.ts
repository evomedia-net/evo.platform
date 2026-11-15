// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * The app has to end when it is told to stop (evo.platform#334).
 *
 * It did not. As the first process in its container it received no stop
 * signal it had no handler for, so every `docker stop` and every deploy
 * waited out Docker's timeout and then killed it. Nothing failed and no test
 * was red: the app served perfectly, right up to the kill.
 *
 * The first half runs a real Nest application and sends it the signal, the
 * way the container runtime does. `process.exit` is the one thing replaced,
 * because the real one would end the test run. The second half holds the
 * wiring: the handler is installed before the app listens, and the two
 * production compose files start it under an init process, which covers
 * the seconds at start, while the migrations run and the app has not
 * installed its handler yet.
 */
import { readFileSync } from 'fs';
import { AddressInfo } from 'net';
import { join } from 'path';
import { Controller, Get, INestApplication, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { STOP_SIGNALS, stopOnSignal } from './shutdown';

@Injectable()
class Probe implements OnModuleDestroy {
  destroyed = 0;
  onModuleDestroy() {
    this.destroyed += 1;
  }
}

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

// Every app a test starts is closed after it, pass or fail. A failed test
// that left a server listening would keep the whole run from ending.
const started: INestApplication[] = [];
afterEach(async () => {
  for (const app of started.splice(0)) await app.close().catch(() => undefined);
});

async function makeApp() {
  const moduleRef = await Test.createTestingModule({
    controllers: [PingController],
    providers: [Probe],
  }).compile();
  const app = moduleRef.createNestApplication();
  started.push(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, probe: moduleRef.get(Probe), url: `http://127.0.0.1:${port}/ping` };
}

async function until(done: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error(`still waiting after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('stopOnSignal', () => {
  let exit: jest.SpyInstance;
  let kill: jest.SpyInstance;

  beforeEach(() => {
    exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    // Nest's other way to end is to signal itself. Replaced too, so that a
    // change back to it fails a test here and does not end the test run.
    kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
  });
  afterEach(() => {
    exit.mockRestore();
    kill.mockRestore();
  });

  it.each(STOP_SIGNALS)('%s closes the server, runs the shutdown, and exits 0', async (signal) => {
    const { app, probe, url } = await makeApp();
    stopOnSignal(app);
    expect((await fetch(url)).status).toBe(200);

    process.emit(signal, signal);
    await until(() => exit.mock.calls.length + kill.mock.calls.length > 0);

    expect(probe.destroyed).toBe(1);
    expect(app.getHttpServer().listening).toBe(false);
    // Exits, and does not signal itself: a container's first process would
    // ignore that signal as it ignored the first one.
    expect(kill).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('is what installs the handler: without it a stop signal reaches nothing', async () => {
    const before = STOP_SIGNALS.map((s) => process.listenerCount(s));
    const { app, probe } = await makeApp();
    expect(STOP_SIGNALS.map((s) => process.listenerCount(s))).toEqual(before);

    stopOnSignal(app);
    expect(STOP_SIGNALS.map((s) => process.listenerCount(s))).toEqual(before.map((n) => n + 1));

    await app.close();
    expect(probe.destroyed).toBe(1);
    expect(STOP_SIGNALS.map((s) => process.listenerCount(s))).toEqual(before);
  });

  it('a second signal during the shutdown does not run it twice', async () => {
    const { app, probe } = await makeApp();
    stopOnSignal(app);

    process.emit('SIGTERM', 'SIGTERM');
    process.emit('SIGTERM', 'SIGTERM');
    await until(() => exit.mock.calls.length > 0);
    await new Promise((r) => setTimeout(r, 50));

    expect(probe.destroyed).toBe(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('where a stop has to work', () => {
  const root = join(__dirname, '..', '..');
  const read = (file: string) => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');

  /** The lines of one service in a compose file, from its name to the next service. */
  function service(text: string, name: string): string {
    const lines = text.split('\n');
    const start = lines.indexOf(`  ${name}:`);
    if (start < 0) throw new Error(`no service named ${name}`);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^ {0,2}\S/.test(l) && !/^\s*#/.test(l));
    return rest.slice(0, end < 0 ? undefined : end).join('\n');
  }

  it('the app installs the handler before it listens', () => {
    const main = read('src/main.ts');
    const installs = main.indexOf('stopOnSignal(app)');
    const listens = main.indexOf('app.listen(');
    expect(installs).toBeGreaterThan(-1);
    expect(listens).toBeGreaterThan(installs);
  });

  it.each(['deploy/docker-compose.yml', 'docker-compose.prod.yml'])(
    '%s starts the app under an init process',
    (file) => {
      expect(service(read(file), 'app')).toMatch(/^ {4}init: true$/m);
    },
  );

  it('the image still starts the app the way the handler assumes', () => {
    // The migrations run first and the shell then hands over to node. If the
    // command changes, re-measure a stop: the handler is in node, not in
    // whatever ends up in front of it.
    expect(read('Dockerfile')).toMatch(
      /^CMD \["sh", "-c", "npx prisma migrate deploy && node dist\/main\.js"\]$/m,
    );
  });
});
