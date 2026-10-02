import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import type { PeriodBalance } from "../../lib/billing/ledgerMath";
import type { SpendActor } from "../../lib/billing/actor";

// Run with the same isolated module-mock runner as verify:paid-route-seams:
// node --experimental-test-module-mocks --import tsx scripts/verify/verify-paid-abuse.ts
// Only authentication, persistence, telemetry, and paid providers are faked.
// The HTTP routes, billing gate, grants, and usage-cost/accounting code are real.
const load = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../..");
const path = (relative: string) => resolve(root, relative);
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
process.env.FIREWORKS_API_KEY = "paid-abuse-test-key";
process.env.CARTESIA_API_KEY = "paid-abuse-test-key";
process.env.CARTESIA_STT_API_KEY = "paid-abuse-test-key";
process.env.STT_PROVIDER = "cartesia";
process.env.TTS_PROVIDER = "cartesia";
process.env.AI_GATEWAY_API_KEY = "paid-abuse-test-key";
process.env.BILLING_PROVIDER = "";
process.env.AUTUMN_ENABLED = "0";
globalThis.fetch = async () => {
  throw new Error("External network is prohibited in paid-abuse verification");
};

// The tutor-core source barrel also initializes unrelated scene planners. Keep
// those out of these HTTP/billing tests (the package has its own verification).
// Inputs here are conceptual questions with valid headers, so no reasoning or
// mock-lesson generation is part of the behavior under test.
mock.module(resolve(root, "../../packages/tutor-core/src/index.ts"), {
  namedExports: {
    HEYTUTOR_TRACE_ID_HEADER: "x-heytutor-trace-id",
    HEYTUTOR_QUESTION_HEADER: "x-heytutor-question",
    readTraceIdHeader: (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed && trimmed.length <= 128 && /^[\w.:-]+$/.test(trimmed)
        ? trimmed
        : undefined;
    },
    readQuestionHeader: (value?: string | null) =>
      value ? decodeURIComponent(value).trim().slice(0, 2000) : undefined,
    parseFastModeHeader: (value?: string | null) =>
      value !== "0" && value?.toLowerCase() !== "false",
    parseReasoningMode: () => "off",
    resolveReasoningEffort: () => "none",
    tutorDebug: () => undefined,
    normalizeTutorQuestion: (value: string) => value.trim(),
    DEFAULT_DSA_TEACHING_POLICY: {
      motivation: "show_slow_way",
      emphasis: "walkthrough",
    },
    getMockResponse: () => {
      throw new Error(
        "Configured paid-route verification cannot use mock lessons",
      );
    },
    getMockCodeLessonPlan: () => {
      throw new Error(
        "Configured paid-route verification cannot use mock code lessons",
      );
    },
  },
});

let actor: SpendActor;
let remaining = 0;
let allowance = 0;
let spent = 0;
let providerCalls = 0;
let uploadCalls = 0;
let storageBytes = 0;
let accountPlanId = "free";
let reservationPlanId: string | undefined;
let uploadOutcome: "success" | "uncertain" | "account_deleted" = "success";
let accountExists = true;
const queuedObjects: { prefix: string; userId: string; bytes: bigint }[] = [];
let testNumber = 0;
const reservations = new Map<string, number>();
let reservationCounter = 0;
const ownedTraces = new Map<string, { userId: string; expiresAt: Date }>();

function periodBalance(): PeriodBalance {
  return {
    period: "2026-10",
    planId: "free",
    spentMillicents: spent,
    bonusMillicents: 0,
    allowanceMillicents: allowance,
    remainingMillicents: remaining,
    remainingPct: allowance > 0 ? Math.round((remaining / allowance) * 100) : 0,
    nextResetAt: Date.now() + 86_400_000,
  };
}

mock.module(path("lib/billing/actor.ts"), {
  namedExports: {
    requireSpendActor: async () => actor,
    isSpendActor: (value: unknown) => !(value instanceof Response),
  },
});
mock.module(path("lib/auth.ts"), {
  namedExports: {
    ensureUser: async () => undefined,
    requireSessionUserId: async () => actor.userId,
    isAuthFailure: (value: unknown) => value instanceof Response,
  },
});
mock.module(path("lib/object-store/s3.ts"), {
  namedExports: {
    uploadImage: async () => {
      uploadCalls += 1;
      assert(
        storageBytes > 0,
        "image storage is reserved before external upload",
      );
      if (uploadOutcome === "uncertain") return null;
      if (uploadOutcome === "account_deleted") accountExists = false;
      return "/api/media/test-image.png";
    },
  },
});
mock.module(path("lib/boards/storageQuota.ts"), {
  namedExports: {
    StorageQuotaError: class StorageQuotaError extends Error {
      status = 413;
    },
    reserveStorageBytes: async (_userId: string, bytes: number) => {
      storageBytes += bytes;
    },
    releaseStorageBytes: async (_userId: string, bytes: number | bigint) => {
      storageBytes -= Number(bytes);
    },
  },
});
mock.module(path("lib/db/prisma.ts"), {
  namedExports: {
    prisma: {
      user: {
        findUnique: async () =>
          accountExists
            ? {
                id: actor.userId,
                planId: accountPlanId,
                subjects: ["Physics"],
                settings: { showHomeSuggestions: true },
              }
            : null,
      },
      turn: {
        findMany: async () => [
          { id: "last-lesson", question: "Explain force and acceleration." },
        ],
      },
      board: { findUnique: async () => null },
      homeSuggestionCache: {
        upsert: async () => ({
          packs: [],
          cursor: 0,
          sourceTurnId: null,
          generatedAt: null,
        }),
        updateMany: async () => ({ count: 1 }),
        update: async () => ({ cursor: 1 }),
      },
      objectDeletionJob: {
        createMany: async ({
          data,
        }: {
          data: { prefix: string; userId: string; bytes: bigint }[];
        }) => {
          queuedObjects.push(...data);
          return { count: data.length };
        },
      },
      ownedTrace: {
        createMany: async ({
          data,
        }: {
          data: { traceId: string; userId: string; expiresAt: Date }[];
        }) => {
          for (const row of data)
            if (!ownedTraces.has(row.traceId))
              ownedTraces.set(row.traceId, row);
          return { count: data.length };
        },
        findUnique: async ({ where }: { where: { traceId: string } }) =>
          ownedTraces.get(where.traceId) ?? null,
        deleteMany: async () => ({ count: 0 }),
      },
    },
  },
});
mock.module(path("lib/billing/ledger.ts"), {
  namedExports: {
    loadPeriodBalance: async () => periodBalance(),
    cacheUsageOnUser: async () => undefined,
    addPeriodSpend: async ({ usd }: { usd: number }) => {
      const charge = Math.round(usd * 1000);
      spent += charge;
      remaining = Math.max(0, remaining - charge);
      return periodBalance();
    },
    reservePeriodUsage: async ({
      millicents,
      planId,
    }: {
      millicents: number;
      planId: string;
    }) => {
      reservationPlanId = planId;
      if (millicents <= 0 || millicents > remaining) return null;
      const id = `reservation-${testNumber}-${reservationCounter++}`;
      reservations.set(id, millicents);
      spent += millicents;
      remaining -= millicents;
      return {
        id,
        amountMillicents: millicents,
        remainingMillicents: remaining,
        planId: "free",
      };
    },
    settlePeriodUsage: async ({
      reservationId,
      actualMillicents,
    }: {
      reservationId: string;
      actualMillicents?: number;
    }) => {
      const reserved = reservations.get(reservationId);
      assert.notEqual(
        reserved,
        undefined,
        "only an existing durable reservation can settle",
      );
      const retained = Math.min(reserved!, actualMillicents ?? reserved!);
      const refund = reserved! - retained;
      remaining += refund;
      spent -= refund;
      reservations.delete(reservationId);
    },
  },
});
mock.module(path("lib/obs/langfuse.ts"), {
  namedExports: {
    genTraceId: () => `server-trace-${testNumber}`,
    startTurnTrace: () => null,
    endLlmGeneration: () => undefined,
    flushInBackground: () => undefined,
  },
});

const grants = load(
  path("lib/billing/grant.ts"),
) as typeof import("../../lib/billing/grant");
const fuses = load(
  path("lib/billing/fuses.ts"),
) as typeof import("../../lib/billing/fuses");
const chat = load(
  path("app/api/chat/route.ts"),
) as typeof import("../../app/api/chat/route");
const titles = load(
  path("app/api/board-name/route.ts"),
) as typeof import("../../app/api/board-name/route");
const stt = load(
  path("app/api/stt/route.ts"),
) as typeof import("../../app/api/stt/route");
const photo = load(
  path("app/api/extract-question/route.ts"),
) as typeof import("../../app/api/extract-question/route");
const visual = load(
  path("app/api/visual-need/route.ts"),
) as typeof import("../../app/api/visual-need/route");
const dsaPolicy = load(
  path("app/api/dsa-teaching-policy/route.ts"),
) as typeof import("../../app/api/dsa-teaching-policy/route");
const suggestions = load(
  path("app/api/home-suggestions/route.ts"),
) as typeof import("../../app/api/home-suggestions/route");
const paidUsage = load(
  path("lib/billing/paidUsage.ts"),
) as typeof import("../../lib/billing/paidUsage");
const evaluation = load(
  path("lib/llm/evaluation/gateway.ts"),
) as typeof import("../../lib/llm/evaluation/gateway");

function arrange(credits = 100_000): string {
  grants.resetTurnGrantsForTests();
  fuses.resetBillingFusesForTests();
  testNumber += 1;
  actor = {
    userId: `paid-abuse-user-${testNumber}`,
    email: null,
    staff: false,
    lectureLab: false,
    skipAutumn: true,
    skipGates: false,
  };
  remaining = credits;
  allowance = credits;
  spent = 0;
  reservations.clear();
  reservationCounter = 0;
  ownedTraces.clear();
  providerCalls = 0;
  uploadCalls = 0;
  storageBytes = 0;
  accountPlanId = "free";
  accountExists = true;
  uploadOutcome = "success";
  queuedObjects.length = 0;
  reservationPlanId = undefined;
  evaluation.resetEvaluationCircuitForTests();
  const traceId = `paid-abuse-trace-${testNumber}`;
  ownedTraces.set(traceId, {
    userId: actor.userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const result = grants.createLessonGrant({
    userId: actor.userId,
    traceId,
    usdMillicents: credits,
  });
  assert(
    result.ok,
    "the test lesson is authorized before exercising the paid HTTP boundary",
  );
  return traceId;
}

function chatRequest(
  traceId: string,
  options: Record<string, unknown> = {},
): Request {
  return new Request("https://example.test/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-heytutor-trace-id": traceId,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Explain force." }],
      stream: true,
      ...options,
    }),
  });
}

const encoder = new TextEncoder();
function completion(
  usage: Record<string, number> | null = {
    prompt_tokens: 1000,
    completion_tokens: 1000,
  },
): Response {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Paid teaching output" } }], ...(usage ? { usage } : {}) })}\n\ndata: [DONE]\n\n`,
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

async function flushAccounting(): Promise<void> {
  // Let promise-based ledger reconciliation finish without wall-clock sleeps.
  for (let count = 0; count < 4; count += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function recording(seconds = 30): Blob {
  const sampleRate = 16_000;
  const pcmBytes = seconds * sampleRate * 2;
  const bytes = new Uint8Array(44 + pcmBytes);
  const data = new DataView(bytes.buffer);
  bytes.set(encoder.encode("RIFF"), 0);
  data.setUint32(4, 36 + pcmBytes, true);
  bytes.set(encoder.encode("WAVEfmt "), 8);
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  bytes.set(encoder.encode("data"), 36);
  data.setUint32(40, pcmBytes, true);
  return new Blob([bytes], { type: "audio/wav" });
}

function transcriptionRequest(traceId: string, audio = recording()): Request {
  const form = new FormData();
  form.set("audio", audio, "dictation.wav");
  return new Request("https://example.test/api/stt", {
    method: "POST",
    headers: { "x-heytutor-trace-id": traceId },
    body: form,
  });
}

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6n90AAAAASUVORK5CYII=";
const paidRestRoutes = [
  {
    name: "photo OCR",
    path: "extract-question",
    post: photo.POST,
    body: { image: tinyPng },
  },
  {
    name: "visual policy",
    path: "visual-need",
    post: visual.POST,
    body: { question: "Explain force." },
  },
  {
    name: "DSA policy",
    path: "dsa-teaching-policy",
    post: dsaPolicy.POST,
    body: { question: "Explain two pointers.", familiarity: "normal" },
  },
  {
    name: "home suggestions",
    path: "home-suggestions",
    post: suggestions.POST,
    body: {},
  },
];

function restRequest(
  pathname: string,
  traceId: string,
  body: unknown,
): Request {
  return new Request(`https://example.test/api/${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-heytutor-trace-id": traceId,
      "x-session-id": "client-session",
    },
    body: JSON.stringify(body),
  });
}

const checks: [string, () => Promise<void>][] = [
  ...paidRestRoutes.flatMap((route): [string, () => Promise<void>][] => [
    [
      `${route.name}: provider failures retain a pre-dispatch durable charge`,
      async () => {
        const trace = arrange();
        globalThis.fetch = async () => {
          providerCalls += 1;
          assert(
            spent > 0 && reservations.size > 0,
            "paid work has a durable debit before provider contact",
          );
          return new Response("vendor unavailable", { status: 503 });
        };
        const response = await route.post(
          restRequest(route.path, trace, route.body),
        );
        await response.text();
        assert.equal(providerCalls, 1);
        assert(spent > 0, "uncertain vendor work remains charged");
        assert.equal(
          grants.getTurnGrant(actor.userId)?.inUse,
          0,
          "failed paid work releases its admission slot",
        );
      },
    ],
    [
      `${route.name}: a successful response without vendor usage remains charged`,
      async () => {
        const trace = arrange();
        globalThis.fetch = async (_url, options) => {
          providerCalls += 1;
          const forwarded = JSON.parse(String(options?.body));
          if (forwarded.messages) {
            assert.equal(
              forwarded.n,
              1,
              "a paid REST request buys one completion",
            );
            assert.equal(forwarded.stream, false);
          }
          return Response.json({
            choices: [
              { message: { content: "Explain force and acceleration." } },
            ],
            answers: {
              visual_need: { type: "choice", choice: "optional" },
              motivation: { type: "choice", choice: "show_slow_way" },
              emphasis: { type: "choice", choice: "walkthrough" },
            },
          });
        };
        const response = await route.post(
          restRequest(route.path, trace, route.body),
        );
        assert.equal(response.status, 200, await response.text());
        assert.equal(providerCalls, 1);
        assert(
          spent > 0,
          "absent usage is unknown rather than a measured zero",
        );
        assert.equal(grants.getTurnGrant(actor.userId)?.inUse, 0);
        if (route.path === "extract-question") {
          assert.equal(uploadCalls, 1);
          assert(
            storageBytes > 0,
            "stored question images consume account quota",
          );
        }
      },
    ],
  ]),
  [
    "paid work without a lesson grant uses the authenticated account's paid plan",
    async () => {
      arrange(24000);
      grants.resetTurnGrantsForTests();
      accountPlanId = "pro";
      const reservation = await paidUsage.reservePaidUsage({
        actor,
        kind: "suggestions",
        usd: 0.01,
      });
      assert(!(reservation instanceof Response));
      await reservation.finish();
      assert.equal(
        reservationPlanId,
        "pro",
        "a paid account is not silently reduced to the free allowance",
      );
    },
  ],
  [
    "home suggestions with exhausted credits use a free fallback",
    async () => {
      const trace = arrange(0);
      globalThis.fetch = async () => {
        providerCalls += 1;
        return new Response("unused");
      };
      const response = await suggestions.POST(
        restRequest("home-suggestions", trace, {}),
      );
      assert.equal(providerCalls, 0);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).generated, false);
    },
  ],
  [
    "DSA policy rejects an oversized technique before paying a provider",
    async () => {
      const trace = arrange();
      globalThis.fetch = async () => {
        providerCalls += 1;
        return new Response("unused");
      };
      const response = await dsaPolicy.POST(
        restRequest("dsa-teaching-policy", trace, {
          question: "Explain two pointers.",
          familiarity: "normal",
          technique: "x".repeat(1000),
        }),
      );
      assert.equal(providerCalls, 0);
      assert.equal(response.status, 400);
    },
  ],
  [
    "policy JSON bodies are counted before parsing unknown-size requests",
    async () => {
      const trace = arrange();
      globalThis.fetch = async () => {
        providerCalls += 1;
        return new Response("unused");
      };
      const response = await visual.POST(
        restRequest("visual-need", trace, {
          question: "Explain force.",
          ignored: "x".repeat(80_000),
        }),
      );
      assert.equal(providerCalls, 0);
      assert.equal(response.status, 413);
    },
  ],
  [
    "photo MIME must match its encoded image content before provider contact",
    async () => {
      const trace = arrange();
      globalThis.fetch = async () => {
        providerCalls += 1;
        return new Response("unused");
      };
      const response = await photo.POST(
        restRequest("extract-question", trace, {
          image: tinyPng.replace("image/png", "image/jpeg"),
        }),
      );
      assert.equal(providerCalls, 0);
      assert.equal(response.status, 400);
    },
  ],
  [
    "photo decoded dimensions are bounded before vendor processing",
    async () => {
      const trace = arrange();
      const bytes = Buffer.from(tinyPng.split(",")[1]!, "base64");
      bytes.writeUInt32BE(100_000, 16);
      globalThis.fetch = async () => {
        providerCalls += 1;
        return new Response("unused");
      };
      const response = await photo.POST(
        restRequest("extract-question", trace, {
          image: `data:image/png;base64,${bytes.toString("base64")}`,
        }),
      );
      assert.equal(providerCalls, 0);
      assert.equal(response.status, 400);
    },
  ],
  ...(["uncertain", "account_deleted"] as const).map(
    (outcome): [string, () => Promise<void>] => [
      `photo storage: ${outcome} uploads stay charged and enter durable cleanup`,
      async () => {
        const trace = arrange();
        uploadOutcome = outcome;
        globalThis.fetch = async () => {
          providerCalls += 1;
          return Response.json({
            choices: [
              { message: { content: "Explain force and acceleration." } },
            ],
          });
        };
        const response = await photo.POST(
          restRequest("extract-question", trace, { image: tinyPng }),
        );
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal(
          (await response.json()).imageUrl,
          null,
          "uncertain or deleted-account writes are not exposed",
        );
        assert.equal(uploadCalls, 1);
        assert.equal(
          queuedObjects.length,
          1,
          "uncertain uploaded objects have a persistent deletion receipt",
        );
        assert.match(
          queuedObjects[0]!.prefix,
          new RegExp(`^images/${actor.userId}/[a-f0-9-]+\\.png$`),
        );
        assert.equal(
          Number(queuedObjects[0]!.bytes),
          storageBytes,
          "only the deletion worker may release uncertain storage capacity",
        );
      },
    ],
  ),
  [
    "an ordinary planner, repair, and teaching sequence still completes with free-plan credit",
    async () => {
      const trace = arrange(3500);
      globalThis.fetch = async (_url, options) => {
        providerCalls += 1;
        const body = JSON.parse(String(options?.body)) as Record<
          string,
          unknown
        >;
        if (body.stream === false)
          return Response.json({
            choices: [
              { message: { content: '{"schemaVersion":"turn-plan/v3"}' } },
            ],
            usage: { prompt_tokens: 1000, completion_tokens: 1000 },
          });
        return completion();
      };
      for (const phase of ["plan", "repair"]) {
        const request = chatRequest(trace);
        request.headers.set("x-planner", "1");
        request.headers.set("x-turn-planner-version", "3");
        request.headers.set("x-scene-planner-phase", phase);
        const response = await chat.POST(request);
        assert.equal(
          response.status,
          200,
          `the ${phase} phase remains authorized`,
        );
        await response.text();
      }
      const teaching = await chat.POST(chatRequest(trace));
      assert.equal(
        teaching.status,
        200,
        "the ordinary teaching phase remains authorized",
      );
      assert.match(await teaching.text(), /Paid teaching output/);
      await flushAccounting();
      assert.equal(providerCalls, 3);
      assert(
        spent > 0 && remaining > 0,
        "ordinary usage is accounted within its initial credit allowance",
      );
    },
  ],
  [
    "S01: client JSON mode and multiple completions cannot bypass paid accounting",
    async () => {
      const trace = arrange();
      let forwarded: Record<string, unknown> | undefined;
      globalThis.fetch = async (_url, options) => {
        providerCalls += 1;
        forwarded = JSON.parse(String(options?.body)) as Record<
          string,
          unknown
        >;
        return forwarded.stream === true
          ? completion()
          : Response.json({
              choices: [{ message: { content: "Paid teaching output" } }],
              usage: { prompt_tokens: 1000, completion_tokens: 1000 },
            });
      };
      const response = await chat.POST(
        chatRequest(trace, { stream: false, n: 4, best_of: 4 }),
      );
      await response.text();
      await flushAccounting();
      if (providerCalls === 0) {
        assert(
          [400, 422].includes(response.status),
          "unsupported options receive a validation denial",
        );
      } else {
        assert.equal(response.status, 200);
        assert.equal(
          forwarded?.stream,
          true,
          "the teaching provider response mode is server-owned",
        );
        assert.equal(
          forwarded?.n,
          1,
          "an ordinary request purchases one completion",
        );
        assert.equal(
          forwarded?.best_of,
          undefined,
          "the caller cannot multiply provider work",
        );
        assert(spent > 0, "returned paid output decreases persisted usage");
      }
    },
  ],
  [
    "S01: cancelling after teaching output does not recover all paid usage",
    async () => {
      const trace = arrange();
      globalThis.fetch = async () => {
        providerCalls += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"Paid teaching output"}}]}\n\n',
                ),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      };
      const response = await chat.POST(chatRequest(trace));
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      const first = await reader.read();
      assert.equal(first.done, false);
      assert.match(
        new TextDecoder().decode(first.value),
        /Paid teaching output/,
      );
      await reader.cancel("client cancels after receiving output");
      await flushAccounting();
      assert(
        spent > 0 && remaining < allowance,
        "cancellation retains a durable bounded charge or reservation",
      );
      assert.equal(
        grants.getTurnGrant(actor.userId)?.inUse,
        0,
        "cancelled teaching releases its concurrency slot",
      );
    },
  ],
  [
    "S01: successful output without final vendor usage is not a free request",
    async () => {
      const trace = arrange();
      globalThis.fetch = async () => {
        providerCalls += 1;
        return completion(null);
      };
      const response = await chat.POST(chatRequest(trace));
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Paid teaching output/);
      await flushAccounting();
      assert(
        spent > 0,
        "unknown usage retains a conservative charge/reservation for reconciliation",
      );
    },
  ],
  [
    "S02: an exhausted trace cannot start another paid chat request",
    async () => {
      const trace = arrange(0);
      globalThis.fetch = async () => {
        providerCalls += 1;
        return completion();
      };
      const response = await chat.POST(chatRequest(trace));
      await response.body?.cancel();
      assert.equal(
        providerCalls,
        0,
        "known traces do not skip exhausted-balance admission",
      );
      assert(
        [402, 429].includes(response.status),
        "exhausted paid admission returns an actionable denial",
      );
    },
  ],
  [
    "S02: concurrent requests on the same trace have a provider admission bound",
    async () => {
      const trace = arrange(10_000_000);
      globalThis.fetch = async () => {
        providerCalls += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"delta":{"content":"Held output"}}]}\n\n',
                ),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      };
      const responses = await Promise.all(
        Array.from({ length: 12 }, () => chat.POST(chatRequest(trace))),
      );
      const contacted = providerCalls;
      await Promise.all(responses.map((response) => response.body?.cancel()));
      assert(
        contacted > 0 && contacted < 12,
        "a burst cannot purchase all twelve simultaneous requests",
      );
      assert(
        responses.some((response) => response.status === 429),
        "excess simultaneous work is denied before contacting the provider",
      );
    },
  ],
  [
    "S02: serial reuse of one trace has a finite paid-call allowance",
    async () => {
      const trace = arrange(10_000_000);
      globalThis.fetch = async () => {
        providerCalls += 1;
        return completion({ prompt_tokens: 0, completion_tokens: 0 });
      };
      let denial: number | undefined;
      for (let count = 0; count < 64; count += 1) {
        const response = await chat.POST(chatRequest(trace));
        await response.text();
        if (response.status !== 200) {
          denial = response.status;
          break;
        }
      }
      assert(
        providerCalls > 0 && providerCalls < 64,
        "a trace cannot purchase sixty-four teaching calls even with ample credit",
      );
      assert.equal(
        denial,
        429,
        "the finite lesson-call limit has an explicit denial",
      );
    },
  ],
  [
    "S03: exhausted-credit title requests do not contact a paid provider",
    async () => {
      arrange(0);
      globalThis.fetch = async () => {
        providerCalls += 1;
        return Response.json({
          choices: [{ message: { content: "Force" } }],
          usage: { prompt_tokens: 1000, completion_tokens: 100 },
        });
      };
      const response = await titles.POST(
        new Request("https://example.test/api/board-name", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: "Explain force." }),
        }),
      );
      const output = await response.text();
      assert.equal(
        providerCalls,
        0,
        "title generation uses a free fallback or denies exhausted usage",
      );
      assert(
        response.status === 402 ||
          (response.status === 200 && /title/.test(output)),
        "the caller receives a denial or usable deterministic title",
      );
    },
  ],
  [
    "S04: successful transcription decreases persisted usage",
    async () => {
      const trace = arrange();
      globalThis.fetch = async () => {
        providerCalls += 1;
        return Response.json({
          text: "Transcribed words",
          language: "en",
          duration: 30,
        });
      };
      const response = await stt.POST(transcriptionRequest(trace));
      assert.equal(response.status, 200, await response.text());
      await flushAccounting();
      assert.equal(providerCalls, 1);
      assert(
        spent > 0 && remaining < allowance,
        "vendor transcription consumes persisted usage",
      );
    },
  ],
  [
    "S04: exhausted known traces cannot request another transcription",
    async () => {
      const trace = arrange(0);
      globalThis.fetch = async () => {
        providerCalls += 1;
        return Response.json({ text: "Transcribed words", duration: 30 });
      };
      const response = await stt.POST(transcriptionRequest(trace));
      await response.body?.cancel();
      assert.equal(
        providerCalls,
        0,
        "exhausted transcription requests are denied before vendor contact",
      );
      assert([402, 429].includes(response.status));
    },
  ],
  [
    "S04: empty transcription still accounts for vendor processing",
    async () => {
      const trace = arrange();
      globalThis.fetch = async () => {
        providerCalls += 1;
        return Response.json({ text: "", duration: 30 });
      };
      const response = await stt.POST(transcriptionRequest(trace));
      assert.equal(response.status, 422);
      await flushAccounting();
      assert.equal(providerCalls, 1);
      assert(
        spent > 0,
        "a processed empty recording cannot repeatedly consume free vendor work",
      );
    },
  ],
  [
    "S04: recordings longer than the supported minute are denied before provider contact",
    async () => {
      const trace = arrange();
      globalThis.fetch = async () => {
        providerCalls += 1;
        return Response.json({ text: "Overlong recording", duration: 120 });
      };
      const response = await stt.POST(
        transcriptionRequest(trace, recording(120)),
      );
      await response.body?.cancel();
      assert.equal(
        providerCalls,
        0,
        "valid but overlong audio is bounded by duration, not just compressed bytes",
      );
      assert([400, 413, 422].includes(response.status));
    },
  ],
];

async function main(): Promise<void> {
  const failures: string[] = [];
  try {
    for (const [name, run] of checks) {
      try {
        await run();
        console.log(`✓ ${name}`);
      } catch (error) {
        failures.push(name);
        console.error(
          `✗ ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env))
      if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    grants.resetTurnGrantsForTests();
    fuses.resetBillingFusesForTests();
    mock.restoreAll();
  }
  if (failures.length > 0)
    throw new Error(
      `${failures.length}/${checks.length} paid-abuse regressions failed`,
    );
  console.log(
    "✓ paid HTTP boundaries account for output, bound grants, and meter transcription",
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
