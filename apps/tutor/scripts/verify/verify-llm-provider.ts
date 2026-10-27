import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import type { SpendActor } from "../../lib/billing/actor";
import type { PeriodBalance } from "../../lib/billing/ledgerMath";

// One switch, three providers. `LLM_PROVIDER=fireworks` (or unset) must be
// today's Kimi K3 behaviour exactly; `LLM_PROVIDER=azure` must send every lane
// to the one Azure deployment with a body the model accepts; and an Azure
// setting with a missing variable must log once and stay on Fireworks.
// `LLM_PROVIDER=openai_compat` (a relay such as tokens-flow) behaves like
// Azure, and its circuit breaker must move new requests to Fireworks when the
// relay blocks the key or keeps failing.
//
// The route section runs the real chat route, billing gate, grants and
// reservations; it fakes only authentication, persistence, telemetry and the
// provider. It needs module mocks, so a plain `tsx` run re-executes itself.
if (typeof mock.module !== "function") {
  const child = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", fileURLToPath(import.meta.url)],
    { stdio: "inherit", env: process.env },
  );
  process.exit(child.status ?? 1);
}

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const path = (relativePath: string) => resolve(root, relativePath);
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const originalConsoleError = console.error;

// Start from a clean provider environment whatever the shell exported.
for (const key of Object.keys(process.env)) {
  if (key === "LLM_PROVIDER" || key === "DIAGRAM_PLANNER_PRIORITY" || key.startsWith("AZURE_OPENAI_") || key.startsWith("FIREWORKS_") || key.startsWith("OPENAI_COMPAT_")) delete process.env[key];
}
process.env.FIREWORKS_API_KEY = "fireworks-test-key";
process.env.BILLING_PROVIDER = "";
process.env.AUTUMN_ENABLED = "0";
globalThis.fetch = async () => {
  throw new Error("External network is prohibited in provider verification");
};

const AZURE = {
  LLM_PROVIDER: "azure",
  AZURE_OPENAI_ENDPOINT: "https://heytutor-test.cognitiveservices.azure.com/",
  AZURE_OPENAI_API_KEY: "azure-test-key",
  AZURE_OPENAI_DEPLOYMENT: "gpt-6-1-sol",
};
const AZURE_URL = "https://heytutor-test.cognitiveservices.azure.com/openai/v1/chat/completions";
const RELAY = {
  LLM_PROVIDER: "openai_compat",
  OPENAI_COMPAT_BASE_URL: "https://relay.test/v1/",
  OPENAI_COMPAT_API_KEY: "relay-test-key",
  OPENAI_COMPAT_MODEL: "gpt-6.1-sol",
};
const RELAY_URL = "https://relay.test/v1/chat/completions";
const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

mock.module(resolve(root, "../../packages/tutor-core/src/index.ts"), {
  namedExports: {
    HEYTUTOR_TRACE_ID_HEADER: "x-heytutor-trace-id",
    HEYTUTOR_QUESTION_HEADER: "x-heytutor-question",
    readTraceIdHeader: (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed && trimmed.length <= 128 && /^[\w.:-]+$/.test(trimmed) ? trimmed : undefined;
    },
    readQuestionHeader: (value?: string | null) =>
      value ? decodeURIComponent(value).trim().slice(0, 2000) : undefined,
    parseFastModeHeader: (value?: string | null) => value !== "0" && value?.toLowerCase() !== "false",
    parseReasoningMode: () => "medium",
    resolveReasoningEffort: () => "medium",
    tutorDebug: () => undefined,
    getMockResponse: () => {
      throw new Error("Configured provider verification cannot use mock lessons");
    },
    getMockCodeLessonPlan: () => {
      throw new Error("Configured provider verification cannot use mock code lessons");
    },
  },
});

let actor: SpendActor;
let remaining = 0;
let testNumber = 0;
const reservations = new Map<string, number>();
const ownedTraces = new Map<string, { userId: string; expiresAt: Date }>();
const generations: { model?: string; metadata?: Record<string, unknown> }[] = [];

function periodBalance(): PeriodBalance {
  return {
    period: "2026-10",
    planId: "free",
    spentMillicents: 0,
    bonusMillicents: 0,
    allowanceMillicents: 10_000_000,
    remainingMillicents: remaining,
    remainingPct: 100,
    nextResetAt: Date.now() + 86_400_000,
  };
}

mock.module(path("lib/billing/actor.ts"), {
  namedExports: {
    requireSpendActor: async () => actor,
    isSpendActor: (value: unknown) => !(value instanceof Response),
  },
});
mock.module(path("lib/db/prisma.ts"), {
  namedExports: {
    prisma: {
      user: { findUnique: async () => ({ id: actor.userId, planId: "free" }) },
      board: { findUnique: async () => null },
      ownedTrace: {
        createMany: async ({ data }: { data: { traceId: string; userId: string; expiresAt: Date }[] }) => {
          for (const row of data) if (!ownedTraces.has(row.traceId)) ownedTraces.set(row.traceId, row);
          return { count: data.length };
        },
        findUnique: async ({ where }: { where: { traceId: string } }) => ownedTraces.get(where.traceId) ?? null,
        deleteMany: async () => ({ count: 0 }),
      },
    },
  },
});
mock.module(path("lib/billing/ledger.ts"), {
  namedExports: {
    loadPeriodBalance: async () => periodBalance(),
    cacheUsageOnUser: async () => undefined,
    addPeriodSpend: async () => periodBalance(),
    reservePeriodUsage: async ({ millicents }: { millicents: number }) => {
      if (millicents <= 0 || millicents > remaining) return null;
      const id = `reservation-${testNumber}-${reservations.size}`;
      reservations.set(id, millicents);
      remaining -= millicents;
      return { id, amountMillicents: millicents, remainingMillicents: remaining, planId: "free" };
    },
    settlePeriodUsage: async ({ reservationId, actualMillicents }: { reservationId: string; actualMillicents?: number }) => {
      const reserved = reservations.get(reservationId) ?? 0;
      remaining += reserved - Math.min(reserved, actualMillicents ?? reserved);
      reservations.delete(reservationId);
    },
  },
});
mock.module(path("lib/obs/langfuse.ts"), {
  namedExports: {
    genTraceId: () => `server-trace-${testNumber}`,
    startTurnTrace: ({ model }: { model?: string }) => ({ model }),
    endLlmGeneration: (_turn: unknown, params: { metadata?: Record<string, unknown>; model?: string }) => {
      generations.push({ model: params.model, metadata: params.metadata });
    },
    flushInBackground: () => undefined,
  },
});

const provider = load(path("lib/llm/llmProvider.ts")) as typeof import("../../lib/llm/llmProvider");
const models = load(path("lib/llm/fireworksModels.ts")) as typeof import("../../lib/llm/fireworksModels");
const planner = load(path("lib/llm/plannerTransport.ts")) as typeof import("../../lib/llm/plannerTransport");
const teaching = load(path("lib/llm/teachingTransport.ts")) as typeof import("../../lib/llm/teachingTransport");
const notes = load(path("lib/llm/notesChatPolicy.ts")) as typeof import("../../lib/llm/notesChatPolicy");
const usageCost = load(path("lib/obs/usageCost.ts")) as typeof import("../../lib/obs/usageCost");
const providerUsage = load(path("lib/obs/providerUsage.ts")) as typeof import("../../lib/obs/providerUsage");
const chatTrace = load(path("lib/obs/chatTrace.ts")) as typeof import("../../lib/obs/chatTrace");
const runCost = load(path("lib/obs/runCost.ts")) as typeof import("../../lib/obs/runCost");
const flags = load(path("lib/billing/flags.ts")) as typeof import("../../lib/billing/flags");
const paidUsage = load(path("lib/billing/paidUsage.ts")) as typeof import("../../lib/billing/paidUsage");
const grants = load(path("lib/billing/grant.ts")) as typeof import("../../lib/billing/grant");
const fuses = load(path("lib/billing/fuses.ts")) as typeof import("../../lib/billing/fuses");
const labProfile = load(path("lib/llm/labModelProfile.ts")) as typeof import("../../lib/llm/labModelProfile");
const failedTurns = load(path("lib/obs/failedTurnTelemetry.ts")) as typeof import("../../lib/obs/failedTurnTelemetry");
const chat = load(path("app/api/chat/route.ts")) as typeof import("../../app/api/chat/route");

type Env = Record<string, string | undefined>;

/** Every lane the switch owns, resolved for one environment. */
function laneSnapshot(env: Env): Record<string, unknown> {
  const route = (fastMode: boolean | undefined, startupRetry: "first_content_timeout" | null = null) =>
    teaching.resolveTeachingModelRoute(env, { fastMode, startupRetry });
  return {
    planner: models.resolveFireworksModel({ env }),
    plannerFast: models.resolveFireworksModel({ env, fastMode: true }),
    plannerSlow: models.resolveFireworksModel({ env, fastMode: false }),
    plannerModels: planner.resolvePlannerModels({ semanticSceneV2: false, turnPlanV3: true, plannerPhase: "plan", fastMode: true, env }),
    problemIR: planner.resolvePlannerModels({ semanticSceneV2: false, turnPlanV3: false, problemIRV1: true, plannerPhase: "plan", fastMode: false, env }),
    teaching: models.resolveTeachingFireworksModel({ env }),
    teachingFast: models.resolveTeachingFireworksModel({ env, fastMode: true }),
    teachingSlow: models.resolveTeachingFireworksModel({ env, fastMode: false }),
    teachingAlternate: models.resolveTeachingAlternateFireworksModel({ env, fastMode: true }),
    teachingRouteFast: route(true),
    teachingRouteSlow: route(false),
    teachingRouteStartupRetry: route(true, "first_content_timeout"),
    cheap: models.resolveCheapFireworksModel({ env }),
    vision: models.resolveFireworksVisionModel(env),
    visionModels: models.resolveFireworksVisionModels(env),
    homeSuggestions: models.resolveFireworksModel({ env, fastMode: true }),
  };
}

async function notesModels(env: Env): Promise<string[]> {
  const snapshot: Parameters<typeof notes.prepareNotesChat>[0]["notes"] = { turns: [], lectureInProgress: false };
  const out: string[] = [];
  for (const mode of ["off", "cheap"]) {
    const prepared = await notes.prepareNotesChat({
      env: { ...env, TUTOR_NOTES_EVALUATION_MODE: mode },
      notes: snapshot,
      tag: null,
      userMessage: "why?",
      network: false,
    });
    out.push(prepared.model);
  }
  return out;
}

/** Fireworks override combinations a deployment may carry today. */
const FIREWORKS_ENVS: Env[] = [
  {},
  { FIREWORKS_MODEL: "fw/model" },
  { FIREWORKS_FAST_MODEL: "fw/fast", FIREWORKS_TEACHING_FAST_MODEL: "fw/teach-fast" },
  { FIREWORKS_TEACHING_MODEL: "fw/teach", FIREWORKS_TEACHING_RETRY_MODEL: "fw/retry" },
  { FIREWORKS_PROBLEM_IR_MODEL: "fw/ir", FIREWORKS_VISION_MODEL: "fw/vision", FIREWORKS_NOTES_MODEL: "fw/notes" },
];

function captureErrors<T>(run: () => T): { value: T; errors: string[] } {
  const errors: string[] = [];
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try { return { value: run(), errors }; } finally { console.error = originalConsoleError; }
}

// ---------------------------------------------------------------- pure
const unitChecks: [string, () => void | Promise<void>][] = [
  ["unset and fireworks both resolve to Fireworks with the Fireworks key", () => {
    for (const env of [{ FIREWORKS_API_KEY: "fw" }, { FIREWORKS_API_KEY: "fw", LLM_PROVIDER: "fireworks" }, { FIREWORKS_API_KEY: "fw", LLM_PROVIDER: " Fireworks ", ...{ AZURE_OPENAI_ENDPOINT: AZURE.AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY: "a", AZURE_OPENAI_DEPLOYMENT: "d" } }]) {
      const endpoint = provider.resolveLlmEndpoint(env);
      assert.deepEqual(endpoint, { provider: "fireworks", url: FIREWORKS_URL, apiKey: "fw", deployment: null, fallbackReason: null });
    }
  }],
  ["azure with every variable resolves to the deployment on the v1 API", () => {
    const endpoint = provider.resolveLlmEndpoint({ ...AZURE, FIREWORKS_API_KEY: "fw" });
    assert.deepEqual(endpoint, { provider: "azure", url: AZURE_URL, apiKey: "azure-test-key", deployment: "gpt-6-1-sol", fallbackReason: null });
    for (const pasted of ["https://heytutor-test.cognitiveservices.azure.com", "https://heytutor-test.cognitiveservices.azure.com/openai/v1/", "https://heytutor-test.cognitiveservices.azure.com/openai"]) {
      assert.equal(provider.azureChatUrl(pasted), AZURE_URL, pasted);
    }
  }],
  ["azure with a missing variable logs one clear error and stays on Fireworks", () => {
    for (const missing of provider.AZURE_ENV_KEYS) {
      const env: Env = { ...AZURE, FIREWORKS_API_KEY: "fw", [missing]: "  " };
      const first = captureErrors(() => provider.resolveLlmEndpoint(env));
      const again = captureErrors(() => provider.resolveLlmEndpoint(env));
      assert.equal(first.value.provider, "fireworks");
      assert.equal(first.value.url, FIREWORKS_URL);
      assert.equal(first.value.apiKey, "fw");
      assert.match(first.value.fallbackReason ?? "", new RegExp(missing));
      assert.equal(first.errors.length, 1, `${missing}: one error`);
      assert.match(first.errors[0]!, new RegExp(`LLM_PROVIDER=azure but ${missing} is not set; using Fireworks`));
      assert.equal(again.errors.length, 0, `${missing}: logged once per process`);
      assert.deepEqual(laneSnapshot(env), laneSnapshot({ FIREWORKS_API_KEY: "fw" }), `${missing}: every lane is Fireworks`);
    }
    const unknown = captureErrors(() => provider.resolveLlmEndpoint({ LLM_PROVIDER: "openai", FIREWORKS_API_KEY: "fw" }));
    assert.equal(unknown.value.provider, "fireworks");
    assert.equal(unknown.errors.length, 1);
  }],
  ["LLM_PROVIDER=fireworks leaves every lane exactly as an unset switch does", async () => {
    for (const base of FIREWORKS_ENVS) {
      const today = laneSnapshot(base);
      const azureVarsPresent = { ...base, AZURE_OPENAI_ENDPOINT: AZURE.AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY: "a", AZURE_OPENAI_DEPLOYMENT: "d" };
      assert.deepEqual(laneSnapshot({ ...base, LLM_PROVIDER: "fireworks" }), today, JSON.stringify(base));
      assert.deepEqual(laneSnapshot({ ...azureVarsPresent, LLM_PROVIDER: "fireworks" }), today, "Azure variables alone switch nothing");
      assert.deepEqual(await notesModels({ ...base, LLM_PROVIDER: "fireworks" }), await notesModels(base));
    }
  }],
  ["the Fireworks defaults are still Kimi K3, Kimi K3 Fast and DeepSeek Flash", async () => {
    assert.deepEqual(laneSnapshot({}), {
      planner: "accounts/fireworks/models/kimi-k3",
      plannerFast: "accounts/fireworks/routers/kimi-k3-fast",
      plannerSlow: "accounts/fireworks/models/kimi-k3",
      plannerModels: ["accounts/fireworks/routers/kimi-k3-fast"],
      problemIR: ["accounts/fireworks/routers/kimi-k3-fast"],
      teaching: "accounts/fireworks/models/kimi-k3",
      teachingFast: "accounts/fireworks/routers/kimi-k3-fast",
      teachingSlow: "accounts/fireworks/models/kimi-k3",
      teachingAlternate: "accounts/fireworks/models/kimi-k3",
      teachingRouteFast: { model: "accounts/fireworks/routers/kimi-k3-fast", alternate: "accounts/fireworks/models/kimi-k3", fallbackReason: null },
      teachingRouteSlow: { model: "accounts/fireworks/models/kimi-k3", alternate: null, fallbackReason: null },
      teachingRouteStartupRetry: { model: "accounts/fireworks/models/kimi-k3", alternate: null, fallbackReason: "startup_retry_first_content_timeout" },
      cheap: "accounts/fireworks/models/deepseek-v4p1-flash",
      vision: "accounts/fireworks/models/deepseek-v4p1-flash",
      visionModels: ["accounts/fireworks/models/deepseek-v4p1-flash"],
      homeSuggestions: "accounts/fireworks/routers/kimi-k3-fast",
    });
    assert.deepEqual(await notesModels({}), ["accounts/fireworks/routers/kimi-k3-fast", "accounts/fireworks/models/deepseek-v4p1-flash"]);
  }],
  ["LLM_PROVIDER=azure sends every lane to the deployment, whatever Fireworks overrides say", async () => {
    for (const base of FIREWORKS_ENVS) {
      const env = { ...base, ...AZURE };
      const lanes = laneSnapshot(env);
      const route = { model: "gpt-6-1-sol", alternate: null, fallbackReason: null };
      assert.deepEqual(lanes, {
        planner: "gpt-6-1-sol",
        plannerFast: "gpt-6-1-sol",
        plannerSlow: "gpt-6-1-sol",
        plannerModels: ["gpt-6-1-sol"],
        problemIR: ["gpt-6-1-sol"],
        teaching: "gpt-6-1-sol",
        teachingFast: "gpt-6-1-sol",
        teachingSlow: "gpt-6-1-sol",
        teachingAlternate: null,
        teachingRouteFast: route,
        teachingRouteSlow: route,
        teachingRouteStartupRetry: route,
        cheap: "gpt-6-1-sol",
        vision: "gpt-6-1-sol",
        visionModels: ["gpt-6-1-sol"],
        homeSuggestions: "gpt-6-1-sol",
      }, JSON.stringify(base));
      assert.deepEqual(await notesModels(env), ["gpt-6-1-sol", "gpt-6-1-sol"]);
    }
  }],
  ["Fireworks bodies pass through untouched", () => {
    const fireworks = { provider: "fireworks" as const };
    for (const body of [
      { model: "m", messages: [], thinking: { type: "disabled" }, max_tokens: 2800, temperature: 0, perf_metrics_in_response: true, n: 1 },
      { model: "m", messages: [], reasoning_effort: "none", max_tokens: 1024, temperature: 0 },
    ]) {
      const snapshot = structuredClone(body);
      assert.equal(provider.providerChatBody(body, fireworks), body);
      assert.deepEqual(body, snapshot);
    }
  }],
  ["Azure bodies: no temperature, thinking, perf flag or max_tokens; lowest reasoning; headroom added", () => {
    const azure = { provider: "azure" as const };
    const messages = [{ role: "user", content: "JSON please" }];
    // Planner with structured output.
    assert.deepEqual(provider.providerChatBody({
      model: "gpt-6-1-sol", messages, n: 1, temperature: 0, perf_metrics_in_response: true,
      thinking: { type: "disabled" }, max_tokens: 2800, stream: false, response_format: { type: "json_object" },
    }, azure, {}), {
      model: "gpt-6-1-sol", messages, n: 1, stream: false, response_format: { type: "json_object" },
      reasoning_effort: "low", max_completion_tokens: 2800 + 2048,
    });
    // Planned teaching: thinking disabled becomes the lowest effort the model accepts.
    assert.deepEqual(provider.providerChatBody({
      model: "gpt-6-1-sol", messages, n: 1, temperature: 0.3, perf_metrics_in_response: true,
      stream: true, stream_options: { include_usage: true }, thinking: { type: "disabled" }, max_tokens: 3600,
    }, azure, {}), {
      model: "gpt-6-1-sol", messages, n: 1, stream: true, stream_options: { include_usage: true },
      reasoning_effort: "low", max_completion_tokens: 3600 + 2048,
    });
    // Unplanned teaching with a reasoning budget.
    assert.equal(provider.providerChatBody({ messages, thinking: { type: "enabled", budget_tokens: 1024, budget_end_str: "x" }, max_tokens: 4624 }, azure, {}).reasoning_effort, "low");
    const medium = provider.providerChatBody({ messages, thinking: { type: "enabled", budget_tokens: 2048 }, max_tokens: 5648 }, azure, {});
    assert.equal(medium.reasoning_effort, "medium");
    assert.equal(medium.max_completion_tokens, 5648 + 4096);
    assert.equal("thinking" in medium, false);
    // Photo OCR, notes chat, home suggestions.
    for (const [effort, expected] of [["none", "low"], ["low", "low"], ["medium", "medium"], ["high", "high"]] as const) {
      assert.equal(provider.providerChatBody({ messages, reasoning_effort: effort, max_tokens: 1024 }, azure, {}).reasoning_effort, expected);
    }
    // A deployment that accepts a lower floor can say so in env.
    assert.equal(provider.providerChatBody({ messages, thinking: { type: "disabled" } }, azure, { AZURE_OPENAI_MIN_REASONING_EFFORT: "minimal" }).reasoning_effort, "minimal");
    assert.equal(provider.completionTokenCap({ max_completion_tokens: 5000 }), 5000);
    assert.equal(provider.completionTokenCap({ max_tokens: 1024 }), 1024);
  }],
  ["gpt-6.1-sol is priced at $2 in, $10 out, $0.10 cached per 1M tokens", () => {
    for (const id of ["gpt-6-1-sol", "gpt-6.1-sol", "gpt-6.1-sol-2026-09-29", "azure/gpt-6-1-sol"]) {
      assert.equal(usageCost.resolveLlmRateLane(id), "gpt-6.1-sol", id);
    }
    const cost = usageCost.calculateLlmCostDetails({ input: 1_000_000, cachedInput: 400_000, output: 1_000_000 }, { model: "gpt-6-1-sol" });
    assert.deepEqual(cost, { input: 1.24, cachedInput: 0.04, output: 10, total: 11.24 });
    assert.equal(paidUsage.actualLlmCost({ input: 10_000, output: 2_000 }, "gpt-6-1-sol"), 0.04);
    // Kimi pricing is untouched.
    assert.equal(usageCost.resolveLlmRateLane("accounts/fireworks/routers/kimi-k3-fast"), "kimi-k3-fast");
    assert.equal(usageCost.calculateLlmCostDetails({ input: 1_000_000, output: 0 }, { model: "accounts/fireworks/models/kimi-k3" }).total, 3);
    const pricing = runCost.snapshotPricing().llm.find((row) => row.lane === "gpt-6.1-sol");
    assert.deepEqual(pricing, { lane: "gpt-6.1-sol", inputUsdPer1M: 2, cachedInputUsdPer1M: 0.1, outputUsdPer1M: 10 });
  }],
  ["a custom deployment name keeps its Azure rates after a rollback to Fireworks", () => {
    const saved = { provider: process.env.LLM_PROVIDER, deployment: process.env.AZURE_OPENAI_DEPLOYMENT };
    try {
      process.env.AZURE_OPENAI_DEPLOYMENT = "tutor-prod";
      for (const active of ["azure", "fireworks", ""]) {
        process.env.LLM_PROVIDER = active;
        assert.equal(usageCost.resolveLlmRateLane("tutor-prod"), "gpt-6.1-sol", `LLM_PROVIDER=${active}`);
      }
      delete process.env.AZURE_OPENAI_DEPLOYMENT;
      assert.equal(usageCost.resolveLlmRateLane("tutor-prod"), "unknown");
    } finally {
      if (saved.provider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = saved.provider;
      if (saved.deployment === undefined) delete process.env.AZURE_OPENAI_DEPLOYMENT; else process.env.AZURE_OPENAI_DEPLOYMENT = saved.deployment;
    }
  }],
  ["mock mode follows the active provider's key", () => {
    assert.equal(flags.isProviderMockMode({} as unknown as NodeJS.ProcessEnv), true);
    assert.equal(flags.isProviderMockMode({ FIREWORKS_API_KEY: "fw" } as unknown as NodeJS.ProcessEnv), false);
    assert.equal(flags.isProviderMockMode({ ...AZURE } as unknown as NodeJS.ProcessEnv), false);
    const fallback = captureErrors(() => flags.isProviderMockMode({ ...AZURE, AZURE_OPENAI_API_KEY: "" } as unknown as NodeJS.ProcessEnv));
    assert.equal(fallback.value, true, "an incomplete Azure env with no Fireworks key is mock mode, not a broken provider");
  }],
  ["Azure usage reads cache hits and reasoning; latency_checkpoint feeds perf metadata", () => {
    const usage = {
      prompt_tokens: 3619, completion_tokens: 40, total_tokens: 3659,
      prompt_tokens_details: { cached_tokens: 3608, cache_write_tokens: 8 },
      completion_tokens_details: { reasoning_tokens: 16 },
      latency_checkpoint: { service_ttft_ms: 600, service_ttlt_ms: 1000 },
    };
    assert.deepEqual(providerUsage.parseProviderUsage(usage), { input: 3619, output: 40, total: 3659, cachedInput: 3608, reasoning: 16, known: true });
    assert.deepEqual(chatTrace.providerPerfMetadata(provider.readProviderPerf({ usage }), { completionTokens: 40 }), { ttft_ms: 600, tokens_per_sec: 100, provider_processing_ms: 1000 });
    const chunk = { choices: [], latency_checkpoint: { service_ttft_ms: 250, service_ttlt_ms: 1250 } };
    assert.deepEqual(provider.readProviderPerf(chunk), chunk.latency_checkpoint);
    const fireworks = { perf_metrics: { "server-time-to-first-token": 0.25 } };
    assert.equal(provider.readProviderPerf(fireworks), fireworks.perf_metrics);
  }],
  ["openai_compat resolves to the relay model; a missing variable logs once and stays on Fireworks", () => {
    const endpoint = provider.resolveLlmEndpoint({ ...RELAY, FIREWORKS_API_KEY: "fw" }, new provider.CompatCircuit());
    assert.deepEqual(endpoint, { provider: "openai_compat", url: RELAY_URL, apiKey: "relay-test-key", deployment: "gpt-6.1-sol", fallbackReason: null });
    for (const pasted of ["https://relay.test/v1", "https://relay.test/v1/chat/completions", " https://relay.test/v1/chat/completions/ "]) {
      assert.equal(provider.compatChatUrl(pasted), RELAY_URL, pasted);
    }
    for (const missing of provider.OPENAI_COMPAT_ENV_KEYS) {
      const env: Env = { ...RELAY, FIREWORKS_API_KEY: "fw", [missing]: " " };
      const first = captureErrors(() => provider.resolveLlmEndpoint(env));
      const again = captureErrors(() => provider.resolveLlmEndpoint(env));
      assert.equal(first.value.provider, "fireworks");
      assert.equal(first.value.apiKey, "fw");
      assert.equal(first.errors.length, 1, `${missing}: one error`);
      assert.match(first.errors[0]!, new RegExp(`LLM_PROVIDER=openai_compat but ${missing} is not set; using Fireworks`));
      assert.equal(again.errors.length, 0, `${missing}: logged once per process`);
      assert.deepEqual(laneSnapshot(env), laneSnapshot({ FIREWORKS_API_KEY: "fw" }), `${missing}: every lane is Fireworks`);
    }
  }],
  ["LLM_PROVIDER=openai_compat sends every lane to the relay model", async () => {
    for (const base of FIREWORKS_ENVS) {
      const env = { ...base, ...RELAY };
      const route = { model: "gpt-6.1-sol", alternate: null, fallbackReason: null };
      assert.deepEqual(laneSnapshot(env), {
        planner: "gpt-6.1-sol", plannerFast: "gpt-6.1-sol", plannerSlow: "gpt-6.1-sol",
        plannerModels: ["gpt-6.1-sol"], problemIR: ["gpt-6.1-sol"],
        teaching: "gpt-6.1-sol", teachingFast: "gpt-6.1-sol", teachingSlow: "gpt-6.1-sol", teachingAlternate: null,
        teachingRouteFast: route, teachingRouteSlow: route, teachingRouteStartupRetry: route,
        cheap: "gpt-6.1-sol", vision: "gpt-6.1-sol", visionModels: ["gpt-6.1-sol"], homeSuggestions: "gpt-6.1-sol",
      }, JSON.stringify(base));
      assert.deepEqual(await notesModels(env), ["gpt-6.1-sol", "gpt-6.1-sol"]);
    }
  }],
  ["relay bodies get the Azure translation with their own reasoning floor", () => {
    const relay = { provider: "openai_compat" as const };
    const messages = [{ role: "user", content: "JSON please" }];
    const planner = {
      model: "gpt-6.1-sol", messages, n: 1, temperature: 0, perf_metrics_in_response: true,
      thinking: { type: "disabled" }, max_tokens: 2800, stream: false, response_format: { type: "json_object" },
    };
    assert.deepEqual(provider.providerChatBody(planner, relay, {}), provider.providerChatBody(planner, { provider: "azure" }, {}));
    assert.deepEqual(provider.providerChatBody(planner, relay, {}), {
      model: "gpt-6.1-sol", messages, n: 1, stream: false, response_format: { type: "json_object" },
      reasoning_effort: "low", max_completion_tokens: 2800 + 2048,
    });
    // Probed 27 Oct 2026: one upstream rejects none and minimal, so low is the floor
    // unless the relay's own override says otherwise. Azure's override does not leak.
    assert.equal(provider.providerChatBody(planner, relay, { AZURE_OPENAI_MIN_REASONING_EFFORT: "none" }).reasoning_effort, "low");
    assert.equal(provider.providerChatBody(planner, relay, { OPENAI_COMPAT_MIN_REASONING_EFFORT: "none" }).reasoning_effort, "none");
    assert.equal(provider.providerChatBody(planner, { provider: "azure" }, { OPENAI_COMPAT_MIN_REASONING_EFFORT: "none" }).reasoning_effort, "low");
  }],
  ["the relay circuit opens on a blocked key or repeated failures, and closes after the cooldown", () => {
    const { failureWindowMs, failuresToOpen, cooldownMs } = provider.COMPAT_CIRCUIT;
    const t0 = 1_000_000;
    // A blocked key, empty balance, wrong URL or unrouted model opens at once.
    for (const status of [401, 402, 403, 404, 410]) {
      const circuit = new provider.CompatCircuit();
      assert.equal(circuit.record({ ok: false, status }, t0), true, `${status}`);
      assert.match(circuit.openReason(t0 + 1) ?? "", new RegExp(`answered ${status}`));
      assert.equal(circuit.openReason(t0 + cooldownMs - 1) !== null, true);
      assert.equal(circuit.openReason(t0 + cooldownMs), null, "closes after the cooldown");
    }
    // Three transient failures inside the window open it; a success in between resets.
    const repeated = new provider.CompatCircuit();
    for (let i = 0; i < failuresToOpen - 1; i += 1) assert.equal(repeated.record({ ok: false, status: 503 }, t0 + i), false);
    assert.equal(repeated.record({ ok: false }, t0 + failuresToOpen), true, "a connect failure counts");
    const reset = new provider.CompatCircuit();
    reset.record({ ok: false, status: 429 }, t0);
    reset.record({ ok: false, status: 502 }, t0 + 1);
    reset.record({ ok: true }, t0 + 2);
    assert.equal(reset.record({ ok: false, status: 500 }, t0 + 3), false, "a success clears the count");
    const spread = new provider.CompatCircuit();
    for (let i = 0; i < failuresToOpen + 2; i += 1) assert.equal(spread.record({ ok: false, status: 503 }, t0 + i * failureWindowMs), false, "failures a window apart");
    // Our own bad request is not the relay failing.
    const ours = new provider.CompatCircuit();
    for (let i = 0; i < 10; i += 1) assert.equal(ours.record({ ok: false, status: 400 }, t0 + i), false);
    // An open circuit resolves to Fireworks with the reason, unless fallback is off or there is no Fireworks key.
    const open = new provider.CompatCircuit();
    open.record({ ok: false, status: 403 });
    const tripped = provider.resolveLlmEndpoint({ ...RELAY, FIREWORKS_API_KEY: "fw" }, open);
    assert.equal(tripped.provider, "fireworks");
    assert.equal(tripped.url, FIREWORKS_URL);
    assert.equal(tripped.apiKey, "fw");
    assert.match(tripped.fallbackReason ?? "", /openai_compat answered 403/);
    assert.equal(provider.resolveLlmEndpoint({ ...RELAY, FIREWORKS_API_KEY: "fw", OPENAI_COMPAT_FALLBACK: "off" }, open).provider, "openai_compat");
    assert.equal(provider.resolveLlmEndpoint({ ...RELAY }, open).provider, "openai_compat", "no Fireworks key: never mock lessons");
    // Reports only count for the relay, and only when a fallback exists.
    const quiet = new provider.CompatCircuit();
    for (const endpoint of [{ provider: "fireworks" as const }, { provider: "azure" as const }]) {
      provider.noteProviderOutcome(endpoint, { ok: false, status: 401 }, { ...RELAY, FIREWORKS_API_KEY: "fw" }, quiet);
    }
    provider.noteProviderOutcome({ provider: "openai_compat" }, { ok: false, status: 401 }, { ...RELAY, FIREWORKS_API_KEY: "fw", OPENAI_COMPAT_FALLBACK: "off" }, quiet);
    provider.noteProviderOutcome({ provider: "openai_compat" }, { ok: false, status: 401 }, { ...RELAY }, quiet);
    assert.equal(quiet.openReason(), null);
    const loud = captureErrors(() => provider.noteProviderOutcome({ provider: "openai_compat" }, { ok: false, status: 401 }, { ...RELAY, FIREWORKS_API_KEY: "fw" }, quiet));
    assert.notEqual(quiet.openReason(), null);
    assert.equal(loud.errors.length, 1);
    assert.match(loud.errors[0]!, /\[llm\] openai_compat answered 401/);
  }],
  ["a relay base URL without /v1, or production without the opt-in, stays on Fireworks", () => {
    for (const [base, problem] of [
      ["https://relay.test", "must end in /v1"], ["https://relay.test/api", "must end in /v1"],
      ["relay.test/v1", "is not a URL"], ["ftp://relay.test/v1", "is not an http\\(s\\) URL"],
    ] as const) {
      const env = { ...RELAY, FIREWORKS_API_KEY: "fw", OPENAI_COMPAT_BASE_URL: base };
      const { value } = captureErrors(() => provider.resolveLlmEndpoint(env, new provider.CompatCircuit()));
      assert.equal(value.provider, "fireworks", base);
      assert.match(value.fallbackReason ?? "", new RegExp(`OPENAI_COMPAT_BASE_URL ${problem}`), base);
    }
    const production = { ...RELAY, FIREWORKS_API_KEY: "fw", NODE_ENV: "production" };
    const { value: blocked } = captureErrors(() => provider.resolveLlmEndpoint(production, new provider.CompatCircuit()));
    assert.equal(blocked.provider, "fireworks");
    assert.match(blocked.fallbackReason ?? "", /does not enforce output caps and OPENAI_COMPAT_ALLOW_PRODUCTION is not 1/);
    assert.equal(provider.resolveLlmEndpoint({ ...production, OPENAI_COMPAT_ALLOW_PRODUCTION: "1" }, new provider.CompatCircuit()).provider, "openai_compat");
  }],
  ["endpointEnv pins model choice to the endpoint a request already resolved", () => {
    const env = { ...RELAY, FIREWORKS_API_KEY: "fw" };
    const saved = { ...process.env };
    try {
      Object.assign(process.env, env);
      provider.compatCircuit.reset();
      const relayEndpoint = provider.resolveLlmEndpoint();
      assert.equal(relayEndpoint.provider, "openai_compat");
      provider.compatCircuit.record({ ok: false, status: 403 });
      // The circuit opened after the request resolved: its model stays the relay's.
      assert.equal(models.resolveFireworksModel({ fastMode: true }), "accounts/fireworks/routers/kimi-k3-fast");
      assert.equal(models.resolveFireworksModel({ fastMode: true, env: provider.endpointEnv(relayEndpoint) }), "gpt-6.1-sol");
      const fireworksEndpoint = provider.resolveLlmEndpoint();
      assert.equal(fireworksEndpoint.provider, "fireworks");
      provider.compatCircuit.reset();
      // The circuit closed after the request resolved: its model stays Kimi.
      assert.equal(models.resolveFireworksModel({ fastMode: true }), "gpt-6.1-sol");
      assert.equal(models.resolveFireworksModel({ fastMode: true, env: provider.endpointEnv(fireworksEndpoint) }), "accounts/fireworks/routers/kimi-k3-fast");
      assert.equal(provider.endpointEnv({ provider: "azure" }, env), env);
    } finally {
      provider.compatCircuit.reset();
      for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
      Object.assign(process.env, saved);
    }
  }],
  ["failed turn telemetry tags the relay, not Fireworks", () => {
    const turn = {
      visualStatus: "text_only", status: "complete", kind: "lesson", rawResponse: "Synthetic",
      sceneArtifacts: { turnPlan: { visualRequirement: "required" }, failureTelemetry: { subject: "physics", stage: "scene_planner", code: "candidate_invalid" } },
      segments: [{ narration: "Synthetic", spokenText: "Synthetic" }],
    } as unknown as Parameters<typeof failedTurns.buildFailedTurnSentryEvent>[0];
    const tags = (env: Env) => {
      const event = failedTurns.buildFailedTurnSentryEvent(turn, env);
      assert(event, "the fixture is a failed turn");
      const all = event.tags as Record<string, unknown>;
      return [all.provider, all.deployment];
    };
    provider.compatCircuit.reset();
    assert.deepEqual(tags({ ...RELAY, FIREWORKS_API_KEY: "fw" }), ["openai_compat", "gpt-6.1-sol"]);
    assert.deepEqual(tags({ ...RELAY }), ["openai_compat", "gpt-6.1-sol"], "no Fireworks key: still the relay, not mock");
    assert.deepEqual(tags({ ...AZURE }), ["azure", "gpt-6-1-sol"]);
    assert.deepEqual(tags({ FIREWORKS_API_KEY: "fw" }), ["fireworks", "fireworks"]);
    assert.deepEqual(tags({}), ["mock", "mock"]);
  }],
  ["relay reservations include the hidden prompt; other lanes are unchanged", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, RELAY);
      const messages = [{ role: "user", content: "x".repeat(100) }];
      const relay = paidUsage.maximumLlmCost(messages, 1000, ["gpt-6.1-sol"]);
      const azure = paidUsage.maximumLlmCost(messages, 1000, ["azure/gpt-6-1-sol"]);
      assert.equal(usageCost.resolveLlmRateLane("azure/gpt-6-1-sol"), "gpt-6.1-sol");
      // Same default rates on both lanes, so the difference is the hidden prompt at $2 per 1M.
      assert.equal(Math.round((relay - azure) * 1e6), Math.round(paidUsage.RELAY_HIDDEN_PROMPT_TOKENS * 2));
      Object.assign(process.env, { LLM_PROVIDER: "fireworks" });
      assert.equal(paidUsage.maximumLlmCost(messages, 1000, ["gpt-6.1-sol"]), azure, "an inactive relay adds nothing");
    } finally {
      for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
      Object.assign(process.env, saved);
    }
  }],
  ["relay usage: both upstream shapes parse, and the id names the upstream", () => {
    // chatcmpl upstream: top level input/output/reasoning, plus cached details.
    assert.deepEqual(providerUsage.parseProviderUsage({
      prompt_tokens: 4230, completion_tokens: 320, total_tokens: 4550, input_tokens: 4230, output_tokens: 320,
      reasoning_tokens: 242, cached_tokens: 4096, prompt_tokens_details: { cached_tokens: 4096 },
    }), { input: 4230, output: 320, total: 4550, cachedInput: 4096, reasoning: 242, known: true });
    assert.deepEqual(providerUsage.parseProviderUsage({ input_tokens: 14, output_tokens: 295, reasoning_tokens: 212 }),
      { input: 14, output: 295, total: 309, cachedInput: undefined, reasoning: 212, known: true });
    // resp upstream: the Azure shape.
    assert.deepEqual(providerUsage.parseProviderUsage({
      prompt_tokens: 4394, completion_tokens: 114, total_tokens: 4508,
      prompt_tokens_details: { cached_tokens: 4224 }, completion_tokens_details: { reasoning_tokens: 27 },
    }), { input: 4394, output: 114, total: 4508, cachedInput: 4224, reasoning: 27, known: true });
    assert.equal(provider.relayUpstreamKind("resp_0e516901acb97714016ae04f0c055c819b"), "responses");
    assert.equal(provider.relayUpstreamKind("chatcmpl-be7b88bb"), "chat_completions");
    assert.equal(provider.relayUpstreamKind(undefined), "unknown");
  }],
  ["a relay is priced as the relay only while active; Azure keeps Azure rates", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, RELAY);
      assert.equal(usageCost.resolveLlmRateLane("gpt-6.1-sol"), "openai-compat");
      assert.equal(usageCost.resolveLlmRateLane("gpt-6-sol"), "unknown", "another relay model is not this lane");
      process.env.OPENAI_COMPAT_INPUT_USD_PER_1M = "1.25";
      process.env.OPENAI_COMPAT_OUTPUT_USD_PER_1M = "5";
      process.env.OPENAI_COMPAT_CACHED_INPUT_USD_PER_1M = "0.125";
      assert.deepEqual(usageCost.calculateLlmCostDetails({ input: 1_000_000, cachedInput: 1_000_000, output: 1_000_000 }, { model: "gpt-6.1-sol" }),
        { input: 0.125, cachedInput: 0.125, output: 5, total: 5.125 });
      assert.deepEqual(runCost.snapshotPricing().llm.find((row) => row.lane === "openai-compat"),
        { lane: "openai-compat", inputUsdPer1M: 1.25, cachedInputUsdPer1M: 0.125, outputUsdPer1M: 5 });
      assert.deepEqual(runCost.snapshotPricing().llm.map((row) => row.lane).filter((lane) => lane === "openai-compat" || lane === "gpt-6.1-sol"),
        ["gpt-6.1-sol", "openai-compat"], "one Azure row and one relay row");
      Object.assign(process.env, AZURE);
      assert.equal(usageCost.resolveLlmRateLane("gpt-6.1-sol"), "gpt-6.1-sol");
      assert.equal(runCost.snapshotPricing().llm.some((row) => row.lane === "openai-compat"), false);
    } finally {
      for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
      Object.assign(process.env, saved);
    }
  }],
  ["the lab profile accepts a relay only with explicit prices", () => {
    const env = { ...RELAY, FIREWORKS_API_KEY: "fw" };
    const endpoint = provider.resolveLlmEndpoint(env, new provider.CompatCircuit());
    const saved = { ...process.env };
    try {
      Object.assign(process.env, env);
      assert.throws(() => labProfile.buildLabModelProfile({ endpoint, env }),
        /explicit relay prices: set OPENAI_COMPAT_INPUT_USD_PER_1M, OPENAI_COMPAT_CACHED_INPUT_USD_PER_1M, OPENAI_COMPAT_OUTPUT_USD_PER_1M/);
      const pricedOnly = { ...env, OPENAI_COMPAT_INPUT_USD_PER_1M: "2", OPENAI_COMPAT_CACHED_INPUT_USD_PER_1M: "0.1", OPENAI_COMPAT_OUTPUT_USD_PER_1M: "10" };
      assert.throws(() => labProfile.buildLabModelProfile({ endpoint, env: pricedOnly }), /OPENAI_COMPAT_FALLBACK=off/);
      const priced = { ...pricedOnly, OPENAI_COMPAT_FALLBACK: "off" };
      Object.assign(process.env, priced);
      const profile = labProfile.buildLabModelProfile({ endpoint, env: priced });
      assert.equal(profile.provider, "openai_compat");
      assert.equal(profile.deployment, "gpt-6.1-sol");
      assert.deepEqual(Object.values(profile.models), ["gpt-6.1-sol", "gpt-6.1-sol", "gpt-6.1-sol", "gpt-6.1-sol"]);
      assert.equal(profile.rates.teaching.lane, "openai-compat");
      assert.throws(() => labProfile.assertLabModelProfile({ ...profile, models: { ...profile.models, picker: "other" } }), /lane model must match deployment/);
      assert.throws(() => labProfile.buildLabModelProfile({ endpoint, env: priced, fastMode: true }), /Fast mode requires the Fireworks provider/);
    } finally {
      for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
      Object.assign(process.env, saved);
    }
  }],
  ["no route or library hard-codes the Fireworks URL outside llmProvider.ts", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(full, "utf8").includes("api.fireworks.ai")) offenders.push(relative(root, full));
      }
    };
    for (const dir of ["app", "lib", "features"]) walk(path(dir));
    assert.deepEqual(offenders, ["lib/llm/llmProvider.ts"]);
  }],
];

// ---------------------------------------------------------------- route
function arrange(env: Env): string {
  for (const key of ["LLM_PROVIDER", "DIAGRAM_PLANNER_PRIORITY", "OPENAI_COMPAT_FALLBACK", ...provider.AZURE_ENV_KEYS, ...provider.OPENAI_COMPAT_ENV_KEYS]) delete process.env[key];
  Object.assign(process.env, env);
  provider.compatCircuit.reset();
  grants.resetTurnGrantsForTests();
  fuses.resetBillingFusesForTests();
  testNumber += 1;
  actor = {
    userId: `provider-user-${testNumber}`,
    email: null,
    staff: false,
    lectureLab: false,
    skipAutumn: true,
    skipGates: false,
  } as SpendActor;
  remaining = 10_000_000;
  reservations.clear();
  ownedTraces.clear();
  generations.length = 0;
  const traceId = `provider-trace-${testNumber}`;
  ownedTraces.set(traceId, { userId: actor.userId, expiresAt: new Date(Date.now() + 86_400_000) });
  const result = grants.createLessonGrant({ userId: actor.userId, traceId, usdMillicents: remaining });
  assert(result.ok);
  return traceId;
}

interface Sent { url: string; authorization: string | null; body: Record<string, unknown> }

function installProvider(sent: Sent[], reply: () => Response): void {
  globalThis.fetch = async (url, options) => {
    sent.push({
      url: String(url),
      authorization: new Headers(options?.headers).get("authorization"),
      body: JSON.parse(String(options?.body)) as Record<string, unknown>,
    });
    return reply();
  };
}

const plannerReply = (perf: Record<string, unknown>) => () => Response.json({
  choices: [{ message: { content: '{"schemaVersion":"turn-plan/v3"}' } }],
  usage: { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 40 }, ...perf },
});

const teachingReply = () => new Response(
  `data: ${JSON.stringify({ choices: [], prompt_filter_results: [] })}\n\n` +
  `data: ${JSON.stringify({ choices: [{ delta: { content: "Force is a push." } }] })}\n\n` +
  `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 800, completion_tokens: 200 }, latency_checkpoint: { service_ttft_ms: 500, service_ttlt_ms: 1500 } })}\n\n` +
  "data: [DONE]\n\n",
  { headers: { "content-type": "text/event-stream" } },
);

function chatRequest(traceId: string, headers: Record<string, string> = {}, body: Record<string, unknown> = {}): Request {
  return new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-heytutor-trace-id": traceId, ...headers },
    body: JSON.stringify({ messages: [{ role: "user", content: "Explain force." }], stream: true, temperature: 0.3, ...body }),
  });
}

const PLANNER_HEADERS = { "x-planner": "1", "x-turn-planner-version": "3" };
const PLANNED_TEACHING = { "x-heytutor-teaching-pass": "planned" };

const routeChecks: [string, () => Promise<void>][] = [
  ["fireworks: the planner body and URL are today's", async () => {
    const sent: Sent[] = [];
    // Unset, and fireworks with every Azure variable present.
    for (const env of [{}, { ...AZURE, LLM_PROVIDER: "fireworks" }]) {
      const trace = arrange(env);
      installProvider(sent, plannerReply({}));
      const response = await chat.POST(chatRequest(trace, PLANNER_HEADERS, { stream: false, temperature: 0 }));
      assert.equal(response.status, 200);
    }
    for (const call of sent) {
      assert.equal(call.url, FIREWORKS_URL);
      assert.equal(call.authorization, "Bearer fireworks-test-key");
      assert.deepEqual(call.body, {
        messages: [{ role: "user", content: "Explain force." }],
        n: 1,
        temperature: 0,
        perf_metrics_in_response: true,
        thinking: { type: "disabled" },
        max_tokens: 2800,
        stream: false,
        response_format: { type: "json_object" },
        model: "accounts/fireworks/routers/kimi-k3-fast",
      });
    }
    assert.equal(sent.length, 2);
  }],
  ["fireworks: a planned teaching turn still sends thinking disabled at 0.3", async () => {
    const trace = arrange({ LLM_PROVIDER: "fireworks" });
    const sent: Sent[] = [];
    installProvider(sent, teachingReply);
    const response = await chat.POST(chatRequest(trace, PLANNED_TEACHING));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Force is a push/);
    assert.equal(sent[0]!.url, FIREWORKS_URL);
    assert.deepEqual(sent[0]!.body, {
      messages: [{ role: "user", content: "Explain force." }],
      n: 1,
      temperature: 0.3,
      perf_metrics_in_response: true,
      model: "accounts/fireworks/routers/kimi-k3-fast",
      stream: true,
      stream_options: { include_usage: true },
      thinking: { type: "disabled" },
      max_tokens: 3600,
    });
  }],
  ["azure: the planner calls the deployment with a body it accepts, priced at Azure rates", async () => {
    const priority = process.env.DIAGRAM_PLANNER_PRIORITY;
    try {
      // Default fixtures must ignore a priority flag inherited from the shell.
      process.env.DIAGRAM_PLANNER_PRIORITY = "1";
      const trace = arrange(AZURE);
      const sent: Sent[] = [];
      installProvider(sent, plannerReply({ latency_checkpoint: { service_ttft_ms: 300, service_ttlt_ms: 2300 } }));
      const response = await chat.POST(chatRequest(trace, PLANNER_HEADERS, { stream: false, temperature: 0 }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-heytutor-planner-model"), "gpt-6-1-sol");
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.url, AZURE_URL);
      assert.equal(sent[0]!.authorization, "Bearer azure-test-key");
      assert.deepEqual(sent[0]!.body, {
        messages: [{ role: "user", content: "Explain force." }],
        n: 1,
        stream: false,
        response_format: { type: "json_object" },
        reasoning_effort: "low",
        max_completion_tokens: 2800 + 2048,
        model: "gpt-6-1-sol",
      });
      const metadata = generations.at(-1)!.metadata!;
      assert.equal(generations.at(-1)!.model, "gpt-6-1-sol");
      assert.equal(metadata.llm_provider, "azure");
      assert.equal(metadata.reasoning_tokens, 40);
      assert.equal(metadata.cached_input_tokens, 200);
      assert.equal(metadata.ttft_ms, 300);
      assert.equal(metadata.service_tier_requested, "auto");
      assert.equal(response.headers.get("x-heytutor-service-tier-requested"), "auto");
    } finally {
      if (priority === undefined) delete process.env.DIAGRAM_PLANNER_PRIORITY;
      else process.env.DIAGRAM_PLANNER_PRIORITY = priority;
    }
  }],
  ["azure: Problem IR and the fast planner lane use the same deployment", async () => {
    const trace = arrange(AZURE);
    const sent: Sent[] = [];
    installProvider(sent, plannerReply({}));
    await chat.POST(chatRequest(trace, { "x-planner": "1", "x-problem-ir-version": "1" }, { stream: false }));
    await chat.POST(chatRequest(trace, { ...PLANNER_HEADERS, "x-heytutor-fast-mode": "0" }, { stream: false }));
    assert.deepEqual(sent.map((call) => [call.url, call.body.model, call.body.max_completion_tokens]), [
      [AZURE_URL, "gpt-6-1-sol", 3600 + 2048],
      [AZURE_URL, "gpt-6-1-sol", 2800 + 2048],
    ]);
  }],
  ["azure: a planned teaching turn streams at the lowest effort with usage on", async () => {
    const trace = arrange(AZURE);
    const sent: Sent[] = [];
    installProvider(sent, teachingReply);
    const response = await chat.POST(chatRequest(trace, PLANNED_TEACHING));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Force is a push/);
    assert.equal(sent[0]!.url, AZURE_URL);
    assert.deepEqual(sent[0]!.body, {
      messages: [{ role: "user", content: "Explain force." }],
      n: 1,
      model: "gpt-6-1-sol",
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: "low",
      max_completion_tokens: 3600 + 2048,
    });
    for (let tick = 0; tick < 6; tick += 1) await new Promise<void>((done) => setImmediate(done));
    const metadata = generations.at(-1)!.metadata!;
    assert.equal(metadata.llm_provider, "azure");
    assert.equal(metadata.ttft_ms, 500);
    assert.equal(metadata.usage_status, "known");
    assert.equal(reservations.size, 0, "the teaching reservation settles");
  }],
  ["azure: an unplanned turn with a reasoning budget maps to medium, and a 5xx retries on the same deployment", async () => {
    const trace = arrange(AZURE);
    const sent: Sent[] = [];
    let calls = 0;
    installProvider(sent, () => (calls++ === 0 ? new Response("busy", { status: 503 }) : teachingReply()));
    const response = await chat.POST(chatRequest(trace));
    assert.equal(response.status, 200);
    await response.text();
    assert.deepEqual(sent.map((call) => [call.body.model, call.body.reasoning_effort]), [["gpt-6-1-sol", "medium"], ["gpt-6-1-sol", "medium"]]);
  }],
  ["relay: the planner calls the relay model with the Azure body and records the upstream", async () => {
    const trace = arrange(RELAY);
    const sent: Sent[] = [];
    globalThis.fetch = async (url, options) => {
      sent.push({ url: String(url), authorization: new Headers(options?.headers).get("authorization"), body: JSON.parse(String(options?.body)) as Record<string, unknown> });
      return Response.json({ id: "resp_0abc", choices: [{ message: { content: '{"schemaVersion":"turn-plan/v3"}' } }],
        usage: { prompt_tokens: 4394, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 4224 } } });
    };
    const response = await chat.POST(chatRequest(trace, PLANNER_HEADERS, { stream: false, temperature: 0 }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-heytutor-planner-model"), "gpt-6.1-sol");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.url, RELAY_URL);
    assert.equal(sent[0]!.authorization, "Bearer relay-test-key");
    assert.deepEqual(sent[0]!.body, {
      messages: [{ role: "user", content: "Explain force." }], n: 1, stream: false,
      response_format: { type: "json_object" }, reasoning_effort: "low", max_completion_tokens: 2800 + 2048, model: "gpt-6.1-sol",
    });
    const metadata = generations.at(-1)!.metadata!;
    assert.equal(metadata.llm_provider, "openai_compat");
    assert.equal(metadata.relay_upstream, "responses");
    assert.equal(metadata.cached_input_tokens, 4224);
  }],
  ["relay: a blocked key opens the circuit and the next lesson runs on Fireworks", async () => {
    let trace = arrange({ ...RELAY, FIREWORKS_API_KEY: "fireworks-test-key" });
    const sent: Sent[] = [];
    installProvider(sent, () => (sent.at(-1)!.url === RELAY_URL ? new Response("blocked", { status: 403 }) : teachingReply()));
    const { value: blocked, errors } = await (async () => {
      const captured: string[] = [];
      console.error = (...args: unknown[]) => { captured.push(args.map(String).join(" ")); };
      try { return { value: await chat.POST(chatRequest(trace, PLANNED_TEACHING)), errors: captured }; }
      finally { console.error = originalConsoleError; }
    })();
    assert.notEqual(blocked.status, 200, "the blocked call itself is not rescued");
    await blocked.text();
    assert.ok(sent.length >= 1 && sent.every((call) => call.url === RELAY_URL));
    assert.ok(errors.some((line) => /\[llm\] openai_compat answered 403/.test(line)), errors.join("\n"));
    // A fresh lesson: same env, new grant. It must resolve to Fireworks with a Fireworks body.
    const relaySent = sent.length;
    grants.resetTurnGrantsForTests();
    testNumber += 1;
    trace = `provider-trace-${testNumber}`;
    ownedTraces.set(trace, { userId: actor.userId, expiresAt: new Date(Date.now() + 86_400_000) });
    assert(grants.createLessonGrant({ userId: actor.userId, traceId: trace, usdMillicents: 1_000_000 }).ok);
    const recovered = await chat.POST(chatRequest(trace, PLANNED_TEACHING));
    assert.equal(recovered.status, 200);
    assert.match(await recovered.text(), /Force is a push/);
    const next = sent[relaySent]!;
    assert.equal(next.url, FIREWORKS_URL);
    assert.equal(next.authorization, "Bearer fireworks-test-key");
    assert.equal(next.body.model, "accounts/fireworks/routers/kimi-k3-fast");
    assert.deepEqual(next.body.thinking, { type: "disabled" });
    assert.equal("reasoning_effort" in next.body, false);
  }],
  ["relay: a planner 403 (final response) opens the circuit", async () => {
    const trace = arrange({ ...RELAY, FIREWORKS_API_KEY: "fireworks-test-key" });
    const sent: Sent[] = [];
    installProvider(sent, () => new Response("blocked", { status: 403 }));
    const captured: string[] = [];
    console.error = (...args: unknown[]) => { captured.push(args.map(String).join(" ")); };
    try { await (await chat.POST(chatRequest(trace, PLANNER_HEADERS, { stream: false }))).text(); }
    finally { console.error = originalConsoleError; }
    assert.equal(sent.length, 1);
    assert.ok(captured.some((line) => /\[llm\] openai_compat answered 403/.test(line)));
    assert.match(provider.compatCircuit.openReason() ?? "", /answered 403/);
  }],
  ["relay: planner connect failures count once per request, and three requests open the circuit", async () => {
    const trace = arrange({ ...RELAY, FIREWORKS_API_KEY: "fireworks-test-key" });
    let dispatched = 0;
    globalThis.fetch = async () => { dispatched += 1; throw new TypeError("fetch failed"); };
    const post = async () => (await chat.POST(chatRequest(trace, PLANNER_HEADERS, { stream: false }))).text();
    const captured: string[] = [];
    console.error = (...args: unknown[]) => { captured.push(args.map(String).join(" ")); };
    try {
      await post(); await post();
      assert.ok(dispatched >= 4, `${dispatched} attempts over two requests`);
      assert.equal(provider.compatCircuit.openReason(), null, "two requests with retries are two failures, not four");
      await post();
    } finally { console.error = originalConsoleError; }
    assert.match(provider.compatCircuit.openReason() ?? "", /failed 3 times/);
    assert.ok(captured.some((line) => /\[llm\] openai_compat failed 3 times/.test(line)), captured.join("\n"));
  }],
  ["relay: teaching connect failures count once per request; a student who left counts nothing", async () => {
    arrange({ ...RELAY, FIREWORKS_API_KEY: "fireworks-test-key" });
    let dispatched = 0;
    globalThis.fetch = async () => { dispatched += 1; throw new TypeError("fetch failed"); };
    // A lesson trace admits only a few teaching calls, so each request is its own lesson.
    const freshTrace = () => {
      testNumber += 1;
      const trace = `provider-trace-${testNumber}`;
      ownedTraces.set(trace, { userId: actor.userId, expiresAt: new Date(Date.now() + 86_400_000) });
      assert(grants.createLessonGrant({ userId: actor.userId, traceId: trace, usdMillicents: 1_000_000 }).ok);
      return trace;
    };
    const post = async (signal?: AbortSignal) => {
      const request = chatRequest(freshTrace(), PLANNED_TEACHING);
      const response = await chat.POST(signal ? new Request(request, { signal }) : request).catch((error: unknown) => error);
      if (response instanceof Response) await response.text().catch(() => undefined);
    };
    await post(); await post();
    assert.ok(dispatched >= 6, `${dispatched} attempts over two requests`);
    assert.equal(provider.compatCircuit.openReason(), null, "two requests are two failures");
    // Three requests from a student who left: every attempt aborts, nothing counts.
    for (let i = 0; i < 3; i += 1) {
      const left = new AbortController();
      globalThis.fetch = async () => { left.abort(); throw new DOMException("aborted", "AbortError"); };
      await post(left.signal);
    }
    assert.equal(provider.compatCircuit.openReason(), null, "aborted requests are not relay failures");
    const before = dispatched;
    globalThis.fetch = async () => { dispatched += 1; throw new TypeError("fetch failed"); };
    const captured: string[] = [];
    console.error = (...args: unknown[]) => { captured.push(args.map(String).join(" ")); };
    try { await post(); } finally { console.error = originalConsoleError; }
    assert.ok(dispatched > before, "the third failing request reached the relay");
    assert.match(provider.compatCircuit.openReason() ?? "", /failed 3 times/);
  }],
  ["relay: a 400 is our request and never opens the circuit", async () => {
    const trace = arrange({ ...RELAY, FIREWORKS_API_KEY: "fireworks-test-key" });
    const sent: Sent[] = [];
    installProvider(sent, () => Response.json({ error: { message: "bad request" } }, { status: 400 }));
    for (let i = 0; i < 4; i += 1) await (await chat.POST(chatRequest(trace, PLANNED_TEACHING))).text();
    assert.equal(provider.compatCircuit.openReason(), null);
    assert.ok(sent.length >= 4 && sent.every((call) => call.url === RELAY_URL));
  }],
  ["relay: a planner 404 does not blacklist the relay model for the life of the process", async () => {
    const trace = arrange({ ...RELAY, OPENAI_COMPAT_FALLBACK: "off" });
    const sent: Sent[] = [];
    let calls = 0;
    installProvider(sent, () => (calls++ === 0 ? new Response("no route", { status: 404 }) : plannerReply({})()));
    await (await chat.POST(chatRequest(trace, PLANNER_HEADERS, { stream: false }))).text();
    const second = await chat.POST(chatRequest(trace, PLANNER_HEADERS, { stream: false }));
    assert.equal(second.status, 200, "the next plan still reaches the relay");
    assert.deepEqual(sent.map((call) => [call.url, call.body.model]), [[RELAY_URL, "gpt-6.1-sol"], [RELAY_URL, "gpt-6.1-sol"]]);
  }],
  ["relay: with fallback off, repeated 5xx keep the relay (the lab measures it alone)", async () => {
    const trace = arrange({ ...RELAY, OPENAI_COMPAT_FALLBACK: "off" });
    const sent: Sent[] = [];
    installProvider(sent, () => new Response("busy", { status: 503 }));
    const response = await chat.POST(chatRequest(trace, PLANNED_TEACHING));
    await response.text();
    assert.ok(sent.length >= 3, `${sent.length} attempts`);
    assert.ok(sent.every((call) => call.url === RELAY_URL));
    assert.equal(provider.compatCircuit.openReason(), null);
  }],
  ["azure with the key missing: the route stays on Fireworks", async () => {
    const trace = arrange({ ...AZURE, AZURE_OPENAI_API_KEY: "" });
    const sent: Sent[] = [];
    installProvider(sent, teachingReply);
    const { value } = captureErrors(() => chat.POST(chatRequest(trace, PLANNED_TEACHING)));
    const response = await value;
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(sent[0]!.url, FIREWORKS_URL);
    assert.equal(sent[0]!.authorization, "Bearer fireworks-test-key");
    assert.equal(sent[0]!.body.model, "accounts/fireworks/routers/kimi-k3-fast");
    assert.deepEqual(sent[0]!.body.thinking, { type: "disabled" });
  }],
];

async function main(): Promise<void> {
  const failures: string[] = [];
  try {
    for (const [name, run] of [...unitChecks, ...routeChecks]) {
      try { await run(); console.log(`ok ${name}`); }
      catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
    }
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    grants.resetTurnGrantsForTests();
    fuses.resetBillingFusesForTests();
    mock.restoreAll();
  }
  if (failures.length > 0) {
    console.error(`${failures.length}/${unitChecks.length + routeChecks.length} provider checks failed`);
    process.exit(1);
  }
  console.log("llm provider verification passed");
}

void main();
