ALTER TABLE "billing_period_spend" ADD COLUMN "notes_messages" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "billing_purchases" (
  "id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "idempotency_key" UUID NOT NULL,
  "plan_id" TEXT NOT NULL,
  "amount" INTEGER NOT NULL CHECK ("amount" > 0),
  "currency" TEXT NOT NULL,
  "usage_millicents" INTEGER NOT NULL CHECK ("usage_millicents" >= 0),
  "spent_millicents" INTEGER NOT NULL DEFAULT 0 CHECK ("spent_millicents" >= 0),
  "key_id" TEXT NOT NULL,
  "test_mode" BOOLEAN NOT NULL,
  "order_id" TEXT,
  "payment_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'paid', 'refunded')),
  "refund_amount" INTEGER NOT NULL DEFAULT 0 CHECK ("refund_amount" >= 0 AND "refund_amount" <= "amount"),
  "granted_period" TEXT,
  "access_starts_at" TIMESTAMPTZ(6),
  "access_ends_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_purchases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "billing_purchases_user_id_idempotency_key_key" ON "billing_purchases"("user_id", "idempotency_key");
CREATE UNIQUE INDEX "billing_purchases_order_id_key" ON "billing_purchases"("order_id");
CREATE UNIQUE INDEX "billing_purchases_payment_id_key" ON "billing_purchases"("payment_id");
CREATE INDEX "billing_purchases_user_id_test_mode_status_access_ends_at_idx" ON "billing_purchases"("user_id", "test_mode", "status", "access_ends_at");
