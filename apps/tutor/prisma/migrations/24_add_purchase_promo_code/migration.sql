-- The promo code that discounted a purchase (e.g. PH50). Additive only: every
-- existing purchase was charged at full price and reads as null.
ALTER TABLE "billing_purchases" ADD COLUMN "promo_code" TEXT;
