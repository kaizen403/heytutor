import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  acceptedLabResponseModels,
  assertLabModelProfile,
  buildLabModelProfile,
  expectedLabRequestModel,
  labModelProfilesMatch,
} from "../../lib/llm/labModelProfile";
import { DEFAULT_CHEAP_FIREWORKS_MODEL, DEFAULT_FIREWORKS_MODEL, DEFAULT_FIREWORKS_FAST_MODEL } from "../../lib/llm/fireworksModels";
import type { LlmEndpoint } from "../../lib/llm/llmProvider";
import { LLM_RATE_DEFAULTS, type LlmRateLane, type resolveLlmRates } from "../../lib/obs/usageCost";

const endpoint: LlmEndpoint = { provider: "fireworks", deployment: null, apiKey: "synthetic-key-do-not-expose",
  fallbackReason: null, url: "https://synthetic.invalid/chat" };
const ratesForModel: typeof resolveLlmRates = (model) => {
  const lane: LlmRateLane = model === "synthetic-azure-deployment" ? "gpt-6.1-sol"
    : model === DEFAULT_FIREWORKS_MODEL ? "kimi-k3"
    : model === DEFAULT_FIREWORKS_FAST_MODEL ? "kimi-k3-fast"
    : model === DEFAULT_CHEAP_FIREWORKS_MODEL ? "deepseek-flash" : "unknown";
  return { lane, ...LLM_RATE_DEFAULTS[lane === "unknown" ? "kimi-k3-fast" : lane] };
};
const build = (env: Record<string, string | undefined> = {}, selectedEndpoint = endpoint, fastMode?: boolean) =>
  buildLabModelProfile({ endpoint: selectedEndpoint, env, ratesForModel, fastMode });

const fireworks = build();
assert.deepEqual(fireworks.models, { planner: DEFAULT_FIREWORKS_MODEL, problemIR: DEFAULT_FIREWORKS_MODEL,
  teaching: DEFAULT_FIREWORKS_MODEL, picker: DEFAULT_CHEAP_FIREWORKS_MODEL });
assert.equal(fireworks.fastMode, false);
assert.equal(fireworks.deployment, null);
assert.equal(fireworks.rates.planner.inputUsdPer1M, 3);
assert.equal(fireworks.rates.picker.outputUsdPer1M, 0.66);
assert(!JSON.stringify(fireworks).includes(endpoint.apiKey!), "public profile cannot expose the provider key");

const overridden = build({ LLM_PROVIDER: "fireworks", FIREWORKS_MODEL: "configured-fast-planner",
  FIREWORKS_FAST_MODEL: "configured-fast-router", FIREWORKS_TEACHING_MODEL: "configured-teacher",
  FIREWORKS_TEACHING_FAST_MODEL: "configured-fast-teacher", FIREWORKS_PROBLEM_IR_MODEL: DEFAULT_FIREWORKS_MODEL,
  FIREWORKS_CHEAP_MODEL: "unused-cheap-override" });
assert.deepEqual(overridden.models, { planner: DEFAULT_FIREWORKS_MODEL, problemIR: DEFAULT_FIREWORKS_MODEL,
  teaching: DEFAULT_FIREWORKS_MODEL, picker: DEFAULT_FIREWORKS_MODEL },
"authenticated standard evaluation overrides ordinary lane envs while the picker keeps its actual resolver");

const azureEndpoint: LlmEndpoint = { ...endpoint, provider: "azure", deployment: "synthetic-azure-deployment" };
const azure = build({ LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://synthetic.invalid",
  AZURE_OPENAI_API_KEY: "synthetic-key", AZURE_OPENAI_DEPLOYMENT: "synthetic-azure-deployment" }, azureEndpoint);
assert.deepEqual(Object.values(azure.models), Array(4).fill("synthetic-azure-deployment"));
assert.equal(azure.rates.picker.lane, "gpt-6.1-sol");

const plannerHeaders: Record<string, string>[] = [
  { "x-planner": "1", "x-turn-planner-version": "3" },
  { "x-planner": "1", "x-scene-planner-version": "2" },
];
for (const headers of plannerHeaders) assert.equal(expectedLabRequestModel(fireworks, new Headers(headers)), fireworks.models.planner);
assert.equal(expectedLabRequestModel(fireworks, new Headers({ "x-planner": "1", "x-problem-ir-version": "1" })), fireworks.models.problemIR);
assert.equal(expectedLabRequestModel(fireworks, new Headers({ "x-planner": "1", "x-problem-ir-version": "1", "x-diagram-example-picker": "1" })), fireworks.models.picker, "picker identity has precedence over generic planner and IR headers");
assert.equal(expectedLabRequestModel(fireworks, new Headers()), fireworks.models.teaching);

for (const rejected of [
  { ...endpoint, apiKey: undefined }, { ...endpoint, apiKey: "  " },
  { ...endpoint, fallbackReason: "incomplete Azure fallback" }, { ...azureEndpoint, deployment: null },
]) assert.throws(() => build({}, rejected), /configured|key|fallback|deployment/i);
assert.throws(() => build({ FIREWORKS_PROBLEM_IR_MODEL: "unknown-model" }), /unknown|rate|price/i);
for (const invalidPicker of [
  { ...fireworks, rates: { ...fireworks.rates, picker: fireworks.rates.planner } },
  { ...fireworks, models: { ...fireworks.models, picker: "unknown-model" } },
  { ...fireworks, models: { ...fireworks.models, picker: DEFAULT_FIREWORKS_FAST_MODEL },
    rates: { ...fireworks.rates, picker: { lane: "kimi-k3-fast", ...LLM_RATE_DEFAULTS["kimi-k3-fast"] } } },
]) assert.throws(() => assertLabModelProfile(invalidPicker), /picker|model|rate|price/i,
  "a picker must have an exact supported identity and its corresponding price lane");
for (const value of ["NaN", "Infinity", "-1", "0", "3garbage", " "]) {
  assert.throws(() => build({ FIREWORKS_KIMI_K3_INPUT_USD_PER_1M: value }), /rate|price/i, `reject invalid configured rate ${value}`);
}
assert.throws(() => buildLabModelProfile({ endpoint, env: {}, ratesForModel: (model) => ({ ...ratesForModel(model), outputUsdPer1M: -1 }) }), /rate|price/i);

const currentRates = buildLabModelProfile({ endpoint,
  env: { FIREWORKS_DEEPSEEK_FLASH_INPUT_USD_PER_1M: "0.30", FIREWORKS_DEEPSEEK_FLASH_OUTPUT_USD_PER_1M: "1.20", FIREWORKS_DEEPSEEK_FLASH_CACHED_INPUT_USD_PER_1M: "0.006" },
  ratesForModel: (model) => model === DEFAULT_CHEAP_FIREWORKS_MODEL
    ? { lane: "deepseek-flash", inputUsdPer1M: 0.30, outputUsdPer1M: 1.20, cachedInputUsdPer1M: 0.006 }
    : ratesForModel(model),
});
assert.deepEqual(currentRates.rates.picker, { lane: "deepseek-flash", inputUsdPer1M: 0.30, outputUsdPer1M: 1.20, cachedInputUsdPer1M: 0.006 });
assert(labModelProfilesMatch(currentRates, structuredClone(currentRates)), "exact JSON-roundtripped model/rate profile matches");
assert(!labModelProfilesMatch(fireworks, currentRates), "price changes reject the server/local match");
assert(!labModelProfilesMatch(fireworks, overridden), "picker override changes reject the server/local match");
assert(!labModelProfilesMatch(azure, { ...azure, deployment: "other-deployment" }));
for (const malformed of [null, {}, { ...fireworks, fastMode: "false" }, { ...fireworks, models: {} },
  { ...fireworks, rates: { ...fireworks.rates, picker: { ...fireworks.rates.picker, lane: "unknown" } } },
  { ...fireworks, rates: { ...fireworks.rates, planner: { ...fireworks.rates.planner, cachedInputUsdPer1M: Infinity } } },
]) {
  assert.throws(() => assertLabModelProfile(malformed), /profile|model|rate|price|fast/i);
  assert(!labModelProfilesMatch(fireworks, malformed), "malformed server config fails closed before dispatch");
}
assert.doesNotThrow(() => assertLabModelProfile(fireworks));
assert.equal(build({}, endpoint, false).fastMode, false, "standard stays the default identity");

// Fast: production's Fireworks routing (Kimi K3 Fast router in planner, ProblemIR and teaching).
const fast = build({}, endpoint, true);
assert.equal(fast.fastMode, true);
assert.deepEqual(fast.models, { planner: DEFAULT_FIREWORKS_FAST_MODEL, problemIR: DEFAULT_FIREWORKS_FAST_MODEL,
  teaching: DEFAULT_FIREWORKS_FAST_MODEL, picker: DEFAULT_CHEAP_FIREWORKS_MODEL });
for (const lane of ["planner", "problemIR", "teaching"] as const) {
  assert.deepEqual(fast.rates[lane], { lane: "kimi-k3-fast", ...LLM_RATE_DEFAULTS["kimi-k3-fast"] }, `${lane} uses Fast rates`);
}
assert.equal(fast.rates.planner.inputUsdPer1M, 4.5);
assert.equal(fast.rates.planner.outputUsdPer1M, 22.5);
assert.equal(fast.rates.planner.cachedInputUsdPer1M, 0.45);
assert.equal(fast.rates.picker.lane, "deepseek-flash");
assert(labModelProfilesMatch(fast, structuredClone(fast)), "exact Fast profile matches itself");
assert(!labModelProfilesMatch(fast, fireworks) && !labModelProfilesMatch(fireworks, fast), "Fast and standard never match");
assert.equal(expectedLabRequestModel(fast, new Headers({ "x-planner": "1", "x-problem-ir-version": "1" })), DEFAULT_FIREWORKS_FAST_MODEL);
assert.equal(expectedLabRequestModel(fast, new Headers({ "x-planner": "1", "x-diagram-example-picker": "1" })), DEFAULT_CHEAP_FIREWORKS_MODEL);
assert.equal(expectedLabRequestModel(fast, new Headers()), DEFAULT_FIREWORKS_FAST_MODEL);
assert.throws(() => build({}, azureEndpoint, true), /Fast mode requires the Fireworks provider/);
for (const env of [
  { FIREWORKS_FAST_MODEL: DEFAULT_FIREWORKS_MODEL }, { FIREWORKS_TEACHING_FAST_MODEL: "configured-fast-teacher" },
  { FIREWORKS_PROBLEM_IR_MODEL: DEFAULT_FIREWORKS_MODEL }, { FIREWORKS_PROBLEM_IR_MODEL: "unknown-model" },
  { FIREWORKS_KIMI_FAST_INPUT_USD_PER_1M: "garbage" },
]) assert.throws(() => build(env, endpoint, true), /model|rate|price|router|unknown/i, `Fast rejects an unsupported identity ${Object.keys(env)[0]}`);
for (const malformed of [
  { ...fast, models: { ...fast.models, planner: DEFAULT_FIREWORKS_MODEL } },
  { ...fast, rates: { ...fast.rates, problemIR: fireworks.rates.problemIR } },
  { ...fast, models: { ...fast.models, teaching: DEFAULT_FIREWORKS_MODEL }, rates: { ...fast.rates, teaching: fireworks.rates.teaching } },
  { ...fast, provider: "azure", deployment: "synthetic-azure-deployment" },
  { ...fast, fastMode: "true" },
  { ...fireworks, fastMode: true },
]) {
  assert.throws(() => assertLabModelProfile(malformed), /profile|model|rate|price|fast/i);
  assert(!labModelProfilesMatch(fast, malformed), "mixed Fast/standard identities fail closed");
}
// M13: production may serve a Fast teaching stream from its standard K3
// fallback (429, connect failures, startup retry). The lab must accept that
// successful lesson and price it by the model served, for teaching only.
assert.equal(fast.teachingAlternate?.model, DEFAULT_FIREWORKS_MODEL, "M13: the Fast profile records production's teaching fallback");
assert.equal(fast.teachingAlternate?.rates.lane, "kimi-k3", "M13: the fallback is priced as standard K3");
assert.equal(fireworks.teachingAlternate ?? null, null, "M13: a standard profile has no teaching fallback");
const teachingHeaders = new Headers({ "x-heytutor-trace-id": "t" });
assert.deepEqual(acceptedLabResponseModels(fast, teachingHeaders), [fast.models.teaching, DEFAULT_FIREWORKS_MODEL],
  "M13: a Fast teaching response may name the Fast router or the standard fallback");
for (const lane of [{ "x-planner": "1" }, { "x-planner": "1", "x-problem-ir-version": "1" }, { "x-diagram-example-picker": "1" }] as Record<string, string>[]) {
  assert.deepEqual(acceptedLabResponseModels(fast, new Headers(lane)), [expectedLabRequestModel(fast, new Headers(lane))],
    "M13: planner, ProblemIR and picker responses must name exactly their expected model");
}
assert.deepEqual(acceptedLabResponseModels(fireworks, teachingHeaders), [DEFAULT_FIREWORKS_MODEL], "M13: standard teaching accepts only standard K3");
for (const malformed of [
  { ...fast, teachingAlternate: null },
  { ...fast, teachingAlternate: { model: "configured-teacher", rates: fast.teachingAlternate!.rates } },
  { ...fast, teachingAlternate: { ...fast.teachingAlternate!, rates: { ...fast.teachingAlternate!.rates, outputUsdPer1M: fast.rates.teaching.outputUsdPer1M + 1 } } },
  { ...fireworks, teachingAlternate: fast.teachingAlternate },
]) {
  assert.throws(() => assertLabModelProfile(malformed), /fallback/i, "M13: a missing, overridden, overpriced or standard-profile fallback fails before dispatch");
  assert(!labModelProfilesMatch(fast, malformed) || malformed === fast, "M13: a different fallback is a different identity");
}
assert(!labModelProfilesMatch(fast, { ...fast, teachingAlternate: { ...fast.teachingAlternate!, rates: { ...fast.teachingAlternate!.rates, inputUsdPer1M: 0.5 } } }),
  "M13: CLI and server must agree on the fallback's price");
{
  // The runner's response check must use the accepted list, not one model.
  const runner = readFileSync(new URL("../lecture-lab/run.ts", import.meta.url), "utf8");
  assert(/acceptedLabResponseModels\(modelProfile, headers\)/.test(runner) && /!\(servedModel !== null && acceptedModels\.includes\(servedModel\)\)/.test(runner),
    "M13: the runner checks the served model against acceptedLabResponseModels");
  assert(!/"x-heytutor-model"\) !== requestModel\)/.test(runner), "M13: the old single-model response check is gone");
}
console.log("lab model profile GREEN: standard Fireworks/Azure and Fireworks Fast identities, per-request models, effective rates and fail-closed preflight; no network or environment changes");
