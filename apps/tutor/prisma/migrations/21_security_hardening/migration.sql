-- AlterTable
ALTER TABLE "board_chat_messages" ADD COLUMN     "storage_bytes" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "turns" ADD COLUMN     "storage_bytes" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "paid_usage_reservations" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "trace_id" TEXT,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "amount_millicents" INTEGER NOT NULL,
    "settled_millicents" INTEGER,
    "allocations" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paid_usage_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_identities" (
    "identity_hash" TEXT NOT NULL,
    "free_period" TEXT NOT NULL,
    "spent_millicents" INTEGER NOT NULL DEFAULT 0,
    "free_window_starts_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "abuse_identities_pkey" PRIMARY KEY ("identity_hash")
);

-- CreateTable
CREATE TABLE "owned_traces" (
    "trace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "saved_turn_id" TEXT,

    CONSTRAINT "owned_traces_pkey" PRIMARY KEY ("trace_id")
);

-- CreateTable
CREATE TABLE "billing_webhook_events" (
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("provider","event_id")
);

-- CreateTable
CREATE TABLE "user_storage" (
    "user_id" TEXT NOT NULL,
    "reserved_bytes" BIGINT NOT NULL DEFAULT 0,
    "pending_turns" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_storage_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "object_deletion_jobs" (
    "id" UUID NOT NULL,
    "prefix" TEXT NOT NULL,
    "user_id" TEXT,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "object_deletion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paid_usage_reservations_user_id_trace_id_kind_idx" ON "paid_usage_reservations"("user_id", "trace_id", "kind");

-- CreateIndex
CREATE INDEX "paid_usage_reservations_created_at_idx" ON "paid_usage_reservations"("created_at");

-- CreateIndex
CREATE INDEX "abuse_identities_expires_at_idx" ON "abuse_identities"("expires_at");

-- CreateIndex
CREATE INDEX "owned_traces_user_id_idx" ON "owned_traces"("user_id");

-- CreateIndex
CREATE INDEX "owned_traces_expires_at_idx" ON "owned_traces"("expires_at");

-- CreateIndex
CREATE INDEX "billing_webhook_events_created_at_idx" ON "billing_webhook_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "object_deletion_jobs_prefix_key" ON "object_deletion_jobs"("prefix");

-- CreateIndex
CREATE INDEX "object_deletion_jobs_next_attempt_at_idx" ON "object_deletion_jobs"("next_attempt_at");

-- AddForeignKey
ALTER TABLE "paid_usage_reservations" ADD CONSTRAINT "paid_usage_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owned_traces" ADD CONSTRAINT "owned_traces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_storage" ADD CONSTRAINT "user_storage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
