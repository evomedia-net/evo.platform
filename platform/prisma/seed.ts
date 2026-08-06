/**
 * Development seed. ALL DATA IS FICTIONAL — never seed real names, companies,
 * or identifiers (template contract rule).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

// Prisma 7 requires a driver adapter; dotenv/config above supplies
// DATABASE_URL when this runs outside the container.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

function password(envVar: string): { value: string; generated: boolean } {
  const fromEnv = process.env[envVar];
  if (fromEnv) return { value: fromEnv, generated: false };
  return { value: randomBytes(12).toString('base64url'), generated: true };
}

async function main() {
  const out: string[] = [];

  // Platform admin (tenantId = null → platform-level user)
  const adminEmail = 'admin@example.com';
  const adminPw = password('SEED_ADMIN_PASSWORD');
  let admin = await prisma.user.findFirst({ where: { tenantId: null, email: adminEmail } });
  if (!admin) {
    admin = await prisma.user.create({
      data: {
        tenantId: null,
        email: adminEmail,
        name: 'Platform Admin',
        passwordHash: bcrypt.hashSync(adminPw.value, 10),
        isPlatformAdmin: true,
        // Login refuses an unverified mailbox, and a fresh dev stack has no
        // mail server to click a link from — so a seeded account without this
        // cannot sign in at all, which is the first thing the quickstart asks
        // you to do. The seed handing over the credentials is the same
        // identity proof UsersService.create relies on.
        emailVerifiedAt: new Date(),
      },
    });
    out.push(`platform admin: ${adminEmail} / ${adminPw.value}`);
  } else {
    out.push(`platform admin: ${adminEmail} (already exists, password unchanged)`);
  }

  // Demo tenant (fictional)
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'acme' },
    update: {},
    create: { slug: 'acme', name: 'Acme Widgets (Demo)', plan: 'free' },
  });

  // Demo app with roles
  let app = await prisma.app.findUnique({ where: { name: 'demo-app' } });
  if (!app) {
    const secret = randomBytes(24).toString('base64url');
    app = await prisma.app.create({
      data: {
        name: 'demo-app',
        clientId: 'app_demo',
        clientSecretHash: bcrypt.hashSync(secret, 10),
        callbackUrls: ['http://localhost:3000/auth/callback'],
      },
    });
    out.push(`demo app: clientId=app_demo clientSecret=${secret}`);
  } else {
    out.push('demo app: app_demo (already exists, secret unchanged)');
  }

  const adminRole = await prisma.role.upsert({
    where: { appId_name: { appId: app.id, name: 'admin' } },
    update: {},
    create: { appId: app.id, name: 'admin', description: 'Full access' },
  });
  await prisma.role.upsert({
    where: { appId_name: { appId: app.id, name: 'member' } },
    update: {},
    create: { appId: app.id, name: 'member', description: 'Standard access' },
  });

  // Demo tenant user with the admin role
  const ownerEmail = 'owner@acme.example';
  const ownerPw = password('SEED_OWNER_PASSWORD');
  let owner = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: ownerEmail } });
  if (!owner) {
    owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: ownerEmail,
        name: 'Demo Owner',
        passwordHash: bcrypt.hashSync(ownerPw.value, 10),
        emailVerifiedAt: new Date(), // see the platform admin above
      },
    });
    out.push(`tenant user: ${ownerEmail} / ${ownerPw.value} (tenant: acme)`);
  } else {
    out.push(`tenant user: ${ownerEmail} (already exists, password unchanged)`);
  }
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: adminRole.id } },
    update: {},
    create: { userId: owner.id, roleId: adminRole.id },
  });

  console.log('--- seed complete ---');
  for (const line of out) console.log(line);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
