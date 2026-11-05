-- One row per monthly AI credits cycle, kept from the relay's usage counter.
CREATE TABLE IF NOT EXISTS "ai_credit_cycles" (
  "cycle_key" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "spent_cents" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "last_counter_cents" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "alerted_percent" INTEGER NOT NULL DEFAULT 0,
  "polled_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ai_credit_cycles_pkey" PRIMARY KEY ("cycle_key")
);
