-- Community: public boards anyone can watch and remix.
-- Boards made before this migration stay private; their owners never agreed
-- to publish them. Only the column default makes new boards public.
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "boards" ALTER COLUMN "visibility" SET DEFAULT 'public';
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
