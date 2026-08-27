-- Sidebar notes-chat history, scoped to a board.
CREATE TABLE "board_chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "board_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "board_chat_messages_board_id_created_at_idx" ON "board_chat_messages"("board_id", "created_at");
CREATE INDEX "board_chat_messages_user_id_idx" ON "board_chat_messages"("user_id");

ALTER TABLE "board_chat_messages"
  ADD CONSTRAINT "board_chat_messages_board_id_fkey"
  FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "board_chat_messages"
  ADD CONSTRAINT "board_chat_messages_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
