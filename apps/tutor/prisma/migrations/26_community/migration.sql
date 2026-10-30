-- Community: public boards anyone can watch and remix. Every board is public,
-- the ones made before this migration too (the owner's choice), except staff
-- boards, which stay private so lab rounds never fill the gallery. Community
-- lists only lessons that drew a figure and ran a minute (turns.lesson_ms).
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'public';
UPDATE "boards" b SET "visibility" = 'private'
FROM "users" u
WHERE u."id" = b."user_id"
  AND lower(trim(u."email")) IN (SELECT lower(trim("email")) FROM "admins");
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "community_hidden_at" TIMESTAMPTZ(6);
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "featured_at" TIMESTAMPTZ(6);
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "view_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "remix_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "remixed_from_board_id" TEXT;
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "thumbnail_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "boards_community_idx"
  ON "boards" ("visibility", "community_hidden_at", "updated_at");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "handle" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_handle_key" ON "users" ("handle");

CREATE TABLE IF NOT EXISTS "community_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "board_id" TEXT NOT NULL,
  "reporter_id" TEXT,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "community_reports_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "community_reports_board_id_created_at_idx"
  ON "community_reports" ("board_id", "created_at");

-- Spoken length of each saved lesson: every audio clip once, rows that share a
-- clip by their longest duration. Kept current by every turn save.
ALTER TABLE "turns" ADD COLUMN IF NOT EXISTS "lesson_ms" INTEGER NOT NULL DEFAULT 0;
UPDATE "turns" t SET "lesson_ms" = lesson."ms"
FROM (
  SELECT "turn_id", LEAST(SUM("clip_ms"), 2147483647)::INTEGER AS "ms"
  FROM (
    SELECT "turn_id", MAX(GREATEST(COALESCE("duration_ms", 0), 0))::BIGINT AS "clip_ms"
    FROM "segments"
    GROUP BY "turn_id", COALESCE("audio_ref", "order_index")
  ) clips
  GROUP BY "turn_id"
) lesson
WHERE lesson."turn_id" = t."id";
