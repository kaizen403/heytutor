-- Admin time-window queries (24h/7d/30d turns, 14-day series, recent feeds,
-- failure windows) all filter and sort turns on created_at; before this index
-- each of those was a sequential scan over every stored turn.
CREATE INDEX IF NOT EXISTS "turns_created_at_idx" ON "turns"("created_at");
