import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import type { SpendActor } from "../../lib/billing/actor";
import type { PeriodBalance } from "../../lib/billing/ledgerMath";

// Server-owned chat parameters (planner temperature, perf metrics) and the
// hedged teaching contract: a second concurrent teaching request on the same
// trace is admitted, tagged, and the aborted one settles exactly once.
//
// The route section fakes only authentication, persistence, telemetry, and the
// provider; the HTTP route, billing gate, grants, and reservations are real.
// It needs module mocks, so a plain `tsx` run re-executes itself with them.
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
const path = (relative: string) => resolve(root, relative);
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
process.env.FIREWORKS_API_KEY = "chat-params-test-key";
process.env.BILLING_PROVIDER = "";
process.env.AUTUMN_ENABLED = "0";
globalThis.fetch = async () => {
  throw new Error("External network is prohibited in chat parameter verification");
};

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
    // An unplanned question would reason; the hedge's retry header must win.
    resolveReasoningEffort: () => "medium",
    tutorDebug: () => undefined,
    getMockResponse: () => {
      throw new Error("Configured chat verification cannot use mock lessons");
    },
    getMockCodeLessonPlan: () => {
      throw new Error("Configured chat verification cannot use mock code lessons");
    },
  },
});

let actor: SpendActor;
let remaining = 0;
let testNumber = 0;
const reservations = new Map<string, number>();
const settlements: { id: string; reserved: number; actual: number | undefined }[] = [];
let reservationCounter = 0;
const ownedTraces = new Map<string, { userId: string; expiresAt: Date }>();
const generations: { turn: { seq: number }; params: { metadata?: Record<string, unknown>; level?: string } }[] = [];
let turnSeq = 0;

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
      const id = `reservation-${testNumber}-${reservationCounter++}`;
      reservations.set(id, millicents);
      remaining -= millicents;
      return { id, amountMillicents: millicents, remainingMillicents: remaining, planId: "free" };
    },
    settlePeriodUsage: async ({ reservationId, actualMillicents }: { reservationId: string; actualMillicents?: number }) => {
      const reserved = reservations.get(reservationId);
      assert.notEqual(reserved, undefined, "a reservation settles at most once");
      settlements.push({ id: reservationId, reserved: reserved!, actual: actualMillicents });
      remaining += reserved! - Math.min(reserved!, actualMillicents ?? reserved!);
      reservations.delete(reservationId);
    },
  },
});
mock.module(path("lib/obs/langfuse.ts"), {
  namedExports: {
    genTraceId: () => `server-trace-${testNumber}`,
    startTurnTrace: () => ({ seq: ++turnSeq }),
    endLlmGeneration: (turn: { seq: number }, params: { metadata?: Record<string, unknown>; level?: string }) => {
      generations.push({ turn, params });
    },
    flushInBackground: () => undefined,
  },
});

const chatRequestModule = load(path("lib/llm/chatRequest.ts")) as typeof import("../../lib/llm/chatRequest");
const chatTrace = load(path("lib/obs/chatTrace.ts")) as typeof import("../../lib/obs/chatTrace");
const grants = load(path("lib/billing/grant.ts")) as typeof import("../../lib/billing/grant");
const fuses = load(path("lib/billing/fuses.ts")) as typeof import("../../lib/billing/fuses");
const chat = load(path("app/api/chat/route.ts")) as typeof import("../../app/api/chat/route");
const { serverChatBody, plannerTemperature, isTeachingHedge, TEACHING_TEMPERATURE } = chatRequestModule;

const messages = [{ role: "user", content: "Explain force." }];
const encoder = new TextEncoder();

// ---------------------------------------------------------------- pure body
const unitChecks: [string, () => void][] = [
  ["planner temperature is honoured inside [0, 1]", () => {
    assert.equal(serverChatBody({ messages, temperature: 0 }, "planner").temperature, 0);
    assert.equal(serverChatBody({ messages, temperature: 0.2 }, "planner").temperature, 0.2);
    assert.equal(serverChatBody({ messages, temperature: 1 }, "planner").temperature, 1);
  }],
  ["planner temperature is clamped into [0, 1]", () => {
    assert.equal(serverChatBody({ messages, temperature: 1.7 }, "planner").temperature, 1);
    assert.equal(serverChatBody({ messages, temperature: -0.5 }, "planner").temperature, 0);
    assert.equal(plannerTemperature(2), 1);
  }],
  ["planner temperature defaults to 0 when absent or not a finite number", () => {
    assert.equal(serverChatBody({ messages }, "planner").temperature, 0);
    for (const temperature of ["0.9", null, Number.NaN, Number.POSITIVE_INFINITY, true, {}]) {
      assert.equal(serverChatBody({ messages, temperature }, "planner").temperature, 0, `rejects ${String(temperature)}`);
    }
  }],
  ["teaching keeps the server temperature whatever the client asks", () => {
    assert.equal(TEACHING_TEMPERATURE, 0.3);
    assert.equal(serverChatBody({ messages, temperature: 0 }).temperature, 0.3);
    assert.equal(serverChatBody({ messages, temperature: 1.5 }, "teaching").temperature, 0.3);
    assert.equal(serverChatBody({ messages }, "teaching").temperature, 0.3);
  }],
  ["every body asks for one completion and provider perf metrics, nothing else from the client", () => {
    for (const kind of ["planner", "teaching"] as const) {
      const body = serverChatBody({
        messages: [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }],
        n: 4, best_of: 4, tools: [{}], stream: false, response_format: { type: "json_object" },
        perf_metrics_in_response: false, model: "client-model", max_tokens: 99_999, logprobs: true,
      }, kind);
      assert.deepEqual(Object.keys(body).sort(), ["messages", "n", "perf_metrics_in_response", "temperature"]);
      assert.equal(body.n, 1);
      assert.equal(body.perf_metrics_in_response, true);
      assert.deepEqual(body.messages, [{ role: "user", content: "a\nb" }]);
    }
  }],
  ["invalid messages are still rejected for both kinds", () => {
    const invalid: unknown[] = [
      null, {}, { messages: [] }, { messages: "hi" },
      { messages: Array.from({ length: 65 }, () => ({ role: "user", content: "x" })) },
      { messages: [{ role: "tool", content: "x" }] },
      { messages: [{ role: "user" }] },
      { messages: [{ role: "user", content: 42 }] },
      { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:" } }] }] },
      { messages: [{ role: "user", content: [{ type: "text", text: 1 }] }] },
    ];
    for (const kind of ["planner", "teaching"] as const) {
      for (const value of invalid) assert.throws(() => serverChatBody(value, kind), Error, JSON.stringify(value)?.slice(0, 60));
    }
  }],
  ["the hedge header is read only as the exact value 1", () => {
    assert.equal(isTeachingHedge(new Headers({ "x-heytutor-teaching-hedge": "1" })), true);
    assert.equal(isTeachingHedge(new Headers({ "x-heytutor-teaching-hedge": "true" })), false);
    assert.equal(isTeachingHedge(new Headers()), false);
  }],
  ["provider perf metrics read the Fireworks shape, headers, and the older names", () => {
    assert.deepEqual(
      chatTrace.providerPerfMetadata({ "server-time-to-first-token": 0.25, "server-processing-time": "1.25" }, { completionTokens: 500 }),
      { ttft_ms: 250, tokens_per_sec: 500, provider_processing_ms: 1250 },
    );
    assert.deepEqual(
      chatTrace.providerPerfMetadata(undefined, {
        headers: new Headers({ "fireworks-server-time-to-first-token": "0.1", "fireworks-server-processing-time": "0.6" }),
        completionTokens: 100,
      }),
      { ttft_ms: 100, tokens_per_sec: 200, provider_processing_ms: 600 },
    );
    assert.deepEqual(chatTrace.providerPerfMetadata({ ttft_ms: 42, tokens_per_sec: 90 }), { ttft_ms: 42, tokens_per_sec: 90 });
    assert.deepEqual(chatTrace.providerPerfMetadata({ "server-time-to-first-token": "n/a" }), {});
    assert.deepEqual(chatTrace.providerPerfMetadata(null), {});
  }],
  ["route timings split setup, connect, and first content", () => {
    assert.deepEqual(
      chatTrace.chatTimingMetadata({ requestStartedAt: 1000, upstreamStartedAt: 1300, responseHeadersAt: 1500, firstContentAt: 2300 }),
      { server_setup_ms: 300, connect_ms: 200, ttft_content_ms: 1000 },
    );
    assert.deepEqual(chatTrace.chatTimingMetadata({ requestStartedAt: 1000, upstreamStartedAt: 1300 }), { server_setup_ms: 300 });
  }],
];

// ---------------------------------------------------------------- route
function arrange(credits = 10_000_000): string {
  grants.resetTurnGrantsForTests();
  fuses.resetBillingFusesForTests();
  testNumber += 1;
  actor = {
    userId: `chat-params-user-${testNumber}`,
    email: null,
    staff: false,
    lectureLab: false,
    skipAutumn: true,
    skipGates: false,
  } as SpendActor;
  remaining = credits;
  reservations.clear();
  settlements.length = 0;
  reservationCounter = 0;
  ownedTraces.clear();
  generations.length = 0;
  turnSeq = 0;
  const traceId = `chat-params-trace-${testNumber}`;
  ownedTraces.set(traceId, { userId: actor.userId, expiresAt: new Date(Date.now() + 86_400_000) });
  const result = grants.createLessonGrant({ userId: actor.userId, traceId, usdMillicents: credits });
  assert(result.ok, "the test lesson is authorized before exercising the route");
  return traceId;
}

function chatRequest(traceId: string, options: { headers?: Record<string, string>; body?: Record<string, unknown>; signal?: AbortSignal } = {}): Request {
  return new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-heytutor-trace-id": traceId, ...options.headers },
    body: JSON.stringify({ messages, stream: true, temperature: 0.3, ...options.body }),
    signal: options.signal,
  });
}

const HEDGE_HEADERS = { "x-heytutor-teaching-hedge": "1", "x-heytutor-reasoning-retry": "1" };

interface Upstream {
  body: Record<string, unknown>;
  controller: ReadableStreamDefaultController<Uint8Array>;
  cancelled: boolean;
}

/** Each provider call gets a stream the test drives; an aborted fetch signal
 * errors it, like undici does. */
function installHeldProvider(upstreams: Upstream[]): void {
  globalThis.fetch = async (_url, options) => {
    const upstream = { body: JSON.parse(String(options?.body)) as Record<string, unknown>, cancelled: false } as Upstream;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { upstream.controller = controller; },
      cancel() { upstream.cancelled = true; },
    });
    const signal = options?.signal;
    signal?.addEventListener("abort", () => {
      upstream.cancelled = true;
      try { upstream.controller.error(signal.reason); } catch { /* already closed */ }
    }, { once: true });
    upstreams.push(upstream);
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  };
}

function sse(payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

async function settleMicrotasks(): Promise<void> {
  for (let count = 0; count < 6; count += 1) await new Promise<void>((done) => setImmediate(done));
}

function pendingAi(): number {
  return grants.getTurnGrant(actor.userId)?.paidCallsPending.get("ai") ?? 0;
}

function generationFor(seq: number) {
  const matches = generations.filter((entry) => entry.turn.seq === seq);
  assert.equal(matches.length, 1, `generation ${seq} ends exactly once`);
  return matches[0]!.params;
}

const routeChecks: [string, () => Promise<void>][] = [
  ["planner calls forward the requested temperature and record provider perf metrics", async () => {
    const trace = arrange();
    const forwarded: Record<string, unknown>[] = [];
    globalThis.fetch = async (_url, options) => {
      forwarded.push(JSON.parse(String(options?.body)) as Record<string, unknown>);
      return Response.json({
        choices: [{ message: { content: '{"schemaVersion":"turn-plan/v3"}' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
        perf_metrics: { "server-time-to-first-token": 0.25, "server-processing-time": 1.25 },
      });
    };
    for (const temperature of [0, 0.6, undefined]) {
      const request = chatRequest(trace, { headers: { "x-planner": "1", "x-turn-planner-version": "3" }, body: { stream: false, temperature } });
      const response = await chat.POST(request);
      assert.equal(response.status, 200);
      const parsed = await response.json() as { perf_metrics?: unknown };
      assert(parsed.perf_metrics, "the planner JSON still reaches the client unchanged");
    }
    assert.deepEqual(forwarded.map((body) => body.temperature), [0, 0.6, 0]);
    assert(forwarded.every((body) => body.perf_metrics_in_response === true && body.n === 1 && body.stream === false));
    const metadata = generations[0]!.params.metadata!;
    assert.equal(metadata.ttft_ms, 250);
    assert.equal(metadata.tokens_per_sec, 500);
    assert.equal(metadata.temperature, 0);
    assert.equal(typeof metadata.server_setup_ms, "number");
    assert.equal(typeof metadata.connect_ms, "number");
    await settleMicrotasks();
    assert.equal(reservations.size, 0, "every planner reservation settles");
  }],
  ["teaching keeps 0.3 and records provider and route timings", async () => {
    const trace = arrange();
    const upstreams: Upstream[] = [];
    installHeldProvider(upstreams);
    const response = await chat.POST(chatRequest(trace, { body: { temperature: 0 } }));
    assert.equal(response.status, 200);
    const upstream = upstreams[0]!;
    assert.equal(upstream.body.temperature, 0.3);
    assert.equal(upstream.body.perf_metrics_in_response, true);
    assert.equal(upstream.body.stream, true);
    upstream.controller.enqueue(sse({ choices: [{ delta: { content: "Force is a push." } }] }));
    upstream.controller.enqueue(sse({
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 800, completion_tokens: 200 },
      perf_metrics: { "server-time-to-first-token": "0.5", "server-processing-time": "1.5" },
    }));
    upstream.controller.close();
    assert.match(await response.text(), /Force is a push/);
    await settleMicrotasks();
    const metadata = generationFor(1).metadata!;
    assert.equal(metadata.ttft_ms, 500);
    assert.equal(metadata.tokens_per_sec, 200);
    assert.equal(typeof metadata.server_setup_ms, "number");
    assert.equal(typeof metadata.connect_ms, "number");
    assert.equal(typeof metadata.ttft_content_ms, "number");
    assert.equal(metadata.teaching_hedge, undefined, "an ordinary call is not tagged as a hedge");
    assert.equal(reservations.size, 0);
    assert.equal(pendingAi(), 0);
  }],
  ["a hedge on the same trace is admitted while the first stream is silent; the aborted one settles once", async () => {
    const trace = arrange();
    const upstreams: Upstream[] = [];
    installHeldProvider(upstreams);
    const firstAbort = new AbortController();
    const first = await chat.POST(chatRequest(trace, { signal: firstAbort.signal }));
    assert.equal(first.status, 200);
    upstreams[0]!.controller.enqueue(sse({ choices: [{ delta: { reasoning_content: "thinking" } }] }));

    const hedge = await chat.POST(chatRequest(trace, { headers: HEDGE_HEADERS }));
    assert.equal(hedge.status, 200, "the hedge is not rejected or rate limited");
    assert.equal(upstreams.length, 2, "both requests reach the provider");
    assert.deepEqual(upstreams[1]!.body.thinking, { type: "disabled" }, "the hedge runs with reasoning off");
    assert.equal(grants.getTurnGrant(actor.userId)?.inUse, 2);
    assert.equal(pendingAi(), 2);
    assert.equal(reservations.size, 2);

    // The client aborts the silent first request: the fetch signal fires and
    // the server cancels the response body.
    firstAbort.abort(new DOMException("hedge won", "AbortError"));
    await first.body!.cancel("hedge won").catch(() => undefined);
    await settleMicrotasks();
    assert.equal(upstreams[0]!.cancelled, true, "the aborted request stops the upstream generation");
    assert.equal(settlements.length, 1, "the aborted reservation settles");
    const aborted = settlements[0]!;
    assert(aborted.actual !== undefined && aborted.actual > 0 && aborted.actual <= aborted.reserved,
      "an aborted, dispatched request keeps a bounded charge and refunds the retry headroom");
    assert.equal(grants.getTurnGrant(actor.userId)?.inUse, 1, "the aborted request releases its in-use slot");
    assert.equal(pendingAi(), 1, "the aborted request releases its admission slot");
    const abortedGeneration = generationFor(1);
    assert.equal(abortedGeneration.metadata?.aborted, true);
    assert.equal(abortedGeneration.metadata?.teaching_hedge, undefined);

    const winner = upstreams[1]!;
    winner.controller.enqueue(sse({ choices: [{ delta: { content: "Force is a push." } }] }));
    winner.controller.enqueue(sse({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 800, completion_tokens: 200 } }));
    winner.controller.close();
    assert.match(await hedge.text(), /Force is a push/);
    await settleMicrotasks();
    assert.equal(settlements.length, 2, "each reservation settles exactly once");
    const won = settlements[1]!;
    assert(won.actual !== undefined && won.actual < won.reserved, "the completed hedge settles at its actual usage");
    assert.equal(reservations.size, 0, "no reservation leaks");
    assert.equal(grants.getTurnGrant(actor.userId)?.inUse, 0);
    assert.equal(pendingAi(), 0);
    assert.equal(generationFor(2).metadata?.teaching_hedge, true, "the hedge is tagged in Langfuse");
  }],
  ["the client may instead abort the hedge before its headers arrive", async () => {
    const trace = arrange();
    const upstreams: Upstream[] = [];
    installHeldProvider(upstreams);
    const first = await chat.POST(chatRequest(trace));
    assert.equal(first.status, 200);
    const hedgeAbort = new AbortController();
    globalThis.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    });
    const pendingHedge = chat.POST(chatRequest(trace, { headers: HEDGE_HEADERS, signal: hedgeAbort.signal }));
    await settleMicrotasks();
    assert.equal(reservations.size, 2, "the hedge reserved before dispatch");
    hedgeAbort.abort(new DOMException("first spoke", "AbortError"));
    const hedge = await pendingHedge;
    assert.equal(hedge.status, 500);
    await settleMicrotasks();
    assert.equal(settlements.length, 1);
    assert(settlements[0]!.actual! <= settlements[0]!.reserved, "the dispatched hedge keeps one bounded attempt");
    assert.equal(grants.getTurnGrant(actor.userId)?.inUse, 1);
    assert.equal(pendingAi(), 1);
    const hedgeGeneration = generationFor(2);
    assert.equal(hedgeGeneration.metadata?.teaching_hedge, true);
    assert.equal(hedgeGeneration.metadata?.aborted, true);

    upstreams[0]!.controller.enqueue(sse({ choices: [{ delta: { content: "Force." } }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
    upstreams[0]!.controller.close();
    await first.text();
    await settleMicrotasks();
    assert.equal(reservations.size, 0);
    assert.equal(pendingAi(), 0);
  }],
  ["a hedge still counts toward the trace's finite teaching allowance", async () => {
    const trace = arrange();
    globalThis.fetch = async () => new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
    const statuses: number[] = [];
    for (let count = 0; count < 5; count += 1) {
      const response = await chat.POST(chatRequest(trace, { headers: count === 1 ? HEDGE_HEADERS : {} }));
      statuses.push(response.status);
      await response.text();
      await settleMicrotasks();
    }
    assert.deepEqual(statuses, [200, 200, 200, 200, 429], "the hedge does not buy a fifth teaching call");
  }],
];

async function main(): Promise<void> {
  const failures: string[] = [];
  try {
    for (const [name, run] of unitChecks) {
      try { run(); console.log(`ok ${name}`); }
      catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    for (const [name, run] of routeChecks) {
      try { await run(); console.log(`ok ${name}`); }
      catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); }
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    grants.resetTurnGrantsForTests();
    fuses.resetBillingFusesForTests();
    mock.restoreAll();
  }
  if (failures.length > 0) {
    console.error(`${failures.length}/${unitChecks.length + routeChecks.length} chat parameter checks failed`);
    process.exit(1);
  }
  console.log("chat request params verification passed");
}

void main();
