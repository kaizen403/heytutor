/** USD cost helpers for Langfuse `costDetails`. Rates are per-model, env-overridable. */

export interface UsageCounts {
  input?: number;
  output?: number;
  total?: number;
  characters?: number;
}

export type CostDetails = Record<string, number>;

export type LlmRateLane =
  | "kimi-k3-fast"
  | "kimi-k3"
  | "deepseek-flash"
  | "qwen-vision"
  | "unknown";

/** Fireworks published serverless rates (USD per 1M tokens). */
export const LLM_RATE_DEFAULTS: Record<
  Exclude<LlmRateLane, "unknown">,
  { inputUsdPer1M: number; outputUsdPer1M: number }
> = {
  "kimi-k3-fast": { inputUsdPer1M: 4.5, outputUsdPer1M: 22.5 },
  "kimi-k3": { inputUsdPer1M: 3, outputUsdPer1M: 15 },
  "deepseek-flash": { inputUsdPer1M: 0.22, outputUsdPer1M: 0.66 },
  "qwen-vision": { inputUsdPer1M: 0.5, outputUsdPer1M: 3 },
};

const UNKNOWN_FALLBACK = LLM_RATE_DEFAULTS["kimi-k3-fast"];

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

export function resolveLlmRateLane(model?: string | null): LlmRateLane {
  const id = (model ?? "").toLowerCase();
  if (!id) return "unknown";
  if (id.includes("kimi-k3-fast") || id.includes("kimi_k3_fast")) {
    return "kimi-k3-fast";
  }
  if (id.includes("deepseek-v4p1") || id.includes("deepseek-v4.1") || id.includes("deepseek-flash")) {
    return "deepseek-flash";
  }
  if (id.includes("qwen3p7") || id.includes("qwen3.7") || id.includes("qwen-3.7") || id.includes("qwen3-7")) {
    return "qwen-vision";
  }
  if (id.includes("kimi-k3") || id.includes("kimi_k3")) {
    return "kimi-k3";
  }
  return "unknown";
}

function laneEnvPrefix(lane: LlmRateLane): string | null {
  switch (lane) {
    case "kimi-k3-fast":
      return "FIREWORKS_KIMI_FAST";
    case "kimi-k3":
      return "FIREWORKS_KIMI_K3";
    case "deepseek-flash":
      return "FIREWORKS_DEEPSEEK_FLASH";
    case "qwen-vision":
      return "FIREWORKS_VISION";
    default:
      return null;
  }
}

export function resolveLlmRates(model?: string | null): {
  lane: LlmRateLane;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
} {
  const lane = resolveLlmRateLane(model);
  const defaults = lane === "unknown" ? UNKNOWN_FALLBACK : LLM_RATE_DEFAULTS[lane];
  const prefix = laneEnvPrefix(lane);
  if (!prefix) {
    return {
      lane,
      inputUsdPer1M: readEnvNumber("FIREWORKS_UNKNOWN_INPUT_USD_PER_1M", defaults.inputUsdPer1M),
      outputUsdPer1M: readEnvNumber("FIREWORKS_UNKNOWN_OUTPUT_USD_PER_1M", defaults.outputUsdPer1M),
    };
  }
  return {
    lane,
    inputUsdPer1M: readEnvNumber(`${prefix}_INPUT_USD_PER_1M`, defaults.inputUsdPer1M),
    outputUsdPer1M: readEnvNumber(`${prefix}_OUTPUT_USD_PER_1M`, defaults.outputUsdPer1M),
  };
}

export type TtsRateLane = "flash" | "multilingual" | "unknown";

/** ElevenLabs published API rates (USD per 1k characters). */
export const TTS_RATE_DEFAULTS: Record<TtsRateLane, number> = {
  flash: 0.05,
  multilingual: 0.1,
  unknown: 0.1,
};

export function resolveTtsRateLane(model?: string | null): TtsRateLane {
  const id = (model ?? "").toLowerCase();
  if (!id) return "unknown";
  if (id.includes("flash") || id.includes("turbo")) return "flash";
  if (id.includes("multilingual") || id.includes("eleven_v3") || id.includes("eleven-v3")) {
    return "multilingual";
  }
  return "unknown";
}

function elevenLabsUsdPer1kChars(model?: string | null): number {
  const global = process.env.ELEVENLABS_USD_PER_1K_CHARS;
  if (global) {
    const parsed = Number.parseFloat(global);
    if (Number.isFinite(parsed)) return parsed;
  }
  const lane = resolveTtsRateLane(model);
  if (lane === "flash") {
    return readEnvNumber("ELEVENLABS_FLASH_USD_PER_1K_CHARS", TTS_RATE_DEFAULTS.flash);
  }
  return readEnvNumber("ELEVENLABS_MULTILINGUAL_USD_PER_1K_CHARS", TTS_RATE_DEFAULTS[lane]);
}

export function calculateLlmCostDetails(
  usage: UsageCounts,
  options: { model?: string | null } = {},
): CostDetails {
  const rates = resolveLlmRates(options.model);
  const inputTokens = usage.input ?? 0;
  const outputTokens = usage.output ?? 0;
  const input = roundUsd((inputTokens / 1_000_000) * rates.inputUsdPer1M);
  const output = roundUsd((outputTokens / 1_000_000) * rates.outputUsdPer1M);
  const total = roundUsd(input + output);

  return { input, output, total };
}

export function calculateTtsCostDetails(
  characters: number,
  options: { model?: string | null } = {},
): CostDetails {
  const charactersCost = roundUsd((characters / 1000) * elevenLabsUsdPer1kChars(options.model));
  return { characters: charactersCost, total: charactersCost };
}

export function llmUsageUsd(
  usage: UsageCounts,
  options: { model?: string | null } = {},
): number {
  return calculateLlmCostDetails(usage, options).total ?? 0;
}

export function ttsUsageUsd(
  characters: number,
  options: { model?: string | null } = {},
): number {
  return calculateTtsCostDetails(characters, options).total ?? 0;
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
