import assert from "node:assert/strict";
import { mock } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// The real chat route, billing gate, grant, provider translation and transport run.
// Only identity/persistence and the network/clock are synthetic fixtures.
// No provider call or scientific-coverage claim is made by this gate.
const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const actor = { userId: "planner-deadline-enforcement-fixture", email: null, staff: false, lectureLab: false, skipAutumn: true, skipGates: false };
const billing = resolve(root, "lib/billing");
const reservations: Array<{ id: string; millicents: number }> = [];
const settlements: Array<{ reservationId: string; actualMillicents?: number }> = [];
mock.module(resolve(billing, "actor.ts"), { namedExports: { requireSpendActor: async () => actor, isSpendActor: () => true } });
mock.module(resolve(billing, "ledger.ts"), { namedExports: {
  loadPeriodBalance: async () => ({ remainingMillicents: 3500, remainingPct: 100, planId: "free" }),
  cacheUsageOnUser: async () => undefined,
  reservePeriodUsage: async (input: { millicents: number; reservationId?: string }) => {
    if (input.reservationId) {
      const receipt = reservations.find(value => value.id === input.reservationId);
      assert(receipt, "retry funding extends an existing receipt");
      receipt.millicents += input.millicents;
      return { id: receipt.id, amountMillicents: receipt.millicents, remainingMillicents: 3500, planId: "free" };
    }
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
  TUTOR_DEBUG: "1",
  LANGFUSE_ENABLED: "0", SENTRY_ENABLED: "0", SENTRY_DSN: undefined, NEXT_PUBLIC_SENTRY_DSN: undefined,
  LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://planner-deadline-enforcement-fixture.invalid",
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
const realLog = console.log;
const clockEpoch = realNow();
const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string) { checks++; if (!condition) failures.push(message); }

async function verifyTransportAbortEdges() {
  const { fetchPlannerCompletion, readPlannerResponseText, untilPlannerRequestAborted } = load(resolve(root,
    "lib/llm/plannerTransport.ts")) as typeof import("../../lib/llm/plannerTransport");
  const reason = new DOMException("Synthetic cancellation", "AbortError");
  const raceController = new AbortController();
  let discarded = 0;
  const racing = untilPlannerRequestAborted(Promise.resolve("late success"), raceController.signal, () => { discarded++; });
  // Abort between the pending promise's fulfillment and the race's continuation.
  queueMicrotask(() => raceController.abort(reason));
  check(await racing.then(() => false, error => error === reason), "a queued success cannot win after cancellation");
  check(discarded === 1, "a queued late success is discarded exactly once");

  const bodyController = new AbortController();
  bodyController.abort(reason);
  let cancelled = 0;
  const body = new Response(new ReadableStream({ cancel() { cancelled++; } }));
  check(await readPlannerResponseText(body, bodyController.signal).then(() => false, error => error === reason),
    "a body read rejects an already-aborted signal");
  check(cancelled === 1 && !body.body?.locked, "a body discarded before reading is cancelled and unlocked");

  const fundingController = new AbortController();
  let dispatches = 0;
  check(await fetchPlannerCompletion({
    apiKey: "synthetic-only", url: "https://fixture.invalid", models: ["fixture"], body: {},
    signal: fundingController.signal,
    beforeAttempt: async () => { fundingController.abort(reason); },
    fetchImpl: async () => { dispatches++; return new Response("discarded"); },
  }).then(() => false, error => error === reason), "cancellation during funding rejects before dispatch");
  check(dispatches === 0, "funding that finishes after cancellation cannot start an upstream attempt");

  for (const networkFailure of [false, true]) {
    const controller = new AbortController();
    let attempts = 0;
    check(await fetchPlannerCompletion({
      apiKey: "synthetic-only", url: "https://fixture.invalid", models: ["fixture"], body: {},
      signal: controller.signal,
      fetchImpl: async () => {
        attempts++;
        if (networkFailure) throw new TypeError("Synthetic network failure");
        return new Response("busy", { status: 503 });
      },
      sleep: () => { controller.abort(reason); return new Promise<void>(() => undefined); },
    }).then(() => false, error => error === reason), `an uncooperative ${networkFailure ? "network" : "status"} retry sleep is bounded`);
    check(attempts === 1, "cancellation during retry sleep cannot dispatch another attempt");
  }

  const encoded = new TextEncoder().encode("\uFEFFsplit \u03C0 \uD83D\uDE42");
  const chunked = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  check(await readPlannerResponseText(chunked) === "split \u03C0 \uD83D\uDE42", "chunked UTF-8 text preserves Response.text decoding");
}

interface Scenario {
  name: string;
  headerAfter: number;
  bodyAfter?: number;
  abortAfter?: number;
  status?: number;
  retryAfter?: string;
  deadline?: number;
  turnPlan?: boolean;
  cancelAfter?: number;
  expectedStatus: number;
  expectedTime: number;
  expectedCalls: number;
}

async function main() {
  globalThis.fetch = async () => { throw new Error("No real network is permitted in this gate"); };
  for (const [key, value] of Object.entries(fixtureEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  let edgeWatchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([verifyTransportAbortEdges(), new Promise<never>((_, reject) => {
      edgeWatchdog = realSet(() => reject(new Error("Transport abort checks stalled")), 5000);
    })]);
  } finally {
    if (edgeWatchdog !== undefined) realClear(edgeWatchdog);
  }
  const { createLessonGrant, resetTurnGrantsForTests } = load(resolve(billing, "grant.ts")) as typeof import("../../lib/billing/grant");
  const chat = load(resolve(root, "app/api/chat/route.ts")) as typeof import("../../app/api/chat/route");
  const run = async (scenario: Scenario) => {
    let now = 0; let nextId = 0; let finished = false; let response: Response | undefined; let routeError: unknown;
    const timers = new Map<number, { at: number; callback: () => void }>();
    const starts: number[] = [];
    const aborts: number[] = [];
    const cancelledBodies: number[] = [];
    const bodies: Record<string, unknown>[] = [];
    const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
    const plannerMessages = ["provider fetch failed", "transient provider response", "provider response", "provider body", "proxy error"];
    console.log = (...args: unknown[]) => {
      const line = args[0];
      if (typeof line === "string" && line.startsWith("[tutor:")) {
        for (const message of plannerMessages) {
          const marker = ` ${message} `;
          const at = line.indexOf(marker);
          if (line.startsWith("[tutor:planner]") && at !== -1) logs.push({ message, data: JSON.parse(line.slice(at + marker.length)) });
        }
        return;
      }
      realLog(...args);
    };
    globalThis.setTimeout = ((callback: () => void, delay = 0) => {
      const id = ++nextId;
      timers.set(id, { at: now + Number(delay), callback });
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: unknown) => { timers.delete(Number(id)); }) as typeof clearTimeout;
    Date.now = () => clockEpoch + now;
    reservations.length = 0; settlements.length = 0;
    resetTurnGrantsForTests();
    assert(createLessonGrant({ userId: actor.userId, traceId: "planner-deadline-enforcement-trace", usdMillicents: 3500 }).ok);
    globalThis.fetch = async (url, init) => {
      const expectedUrl = "https://planner-deadline-enforcement-fixture.invalid/openai/v1/chat/completions";
      assert.equal(String(url), expectedUrl, "every request is handled locally by the provider fixture");
      assert.equal(reservations.length, 1, "reserve before any upstream attempt");
      assert.equal(settlements.length, 0, "do not reconcile a request before its final outcome");
      starts.push(now);
      bodies.push(JSON.parse(String(init?.body)));
      // The fixture deliberately ignores fetch cancellation, matching the bug.
      init?.signal?.addEventListener("abort", () => { aborts.push(now); }, { once: true });
      await new Promise<void>(resolve => setTimeout(resolve, scenario.headerAfter));
      const content = JSON.stringify({ choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => {
            try { controller.enqueue(new TextEncoder().encode(content)); controller.close(); }
            catch { /* A bounded reader has already cancelled this late stream. */ }
          }, scenario.bodyAfter ?? 0);
        },
        cancel() {
          cancelledBodies.push(now);
          if (scenario.cancelAfter !== undefined) return new Promise<void>(resolve => setTimeout(resolve, scenario.cancelAfter));
        },
      });
      return new Response(body, { status: scenario.status ?? 200,
        ...(scenario.retryAfter ? { headers: { "retry-after": scenario.retryAfter } } : {}),
      });
    };
    const controller = new AbortController();
    if (scenario.abortAfter !== undefined) setTimeout(() => controller.abort(new DOMException("Synthetic client left", "AbortError")), scenario.abortAfter);
    const headers: Record<string, string> = {
      "content-type": "application/json", "x-heytutor-trace-id": "planner-deadline-enforcement-trace", "x-heytutor-fast-mode": "0",
      "x-planner": "1", "x-planner-deadline-ms": String(scenario.deadline ?? 20_000), "x-scene-planner-version": "2",
      ...(scenario.turnPlan ? { "x-turn-planner-version": "3" } : {}),
    };
    const pending = chat.POST(new Request("https://fixture.invalid/api/chat", { method: "POST", headers, signal: controller.signal,
      body: JSON.stringify({ messages: [{ role: "user", content: "Explain a synthetic circuit." }], attemptTimeoutMs: 999_999 }),
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

      check(starts.length <= 2, `${scenario.name}: never exceed two reserved attempts`);
      check(reservations.length === 1 && settlements.length === 1 && settlements[0]?.reservationId === reservations[0]?.id, `${scenario.name}: reserve once and settle the same receipt once`);
      if (starts.length > 1 || response?.status !== 200) check(settlements[0]?.actualMillicents === undefined, `${scenario.name}: unknown prior usage retains the pessimistic reservation`);
      else check(typeof settlements[0]?.actualMillicents === "number" && settlements[0].actualMillicents > 0 && settlements[0].actualMillicents < reservations[0]!.millicents,
        `${scenario.name}: a single successful attempt still settles known usage`);
      if (scenario.bodyAfter !== undefined && response?.status !== 200) check(cancelledBodies.includes(scenario.expectedTime), `${scenario.name}: abort cancels a body already being read`);
      check(bodies.every(body => !Object.hasOwn(body, "attemptTimeoutMs")), `${scenario.name}: client attempt timeout never crosses the provider boundary`);
      check(bodies.every(body => body.stream === false && body.n === 1), `${scenario.name}: fixed nonstreaming single-response body`);
      check(logs.length > 0 && logs.every(log => log.data.trace_id === "planner-deadline-enforcement-trace" && log.data.planner_phase === "plan" && log.data.planner_lane === "primary"),
        `${scenario.name}: response, retry, body and error timings identify their trace, phase and lane`);
      const bodyLog = logs.find(log => log.message === "provider body");
      check(Boolean(bodyLog) === (response?.status === 200), `${scenario.name}: only a timely successful body records completion`);
      if (bodyLog) check(bodyLog.data.body_read_ms === (scenario.bodyAfter ?? 0) && bodyLog.data.elapsed_ms === scenario.expectedTime,
        `${scenario.name}: body read and total elapsed timings are separate`);
      const errorLog = logs.find(log => log.message === "proxy error");
      if (response?.status === 500 && !scenario.turnPlan) check(errorLog?.data.abort_source === (scenario.abortAfter !== undefined ? "client_closed" : "server_deadline"),
        `${scenario.name}: current-main abort-source diagnostics survive`);
      if (response) await response.text();
      const endedAt = now;
      const settled = JSON.stringify(settlements);
      const logged = logs.length;
      // Let ignored upstream completions settle. They may not mutate accounting
      // or publish a successful response after the caller's deadline.
      for (let step = 0; step < 20 && timers.size > 0; step++) {
        const timer = [...timers.entries()].sort((a,b) => a[1].at - b[1].at || a[0] - b[0])[0]!;
        now = timer[1].at; timers.delete(timer[0]); timer[1].callback();
        for (let drain = 0; drain < 4; drain++) await new Promise<void>(resolve => realImmediate(resolve));
      }
      check(settlements.length === 1, `${scenario.name}: late work cannot settle a second time`);
      check(JSON.stringify(settlements) === settled && logs.length === logged, `${scenario.name}: late completions cannot alter accounting or publish completion logs`);
      if (scenario.headerAfter > scenario.expectedTime) check(cancelledBodies.length > 0, `${scenario.name}: a late response body is discarded`);
      console.log(JSON.stringify({ scenario: scenario.name, status: response?.status, elapsedMs: endedAt, starts, aborts, cancelledBodies }));
    } finally {
      globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; Date.now = realNow;
      console.log = realLog;
      resetTurnGrantsForTests();
    }
  };
  for (const scenario of [
    { name: "late headers ignore deadline", headerAfter: 35_000, expectedStatus: 500, expectedTime: 20_000, expectedCalls: 1 },
    { name: "late headers ignore client cancellation", headerAfter: 12_000, abortAfter: 8000, expectedStatus: 500, expectedTime: 8000, expectedCalls: 1 },
    { name: "body stalls past deadline", headerAfter: 5000, bodyAfter: 30_000, expectedStatus: 500, expectedTime: 20_000, expectedCalls: 1 },
    { name: "client cancels during body read", headerAfter: 5000, bodyAfter: 7000, abortAfter: 8000, expectedStatus: 500, expectedTime: 8000, expectedCalls: 1 },
    { name: "retained retry body stalls", status: 503, headerAfter: 5000, bodyAfter: 30_000, expectedStatus: 500, expectedTime: 20_000, expectedCalls: 1 },
    { name: "retained unavailable body stalls", status: 404, headerAfter: 5000, bodyAfter: 30_000, expectedStatus: 500, expectedTime: 20_000, expectedCalls: 1 },
    { name: "body cancellation itself stalls", headerAfter: 5000, bodyAfter: 30_000, cancelAfter: 30_000, expectedStatus: 500, expectedTime: 20_000, expectedCalls: 1 },
    { name: "retry delay cannot extend deadline", status: 503, retryAfter: "2", headerAfter: 19_000, expectedStatus: 500, expectedTime: 20_000, expectedCalls: 1 },
    { name: "attempt deadlines ignore uncooperative fetch", headerAfter: 40_000, deadline: 60_000, turnPlan: true, expectedStatus: 500, expectedTime: 50_250, expectedCalls: 2 },
    { name: "error body cancellation cannot stall route", status: 400, headerAfter: 5000, cancelAfter: 30_000, expectedStatus: 500, expectedTime: 20_000, expectedCalls: 1 },
    { name: "body before deadline still succeeds", headerAfter: 5000, bodyAfter: 9000, expectedStatus: 200, expectedTime: 14_000, expectedCalls: 1 },
    { name: "ordinary successful response preserved", headerAfter: 5000, expectedStatus: 200, expectedTime: 5000, expectedCalls: 1 },
    { name: "ordinary failure status preserved", status: 400, headerAfter: 5000, expectedStatus: 502, expectedTime: 5000, expectedCalls: 1 },
  ] satisfies Scenario[]) await run(scenario);
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(`Planner deadline enforcement passed (${checks} route, timeout and reservation checks).`);
}

void main().finally(() => {
  globalThis.fetch = realFetch; globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; Date.now = realNow;
  console.log = realLog;
  for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}).catch(error => { console.error(error); process.exitCode = 1; });
