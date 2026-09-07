-- Pin and archive for sidebar boards.
-- Both are nullable timestamps rather than booleans: the pin order needs to
-- know which board was pinned most recently, and an archive is worth dating.
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "pinned_at" TIMESTAMPTZ(6);
ALTER TABLE "boards" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "boards_user_id_archived_at_pinned_at_idx"
  ON "boards" ("user_id", "archived_at", "pinned_at");
