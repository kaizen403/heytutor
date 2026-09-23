import {
  LLM_RATE_DEFAULTS,
  TTS_RATE_DEFAULTS,
  calculateLlmCostDetails,
  calculateTtsCostDetails,
  resolveLlmRateLane,
  resolveLlmRates,
  resolveTtsRateLane,
} from "../../lib/obs/usageCost";
import {
  DEFAULT_FIREWORKS_FAST_MODEL,
  DEFAULT_FIREWORKS_MODEL,
  DEFAULT_FIREWORKS_VISION_MODEL,
  DEFAULT_PROBLEM_IR_MODEL,
} from "../../lib/llm/fireworksModels";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(resolveLlmRateLane(DEFAULT_FIREWORKS_FAST_MODEL) === "kimi-k3-fast", "Kimi Fast must not share the DeepSeek table");
assert(resolveLlmRateLane(DEFAULT_FIREWORKS_MODEL) === "kimi-k3", "standard Kimi K3 is its own lane");
assert(resolveLlmRateLane(DEFAULT_PROBLEM_IR_MODEL) === "deepseek-flash", "Problem IR is DeepSeek Flash");
assert(resolveLlmRateLane(DEFAULT_FIREWORKS_VISION_MODEL) === "qwen-vision", "OCR is Qwen vision");
assert(resolveLlmRateLane("accounts/fireworks/routers/kimi-k3-fast") === "kimi-k3-fast", "router ids must match Fast");

const fast = resolveLlmRates(DEFAULT_FIREWORKS_FAST_MODEL);
assert(fast.inputUsdPer1M === 4.5 && fast.outputUsdPer1M === 22.5, "Kimi Fast defaults are $4.50 / $22.50");
assert(
  LLM_RATE_DEFAULTS["deepseek-flash"].inputUsdPer1M === 0.22 &&
    LLM_RATE_DEFAULTS["deepseek-flash"].outputUsdPer1M === 0.66,
  "DeepSeek Flash defaults are $0.22 / $0.66",
);
assert(
  LLM_RATE_DEFAULTS["qwen-vision"].inputUsdPer1M === 0.5 &&
    LLM_RATE_DEFAULTS["qwen-vision"].outputUsdPer1M === 3,
  "Qwen vision defaults are Fireworks serverless $0.50 / $3.00",
);

const oneMFast = calculateLlmCostDetails(
  { input: 1_000_000, output: 1_000_000 },
  { model: DEFAULT_FIREWORKS_FAST_MODEL },
);
assert(oneMFast.input === 4.5 && oneMFast.output === 22.5 && oneMFast.total === 27, "1M Fast tokens must cost $27 blended");

const oneMFlash = calculateLlmCostDetails(
  { input: 1_000_000, output: 1_000_000 },
  { model: DEFAULT_PROBLEM_IR_MODEL },
);
assert(oneMFlash.total === 0.88, "1M DeepSeek tokens must not be billed as Kimi Fast");

const unknown = calculateLlmCostDetails(
  { input: 1_000_000, output: 0 },
  { model: "accounts/fireworks/models/mystery" },
);
assert(unknown.input === 4.5, "unknown models must overestimate using Kimi Fast, not the old $0.22 table");

const ttsUnknown = calculateTtsCostDetails(1000);
assert(ttsUnknown.total === TTS_RATE_DEFAULTS.unknown, "unknown TTS overestimates on Multilingual, not Flash");
assert(resolveTtsRateLane("eleven_flash_v2_5") === "flash", "Flash v2.5 is the $0.05 lane");
assert(resolveTtsRateLane("eleven_multilingual_v2") === "multilingual", "Multilingual v2 is the $0.10 lane");
assert(calculateTtsCostDetails(1000, { model: "eleven_flash_v2_5" }).total === 0.05, "Flash is $0.05 / 1k");
assert(
  calculateTtsCostDetails(1000, { model: "eleven_multilingual_v2" }).total === 0.1,
  "Multilingual is $0.10 / 1k",
);

const jev = calculateLlmCostDetails(
  { input: 1_000_000, output: 1_000_000 },
  { model: "typesafe-ai/jev" },
);
assert(resolveLlmRateLane("typesafe-ai/jev") === "jev", "Jev must not use the Kimi Fast fallback");
assert(jev.input === 0.042 && jev.output === 0 && jev.total === 0.042, "Jev is $0.042 / 1M input and free output");

const cachedFast = calculateLlmCostDetails(
  { input: 1_000_000, cachedInput: 1_000_000, output: 0 },
  { model: DEFAULT_FIREWORKS_FAST_MODEL },
);
assert(cachedFast.input === 0.45 && cachedFast.total === 0.45, "a full Kimi Fast cache hit is $0.45 / 1M, not $4.50");

const mixedFast = calculateLlmCostDetails(
  { input: 2_000_000, cachedInput: 1_000_000, output: 0 },
  { model: DEFAULT_FIREWORKS_FAST_MODEL },
);
assert(mixedFast.total === 4.95, "only the cache-hit portion gets the cached rate");

console.log("✓ per-model usageCost rates (Kimi Fast, Kimi K3, DeepSeek Flash, Qwen vision, Jev, TTS)");
