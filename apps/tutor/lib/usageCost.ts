/** USD cost helpers for Langfuse `costDetails`. Rates are env-configurable. */

export interface UsageCounts {
  input?: number;
  output?: number;
  total?: number;
  characters?: number;
}

export type CostDetails = Record<string, number>;

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function fireworksInputUsdPer1M(): number {
  return readEnvNumber("FIREWORKS_INPUT_USD_PER_1M", 0.95);
}

function fireworksOutputUsdPer1M(): number {
  return readEnvNumber("FIREWORKS_OUTPUT_USD_PER_1M", 4);
}

function elevenLabsUsdPer1kChars(): number {
  return readEnvNumber("ELEVENLABS_USD_PER_1K_CHARS", 0.05);
}

export function calculateLlmCostDetails(usage: UsageCounts): CostDetails {
  const inputTokens = usage.input ?? 0;
  const outputTokens = usage.output ?? 0;
  const input = roundUsd((inputTokens / 1_000_000) * fireworksInputUsdPer1M());
  const output = roundUsd((outputTokens / 1_000_000) * fireworksOutputUsdPer1M());
  const total = roundUsd(input + output);

  return { input, output, total };
}

export function calculateTtsCostDetails(characters: number): CostDetails {
  const charactersCost = roundUsd((characters / 1000) * elevenLabsUsdPer1kChars());
  return { characters: charactersCost, total: charactersCost };
}

export function enrichTraceMetadataWithCosts(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const enriched = { ...metadata };
  const chars = enriched.total_tts_chars;

  if (typeof chars === "number" && chars > 0) {
    enriched.tts_cost_usd = calculateTtsCostDetails(chars).total;
  }

  const llmCost = enriched.llm_cost_usd;
  const ttsCost = enriched.tts_cost_usd;

  if (typeof llmCost === "number" && typeof ttsCost === "number") {
    enriched.estimated_turn_cost_usd = roundUsd(llmCost + ttsCost);
  }

  return enriched;
}
