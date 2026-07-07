-- Drop unused cost columns. LLM/TTS costs are tracked in Langfuse trace
-- metadata, not in the turns table.
ALTER TABLE "turns" DROP COLUMN IF EXISTS "llm_cost_usd";
ALTER TABLE "turns" DROP COLUMN IF EXISTS "tts_cost_usd";
