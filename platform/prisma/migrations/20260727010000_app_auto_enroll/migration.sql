-- Per-app opt-out of the console's "new tenants start enabled on every app"
-- fast path. Default true preserves current behavior for existing apps.
ALTER TABLE "apps" ADD COLUMN "autoEnroll" BOOLEAN NOT NULL DEFAULT true;
