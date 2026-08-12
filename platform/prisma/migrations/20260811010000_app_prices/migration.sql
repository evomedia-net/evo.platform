-- What an app sells becomes rows rather than a single column, so a product can
-- offer any number of tiers and billing periods without a schema change.

CREATE TABLE "app_prices" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "stripePriceId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "stripeProductId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "unitAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "sellable" BOOLEAN NOT NULL DEFAULT true,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_prices_stripePriceId_key" ON "app_prices"("stripePriceId");
CREATE INDEX "app_prices_appId_idx" ON "app_prices"("appId");
CREATE UNIQUE INDEX "app_prices_appId_tier_interval_intervalCount_key"
    ON "app_prices"("appId", "tier", "interval", "intervalCount");

ALTER TABLE "app_prices" ADD CONSTRAINT "app_prices_appId_fkey"
    FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry any already-registered price across as that app's first tier. The
-- amount/currency/interval are unknown here (they live in Stripe, and a
-- migration must not make network calls), so they are seeded to a monthly USD
-- zero and refreshed the first time the price is re-registered in the console.
-- 'standard' is a placeholder tier name the operator is expected to rename.
INSERT INTO "app_prices" ("id", "appId", "stripePriceId", "tier", "stripeProductId", "productName", "unitAmount", "currency", "interval", "updatedAt")
SELECT gen_random_uuid()::text, "id", "stripePriceId", 'standard', '', "name", 0, 'usd', 'month', CURRENT_TIMESTAMP
FROM "apps"
WHERE "stripePriceId" IS NOT NULL;

ALTER TABLE "apps" DROP COLUMN "stripePriceId";
