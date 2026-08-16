-- The customer-facing product name. The registry slug ("swag-estimates") is an
-- identifier; an email that must look legitimate needs "SWAG Estimates".
ALTER TABLE "apps" ADD COLUMN "displayName" TEXT;
