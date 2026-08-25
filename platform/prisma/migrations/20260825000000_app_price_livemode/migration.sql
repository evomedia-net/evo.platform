-- AppPrice records which Stripe mode its price id came from.
--
-- Existing rows default to false (test). That is the right default rather than
-- a guess: every price registered before this migration was registered against
-- whatever key the deployment had, and production has only ever held sk_test_
-- keys. A live price mislabelled as test is refused at checkout and shows in
-- the health report; a test price mislabelled as live would be offered to a
-- real customer, so the safe direction is the one that fails loudly.
ALTER TABLE "app_prices" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT false;

-- Looking up "the prices sellable in the mode this deployment is running in"
-- is the hot path for a pricing table, and it is always filtered by app.
CREATE INDEX "app_prices_appId_livemode_idx" ON "app_prices" ("appId", "livemode");
