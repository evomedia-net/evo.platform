-- Tenant company profile (phone + address)
ALTER TABLE "tenants"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "country" TEXT;
