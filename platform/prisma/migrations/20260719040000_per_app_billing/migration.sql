-- Per-app billing: each (tenant, app) pair carries its own Stripe subscription.
ALTER TABLE "apps" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "app_tenants" ADD COLUMN "stripeSubscriptionId" TEXT;
CREATE UNIQUE INDEX "app_tenants_stripeSubscriptionId_key" ON "app_tenants"("stripeSubscriptionId");
