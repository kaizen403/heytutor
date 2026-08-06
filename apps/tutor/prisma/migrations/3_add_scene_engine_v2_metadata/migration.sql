-- Persist the semantic scene and its validation outcome alongside materialized
-- segment commands. All fields are nullable so existing turns remain valid.
ALTER TABLE "turns"
  ADD COLUMN "scene_document" JSONB,
  ADD COLUMN "scene_engine_version" TEXT,
  ADD COLUMN "validation_report" JSONB,
  ADD COLUMN "visual_status" TEXT;
