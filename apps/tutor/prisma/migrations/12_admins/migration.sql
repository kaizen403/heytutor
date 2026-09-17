CREATE TABLE IF NOT EXISTS "admins" (
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("email"),
    CONSTRAINT "admins_email_lowercase" CHECK ("email" = lower("email"))
);

INSERT INTO "admins" ("email")
VALUES ('rishivhavle21@gmail.com')
ON CONFLICT ("email") DO NOTHING;
