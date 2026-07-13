-- Billing: Stripe linkage + PAST_DUE grace window on tenants
ALTER TABLE "tenants" ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripeSubscriptionId" TEXT,
ADD COLUMN "graceUntil" TIMESTAMP(3);

CREATE UNIQUE INDEX "tenants_stripeCustomerId_key" ON "tenants"("stripeCustomerId");
