-- Tenant admins: users who manage their own tenant's members via /tenant/*
ALTER TABLE "users" ADD COLUMN "isTenantAdmin" BOOLEAN NOT NULL DEFAULT false;
