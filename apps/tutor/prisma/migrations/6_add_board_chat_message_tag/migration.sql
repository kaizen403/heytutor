-- Persist the board line a student tagged when they asked, so reload
-- still shows that tag on the message.
ALTER TABLE "board_chat_messages"
  ADD COLUMN "tag" JSONB;
