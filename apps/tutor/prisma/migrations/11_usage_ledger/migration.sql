ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "remaining_pct" INTEGER;
ALTER TABLE "users" DROP COLUMN IF EXISTS "credits_remaining";

CREATE TABLE IF NOT EXISTS "billing_period_spend" (
    "user_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "spent_millicents" INTEGER NOT NULL DEFAULT 0,
    "bonus_millicents" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_period_spend_pkey" PRIMARY KEY ("user_id","period")
);

CREATE INDEX IF NOT EXISTS "billing_period_spend_user_id_idx" ON "billing_period_spend"("user_id");

ALTER TABLE "billing_period_spend" DROP CONSTRAINT IF EXISTS "billing_period_spend_user_id_fkey";
ALTER TABLE "billing_period_spend" ADD CONSTRAINT "billing_period_spend_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
