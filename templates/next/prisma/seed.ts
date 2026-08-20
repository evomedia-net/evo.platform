// Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
// Created by Kelly Michels · dev@evomedia.net
// Licensed under the MIT License. See LICENSE.

/**
 * Development seed. ALL DATA IS FICTIONAL — never seed real names, companies,
 * or identifiers (template contract rule).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

// Prisma 7 requires a driver adapter; dotenv/config above supplies
// DATABASE_URL when this runs outside a container.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme-demo" },
    update: {},
    create: { slug: "acme-demo", name: "Acme Widgets (Demo)" },
  });

  const email = "demo@example.com";
  const password = process.env.SEED_PASSWORD || "demo-password-1";
  let user = await prisma.user.findFirst({ where: { email, platformUserId: null } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: "Demo User", passwordHash: bcrypt.hashSync(password, 12) },
    });
    console.log(`user: ${email} / ${password}`);
  }
  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    update: {},
    create: { userId: user.id, tenantId: tenant.id, role: "OWNER" },
  });

  const projectId = "prj_seed-widget-line";
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      tenantId: tenant.id,
      name: "Widget Line Refresh",
      description: "Fictional sample project",
      status: "Active",
    },
  });
  if ((await prisma.task.count({ where: { projectId } })) > 0) {
    console.log("seed complete (tasks already present)");
    return;
  }
  const titles = ["Sketch the new widget", "Order fictional parts", "Ship it"];
  for (const title of titles) {
    await prisma.task.create({
      data: {
        id: `${projectId}::${randomUUID()}`,
        tenantId: tenant.id,
        projectId,
        title,
        done: title === "Sketch the new widget",
      },
    });
  }
  console.log("seed complete: tenant acme-demo, 1 project, 3 tasks");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
