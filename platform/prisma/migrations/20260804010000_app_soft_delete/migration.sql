-- Soft delete for apps, matching tenants and users. Nullable so existing rows
-- are untouched and every app stays live on deploy.
--
-- clientId and name keep their UNIQUE constraints, which is deliberate: while
-- an app is soft-deleted its identifiers stay reserved, so re-registering the
-- same name cannot silently inherit the old app's tenant grants or roles.
ALTER TABLE "apps" ADD COLUMN "deletedAt" TIMESTAMP(3);