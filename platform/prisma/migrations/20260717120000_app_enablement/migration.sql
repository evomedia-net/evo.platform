-- App ↔ tenant enablement: which tenants may sign in to which apps
CREATE TYPE "AppTenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');

CREATE TABLE "app_tenants" (
    "tenantId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "status" "AppTenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "trialEndsAt" TIMESTAMP(3),
    "graceUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_tenants_pkey" PRIMARY KEY ("tenantId", "appId")
);

ALTER TABLE "app_tenants" ADD CONSTRAINT "app_tenants_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_tenants" ADD CONSTRAINT "app_tenants_appId_fkey"
    FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing tenant keeps access to every registered app, so
-- enforcement switches on without locking anyone out.
INSERT INTO "app_tenants" ("tenantId", "appId", "status", "plan", "updatedAt")
SELECT t."id", a."id", 'ACTIVE', t."plan", CURRENT_TIMESTAMP
FROM "tenants" t CROSS JOIN "apps" a;
