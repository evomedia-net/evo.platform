-- Platform-level users (tenantId IS NULL) were not covered by the
-- users_tenantId_email_key unique index: PostgreSQL treats NULLs as DISTINCT
-- in unique constraints, so (NULL, 'a@b.com') never conflicts with another
-- (NULL, 'a@b.com'). Two platform admins could therefore share an address,
-- and login resolves with findFirst — meaning the account you authenticate as
-- would be whichever row Postgres happened to return.
--
-- UsersService.create/update already check this by hand. This index makes it
-- true by construction, so a future code path that forgets the check fails
-- loudly instead of creating an ambiguous identity.
--
-- Prisma cannot express partial indexes in schema.prisma; it is declared here
-- and documented above the User model. Do not drop it if `prisma migrate dev`
-- offers to.
--
-- Deliberately not filtered on deletedAt: a soft-deleted user keeps its email
-- reserved, matching the existing per-tenant constraint and the manual checks.
-- Restore the account rather than re-creating it.
CREATE UNIQUE INDEX "users_platform_email_key"
  ON "users" ("email")
  WHERE "tenantId" IS NULL;
