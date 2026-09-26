ALTER TABLE "user_settings"
  ADD COLUMN "pencil_color" TEXT NOT NULL DEFAULT 'navy',
  ADD COLUMN "marker_thickness" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "pencil_thickness" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- Existing accounts used the marker color for both instruments.
UPDATE "user_settings" SET "pencil_color" = "marker_color";
