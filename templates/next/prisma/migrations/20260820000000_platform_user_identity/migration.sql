-- Local users are keyed on the PLATFORM's identity, not the email address.
--
-- The platform scopes accounts per workspace (@@unique([tenantId, email])), so
-- one address is a different person, with a different password, in each
-- workspace. Provisioning upserted local rows on the address alone, which
-- merged those people into one account — and the session then resolved to
-- whichever workspace they had joined first.
ALTER TABLE "User" ADD COLUMN "platformUserId" TEXT;

CREATE UNIQUE INDEX "User_platformUserId_key" ON "User"("platformUserId");

-- Email stays unique for STANDALONE accounts only, where it really is the
-- identity. A plain unique would forbid the same person holding accounts in
-- two workspaces, which the platform explicitly allows. Partial, because NULL
-- here means "a platform account" — a kind, so it must be constrained rather
-- than left to application code.
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_email_standalone_key"
  ON "User"("email") WHERE "platformUserId" IS NULL;
