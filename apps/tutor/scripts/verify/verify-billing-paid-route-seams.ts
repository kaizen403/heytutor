import { mock } from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
// Import the real, independent header parser while excluding unrelated scene
// compilation initialization from this paid-HTTP boundary test.
const headers = load(resolve(root, "../../packages/tutor-core/src/llm/traceHeaders.ts")) as typeof import("../../../../packages/tutor-core/src/llm/traceHeaders");
const fastMode = load(resolve(root, "../../packages/tutor-core/src/llm/fastMode.ts"));
const reasoning = load(resolve(root, "../../packages/tutor-core/src/llm/reasoningEffort.ts"));
const debug = load(resolve(root, "../../packages/tutor-core/src/tutorDebug.ts"));
mock.module(resolve(root, "../../packages/tutor-core/src/index.ts"), {
  namedExports: { ...headers, ...fastMode, ...reasoning, ...debug, normalizeTutorQuestion: (value: string) => value.trim() },
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Mock only authentication and persistence. Both HTTP handlers, the billing
// gate, and the in-memory grant implementation execute unmodified.
const actor = {
  userId: "paid-route-seam-user",
  email: null,
  staff: false,
  lectureLab: false,
  skipAutumn: true,
  skipGates: false,
};
const billingPath = resolve(import.meta.dirname, "../../lib/billing");
const appPath = resolve(import.meta.dirname, "../../app/api");
let remainingMillicents = 0;
let allowPaidFixtures = false;
const reservations: Array<{ id: string; traceId?: string; kind: string; millicents: number }> = [];
const settlements: Array<{ reservationId: string; actualMillicents?: number }> = [];
const ownedTraces = new Map<string, { userId: string; expiresAt: Date }>([
  ["original", { userId: actor.userId, expiresAt: new Date(Date.now() + 86_400_000) }],
  ["foreign", { userId: "another-account", expiresAt: new Date(Date.now() + 86_400_000) }],
]);
mock.module(resolve(billingPath, "actor.ts"), {
  namedExports: { requireSpendActor: async () => actor, isSpendActor: () => true },
});
mock.module(resolve(billingPath, "ledger.ts"), {
  namedExports: {
    loadPeriodBalance: async () => ({ remainingMillicents, remainingPct: remainingMillicents > 0 ? 100 : 0, planId: "free" }),
    cacheUsageOnUser: async () => undefined,
    reservePeriodUsage: async (input: {
      traceId?: string; kind: string; millicents: number; reservationId?: string;
      onDenied?: (reason: string) => void;
    }) => {
      if (!allowPaidFixtures) throw new Error("invalid or unauthorized request cannot reserve paid vendor work");
      if (input.reservationId) {
        const existing = reservations.find((row) => row.id === input.reservationId);
        if (!existing || existing.millicents + input.millicents > remainingMillicents) {
          input.onDenied?.("insufficient_balance");
          return null;
        }
        existing.millicents += input.millicents;
        return { id: existing.id, amountMillicents: existing.millicents, remainingMillicents, planId: "free" };
      }
      const id = `receipt-${reservations.length + 1}`;
      reservations.push({ id, traceId: input.traceId, kind: input.kind, millicents: input.millicents });
      return { id, amountMillicents: input.millicents, remainingMillicents, planId: "free" };
    },
    settlePeriodUsage: async (input: { reservationId: string; actualMillicents?: number }) => {
      if (!allowPaidFixtures) throw new Error("no paid work was dispatched");
      settlements.push(input);
    },
  },
});
mock.module(resolve(import.meta.dirname, "../../lib/db/prisma.ts"), {
  namedExports: { prisma: {
    user: { findUnique: async () => ({ id: actor.userId, planId: "free" }) },
    ownedTrace: {
      findUnique: async ({ where }: { where: { traceId: string } }) => ownedTraces.get(where.traceId) ?? null,
      createMany: async ({ data }: { data: { traceId: string; userId: string; expiresAt: Date }[] }) => {
        for (const row of data) if (!ownedTraces.has(row.traceId)) ownedTraces.set(row.traceId, row);
        return { count: data.length };
      },
      deleteMany: async () => ({ count: 0 }),
    },
  } },
});

const { createLessonGrant, consumeUsdMillicents, resetTurnGrantsForTests } =
  load(resolve(billingPath, "grant.ts")) as typeof import("../../lib/billing/grant");
const { beginTurnForActor } = load(resolve(billingPath, "gate.ts")) as typeof import("../../lib/billing/gate");
const routes = [
  ["stt", load(resolve(appPath, "stt/route.ts")) as typeof import("../../app/api/stt/route")],
  ["extract-question", load(resolve(appPath, "extract-question/route.ts")) as typeof import("../../app/api/extract-question/route")],
] as const;

async function verifyChatPlannerPriority(): Promise<number> {
  // Every provider request is served by the fetch fixture below. Disabling the
  // exporter also prevents inherited local Langfuse credentials doing work.
  const fixtureEnv: Record<string, string | undefined> = {
    LANGFUSE_ENABLED: "0", LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://paid-route-fixture.invalid",
    AZURE_OPENAI_API_KEY: "fixture-only", AZURE_OPENAI_DEPLOYMENT: "gpt-6.1-sol",
    AZURE_OPENAI_MIN_REASONING_EFFORT: undefined,
    AZURE_GPT_SOL_INPUT_USD_PER_1M: "2", AZURE_GPT_SOL_OUTPUT_USD_PER_1M: "10", AZURE_GPT_SOL_CACHED_INPUT_USD_PER_1M: "0.1",
    DIAGRAM_PLANNER_PRIORITY: undefined, FIREWORKS_API_KEY: "fixture-only",
    FIREWORKS_MODEL: "accounts/fireworks/models/kimi-k3", FIREWORKS_MAX_TOKENS: "3600",
    FIREWORKS_SCENE_PLANNER_MAX_TOKENS: "4800", FIREWORKS_TURN_PLANNER_MAX_TOKENS: "2800",
    FIREWORKS_PROBLEM_IR_MAX_TOKENS: "3600", FIREWORKS_CODE_LESSON_MAX_TOKENS: "4200",
    FIREWORKS_KIMI_K3_INPUT_USD_PER_1M: "3", FIREWORKS_KIMI_K3_OUTPUT_USD_PER_1M: "15", FIREWORKS_KIMI_K3_CACHED_INPUT_USD_PER_1M: "0.3",
  };
  const originalEnv = new Map(Object.keys(fixtureEnv).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let scenarios = 0;
  try {
    for (const [key, value] of Object.entries(fixtureEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const chat = load(resolve(appPath, "chat/route.ts")) as typeof import("../../app/api/chat/route");
    allowPaidFixtures = true;
    const usage = { prompt_tokens: 1_000, completion_tokens: 800, total_tokens: 1_800,
      prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 100 } };
    const messages = [{ role: "user", content: "Explain pressure." }];
    const body = { messages, service_tier: "priority", reasoning_effort: "high",
      thinking: { type: "enabled", budget_tokens: 8192 }, max_tokens: 100_000,
      max_completion_tokens: 100_000, n: 100, model: "client-owned-model", tools: [{ type: "function" }] };
    const post = async (options: {
      flag?: string; returnedTier?: "priority" | "default"; missingUsage?: boolean; retry?: boolean;
      teaching?: boolean; plannerHeaders?: Record<string, string>; reserve: number; settle?: number;
      balance?: number; expectStatus?: number;
    }) => {
      if (options.flag === undefined) delete process.env.DIAGRAM_PLANNER_PRIORITY;
      else process.env.DIAGRAM_PLANNER_PRIORITY = options.flag;
      resetTurnGrantsForTests();
      remainingMillicents = options.balance ?? 3_500;
      const grant = createLessonGrant({ userId: actor.userId, traceId: "original", usdMillicents: remainingMillicents });
      assert(grant.ok, "chat fixture has an owned funded grant");
      reservations.length = 0; settlements.length = 0;
      const dispatched: Record<string, unknown>[] = [];
      globalThis.fetch = async (input, init) => {
        assert(String(input) === (process.env.LLM_PROVIDER === "azure"
          ? "https://paid-route-fixture.invalid/openai/v1/chat/completions"
          : "https://api.fireworks.ai/inference/v1/chat/completions"), "chat dispatch uses only the configured provider fixture");
        assert(reservations.length === 1 && settlements.length === 0, "the real paid reservation precedes every upstream attempt");
        const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        dispatched.push(sent);
        if (options.retry && dispatched.length === 1) return new Response("transient fixture failure", { status: 503, headers: { "retry-after": "0" } });
        if (options.teaching) return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Pressure is force per unit area." } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
        return Response.json({ model: sent.model, choices: [{ message: { content: "{}" } }],
          ...(options.returnedTier ? { service_tier: options.returnedTier } : {}),
          ...(options.missingUsage ? {} : { usage }),
        });
      };
      const response = await chat.POST(new Request("https://example.test/api/chat", {
        method: "POST", headers: { "content-type": "application/json", "x-heytutor-trace-id": "original",
          "x-heytutor-fast-mode": "0", ...(options.teaching ? { "x-heytutor-teaching-pass": "planned" }
            : { "x-planner": "1", "x-scene-planner-version": "2", ...options.plannerHeaders }) },
        body: JSON.stringify(body),
      }));
      const expectStatus = options.expectStatus ?? 200;
      assert(response.status === expectStatus, `the real chat POST returns ${expectStatus}, got ${response.status}`);
      const responseText = await response.text();
      if (expectStatus !== 200) {
        const denied = JSON.parse(responseText) as { code?: string };
        assert(denied.code === "retry_budget", "an unfunded planner retry is a retry budget denial");
        assert(dispatched.length === 1, "an unfunded planner retry is not dispatched");
        assert(reservations.length === 1 && reservations[0]?.millicents === options.reserve, "the funded attempt stays reserved when the retry is refused");
        assert(settlements.length === 1 && settlements[0]?.reservationId === reservations[0]?.id, "the funded attempt still settles");
        scenarios++;
        return { dispatched, response };
      }
      assert(dispatched.length === (options.retry ? 2 : 1), "planner retry count stays inside the reserved attempt ceiling");
      assert(reservations[0]?.kind === (options.teaching ? "teaching" : "planner"), "chat reserves the admitted paid lane");
      assert(reservations[0]?.millicents === options.reserve, `chat reserves ${options.reserve} millicents, got ${reservations[0]?.millicents}`);
      assert(settlements.length === 1 && settlements[0]?.reservationId === reservations[0]?.id, "chat settles its own reservation exactly once");
      assert(settlements[0]?.actualMillicents === options.settle, `chat settlement is ${options.settle ?? "the retained reservation"}, got ${settlements[0]?.actualMillicents}`);
      for (const sent of dispatched) {
        assert(JSON.stringify(sent.messages) === JSON.stringify(messages), "only sanitized client messages cross the route");
        assert(sent.n === 1 && sent.tools === undefined && sent.model !== body.model, "client fan-out, tools, and model cannot cross the paid boundary");
        assert(sent.stream === Boolean(options.teaching), "the server owns planner JSON versus teaching streaming");
      }
      scenarios++;
      return { dispatched, response };
    };
    // 47 ASCII prompt bytes + 2048 protocol allowance; 6848 completion tokens.
    // The first attempt costs $0.072670 standard / $0.145340 priority, rounded
    // up to 73 / 146 millicents. A funded retry extends that same receipt to
    // the combined ceiling, 146 / 291. Cached usage costs $0.009620 standard /
    // $0.019240 priority, rounded to 10 / 20 millicents.
    const priority = await post({ flag: "1", returnedTier: "priority", reserve: 146, settle: 20 });
    assert(priority.dispatched[0]!.service_tier === "priority", "exact flag 1 selects Azure planner priority");
    assert(priority.dispatched[0]!.reasoning_effort === "low" && priority.dispatched[0]!.max_completion_tokens === 6848,
      "priority preserves the scene planner's low effort and content/reasoning cap");
    assert(priority.response.headers.get("x-heytutor-service-tier") === "priority", "actual priority tier is returned in diagnostics");
    const fallback = await post({ flag: "1", returnedTier: "default", reserve: 146, settle: 10 });
    assert(fallback.dispatched[0]!.service_tier === "priority" && fallback.response.headers.get("x-heytutor-service-tier") === "default",
      "requested priority and actual standard fallback remain distinct");
    await post({ flag: "1", reserve: 146, settle: 20 });
    await post({ flag: "1", missingUsage: true, reserve: 146 });
    const retry = await post({ flag: "1", returnedTier: "default", retry: true, reserve: 291 });
    await post({ flag: "1", retry: true, reserve: 146, balance: 146, expectStatus: 402 });
    assert(retry.dispatched.every(sent => sent.service_tier === "priority"), "priority remains selected on both reserved attempts");
    assert(retry.response.headers.get("x-heytutor-upstream-attempts") === "2", "a real retry exposes both attempts without refunding unknown earlier usage");
    for (const flag of [undefined, "0", "true", " 1 "]) {
      const standard = await post({ flag, returnedTier: "default", reserve: 73, settle: 10 });
      assert(JSON.stringify(standard.dispatched[0]) === JSON.stringify({ messages, n: 1, stream: false,
        response_format: { type: "json_object" }, reasoning_effort: "low", max_completion_tokens: 6848, model: "gpt-6.1-sol" }),
        "omitted or invalid priority flags preserve the complete legacy Azure planner wire body");
      assert(standard.response.headers.get("x-heytutor-service-tier-requested") === "auto", "omitted tier diagnostics reflect deployment-auto behavior");
      assert(standard.dispatched[0]!.reasoning_effort === "low" && standard.dispatched[0]!.max_completion_tokens === 6848,
        "client vendor knobs cannot expand standard planner reasoning or output");
    }
    const autoPriority = await post({ returnedTier: "priority", reserve: 73, settle: 20 });
    assert(autoPriority.dispatched[0]!.service_tier === undefined && autoPriority.response.headers.get("x-heytutor-service-tier") === "priority",
      "an off-path deployment-returned priority tier still settles at 2x");
    for (const [plannerHeaders, cap, reserve] of [
      [{ "x-turn-planner-version": "3" }, 4848, 106],
      [{ "x-problem-ir-version": "1" }, 5648, 122],
      [{ "x-code-lesson-version": "1" }, 6248, 134],
    ] as const) {
      const planner = await post({ flag: "1", returnedTier: "priority", plannerHeaders, reserve, settle: 20 });
      assert(planner.dispatched[0]!.service_tier === "priority" && planner.dispatched[0]!.max_completion_tokens === cap,
        "each Azure planner lane keeps its existing cap while opting into priority");
    }
    process.env.LLM_PROVIDER = "fireworks";
    const fireworks = await post({ flag: "1", reserve: 79, settle: 15 });
    for (const flag of [undefined, "0", "true"]) {
      const unchanged = await post({ flag, reserve: 79, settle: 15 });
      assert(JSON.stringify(unchanged.dispatched[0]) === JSON.stringify(fireworks.dispatched[0]), "every priority flag value preserves the Fireworks wire body and accounting");
    }
    assert(fireworks.dispatched[0]!.service_tier === undefined && fireworks.dispatched[0]!.reasoning_effort === undefined,
      "planner priority and client vendor options do not leak to Fireworks");
    assert(fireworks.dispatched[0]!.max_tokens === 4800 && JSON.stringify(fireworks.dispatched[0]!.thinking) === '{"type":"disabled"}',
      "Fireworks keeps its existing scene planner body");
    process.env.LLM_PROVIDER = "azure";
    const standardTeaching = await post({ teaching: true, reserve: 61, settle: 10 });
    const priorityTeaching = await post({ teaching: true, flag: "1", reserve: 61, settle: 10 });
    for (const flag of ["0", "true"]) {
      const unchanged = await post({ teaching: true, flag, reserve: 61, settle: 10 });
      assert(JSON.stringify(unchanged.dispatched[0]) === JSON.stringify(standardTeaching.dispatched[0]), "invalid and zero priority flags preserve teaching dispatch and accounting");
    }
    assert(JSON.stringify(standardTeaching.dispatched[0]) === JSON.stringify(priorityTeaching.dispatched[0]),
      "priority flag changes neither teaching dispatch nor reservation/settlement");
    assert(priorityTeaching.dispatched[0]!.service_tier === undefined && priorityTeaching.dispatched[0]!.reasoning_effort === "low"
      && priorityTeaching.dispatched[0]!.max_completion_tokens === 5648, "the client cannot select teaching tier, reasoning, or output cap");
    return scenarios;
  } finally {
    allowPaidFixtures = false;
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    resetTurnGrantsForTests();
  }
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("paid upstream was called by an authorization test"); };
  try {
    resetTurnGrantsForTests();
    const minted = createLessonGrant({ userId: actor.userId, traceId: "original", usdMillicents: 1 });
    assert(minted.ok, "preexisting grant minted");
    consumeUsdMillicents(minted.grant, 1);
    for (const [name, route] of routes) {
      const post = (trace?: string) => route.POST(new Request(`https://example.test/api/${name}`, {
        method: "POST",
        headers: trace ? { "x-heytutor-trace-id": trace } : {},
      }));
      const known = await post("original");
      assert(known.status === 402,
        `${name}: exhausted known traces are denied before parsing or provider work`);
      const fresh = await post("new-trace");
      assert(fresh.status === 402, `${name}: exhausted grant denies unknown trace before provider`);
      const missing = await post();
      assert(missing.status === 402, `${name}: exhausted grant denies missing trace before provider`);
      assert(!minted.grant.allowedTraceIds.has("new-trace"), `${name}: refused trace is not cached`);
    }
    resetTurnGrantsForTests();
    const stale = createLessonGrant({ userId: actor.userId, traceId: "original", usdMillicents: 10 });
    assert(stale.ok, "stale in-memory grant minted");
    for (const [name, route] of routes) {
      const response = await route.POST(new Request(`https://example.test/api/${name}`, {
        method: "POST", headers: { "x-heytutor-trace-id": "unknown" },
      }));
      assert(response.status === 402, `${name}: persisted zero beats stale in-memory grant`);
    }
    resetTurnGrantsForTests();
    const bypass = createLessonGrant({ userId: actor.userId, traceId: "original", skipGates: true });
    assert(bypass.ok, "old privileged grant exists");
    const oldTraceBegin = await beginTurnForActor(actor, { traceId: "original", kind: "lesson" });
    assert(oldTraceBegin instanceof Response,
      "an ordinary begin-turn cannot reclassify a cached privileged grant");
    for (const [name, route] of routes) {
      const response = await route.POST(new Request(`https://example.test/api/${name}`, {
        method: "POST", headers: { "x-heytutor-trace-id": "original" },
      }));
      assert(response.status !== 400 && response.status !== 503,
        `${name}: ordinary actor cannot use previously privileged grant`);
    }
    resetTurnGrantsForTests();
    remainingMillicents = 3500;
    const funded = createLessonGrant({ userId: actor.userId, traceId: "original", usdMillicents: 3500 });
    assert(funded.ok, "owned funded grant exists");
    for (const [name, route] of routes) {
      const response = await route.POST(new Request(`https://example.test/api/${name}`, {
        method: "POST", headers: { "x-heytutor-trace-id": "original" },
      }));
      assert(response.status === 400 || response.status === 503,
        `${name}: a funded owned trace reaches input validation without vendor work`);
      const foreign = await route.POST(new Request(`https://example.test/api/${name}`, {
        method: "POST", headers: { "x-heytutor-trace-id": "foreign" },
      }));
      assert(foreign.status === 402,
        `${name}: account credit cannot authorize another account's trace`);
    }
    const chatScenarios = await verifyChatPlannerPriority();
    console.log(`✓ ${chatScenarios} actual chat POST scenarios cover planner tier scoping, retry reservations, returned-tier/unknown-usage settlement, and teaching/client isolation`);
  } finally {
    globalThis.fetch = originalFetch;
    resetTurnGrantsForTests();
  }
  console.log("✓ STT and extraction HTTP handlers enforce trace, balance, and entitlement before providers");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
