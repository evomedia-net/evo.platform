-- Email verification: NULL = mailbox not proven, login refused until verified.
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Backfill: every existing account keeps working — their credentials were
-- issued by an admin, which is treated as proof of identity.
UPDATE "users" SET "emailVerifiedAt" = CURRENT_TIMESTAMP;
