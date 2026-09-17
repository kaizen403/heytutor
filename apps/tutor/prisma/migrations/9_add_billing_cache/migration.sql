-- Optional billing cache for the usage bar. Autumn remains the balance authority.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credits_remaining" INTEGER;
