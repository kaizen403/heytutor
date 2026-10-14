import strictAssert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as Sentry from "@sentry/nextjs";
import { isAuthPublicPath } from "../../lib/auth/publicPaths";
import { rateLimitBucketForPath } from "../../lib/http/ipRateLimit";
import {
  isSentryDisabled,
  redactUrl,
  scrubSecrets,
  scrubSentryBreadcrumb,
  scrubSentryEvent,
  sentryBeforeSend,
  sentryBeforeSendLog,
  sentryClientDsn,
  sentryDataCollection,
  sentryServerDsn,
  sentryTracesSampler,
  type SentryScrubEvent,
} from "../../lib/obs/sentryPrivacy";
import { SENTRY_TUNNEL_PATH } from "../../lib/obs/sentryTunnel";
import * as privacy from "../../lib/obs/sentryPrivacy";
import * as telemetry from "../../lib/obs/failedTurnTelemetry";
import type { FailedTurnInput, FailedTurnSentryEvent } from "../../lib/obs/failedTurnTelemetry";
import type { FailedTurnSentryDelivery, PendingFailedTurnSentry } from "../../lib/obs/failedTurnSentry";
import * as requestBody from "../../lib/http/requestBody";
import * as uploadLimits from "../../lib/scene/turnUploadLimits";
import * as turnStatus from "../../lib/boards/turnStatus";
import { sentryEventUrl } from "../../lib/admin/sentryLink";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

assert(SENTRY_TUNNEL_PATH === "/monitoring", "the tunnel path is the fixed /monitoring route");
assert(isAuthPublicPath("/monitoring"), "the tunnel is public so logged-out errors can be reported");
assert(isAuthPublicPath("/monitoring/extra"), "a tunnel subpath stays public");
assert(!isAuthPublicPath("/settings"), "settings is still not public");
assert(rateLimitBucketForPath("/monitoring") === "sentry", "the tunnel has its own rate limit");

assert(sentryServerDsn(env({})) === undefined, "an empty DSN leaves the server SDK off");
assert(
  sentryServerDsn(env({ NEXT_PUBLIC_SENTRY_DSN: "https://public@example.ingest.sentry.io/1" })) ===
    "https://public@example.ingest.sentry.io/1",
  "the server can use the public DSN",
);
assert(
  sentryServerDsn(env({
    SENTRY_DSN: "https://server@example.ingest.sentry.io/1",
    NEXT_PUBLIC_SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
  })) === "https://server@example.ingest.sentry.io/1",
  "SENTRY_DSN wins on the server",
);
assert(
  sentryServerDsn(env({ SENTRY_DSN: "https://server@example.ingest.sentry.io/1", SENTRY_ENABLED: "0" })) ===
    undefined,
  "SENTRY_ENABLED=0 stops the server SDK",
);
assert(isSentryDisabled(env({ SENTRY_ENABLED: "false" })), "SENTRY_ENABLED=false is the same switch");
assert(
  sentryClientDsn(env({ SENTRY_DSN: "https://server@example.ingest.sentry.io/1" })) === undefined,
  "the browser SDK does not see the server-only DSN",
);
assert(
  sentryClientDsn(env({ NEXT_PUBLIC_SENTRY_DSN: " https://public@example.ingest.sentry.io/1 " })) ===
    "https://public@example.ingest.sentry.io/1",
  "the browser DSN is trimmed",
);

const collection = sentryDataCollection();
assert(collection.userInfo === false, "Sentry must not collect user identity");
assert(collection.cookies === false, "Sentry must not collect cookies");
assert(collection.httpBodies.length === 0, "Sentry must not collect request or response bodies");
assert(collection.urlQueryParams === false, "Sentry must not collect query strings");
assert(collection.databaseQueryData === false, "Sentry must not collect database parameters");
assert(collection.genAI.inputs === false && collection.genAI.outputs === false, "Sentry must not collect model text");
assert(collection.stackFrameVariables === false, "Sentry must not collect local variables");

assert(sentryTracesSampler({ name: "GET /api/health" }, env({ NODE_ENV: "production" })) === 0, "health is not traced");
assert(
  sentryTracesSampler({ name: "POST /monitoring" }, env({ NODE_ENV: "production" })) === 0,
  "the tunnel is not traced",
);
assert(sentryTracesSampler({ name: "GET /api/chat" }, env({ NODE_ENV: "development" })) === 0, "dev traces stay off");
assert(sentryTracesSampler({ name: "GET /api/chat" }, env({ NODE_ENV: "production" })) === 0.1, "production traces are sampled");

assert(scrubSecrets("Bearer sk_live_abc token=secret") === "Bearer [redacted] token=[redacted]", "secrets are scrubbed");
assert(
  redactUrl("https://app.accelute.co/api/tts/ws?ticket=abc&speed=1") ===
    "https://app.accelute.co/api/tts/ws?speed=1",
  "ticket query values are removed and other params stay",
);

const event: SentryScrubEvent = {
  message: "failed token=raw",
  request: {
    url: "https://app.accelute.co/api/chat?ticket=abc&board=1",
    data: "What is the derivative of x^2?",
    cookies: { session: "secret" },
    headers: { authorization: "Bearer sk_live_abc", "content-type": "application/json" },
    query_string: "ticket=abc&board=1",
  },
  user: { id: "user-1", email: "student@school.edu", ip_address: "203.0.113.8", username: "ada" },
  exception: { values: [{ value: "provider rejected sk_live_abc" }] },
  breadcrumbs: [
    { category: "console", message: "student asked about integrals" },
    { category: "fetch", data: { url: "https://api.example/v1?api_key=secret", request_body: "lesson text" } },
  ],
};

const scrubbed = scrubSentryEvent(event);
assert(scrubbed.message === "failed token=[redacted]", "event messages lose secrets");
assert(scrubbed.request?.data == null, "request bodies are dropped");
assert(scrubbed.request?.cookies == null, "request cookies are dropped");
assert(scrubbed.request?.headers?.authorization == null, "authorization headers are dropped");
assert(scrubbed.request?.headers?.["content-type"] === "application/json", "ordinary headers stay");
assert(scrubbed.request?.query_string === "board=1", "ticket is removed from the query string");
assert(scrubbed.request?.url === "https://app.accelute.co/api/chat?board=1", "ticket is removed from the URL");
assert(scrubbed.user?.id == null, "persistent user ids are dropped with the rest of the identity");
assert(scrubbed.user?.email == null, "email is dropped");
assert(scrubbed.user?.ip_address == null, "ip address is dropped");
assert(scrubbed.user?.username == null, "username is dropped");
assert(scrubbed.exception?.values?.[0]?.value === "provider rejected [redacted]", "exception text loses secrets");
assert(scrubbed.breadcrumbs?.length === 1, "console breadcrumbs are dropped");
assert(scrubbed.breadcrumbs?.[0]?.data?.request_body == null, "breadcrumb bodies are dropped");
assert(
  scrubbed.breadcrumbs?.[0]?.data?.url === "https://api.example/v1",
  "api keys are removed from breadcrumb URLs",
);

// Failure telemetry has a stricter boundary than ordinary crash reporting:
// even data inherited from the SDK's request scope must never leave the process.
const failureEvent = {
  event_id: "0123456789abcdef0123456789abcdef",
  message: "Synthetic student question must stay local",
  level: "warning",
  tags: {
    area: "turn-failure", subject: "physics", stage: "scene_planner", code: "candidate_invalid",
    figure_need: "required", strict_subjects: "physics,chemistry", provider: "azure",
    deployment: "gpt-6.1-sol", release: "a".repeat(40), environment: "production",
    board_id: "synthetic-board-id",
  },
  fingerprint: ["synthetic-user-id"],
  user: { id: "synthetic-user-id", email: "synthetic-student@example.test" },
  request: { url: "https://example.test/c/synthetic-board-id", data: "Synthetic student question" },
  breadcrumbs: [{ category: "fetch", message: "Synthetic student answer" }],
  contexts: { lesson: { question: "Synthetic student question" } },
  extra: { candidate_count: 2, validation_issue_count: 1, segment_count: 3,
    issue_codes: ["candidate_invalid"], question: "Synthetic student question" },
  exception: { values: [{ value: "Synthetic student answer" }] },
};
const cleanFailure = scrubSentryEvent(failureEvent);
assert(cleanFailure.user == null, "failed-turn telemetry drops every user field, including ids");
assert(cleanFailure.request == null, "failed-turn telemetry drops inherited request data and paths");
assert(cleanFailure.breadcrumbs == null, "failed-turn telemetry drops inherited breadcrumbs");
assert(cleanFailure.contexts == null, "failed-turn telemetry drops arbitrary inherited context");
assert(cleanFailure.exception == null, "failed-turn telemetry drops arbitrary exception text");
assert(cleanFailure.tags.board_id == null, "failed-turn telemetry drops arbitrary tags");
assert(cleanFailure.extra.question == null, "failed-turn telemetry only keeps approved counts and codes");
assert(cleanFailure.message === "Tutor turn failed", "failed-turn telemetry has a fixed, text-free message");
assert(
  JSON.stringify(cleanFailure.fingerprint) === JSON.stringify(["turn-failure", "scene_planner", "candidate_invalid", "physics"]),
  "failed-turn issue grouping contains only the canonical stage, code and subject",
);
assert(!JSON.stringify(cleanFailure).includes("Synthetic student"), "failed-turn telemetry has no synthetic lesson text");
assert(!JSON.stringify(cleanFailure).includes("synthetic-user-id"), "failed-turn telemetry has no synthetic identity");
assert(scrubSentryBreadcrumb({ category: "console", message: "question text" }) == null, "console crumbs are refused");
assert(sentryBeforeSendLog({ message: "[tutor:planner] 3 villagers" }) == null, "tutor debug logs stay on the machine");
assert(
  sentryBeforeSendLog({ message: "[http] GET /api/chat 200 12ms token=raw" })?.message ===
    "[http] GET /api/chat 200 12ms token=[redacted]",
  "http access logs are kept and secrets are scrubbed",
);

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
const nextConfig = read("next.config.ts");
assert(nextConfig.includes("tunnelRoute: SENTRY_TUNNEL_PATH"), "the browser SDK tunnels through this origin");
assert(nextConfig.includes("disable: !process.env.SENTRY_AUTH_TOKEN"), "source map upload waits for an auth token");
assert(nextConfig.includes("errorHandler"), "a Sentry outage during build must not fail the deploy");
assert(read("instrumentation.ts").includes("onRequestError"), "server request errors are captured");
assert(read("lib/tts/wsRelay.ts").includes("captureTtsRelayFailure"), "the speech relay reports upstream failures");
assert(read("sentry.server.config.ts").includes("consoleLoggingIntegration"), "server console lines are Sentry logs");
assert(read("sentry.server.config.ts").includes("sentryBeforeSendLog"), "server logs are scrubbed");
assert(read("lib/obs/sentryNode.ts").includes("consoleLoggingIntegration"), "the custom server sends console logs");
assert(
  read("instrumentation-client.ts").includes('levels: ["warn", "error"]'),
  "the browser sends warn and error, not every console line",
);
assert(read("app/global-error.tsx").includes("captureException"), "render crashes are captured");

interface FixtureTurn extends FailedTurnInput {
  id: string;
  userId: string;
  boardId: string;
  idempotencyKey: string | null;
  sentryEventId: string | null;
  sentryFailureEvent: FailedTurnSentryEvent | null;
  sentryNextAttemptAt: Date | null;
  sentryReportedAt: Date | null;
  createdAt: Date;
  [key: string]: unknown;
}

type SdkEnvelope = Parameters<NonNullable<ReturnType<Sentry.NodeClient["getTransport"]>>["send"]>[0];

function matchesWhere(row: FixtureTurn, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true; // Prisma omits undefined predicates.
    if ((key === "AND" || key === "OR") && Array.isArray(expected)) {
      const matches = expected.map(value => matchesWhere(row, value as Record<string, unknown>));
      return key === "AND" ? matches.every(Boolean) : matches.some(Boolean);
    }
    const actual = row[key];
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const predicate = expected as Record<string, unknown>;
      const comparable = actual instanceof Date ? actual.getTime() : actual;
      return Object.entries(predicate).every(([operator, operand]) => {
        const value = operand instanceof Date ? operand.getTime() : operand;
        if (operator === "equals") return actual === operand;
        if (operator === "not") return actual !== operand;
        if (operator === "in") return Array.isArray(operand) && operand.includes(actual);
        if (typeof comparable !== "number" || typeof value !== "number") return false;
        if (operator === "lt") return comparable < value;
        if (operator === "lte") return comparable <= value;
        if (operator === "gt") return comparable > value;
        if (operator === "gte") return comparable >= value;
        throw new Error(`unsupported fixture predicate: ${operator}`);
      });
    }
    return actual === expected;
  });
}

function loadModule<T>(relative: string, dependencies: Record<string, unknown>, processEnv: Record<string, string> = { NODE_ENV: "test" }): T {
  const file = relative === "app/api/boards/[boardId]/turns/route.ts" && process.env.SENTRY_TEST_PERSISTENCE_SOURCE
    ? process.env.SENTRY_TEST_PERSISTENCE_SOURCE : resolve(root, relative);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const compiledModule = { exports };
  vm.runInNewContext(code, {
    exports, module: compiledModule, require: (name: string) => {
      assert(name in dependencies, `missing fixture dependency: ${name}`);
      return dependencies[name];
    },
    FormData, Blob, File, Request, Response, Headers, URL, Uint8Array, TextEncoder, TextDecoder,
    crypto, AbortSignal, Date, console, process: { env: processEnv },
  }, { filename: relative });
  return compiledModule.exports as T;
}

async function verifyFailedTurnDelivery(): Promise<void> {
  const sentEvents: Sentry.ErrorEvent[] = [];
  const acknowledgements = new Set<string>();
  Sentry.init({
    dsn: "https://synthetic@example.ingest.sentry.io/1",
    integrations: [],
    beforeSend: sentryBeforeSend,
    transport: () => ({
      send: async (envelope: SdkEnvelope) => {
        for (const [header, payload] of envelope[1]) {
          if (header.type === "event") {
            const delivered = JSON.parse(JSON.stringify(payload)) as Sentry.ErrorEvent;
            sentEvents.push(delivered);
            if (delivered.event_id) acknowledgements.add(delivered.event_id);
          }
        }
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  const rows = new Map<string, FixtureTurn>();
  const tx = {
    $queryRaw: async () => [{ id: "synthetic-board" }],
    board: { findFirst: async () => ({ id: "synthetic-board" }), update: async () => ({}) },
    turn: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].find(row => matchesWhere(row, where)) ?? null,
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        [...rows.values()].find(row => matchesWhere(row, where)) ?? null,
      count: async () => rows.size,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: FixtureTurn = {
          ...data,
          id: String(data.id), userId: String(data.userId), boardId: String(data.boardId),
          idempotencyKey: typeof data.idempotencyKey === "string" ? data.idempotencyKey : null,
          visualStatus: typeof data.visualStatus === "string" ? data.visualStatus : null,
          sceneArtifacts: data.sceneArtifacts,
          rawResponse: typeof data.rawResponse === "string" ? data.rawResponse : "",
          status: "complete", kind: "lesson", segments: [], sentryEventId: null,
          sentryFailureEvent: null, sentryNextAttemptAt: null, sentryReportedAt: null,
          createdAt: new Date(),
        };
        rows.set(row.id, row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = [...rows.values()].find(item => matchesWhere(item, where));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    segment: { createManyAndReturn: async ({ data }: { data: Array<{ turnId: string; narration: string; spokenText: string }> }) => {
      const segments = data.map(item => ({ ...item, id: crypto.randomUUID() }));
      for (const row of rows.values()) row.segments = segments.filter(item => item.turnId === row.id);
      return segments;
    } },
  };
  const failureEnv = {
    NODE_ENV: "production", LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://synthetic.example.test",
    AZURE_OPENAI_API_KEY: "synthetic-not-a-secret", AZURE_OPENAI_DEPLOYMENT: "gpt-6.1-sol",
    SENTRY_RELEASE: "a".repeat(40), DIAGRAM_STRICT_SUBJECTS: "physics,chemistry",
  };
  const reporter = loadModule<{
    queueFailedTurnSentry(tx: unknown, turn: FailedTurnInput & { id: string }, options?: {
      env?: typeof failureEnv; now?: Date; eventId?: string; historical?: boolean; staleLive?: boolean;
    }): Promise<string | null>;
    runFailedTurnSentryBatch(options: { limit?: number; now: Date }, delivery?: FailedTurnSentryDelivery): Promise<{ reported: number; pending: number }>;
  }>("lib/obs/failedTurnSentry.ts", {
    "node:crypto": { randomUUID: () => crypto.randomUUID() },
    "@prisma/client": { Prisma: { JsonNull: null, DbNull: null } },
    "@sentry/nextjs": Sentry, "../db/prisma": { prisma: tx }, "./sentryPrivacy": privacy,
    "./failedTurnTelemetry": telemetry,
    "../boards/turnStatus": turnStatus,
  });
  class StorageQuotaError extends Error {}
  const route = loadModule<{
    POST(request: Request, context: { params: Promise<{ boardId: string }> }): Promise<Response>;
  }>("app/api/boards/[boardId]/turns/route.ts", {
    "@prisma/client": { Prisma: { DbNull: null, PrismaClientKnownRequestError: class extends Error {} } },
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/auth": { getUserId: async () => "synthetic-user", ensureUser: async () => {} },
    "@/lib/db/prisma": { prisma: tx },
    "@/lib/object-store/keys": {}, "@/lib/object-store/s3": {},
    "@/lib/object-store/lectureAudioPersistence": { allowsMetadataOnlyLectureAudio: () => true },
    "@/lib/http/requestBody": requestBody, "@/lib/object-store/mediaUrl": {},
    "@/lib/boards/storageAccounting": { turnMetadataStorageBytes: () => 100 },
    "@/lib/boards/storageQuota": {
      StorageQuotaError, reserveTurnStorage: async () => ({ bytes: 100 }),
      settleTurnStorage: async () => {}, abandonTurnStorage: async () => {},
      withUserStorageLock: async (_user: string, run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    "@/lib/obs/traceOwnership": {},
    "@/lib/scene/turnPersistencePolicy": { isTurnMetadataPersistable: () => true },
    "@/lib/scene/turnScenePersistence": { canonicalizeTurnSceneMetadata: async (metadata: unknown) => ({ ok: true, value: metadata }) },
    "@/lib/boards/turnSaveRejection": { rejectTurnSave: (_code: string, error: string, status: number) => Response.json({ error }, { status }) },
    "@/lib/scene/turnUploadLimits": uploadLimits,
    "@/lib/obs/failedTurnSentry": { queueFailedTurnSentry: (client: unknown, turn: FailedTurnInput & { id: string }) =>
      reporter.queueFailedTurnSentry(client, turn, { env: failureEnv }) },
  });
  const failedTurn: FailedTurnInput = {
    visualStatus: "text_only", status: "complete", kind: "lesson", rawResponse: "Synthetic student answer",
    sceneArtifacts: {
      turnPlan: { visualRequirement: "required" },
      failureTelemetry: { subject: "physics", stage: "scene_planner", code: "candidate_invalid" },
      degradation: { reason: "candidate_invalid", candidateCount: 2, issueCodes: ["scene_without_readable_label"] },
    },
    segments: [{ narration: "Synthetic student answer", spokenText: "Synthetic student answer" }],
  };
  const request = () => {
    const form = new FormData();
    form.set("metadata", JSON.stringify({ ...failedTurn, question: "Synthetic student question",
      segments: failedTurn.segments.map((segment, orderIndex) => ({ ...segment, orderIndex, command: null })) }));
    return new Request("https://example.test/api/boards/synthetic-board/turns", {
      method: "POST", headers: { "idempotency-key": "12345678-1234-4234-8234-123456789012" }, body: form,
    });
  };
  const context = { params: Promise.resolve({ boardId: "synthetic-board" }) };
  strictAssert.equal((await route.POST(request(), context)).status, 200, "a failed turn still persists");
  strictAssert.equal(rows.size, 1);
  const persisted = [...rows.values()][0]!;
  assert(persisted.sentryFailureEvent, "persisting a failed turn must queue a Sentry event");
  assert(persisted.sentryEventId, "the turn record keeps the reserved Sentry event id");
  const queuedEvent = structuredClone(persisted.sentryFailureEvent);
  strictAssert.equal((await route.POST(request(), context)).status, 200, "lost-response retry reuses the turn");
  strictAssert.equal(rows.size, 1, "lost-response retries do not create a second turn");

  const delivery: FailedTurnSentryDelivery = {
    configured: true,
    claim: async (now) => {
      const row = [...rows.values()].find(item => item.sentryFailureEvent && item.sentryNextAttemptAt && item.sentryNextAttemptAt <= now && !item.sentryReportedAt);
      if (!row) return null;
      row.sentryNextAttemptAt = new Date(now.getTime() + 60_000);
      return { id: row.id, sentryEventId: row.sentryEventId!, sentryFailureEvent: row.sentryFailureEvent!, sentryNextAttemptAt: row.sentryNextAttemptAt };
    },
    capture: event => Sentry.captureEvent(event), flush: timeoutMs => Sentry.flush(timeoutMs),
    acknowledged: eventId => acknowledgements.delete(eventId),
    complete: async (job, now) => { Object.assign(rows.get(job.id)!, { sentryReportedAt: now, sentryFailureEvent: null, sentryNextAttemptAt: null }); },
  };
  await Sentry.withScope(async scope => {
    scope.setUser({ id: "synthetic-user", email: "synthetic-student@example.test", ip_address: "203.0.113.10" });
    scope.setContext("lesson", { question: "Synthetic student question", board: "synthetic-board" });
    scope.setTag("board_id", "synthetic-board");
    scope.setExtra("answer", "Synthetic student answer");
    Sentry.addBreadcrumb({ category: "fetch", message: "Synthetic student question" });
    strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date() }, delivery)).reported, 1);
  });
  strictAssert.equal(sentEvents.length, 1, "a persisted failed turn emits exactly one event through the real SDK");
  const captured = sentEvents[0]!;
  strictAssert.equal(captured.event_id, persisted.sentryEventId, "admin event id matches the emitted event");
  strictAssert.equal(captured.level, "warning");
  strictAssert.deepEqual(captured.fingerprint, ["turn-failure", "scene_planner", "candidate_invalid", "physics"]);
  strictAssert.deepEqual(captured.tags, { area: "turn-failure", subject: "physics", stage: "scene_planner", code: "candidate_invalid",
    figure_need: "required", strict_subjects: "chemistry,physics", provider: "azure", deployment: "gpt-6.1-sol",
    release: "a".repeat(40), environment: "production" });
  strictAssert.deepEqual(captured.extra, { candidate_count: 2, validation_issue_count: 1, unknown_issue_count: 0, request_count: 0,
    issue_codes: ["scene_without_readable_label"], segment_count: 1 });
  for (const sensitive of ["Synthetic student", "synthetic-user", "synthetic-board", "203.0.113.10", "example.test"]) {
    assert(!JSON.stringify(captured).includes(sensitive), `transport event excludes synthetic private fixture: ${sensitive}`);
  }
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(Date.now() + 120_000) }, delivery)).reported, 0);
  strictAssert.equal(sentEvents.length, 1, "repeated drains do not emit the persisted turn again");

  const eventLink = sentryEventUrl(persisted.sentryEventId);
  assert(eventLink && new URL(eventLink).searchParams.get("query") === persisted.sentryEventId, "admin link searches the exact event id");
  assert(sentryEventUrl("javascript:alert(1)") == null, "admin links reject non-event-id strings");
  assert(sentryEventUrl(persisted.sentryEventId, env({ SENTRY_ORG: "bad/organization" })) == null, "admin links reject unsafe organization slugs");

  // The bounded drain keeps surplus and unsuccessful sends queued for a later tick.
  const pending: PendingFailedTurnSentry[] = Array.from({ length: 7 }, (_, index) => ({
    id: `synthetic-pending-${index}`, sentryEventId: index.toString(16).padStart(32, "0"),
    sentryFailureEvent: telemetry.buildFailedTurnSentryEvent(failedTurn, failureEnv)!, sentryNextAttemptAt: new Date(0),
  }));
  let attempts = 0, completed = 0;
  const limitedDelivery = { ...delivery, claim: async () => pending.shift() ?? null,
    capture: (event: FailedTurnSentryEvent & { event_id: string }) => { attempts++; return event.event_id; },
    acknowledged: () => true,
    flush: async () => true, complete: async () => { completed++; } };
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ limit: 100, now: new Date() }, limitedDelivery)).reported, 5);
  strictAssert.equal(attempts, 5, "a bad deploy cannot exceed five events in a drain tick");
  strictAssert.equal(pending.length, 2, "rate limiting retains all excess failed events");
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date() }, limitedDelivery)).reported, 2);
  strictAssert.equal(completed, 7, "surplus failed turns drain on the next tick");
  const retryJob = { id: "synthetic-retry", sentryEventId: "f".repeat(32),
    sentryFailureEvent: telemetry.buildFailedTurnSentryEvent(failedTurn, failureEnv)!, sentryNextAttemptAt: new Date(0) };
  let retryCompleted = false, retryClaimed = false;
  const retryDelivery = { ...delivery, claim: async () => retryClaimed ? null : (retryClaimed = true, retryJob),
    capture: (event: FailedTurnSentryEvent & { event_id: string }) => event.event_id, flush: async () => false,
    acknowledged: () => true,
    complete: async () => { retryCompleted = true; } };
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date() }, retryDelivery)).pending, 1);
  strictAssert.equal(retryCompleted, false, "an unflushed failure keeps its durable queue receipt");
  retryClaimed = false;
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date() }, { ...retryDelivery,
    flush: async () => true, acknowledged: () => false })).pending, 1);
  strictAssert.equal(retryCompleted, false, "a flushed but unacknowledged failure remains queued");
  retryClaimed = false;
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date() }, { ...retryDelivery, flush: async () => true })).reported, 1);
  strictAssert.equal(retryCompleted, true, "a retry completes under its original event id");
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date() }, { ...delivery, configured: false })).reported, 0,
    "a missing DSN leaves the durable queue untouched");

  for (const kind of ["lesson", "doubt", "resume"]) {
    for (const visualStatus of ["text_only", "retry_required", "legacy"]) {
      assert(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, kind, visualStatus,
        sceneArtifacts: { turnPlan: { visualRequirement: "none" } } }, failureEnv),
      `every admin failed status queues telemetry, including intentional text and ${kind}`);
    }
  }
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, status: "live" }, failureEnv), null,
    "a provisional live checkpoint waits for final outcome");
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, visualStatus: "validated" }, failureEnv), null,
    "a taught verified diagram is not a failed turn");
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, rawResponse: "", segments: [] }, failureEnv)?.level, "error",
    "a finalized failed turn that did not teach reports an error");
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, visualStatus: "validated",
    sceneArtifacts: { failureTelemetry: { failed: true, stage: "teaching", code: "provider_error" } } }, failureEnv)?.level, "error",
  "a verified scene with finalized teaching failure still reports an error");
  const historical = telemetry.buildFailedTurnSentryEvent(failedTurn, failureEnv, { historical: true });
  assert(historical, "historical failures still get events");
  for (const tag of ["provider", "deployment", "release", "environment", "strict_subjects"]) {
    strictAssert.equal(historical.tags[tag], "unknown", `historical ${tag} cannot borrow today's deployment`);
  }
  const now = new Date();
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, status: "live", updatedAt: now }, failureEnv,
    { staleLive: true, now }), null, "an active checkpoint cannot be mistaken for an abandoned tab");
  assert(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, status: "live", updatedAt: new Date(now.getTime() - turnStatus.LIVE_TURN_IDLE_MS - 1) }, failureEnv,
    { staleLive: true, now }), "a failed tab older than the existing stopped-turn threshold is recovered");
  const diagnosed = telemetry.readFailedTurnTelemetry({ subject: "Synthetic student question", code: "synthetic-user-id",
    stage: "Synthetic student answer", requestCount: 1_000_000, issueCodes: ["scene_without_readable_label", "synthetic-user-id"],
    question: "Synthetic student question" });
  strictAssert.equal(diagnosed?.subject, "unknown");
  strictAssert.equal(diagnosed?.code, undefined);
  strictAssert.equal(diagnosed?.stage, undefined);
  strictAssert.equal(diagnosed?.requestCount, 16);
  strictAssert.deepEqual(diagnosed?.issueCodes, ["scene_without_readable_label"], "unknown diagnostic strings cannot carry identity");
  strictAssert.deepEqual(telemetry.turnPlanFailureTelemetry({ code: "timeout", httpStatus: null }), { stage: "turn_plan", code: "planner_deadline" });
  strictAssert.deepEqual(telemetry.turnPlanFailureTelemetry({ code: "http_error", httpStatus: 429 }), { stage: "turn_plan", code: "rate_limit" });
  strictAssert.equal(telemetry.turnPlanFailureTelemetry({ code: "accepted", httpStatus: 200 }), undefined);
  strictAssert.deepEqual(telemetry.sceneRequestFailureTelemetry({ httpStatus: null, bodyParsed: false, errorPresent: true, declined: false, timedOut: false }),
    { stage: "scene_planner", code: "transport_error" });
  strictAssert.deepEqual(telemetry.sceneRequestFailureTelemetry({ httpStatus: 200, bodyParsed: true, errorPresent: false, declined: true, timedOut: false }),
    { stage: "scene_planner", code: "planner_declined" });
  const relevanceFailure = telemetry.buildFailedTurnSentryEvent({ ...failedTurn, sceneArtifacts: {
    turnPlan: { visualRequirement: "required" },
    failureTelemetry: { subject: "physics", stage: "validation", code: "scene_relevance_rejected" },
  } }, failureEnv);
  assert(relevanceFailure, "scene relevance rejection produces a failed-turn event");
  const cleanRelevanceFailure = scrubSentryEvent(relevanceFailure);
  strictAssert.equal(cleanRelevanceFailure.tags.code, "scene_relevance_rejected", "the relevance rejection code survives the final privacy vocabulary");
  strictAssert.deepEqual(cleanRelevanceFailure.fingerprint, ["turn-failure", "validation", "scene_relevance_rejected", "physics"]);

  // Run the production reporter's dedicated NodeClient and HTTP acknowledgement
  // wrapper itself. A flushed HTTP 429 cannot be mistaken for delivery.
  const reporterEnvelopes: Sentry.ErrorEvent[] = [];
  let transportStatus = 429, leased = false, successfulCommits = 0;
  const durableJob: PendingFailedTurnSentry = { ...retryJob,
    sentryFailureEvent: queuedEvent };
  const productionReporter = loadModule<typeof reporter>("lib/obs/failedTurnSentry.ts", {
    "node:crypto": { randomUUID: () => crypto.randomUUID() },
    "@prisma/client": { Prisma: { JsonNull: null, DbNull: null } },
    "@sentry/nextjs": { ...Sentry, makeNodeTransport: () => ({
      send: async (envelope: SdkEnvelope) => {
        for (const [header, payload] of envelope[1]) {
          if (header.type === "event") reporterEnvelopes.push(JSON.parse(JSON.stringify(payload)) as Sentry.ErrorEvent);
        }
        return { statusCode: transportStatus };
      }, flush: async () => true,
    }) },
    "../db/prisma": { prisma: {
      $queryRaw: async () => leased ? [] : (leased = true, [durableJob]),
      $executeRaw: async () => { successfulCommits++; return 1; },
    } },
    "./sentryPrivacy": { ...privacy, sentryServerDsn: () => "https://synthetic@example.ingest.sentry.io/1" },
    "./failedTurnTelemetry": telemetry, "../boards/turnStatus": turnStatus,
  }, { NODE_ENV: "test", SENTRY_DSN: "https://synthetic@example.ingest.sentry.io/1" });
  const rejectedAttempt = await productionReporter.runFailedTurnSentryBatch({ now, limit: 1 });
  strictAssert.equal(rejectedAttempt.reported, 0);
  strictAssert.equal(rejectedAttempt.pending, 1);
  strictAssert.equal(successfulCommits, 0, "HTTP 429 leaves the production outbox pending even when SDK flush succeeds");
  leased = false; transportStatus = 202;
  const acceptedRetry = await productionReporter.runFailedTurnSentryBatch({ now: new Date(now.getTime() + 86_400_000), limit: 1 });
  strictAssert.equal(acceptedRetry.reported, 1);
  strictAssert.equal(acceptedRetry.pending, 0);
  strictAssert.equal(successfulCommits, 1, "only a real successful HTTP acknowledgement retires the outbox receipt");
  strictAssert.equal(reporterEnvelopes.length, 2);
  strictAssert.equal(reporterEnvelopes[0]!.event_id, reporterEnvelopes[1]!.event_id, "production retries keep one event identity");
  strictAssert.equal(reporterEnvelopes[0]!.timestamp, reporterEnvelopes[1]!.timestamp, "midnight retries keep the original timestamp for Sentry deduplication");

  // A pagehide close can win before an earlier PUT finishes saving its scene
  // or narration. Pending telemetry must follow that accepted saved state.
  const stoppedAt = new Date("2026-10-14T10:00:00Z");
  const makeStopped = (id: string): FixtureTurn => ({
    ...persisted, id, status: "stopped", visualStatus: "text_only", rawResponse: "", segments: [],
    sceneArtifacts: { turnPlan: { visualRequirement: "none" }, failureTelemetry: { subject: "maths" } },
    resumeState: null, updatedAt: stoppedAt, sentryEventId: null, sentryFailureEvent: null,
    sentryReportedAt: null, sentryNextAttemptAt: null,
  });
  const laterNarrated = makeStopped("synthetic-late-narration");
  rows.set(laterNarrated.id, laterNarrated);
  await reporter.queueFailedTurnSentry(tx, { ...laterNarrated }, { env: failureEnv, now: stoppedAt });
  assert(laterNarrated.sentryFailureEvent, "an empty stopped turn has pending telemetry");
  const reservedId = laterNarrated.sentryEventId;
  const reservedTimestamp = laterNarrated.sentryFailureEvent.timestamp;
  strictAssert.equal(laterNarrated.sentryFailureEvent.level, "error");
  assert(laterNarrated.sentryNextAttemptAt && laterNarrated.sentryNextAttemptAt >= new Date(stoppedAt.getTime() + turnStatus.LIVE_TURN_IDLE_MS),
    "a stopped checkpoint gets the existing 120-second settlement grace");
  const beforeSettlement = sentEvents.length;
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(stoppedAt.getTime() + 10_000) }, delivery)).reported, 0,
    "an empty stopped checkpoint cannot send before late saves settle");
  const narrationAt = new Date(stoppedAt.getTime() + 30_000);
  Object.assign(laterNarrated, { updatedAt: narrationAt, rawResponse: "Synthetic completed narration",
    segments: [{ narration: "Synthetic first segment" }, { narration: "Synthetic final segment" }] });
  await reporter.queueFailedTurnSentry(tx, { ...laterNarrated }, { env: failureEnv, now: narrationAt });
  assert(laterNarrated.sentryFailureEvent, "late narration refreshes the pending event");
  strictAssert.equal(laterNarrated.sentryEventId, reservedId, "pending refresh keeps the original event reservation");
  strictAssert.equal(laterNarrated.sentryFailureEvent.timestamp, reservedTimestamp, "pending refresh keeps the first-queue timestamp");
  strictAssert.equal(laterNarrated.sentryFailureEvent.level, "warning", "a later taught lesson replaces the provisional no-teaching error");
  strictAssert.equal(laterNarrated.sentryFailureEvent.tags.code, "not_needed");
  strictAssert.equal(laterNarrated.sentryFailureEvent.extra.segment_count, 2, "pending counts reflect the accepted late narration");
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(narrationAt.getTime() + turnStatus.LIVE_TURN_IDLE_MS + 1) }, delivery)).reported, 1);
  strictAssert.equal(sentEvents.length, beforeSettlement + 1, "settled late narration emits one final event");
  strictAssert.equal(sentEvents.at(-1)?.level, "warning");
  strictAssert.equal(sentEvents.at(-1)?.extra?.segment_count, 2);

  const lateScene = makeStopped("synthetic-late-verified-scene");
  rows.set(lateScene.id, lateScene);
  await reporter.queueFailedTurnSentry(tx, { ...lateScene }, { env: failureEnv, now: stoppedAt });
  assert(lateScene.sentryFailureEvent, "a stopped scene close initially reserves a pending failure");
  const sceneReservation = lateScene.sentryEventId;
  Object.assign(lateScene, { visualStatus: "validated", updatedAt: narrationAt,
    segments: [{ narration: "Synthetic verified scene narration" }] });
  await reporter.queueFailedTurnSentry(tx, { ...lateScene }, { env: failureEnv, now: narrationAt });
  strictAssert.equal(lateScene.sentryFailureEvent, null, "an accepted late verified scene cancels an unreported failure");
  strictAssert.equal(lateScene.sentryNextAttemptAt, null, "a recovered scene has no pending send time");
  strictAssert.equal(lateScene.sentryEventId, sceneReservation, "scene recovery does not churn the reserved event identity");
  const beforeRecoveryDrain = sentEvents.length;
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(narrationAt.getTime() + turnStatus.LIVE_TURN_IDLE_MS + 1) }, delivery)).reported, 0);
  strictAssert.equal(sentEvents.length, beforeRecoveryDrain, "the late verified scene never emits a stale failure");
  await Sentry.close();
  console.log("✓ Sentry: persisted fail, one clean SDK event, retry idempotency, bounded durable delivery and admin link verified");
}

void verifyFailedTurnDelivery().catch(error => { console.error(error); process.exitCode = 1; });
