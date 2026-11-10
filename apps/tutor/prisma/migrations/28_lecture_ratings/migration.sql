-- The student's stars for a lecture turn: one row per moment it was asked
-- (during the lecture, after it ended), rewritten when the student changes it.
CREATE TABLE IF NOT EXISTS "lecture_ratings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "board_id" TEXT NOT NULL,
  "turn_id" UUID NOT NULL,
  "moment" TEXT NOT NULL,
  "stars" INTEGER NOT NULL,
  "feedback" TEXT,
  "steps_taught" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lecture_ratings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lecture_ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5),
  CONSTRAINT "lecture_ratings_moment_check" CHECK ("moment" IN ('during', 'after')),
  CONSTRAINT "lecture_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lecture_ratings_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "lecture_ratings_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "lecture_ratings_turn_id_moment_key" ON "lecture_ratings" ("turn_id", "moment");
CREATE INDEX IF NOT EXISTS "lecture_ratings_created_at_idx" ON "lecture_ratings" ("created_at");
CREATE INDEX IF NOT EXISTS "lecture_ratings_user_id_idx" ON "lecture_ratings" ("user_id");
CREATE INDEX IF NOT EXISTS "lecture_ratings_board_id_idx" ON "lecture_ratings" ("board_id");
