// Evomedia.net EvoPlatform — https://github.com/kellymichels/EvoPlatform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Live integration smoke against a running platform service.
 *
 * Usage:
 *   PLATFORM_URL=http://localhost:8200 \
 *   EVO_CLIENT_ID=app_demo EVO_CLIENT_SECRET=... \
 *   EVO_TEST_TENANT=acme EVO_TEST_EMAIL=owner@acme.example EVO_TEST_PASSWORD=... \
 *   npx tsx scripts/integration.ts
 */
import { EvoPlatform, PlatformError } from '../src';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var ${name}`);
    process.exit(2);
  }
  return v;
};

async function main() {
  const platform = new EvoPlatform({
    platformUrl: process.env.PLATFORM_URL ?? 'http://localhost:8200',
    clientId: process.env.EVO_CLIENT_ID ?? 'app_demo',
    clientSecret: required('EVO_CLIENT_SECRET'),
  });

  let failures = 0;
  const check = (label: string, ok: boolean, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
    if (!ok) failures++;
  };

  // 1. Login through the auth proxy
  const login = await platform.login({
    tenantSlug: process.env.EVO_TEST_TENANT ?? 'acme',
    email: process.env.EVO_TEST_EMAIL ?? 'owner@acme.example',
    password: required('EVO_TEST_PASSWORD'),
  });
  check('login via SDK', Boolean(login.accessToken && login.refreshToken));

  // 2. Verify the token locally (JWKS fetched + cached)
  const claims = await platform.verifyToken(login.accessToken);
  check(
    'local token verification',
    claims.tenant_slug === (process.env.EVO_TEST_TENANT ?? 'acme'),
    `roles=[${claims.roles.join(',')}]`,
  );

  // 3. Refresh rotation
  const refreshed = await platform.refresh(login.refreshToken);
  check('refresh rotation', Boolean(refreshed.accessToken));
  let reuseRejected = false;
  try {
    await platform.refresh(login.refreshToken);
  } catch (e) {
    reuseRejected = e instanceof PlatformError && e.status === 401;
  }
  check('rotated token reuse rejected', reuseRejected);
  await platform.logout(refreshed.refreshToken);

  // 4. Audit push with client credentials
  const event = await platform.pushEvent({
    action: 'sdk.integration_test',
    tenantId: claims.tenant_id ?? undefined,
    detail: { source: 'sdk-node integration script' },
  });
  check('audit event push', Boolean(event.id));

  // 5. Email — expected to fail cleanly when no SMTP is configured
  try {
    await platform.sendEmail({ to: 'test@example.com', subject: 'SDK integration test' });
    check('sendEmail', true, 'SMTP configured and send succeeded');
  } catch (e) {
    const cleanFailure = e instanceof PlatformError && e.status === 503;
    check('sendEmail surfaces missing SMTP as PlatformError(503)', cleanFailure);
  }

  console.log(failures === 0 ? '\nAll integration checks passed.' : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Integration run crashed:', e);
  process.exit(1);
});
