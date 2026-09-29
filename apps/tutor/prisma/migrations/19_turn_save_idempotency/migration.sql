-- NULL keeps legacy turn saves unchanged. A non-NULL client key is unique within
-- the authenticated owner and board so a committed-but-unacknowledged POST can replay.
ALTER TABLE "turns" ADD COLUMN "idempotency_key" UUID;
CREATE UNIQUE INDEX "turns_board_id_user_id_idempotency_key_key"
  ON "turns"("board_id", "user_id", "idempotency_key");
