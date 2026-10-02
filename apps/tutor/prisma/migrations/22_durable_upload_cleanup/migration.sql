-- Upload admission persists its cleanup intent before contacting object storage.
-- Crashed requests retain their pending-turn charge until confirmed deletion.
ALTER TABLE "object_deletion_jobs" ADD COLUMN "pending_turns" INTEGER NOT NULL DEFAULT 0;
