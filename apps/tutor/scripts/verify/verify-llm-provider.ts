import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import type { SpendActor } from "../../lib/billing/actor";
import type { PeriodBalance } from "../../lib/billing/ledgerMath";

// One switch, two providers. `LLM_PROVIDER=fireworks` (or unset) must be
// today's Kimi K3 behaviour exactly; `LLM_PROVIDER=azure` must send every lane
// to the one Azure deployment with a body the model accepts; and an Azure
// setting with a missing variable must log once and stay on Fireworks.
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
  if (key === "LLM_PROVIDER" || key.startsWith("AZURE_OPENAI_") || key.startsWith("FIREWORKS_")) delete process.env[key];
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
  for (const key of ["LLM_PROVIDER", ...provider.AZURE_ENV_KEYS]) delete process.env[key];
  Object.assign(process.env, env);
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
