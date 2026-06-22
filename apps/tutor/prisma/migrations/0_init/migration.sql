-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'new board',
    "preview" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "board_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "raw_response" TEXT NOT NULL,
    "speed_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "trace_id" TEXT,
    "llm_cost_usd" DOUBLE PRECISION,
    "tts_cost_usd" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "turn_id" UUID NOT NULL,
    "order_index" INTEGER NOT NULL,
    "narration" TEXT NOT NULL DEFAULT '',
    "spoken_text" TEXT NOT NULL DEFAULT '',
    "command" JSONB,
    "audio_url" TEXT,
    "audio_format" TEXT DEFAULT 'audio/mpeg',
    "duration_ms" INTEGER,
    "timings" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boards_user_id_idx" ON "boards"("user_id");

-- CreateIndex
CREATE INDEX "turns_board_id_idx" ON "turns"("board_id");

-- CreateIndex
CREATE INDEX "turns_user_id_idx" ON "turns"("user_id");

-- CreateIndex
CREATE INDEX "segments_turn_id_idx" ON "segments"("turn_id");

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turns" ADD CONSTRAINT "turns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segments" ADD CONSTRAINT "segments_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
