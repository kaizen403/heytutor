-- Marker stunts: whether the idle hand is allowed its loud repertoire while
-- the tutor talks. On by default, so an existing row keeps the new behaviour
-- without a write.
ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "marker_stunts" BOOLEAN NOT NULL DEFAULT true;
