-- AddUniqueConstraint on turns(board_id, order_index) so concurrent saves
-- cannot produce two turns with the same orderIndex for a board.
CREATE UNIQUE INDEX IF NOT EXISTS "turns_board_id_order_index_key"
  ON "turns"("board_id", "order_index");
