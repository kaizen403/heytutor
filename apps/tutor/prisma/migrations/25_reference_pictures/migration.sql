CREATE TABLE "reference_pictures" (
  "id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "record" JSONB NOT NULL,
  "plan" JSONB NOT NULL,
  "image" BYTEA NOT NULL,
  "image_type" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reference_pictures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reference_pictures_source_key_key" ON "reference_pictures"("source_key");

CREATE TABLE "reference_picture_queries" (
  "query_key" TEXT NOT NULL,
  "picture_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reference_picture_queries_pkey" PRIMARY KEY ("query_key")
);
