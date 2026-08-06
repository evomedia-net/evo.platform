/**
 * Boot-level wiring test: compile the REAL root module graph through Nest DI.
 *
 * Exists because of a production near-miss: RevenueService took an optional
 * `stripeClient?: Stripe` parameter without @Optional(), so Nest tried to
 * resolve a Stripe provider that is registered nowhere and the entire app
 * failed to boot — while every unit test stayed green, because specs
 * construct services by hand and never exercise the injector. CI passed;
 * `node dist/main.js` crashed. This test closes exactly that gap: any
 * provider added with an unresolvable dependency fails HERE, in CI.
 *
 * compile() builds the full injector but starts nothing: no lifecycle hooks
 * run, so PrismaService never calls $connect and no database is needed.
 * DATABASE_URL is set to a placeholder because constructing the client (as
 * opposed to connecting it) requires a connection string for the driver
 * adapter.
 */
import { Test } from '@nestjs/testing';

describe('AppModule wiring', () => {
  it('every provider in the real module graph resolves', async () => {
    process.env.DATABASE_URL ??= 'postgresql://wiring:wiring@127.0.0.1:5/wiring';
    // Import after env is set: config.ts snapshots process.env at import time.
    const { AppModule } = await import('./app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
