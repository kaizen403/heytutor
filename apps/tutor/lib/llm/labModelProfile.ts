import {
  DEFAULT_CHEAP_FIREWORKS_MODEL, DEFAULT_FIREWORKS_FAST_MODEL, DEFAULT_FIREWORKS_MODEL, DEFAULT_PROBLEM_IR_MODEL,
  DEFAULT_TEACHING_FAST_MODEL, DEFAULT_TEACHING_RETRY_MODEL, resolveCheapFireworksModel, resolveFireworksModel,
  resolveProblemIRFireworksModel, resolveTeachingAlternateFireworksModel, resolveTeachingFireworksModel,
} from "./fireworksModels";
import type { LlmEndpoint, LlmProviderName } from "./llmProvider";
import { resolveLlmRates } from "../obs/usageCost";

const MODEL_LANES = ["planner", "problemIR", "teaching", "picker"] as const;
type ModelLane = (typeof MODEL_LANES)[number];
type Rates = ReturnType<typeof resolveLlmRates>;
type ProfileRateLane = "gpt-6.1-sol" | "openai-compat" | "kimi-k3" | "kimi-k3-fast" | "deepseek-flash";
type Env = Readonly<Record<string, string | undefined>>;

/**
 * Effective authenticated evaluation routing, with no secret fields. Standard
 * pins every paid lane to Kimi K3; Fast (Fireworks only) is the production
 * routing: the Kimi K3 Fast router for planner, ProblemIR and teaching.
 */
export interface LabModelProfile {
  version: "lab-model-profile/v1";
  provider: LlmProviderName;
  deployment: string | null;
  fastMode: boolean;
  models: Record<ModelLane, string>;
  rates: Record<ModelLane, Rates>;
  /**
   * Fast only: production's teaching fallback (standard K3), which serves a
   * teaching stream after a 429, repeated connect failures, or a startup retry.
   * Its rates never exceed the Fast teaching rates, so the Fast reservation
   * covers it. Absent or null on standard and Azure profiles.
   */
  teachingAlternate?: { model: string; rates: Rates } | null;
}

const RATE_PREFIXES: Record<ProfileRateLane, string> = {
  "gpt-6.1-sol": "AZURE_GPT_SOL", "openai-compat": "OPENAI_COMPAT",
  "kimi-k3": "FIREWORKS_KIMI_K3", "kimi-k3-fast": "FIREWORKS_KIMI_FAST", "deepseek-flash": "FIREWORKS_DEEPSEEK_FLASH",
};
const RATE_FIELDS = [
  ["inputUsdPer1M", "INPUT_USD_PER_1M"], ["outputUsdPer1M", "OUTPUT_USD_PER_1M"],
  ["cachedInputUsdPer1M", "CACHED_INPUT_USD_PER_1M"],
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireProfile(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(`invalid lab model profile: ${detail}`);
}

/** Fast profile lane models: the production router ids, never an env override. */
const FAST_LANE_MODELS: Record<Exclude<ModelLane, "picker">, string> = {
  planner: DEFAULT_FIREWORKS_FAST_MODEL, problemIR: DEFAULT_PROBLEM_IR_MODEL, teaching: DEFAULT_TEACHING_FAST_MODEL,
};

/** Reject an unpriced, malformed, or unknown profile before reserving/dispatching. */
export function assertLabModelProfile(value: unknown): asserts value is LabModelProfile {
  requireProfile(record(value), "profile must be an object");
  requireProfile(value.version === "lab-model-profile/v1", "unsupported profile version");
  requireProfile(value.provider === "azure" || value.provider === "openai_compat" || value.provider === "fireworks", "unsupported provider");
  // Azure and a relay both serve every lane from one model.
  const single = value.provider !== "fireworks";
  requireProfile(typeof value.fastMode === "boolean", "fastMode must be a boolean");
  const fast = value.fastMode === true;
  requireProfile(!fast || value.provider === "fireworks", "Fast mode is a Fireworks evaluation profile only");
  requireProfile(record(value.models) && record(value.rates), "models and rates are required");
  if (single) requireProfile(typeof value.deployment === "string" && Boolean(value.deployment.trim()), `${value.provider} deployment is required`);
  else requireProfile(value.deployment === null, "Fireworks deployment must be null");
  for (const lane of MODEL_LANES) {
    const model = value.models[lane];
    requireProfile(typeof model === "string" && Boolean(model.trim()) && model === model.trim(), `${lane} model is required`);
    if (single) requireProfile(model === value.deployment, `${value.provider} lane model must match deployment`);
    else if (lane !== "picker" && fast) requireProfile(model === FAST_LANE_MODELS[lane], `${lane} model must use the production Fast router`);
    else if (lane !== "picker") requireProfile(model === DEFAULT_FIREWORKS_MODEL, `${lane} model must use authenticated standard routing`);
    const rates = value.rates[lane];
    requireProfile(record(rates) && typeof rates.lane === "string" && Object.hasOwn(RATE_PREFIXES, rates.lane), `${lane} has unknown price lane`);
    // This evaluation supports standard K3, the K3 Fast router and cheap Flash,
    // including the existing IR override that also sends the picker to standard K3.
    const expectedRateLane = value.provider === "azure" ? "gpt-6.1-sol"
      : value.provider === "openai_compat" ? "openai-compat"
      : lane !== "picker" && fast ? "kimi-k3-fast"
      : lane !== "picker" || model === DEFAULT_FIREWORKS_MODEL ? "kimi-k3"
        : model === DEFAULT_CHEAP_FIREWORKS_MODEL ? "deepseek-flash" : null;
    requireProfile(expectedRateLane !== null && rates.lane === expectedRateLane, `${lane} model and price lane must match the supported evaluation identity`);
    for (const [field] of RATE_FIELDS) requireProfile(typeof rates[field] === "number" && Number.isFinite(rates[field])
      && (field === "cachedInputUsdPer1M" ? rates[field] >= 0 : rates[field] > 0), `${lane} has an invalid rate`);
    requireProfile((rates.cachedInputUsdPer1M as number) <= (rates.inputUsdPer1M as number), `${lane} cached rate exceeds input rate`);
  }
  const alternate = value.teachingAlternate ?? null;
  if (!fast) {
    requireProfile(alternate === null, "only a Fast profile has a teaching fallback");
    return;
  }
  requireProfile(record(alternate), "a Fast profile records production's teaching fallback");
  requireProfile(alternate.model === DEFAULT_TEACHING_RETRY_MODEL, "teaching fallback must be production's standard K3");
  const alternateRates = alternate.rates;
  const teachingRates = (value.rates as Record<string, Record<string, unknown>>).teaching!;
  requireProfile(record(alternateRates) && alternateRates.lane === "kimi-k3", "teaching fallback must use the standard K3 price lane");
  for (const [field] of RATE_FIELDS) {
    requireProfile(typeof alternateRates[field] === "number" && Number.isFinite(alternateRates[field])
      && (alternateRates[field] as number) >= 0, `teaching fallback has an invalid ${field}`);
    // The Fast teaching reservation is the ceiling for either serving path.
    requireProfile((alternateRates[field] as number) <= (teachingRates[field] as number), `teaching fallback ${field} exceeds the Fast teaching rate`);
  }
}

/**
 * The endpoint and env are supplied by the caller; tests need no process-env
 * mutation. The production resolver remains the only source of effective rates.
 */
export function buildLabModelProfile(input: {
  endpoint: LlmEndpoint;
  env: Env;
  ratesForModel?: typeof resolveLlmRates;
  /** Fireworks Fast routing as production resolves it; standard by default. */
  fastMode?: boolean;
}): LabModelProfile {
  const { endpoint, env } = input;
  const fastMode = input.fastMode === true;
  if (fastMode && endpoint.provider !== "fireworks") throw new Error("lab Fast mode requires the Fireworks provider");
  if (!endpoint.apiKey?.trim() || endpoint.fallbackReason) throw new Error("lab requires a configured provider key without fallback");
  const single = endpoint.provider !== "fireworks";
  if (single && !endpoint.deployment?.trim()) throw new Error(`lab requires a configured ${endpoint.provider} deployment`);
  // A relay's default prices are a guess at its upstream. A capped round needs
  // real ones, and measures the relay alone: an open circuit would quietly
  // send rows to Fireworks.
  if (endpoint.provider === "openai_compat") {
    const unpriced = ["OPENAI_COMPAT_INPUT_USD_PER_1M", "OPENAI_COMPAT_CACHED_INPUT_USD_PER_1M", "OPENAI_COMPAT_OUTPUT_USD_PER_1M"]
      .filter((key) => !env[key]?.trim());
    if (unpriced.length > 0) throw new Error(`lab requires explicit relay prices: set ${unpriced.join(", ")}`);
    if (env.OPENAI_COMPAT_FALLBACK?.trim().toLowerCase() !== "off") throw new Error("lab requires OPENAI_COMPAT_FALLBACK=off so every row runs on the relay");
  }
  const standard = single ? endpoint.deployment! : DEFAULT_FIREWORKS_MODEL;
  // Fast uses the same resolvers as an ordinary production request (no
  // standard-evaluation header); the assertion rejects any lane override.
  const models: LabModelProfile["models"] = fastMode
    ? { planner: resolveFireworksModel({ fastMode: true, env }), problemIR: resolveProblemIRFireworksModel({ env }),
        teaching: resolveTeachingFireworksModel({ fastMode: true, env }), picker: resolveCheapFireworksModel({ env }) }
    : { planner: standard, problemIR: standard, teaching: standard,
        picker: single ? standard : resolveCheapFireworksModel({ env }) };
  const rateResolver = input.ratesForModel ?? resolveLlmRates;
  const alternateModel = fastMode ? resolveTeachingAlternateFireworksModel({ fastMode: true, env }) : null;
  const profile: LabModelProfile = { version: "lab-model-profile/v1", provider: endpoint.provider,
    deployment: endpoint.deployment, fastMode, models,
    rates: { planner: rateResolver(models.planner), problemIR: rateResolver(models.problemIR),
      teaching: rateResolver(models.teaching), picker: rateResolver(models.picker) },
    teachingAlternate: alternateModel ? { model: alternateModel, rates: rateResolver(alternateModel) } : null };
  assertLabModelProfile(profile);
  // usageCost tolerates malformed overrides by falling back. A claimed hard
  // evaluation cap instead rejects them, without exposing their raw contents.
  for (const lane of MODEL_LANES) {
    const rates = profile.rates[lane];
    const prefix = RATE_PREFIXES[rates.lane as ProfileRateLane];
    for (const [field, suffix] of RATE_FIELDS) {
      const raw = env[`${prefix}_${suffix}`];
      if (raw === undefined || raw === "") continue;
      const parsed = Number(raw);
      requireProfile(Boolean(raw.trim()) && Number.isFinite(parsed) && parsed === rates[field]
        && (field === "cachedInputUsdPer1M" ? parsed >= 0 : parsed > 0), `${lane} has an invalid configured price`);
    }
  }
  return profile;
}

/** Request-kind precedence mirrors the authenticated chat route. */
export function expectedLabRequestModel(profile: LabModelProfile, headers: Headers): string {
  if (headers.get("x-diagram-example-picker") === "1") return profile.models.picker;
  if (headers.get("x-problem-ir-version") === "1") return profile.models.problemIR;
  return headers.get("x-planner") === "1" ? profile.models.planner : profile.models.teaching;
}

/**
 * Server models a successful response may name. Teaching on a Fast profile may
 * be served by production's teaching fallback; every other request kind must
 * name exactly the expected model.
 */
export function acceptedLabResponseModels(profile: LabModelProfile, headers: Headers): string[] {
  const expected = expectedLabRequestModel(profile, headers);
  const teaching = headers.get("x-diagram-example-picker") !== "1" && headers.get("x-problem-ir-version") !== "1"
    && headers.get("x-planner") !== "1";
  const alternate = profile.fastMode && teaching ? profile.teachingAlternate?.model ?? null : null;
  return alternate && alternate !== expected ? [expected, alternate] : [expected];
}

/** Exact identities and effective prices bind CLI/server and resumed evidence. */
export function labModelProfilesMatch(local: unknown, remote: unknown): boolean {
  try {
    assertLabModelProfile(local);
    assertLabModelProfile(remote);
    return local.version === remote.version && local.provider === remote.provider
      && local.deployment === remote.deployment && local.fastMode === remote.fastMode
      && MODEL_LANES.every((lane) => local.models[lane] === remote.models[lane]
        && local.rates[lane].lane === remote.rates[lane].lane
        && RATE_FIELDS.every(([field]) => local.rates[lane][field] === remote.rates[lane][field]))
      && sameAlternate(local.teachingAlternate ?? null, remote.teachingAlternate ?? null);
  } catch {
    return false;
  }
}

function sameAlternate(a: LabModelProfile["teachingAlternate"] | null, b: LabModelProfile["teachingAlternate"] | null): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return a.model === b.model && a.rates.lane === b.rates.lane
    && RATE_FIELDS.every(([field]) => a.rates[field] === b.rates[field]);
}
