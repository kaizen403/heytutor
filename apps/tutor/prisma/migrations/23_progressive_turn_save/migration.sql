-- Progressive turn save: a lesson is saved while it is taught, one checkpoint
-- per finished segment, so Stop, a tab close or an error never loses it.
-- Additive only. Every legacy row reads as a finished lesson.
ALTER TABLE "turns" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE "turns" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'lesson';
ALTER TABLE "turns" ADD COLUMN "checkpoint_seq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "turns" ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();
-- Metadata bytes already charged to the account, so a growing turn is charged
-- only for what it adds.
ALTER TABLE "turns" ADD COLUMN "metadata_bytes" BIGINT NOT NULL DEFAULT 0;
-- The submitted (pre-canonical) rows with their audio, re-canonicalized as a
-- whole on every checkpoint. Cleared once the turn is complete.
ALTER TABLE "turns" ADD COLUMN "submitted_segments" JSONB;
-- What a later Continue needs and cannot derive from the rows (for example the
-- solver projection). Opaque to the server, size bounded by the route.
ALTER TABLE "turns" ADD COLUMN "resume_state" JSONB;
-- The submitted row whose audio clip this stored row plays.
ALTER TABLE "segments" ADD COLUMN "audio_ref" INTEGER;

ALTER TABLE "turns" ADD CONSTRAINT "turns_status_check" CHECK ("status" IN ('live', 'stopped', 'complete'));
ALTER TABLE "turns" ADD CONSTRAINT "turns_kind_check" CHECK ("kind" IN ('lesson', 'doubt', 'resume'));
