-- Lecture download file type. MP4 stays the default so existing rows keep
-- today's behaviour without a write.
ALTER TABLE "user_settings"
  ADD COLUMN IF NOT EXISTS "lecture_file_type" TEXT NOT NULL DEFAULT 'mp4';
