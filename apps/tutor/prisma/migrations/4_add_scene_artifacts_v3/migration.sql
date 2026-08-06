-- Persist multi-candidate scene generation artifacts (TurnPlanV3, candidates,
-- selection reason, shadow vision) for Langfuse and accuracy replay.
ALTER TABLE "turns"
  ADD COLUMN "scene_artifacts" JSONB;
