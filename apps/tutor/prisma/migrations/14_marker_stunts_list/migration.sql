-- Marker stunts became a selection rather than a flag: the student picks which
-- tricks the idle hand may play and keeps the rest off.
--
-- `13_marker_stunts` has already shipped, so it is left exactly as it was
-- applied and the column is converted here instead. Editing an applied
-- migration fails `prisma migrate deploy` on its checksum and takes the whole
-- deploy down with it.
--
-- The conversion keeps what each row meant: a student who had the tricks on
-- gets all of them, and one who had switched them off gets none.
ALTER TABLE "user_settings"
  ALTER COLUMN "marker_stunts" DROP DEFAULT;

ALTER TABLE "user_settings"
  ALTER COLUMN "marker_stunts" TYPE TEXT[]
  USING CASE
    WHEN "marker_stunts" THEN ARRAY['thumbAround', 'knuckleRoll', 'helicopter', 'tossCatch']::TEXT[]
    ELSE ARRAY[]::TEXT[]
  END;

ALTER TABLE "user_settings"
  ALTER COLUMN "marker_stunts"
  SET DEFAULT ARRAY['thumbAround', 'knuckleRoll', 'helicopter', 'tossCatch']::TEXT[];
