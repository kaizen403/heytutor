-- Who the account is for. Set during onboarding: college or other.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "learner_role" TEXT;
