-- Student accounts: identity, onboarding, and server-backed settings.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_completed_at" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "exam_goal" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "class_year" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subjects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "age_band" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "guardian_email" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "guardian_notified_at" TIMESTAMPTZ(6);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "learning_note" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users" ("email");

CREATE TABLE IF NOT EXISTS "user_settings" (
  "user_id" TEXT NOT NULL,
  "fast_mode" BOOLEAN NOT NULL DEFAULT true,
  "familiarity" TEXT NOT NULL DEFAULT 'normal',
  "audio_language" TEXT NOT NULL DEFAULT 'english',
  "accent" TEXT NOT NULL DEFAULT 'india',
  "narration_enabled" BOOLEAN NOT NULL DEFAULT true,
  "low_latency_voice" BOOLEAN NOT NULL DEFAULT false,
  "subtitles_enabled" BOOLEAN NOT NULL DEFAULT false,
  "marker_color" TEXT NOT NULL DEFAULT 'navy',
  "speed_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  "ui_language" TEXT NOT NULL DEFAULT 'en',
  "show_home_suggestions" BOOLEAN NOT NULL DEFAULT true,
  "reduced_motion" BOOLEAN NOT NULL DEFAULT false,
  "teaching_note" TEXT NOT NULL DEFAULT '',
  "always_show_units" BOOLEAN NOT NULL DEFAULT false,
  "always_state_law_first" BOOLEAN NOT NULL DEFAULT false,
  "remember_weak_topics" BOOLEAN NOT NULL DEFAULT true,
  "email_weekly_recap" BOOLEAN NOT NULL DEFAULT false,
  "email_guardian_notice" BOOLEAN NOT NULL DEFAULT true,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
