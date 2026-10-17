import assert from "node:assert/strict";
import { mock } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// The real chat route, billing gate, grant, provider translation and transport run.
// Only identity/persistence and the network/clock are synthetic fixtures.
const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const core = resolve(root, "../../packages/tutor-core/src");
mock.module(resolve(core, "index.ts"), { namedExports: {
  ...load(resolve(core, "llm/traceHeaders.ts")), ...load(resolve(core, "llm/fastMode.ts")),
  ...load(resolve(core, "llm/reasoningEffort.ts")), ...load(resolve(core, "tutorDebug.ts")),
  normalizeTutorQuestion: (value: string) => value.trim(),
} });
const actor = { userId: "scene-deadline-fixture", email: null, staff: false, lectureLab: false, skipAutumn: true, skipGates: false };
const billing = resolve(root, "lib/billing");
let reservationDelay = 0;
const reservations: Array<{ id: string; millicents: number }> = [];
const settlements: Array<{ reservationId: string; actualMillicents?: number }> = [];
mock.module(resolve(billing, "actor.ts"), { namedExports: { requireSpendActor: async () => actor, isSpendActor: () => true } });
mock.module(resolve(billing, "ledger.ts"), { namedExports: {
  loadPeriodBalance: async () => ({ remainingMillicents: 3500, remainingPct: 100, planId: "free" }),
  cacheUsageOnUser: async () => undefined,
  reservePeriodUsage: async (input: { millicents: number }) => {
    if (reservationDelay) await new Promise<void>(resolve => setTimeout(resolve, reservationDelay));
    const receipt = { id: "fixture-receipt", millicents: input.millicents };
    reservations.push(receipt);
    return { id: receipt.id, amountMillicents: input.millicents, remainingMillicents: 3500, planId: "free" };
  },
  settlePeriodUsage: async (input: { reservationId: string; actualMillicents?: number }) => { settlements.push(input); },
} });
mock.module(resolve(root, "lib/db/prisma.ts"), { namedExports: { prisma: {
  user: { findUnique: async () => ({ id: actor.userId, planId: "free" }) },
  ownedTrace: {
    findUnique: async () => ({ userId: actor.userId, expiresAt: new Date(Date.now() + 86_400_000) }),
    createMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }),
  },
} } });

const fixtureEnv: Record<string, string | undefined> = {
  LANGFUSE_ENABLED: "0", SENTRY_ENABLED: "0", SENTRY_DSN: undefined, NEXT_PUBLIC_SENTRY_DSN: undefined,
  LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://scene-deadline-fixture.invalid",
  AZURE_OPENAI_API_KEY: "synthetic-only", AZURE_OPENAI_DEPLOYMENT: "gpt-6.1-sol", AZURE_OPENAI_MIN_REASONING_EFFORT: undefined,
  DIAGRAM_PLANNER_PRIORITY: undefined, FIREWORKS_API_KEY: "synthetic-only",
  FIREWORKS_MODEL: "accounts/fireworks/models/kimi-k3", FIREWORKS_SCENE_PLANNER_MAX_TOKENS: "4800",
  FIREWORKS_TURN_PLANNER_MAX_TOKENS: "2800", FIREWORKS_PROBLEM_IR_MAX_TOKENS: "3600", FIREWORKS_CODE_LESSON_MAX_TOKENS: "4200",
  AZURE_GPT_SOL_INPUT_USD_PER_1M: "2", AZURE_GPT_SOL_OUTPUT_USD_PER_1M: "10", AZURE_GPT_SOL_CACHED_INPUT_USD_PER_1M: "0.1",
  FIREWORKS_KIMI_K3_INPUT_USD_PER_1M: "3", FIREWORKS_KIMI_K3_OUTPUT_USD_PER_1M: "15", FIREWORKS_KIMI_K3_CACHED_INPUT_USD_PER_1M: "0.3",
};
const savedEnv = new Map(Object.keys(fixtureEnv).map(key => [key, process.env[key]]));
const realFetch = globalThis.fetch;
const realSet = globalThis.setTimeout;
const realClear = globalThis.clearTimeout;
const realNow = Date.now;
const realImmediate = globalThis.setImmediate;
const clockEpoch = realNow();
const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string) { checks++; if (!condition) failures.push(message); }

interface Scenario {
  name: string; provider?: "azure" | "fireworks"; lane?: "scene" | "turn" | "ir" | "code" | "picker" | "legacy";
  deadline?: number; responseAfter?: number; abortAfter?: number; reserveAfter?: number;
  transient?: "first" | "always" | "network"; clientAttemptTimeout?: number;
  expectedStatus: number; expectedTime: number; expectedCalls: number; expectedStarts: number[];
}

async function main() {
  globalThis.fetch = async () => { throw new Error("No real network is permitted in this gate"); };
  for (const [key, value] of Object.entries(fixtureEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const { createLessonGrant, resetTurnGrantsForTests } = load(resolve(billing, "grant.ts")) as typeof import("../../lib/billing/grant");
  const chat = load(resolve(root, "app/api/chat/route.ts")) as typeof import("../../app/api/chat/route");
  const run = async (scenario: Scenario) => {
    let now = 0; let nextId = 0; let finished = false; let response: Response | undefined; let routeError: unknown;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const starts: number[] = [];
    const aborts: number[] = [];
    const bodies: Record<string, unknown>[] = [];
    globalThis.setTimeout = ((callback: () => void, delay = 0) => {
      const id = ++nextId;
      timers.set(id, { at: now + Number(delay), callback });
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: unknown) => { timers.delete(Number(id)); }) as typeof clearTimeout;
    Date.now = () => clockEpoch + now;
    process.env.LLM_PROVIDER = scenario.provider ?? "azure";
    reservationDelay = scenario.reserveAfter ?? 0;
    reservations.length = 0; settlements.length = 0;
    resetTurnGrantsForTests();
    assert(createLessonGrant({ userId: actor.userId, traceId: "scene-deadline-trace", usdMillicents: 3500 }).ok);
    globalThis.fetch = async (url, init) => {
      const expectedUrl = scenario.provider === "fireworks" ? "https://api.fireworks.ai/inference/v1/chat/completions" : "https://scene-deadline-fixture.invalid/openai/v1/chat/completions";
      assert.equal(String(url), expectedUrl, "every request is handled locally by the provider fixture");
      assert.equal(reservations.length, 1, "reserve before any upstream attempt");
      assert.equal(settlements.length, 0, "do not reconcile a request before its final outcome");
      starts.push(now);
      bodies.push(JSON.parse(String(init?.body)));
      if (scenario.transient === "always" || (scenario.transient === "first" && starts.length === 1)) return new Response("synthetic busy", { status: 503 });
      if (scenario.transient === "network" && starts.length === 1) throw new TypeError("synthetic network failure");
      return new Promise<Response>((resolve, reject) => {
        const complete = scenario.responseAfter === undefined ? undefined : setTimeout(() => resolve(Response.json({
          choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
        })), scenario.responseAfter);
        const abort = () => { if (complete !== undefined) clearTimeout(complete); aborts.push(now); reject(init?.signal?.reason); };
        if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
      });
    };
    const controller = new AbortController();
    if (scenario.abortAfter !== undefined) setTimeout(() => controller.abort(new DOMException("Synthetic client left", "AbortError")), scenario.abortAfter);
    const lane = scenario.lane ?? "scene";
    const headers: Record<string, string> = {
      "content-type": "application/json", "x-heytutor-trace-id": "scene-deadline-trace", "x-heytutor-fast-mode": "0",
      "x-planner": "1", "x-planner-deadline-ms": String(scenario.deadline ?? 30_000),
      ...(lane !== "legacy" ? { "x-scene-planner-version": "2" } : {}),
      ...(lane === "turn" ? { "x-turn-planner-version": "3" } : {}),
      ...(lane === "ir" ? { "x-problem-ir-version": "1" } : {}),
      ...(lane === "code" ? { "x-code-lesson-version": "1" } : {}),
      ...(lane === "picker" ? { "x-diagram-example-picker": "1" } : {}),
    };
    const pending = chat.POST(new Request("https://fixture.invalid/api/chat", { method: "POST", headers, signal: controller.signal,
      body: JSON.stringify({ messages: [{ role: "user", content: "Explain a synthetic circuit." }], attemptTimeoutMs: scenario.clientAttemptTimeout ?? 999_999 }),
    })).then(value => { response = value; finished = true; }, error => { routeError = error; finished = true; });
    try {
      // Drain async request parsing, persistence and response streams before
      // moving the virtual clock. setImmediate is real but no wall-clock sleep.
      for (let step = 0; step < 100 && !finished; step++) {
        for (let drain = 0; drain < 4; drain++) await new Promise<void>(resolve => realImmediate(resolve));
        if (finished) break;
        const timer = [...timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        assert(timer, `${scenario.name}: route is pending without a scheduled fixture task`);
        now = timer[1].at; timers.delete(timer[0]); timer[1].callback();
      }
      assert(finished, `${scenario.name}: virtual schedule did not settle`);
      await pending;
      check(routeError === undefined, `${scenario.name}: route must return rather than throw`);
      check(response?.status === scenario.expectedStatus, `${scenario.name}: status ${response?.status}, expected ${scenario.expectedStatus}`);
      check(now === scenario.expectedTime, `${scenario.name}: ended at ${now}, expected ${scenario.expectedTime}`);
      check(starts.length === scenario.expectedCalls, `${scenario.name}: ${starts.length} attempts, expected ${scenario.expectedCalls}`);
      check(JSON.stringify(starts) === JSON.stringify(scenario.expectedStarts), `${scenario.name}: starts ${starts}, expected ${scenario.expectedStarts}`);
      check(starts.length <= 2, `${scenario.name}: never exceed two reserved attempts`);
      check(reservations.length === 1 && settlements.length === 1 && settlements[0]?.reservationId === reservations[0]?.id, `${scenario.name}: reserve once and settle the same receipt once`);
      if (starts.length > 1 || response?.status !== 200) check(settlements[0]?.actualMillicents === undefined, `${scenario.name}: unknown prior usage retains the pessimistic reservation`);
      check(bodies.every(body => !Object.hasOwn(body, "attemptTimeoutMs")), `${scenario.name}: client attempt timeout never crosses the provider boundary`);
      check(bodies.every(body => body.stream === false && body.n === 1), `${scenario.name}: fixed nonstreaming single-response body`);
      if (response) await response.text();
      console.log(JSON.stringify({ scenario: scenario.name, status: response?.status, elapsedMs: now, starts, aborts }));
    } finally {
      globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; Date.now = realNow;
      resetTurnGrantsForTests();
    }
  };
  for (const scenario of [
    { name: "azure scene completes in 26s", responseAfter: 26_000, expectedStatus: 200, expectedTime: 26_000, expectedCalls: 1, expectedStarts: [0] },
    { name: "short 20s deadline remains", deadline: 20_000, responseAfter: 26_000, expectedStatus: 500, expectedTime: 20_000, expectedCalls: 1, expectedStarts: [0] },
    { name: "client leaves at 8s", abortAfter: 8000, responseAfter: 26_000, expectedStatus: 500, expectedTime: 8000, expectedCalls: 1, expectedStarts: [0] },
    { name: "reservation consumes 8s of 30s", reserveAfter: 8000, responseAfter: 26_000, expectedStatus: 500, expectedTime: 30_000, expectedCalls: 1, expectedStarts: [8000] },
    { name: "reservation plus valid response fits", reserveAfter: 8000, responseAfter: 20_000, expectedStatus: 200, expectedTime: 28_000, expectedCalls: 1, expectedStarts: [8000] },
    { name: "one 503 then 26s response", transient: "first", responseAfter: 26_000, expectedStatus: 200, expectedTime: 26_250, expectedCalls: 2, expectedStarts: [0, 250] },
    { name: "network error then 26s response", transient: "network", responseAfter: 26_000, expectedStatus: 200, expectedTime: 26_250, expectedCalls: 2, expectedStarts: [0, 250] },
    { name: "two 503 attempts maximum", transient: "always", expectedStatus: 502, expectedTime: 250, expectedCalls: 2, expectedStarts: [0, 250] },
    { name: "stall ends at 30s", expectedStatus: 500, expectedTime: 30_000, expectedCalls: 1, expectedStarts: [0] },
    { name: "long outer retains 30s attempts", deadline: 60_000, expectedStatus: 500, expectedTime: 60_000, expectedCalls: 2, expectedStarts: [0, 30_250] },
    { name: "fireworks retains 25s", provider: "fireworks", responseAfter: 26_000, expectedStatus: 500, expectedTime: 30_000, expectedCalls: 2, expectedStarts: [0, 25_250] },
    ...(["turn", "ir", "code", "picker", "legacy"] as const).map(lane => ({ name: `${lane} retains 25s`, lane, responseAfter: 26_000, expectedStatus: 500, expectedTime: 30_000, expectedCalls: 2, expectedStarts: [0, 25_250] })),
    { name: "client tiny timeout ignored", clientAttemptTimeout: 1, responseAfter: 26_000, expectedStatus: 200, expectedTime: 26_000, expectedCalls: 1, expectedStarts: [0] },
  ] satisfies Scenario[]) await run(scenario);
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(`Scene request deadlines passed (${checks} route, timeout and reservation checks).`);
}

void main().finally(() => {
  globalThis.fetch = realFetch; globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; Date.now = realNow;
  for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}).catch(error => { console.error(error); process.exitCode = 1; });
