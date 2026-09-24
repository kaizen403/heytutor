CREATE TABLE "home_suggestion_cache" (
  "user_id" TEXT NOT NULL,
  "packs" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "cursor" INTEGER NOT NULL DEFAULT 0,
  "source_turn_id" TEXT,
  "generated_at" TIMESTAMPTZ(6),
  "next_generation_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "quota_day" TEXT NOT NULL DEFAULT '',
  "generations_today" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "home_suggestion_cache_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "home_suggestion_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
