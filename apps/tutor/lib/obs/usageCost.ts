import type { SpeechProvider } from "../tts/providerConfig";
/** USD cost helpers for Langfuse `costDetails`. Rates are per-model, env-overridable. */

export interface UsageCounts {
  input?: number;
  output?: number;
  total?: number;
  characters?: number;
  /** Prompt tokens reported as cache hits. Subset of `input`. */
  cachedInput?: number;
}

export type CostDetails = Record<string, number>;

export type LlmRateLane =
  | "kimi-k3-fast"
  | "kimi-k3"
  | "deepseek-flash"
  | "qwen-vision"
  | "jev"
  | "unknown";

export interface LlmRate {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  /**
   * Cache-hit input rate. Kimi publishes a discount. Other lanes bill cache
   * hits at the normal input rate until that provider publishes one.
   */
  cachedInputUsdPer1M: number;
}

/** Fireworks published serverless rates, plus TypeSafe's published Jev input rate. */
export const LLM_RATE_DEFAULTS: Record<Exclude<LlmRateLane, "unknown">, LlmRate> = {
  "kimi-k3-fast": { inputUsdPer1M: 4.5, outputUsdPer1M: 22.5, cachedInputUsdPer1M: 0.45 },
  "kimi-k3": { inputUsdPer1M: 3, outputUsdPer1M: 15, cachedInputUsdPer1M: 0.3 },
  "deepseek-flash": { inputUsdPer1M: 0.22, outputUsdPer1M: 0.66, cachedInputUsdPer1M: 0.22 },
  "qwen-vision": { inputUsdPer1M: 0.5, outputUsdPer1M: 3, cachedInputUsdPer1M: 0.5 },
  jev: { inputUsdPer1M: 0.042, outputUsdPer1M: 0, cachedInputUsdPer1M: 0.042 },
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
  if (id.includes("typesafe") || id.endsWith("/jev") || id === "jev" || id.startsWith("jev-")) {
    return "jev";
  }
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
    case "jev":
      return "JEV";
    default:
      return null;
  }
}

export function resolveLlmRates(model?: string | null): {
  lane: LlmRateLane;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  cachedInputUsdPer1M: number;
} {
  const lane = resolveLlmRateLane(model);
  const defaults = lane === "unknown" ? UNKNOWN_FALLBACK : LLM_RATE_DEFAULTS[lane];
  const prefix = laneEnvPrefix(lane);
  if (!prefix) {
    const inputUsdPer1M = readEnvNumber("FIREWORKS_UNKNOWN_INPUT_USD_PER_1M", defaults.inputUsdPer1M);
    return {
      lane,
      inputUsdPer1M,
      outputUsdPer1M: readEnvNumber("FIREWORKS_UNKNOWN_OUTPUT_USD_PER_1M", defaults.outputUsdPer1M),
      cachedInputUsdPer1M: inputUsdPer1M,
    };
  }
  const inputUsdPer1M = readEnvNumber(`${prefix}_INPUT_USD_PER_1M`, defaults.inputUsdPer1M);
  return {
    lane,
    inputUsdPer1M,
    outputUsdPer1M: readEnvNumber(`${prefix}_OUTPUT_USD_PER_1M`, defaults.outputUsdPer1M),
    cachedInputUsdPer1M: readEnvNumber(`${prefix}_CACHED_INPUT_USD_PER_1M`, defaults.cachedInputUsdPer1M),
  };
}

export type TtsRateLane = "cartesia" | "flash" | "multilingual" | "unknown";

/**
 * USD per 1k characters. Cartesia Sonic is 1 credit per character.
 * $0.05 matches the Pro plan ($5 / 100,000 credits). Startup and Scale
 * are cheaper; set CARTESIA_USD_PER_1K_CHARS to that plan's credit price.
 */
export const TTS_RATE_DEFAULTS: Record<TtsRateLane, number> = {
  cartesia: 0.05,
  flash: 0.05,
  multilingual: 0.1,
  unknown: 0.1,
};

export function resolveTtsRateLane(model?: string | null): TtsRateLane {
  const id = (model ?? "").toLowerCase();
  if (!id) return "unknown";
  if (id.startsWith("sonic") || id.includes("cartesia")) return "cartesia";
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
  const inputTokens = Math.max(0, usage.input ?? 0);
  const cachedTokens = Math.min(inputTokens, Math.max(0, usage.cachedInput ?? 0));
  const uncachedTokens = inputTokens - cachedTokens;
  const outputTokens = Math.max(0, usage.output ?? 0);
  const uncached = (uncachedTokens / 1_000_000) * rates.inputUsdPer1M;
  const cached = (cachedTokens / 1_000_000) * rates.cachedInputUsdPer1M;
  const input = roundUsd(uncached + cached);
  const output = roundUsd((outputTokens / 1_000_000) * rates.outputUsdPer1M);
  const total = roundUsd(input + output);

  return { input, cachedInput: roundUsd(cached), output, total };
}

export function calculateTtsCostDetails(
  characters: number,
  options: { model?: string | null; provider?: SpeechProvider } = {},
): CostDetails {
  const modelId = options.model?.toLowerCase() ?? "";
  const provider = options.provider ?? (modelId.startsWith("sonic") ? "cartesia" : "elevenlabs");
  const rate = provider === "cartesia"
    ? readEnvNumber("CARTESIA_USD_PER_1K_CHARS", 0.05)
    : elevenLabsUsdPer1kChars(options.model);
  const charactersCost = roundUsd((characters / 1000) * rate);
  return { characters: charactersCost, total: charactersCost };
}

export function enrichTraceMetadataWithCosts(
  metadata: Record<string, unknown>,
  speech: { provider?: SpeechProvider; model?: string } = {},
): Record<string, unknown> {
  const enriched = { ...metadata };
  const chars = enriched.total_tts_chars;

  if (typeof chars === "number" && chars > 0) {
    enriched.tts_cost_usd = calculateTtsCostDetails(chars, speech).total;
  }

  const llmCost = enriched.llm_cost_usd;
  const ttsCost = enriched.tts_cost_usd;

  if (typeof llmCost === "number" && typeof ttsCost === "number") {
    enriched.estimated_turn_cost_usd = roundUsd(llmCost + ttsCost);
  }

  return enriched;
}
