import strictAssert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as Sentry from "@sentry/nextjs";
import * as drawing from "@heytutor/drawing";
import * as sceneEngine from "@heytutor/scene-engine";
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
import * as failedTurnRuntime from "../../lib/obs/failedTurnRuntime";
import * as workerFailureLog from "../../lib/obs/workerFailureLog";
import type { FailedTurnInput, FailedTurnSentryEvent } from "../../lib/obs/failedTurnTelemetry";
import type { FailedTurnSentryDelivery, PendingFailedTurnSentry } from "../../lib/obs/failedTurnSentry";
import * as requestBody from "../../lib/http/requestBody";
import * as uploadLimits from "../../lib/scene/turnUploadLimits";
import * as turnStatus from "../../lib/boards/turnStatus";
import * as turnFilters from "../../lib/admin/turnFilters";
import * as objectKeys from "../../lib/object-store/keys";
import * as mediaUrl from "../../lib/object-store/mediaUrl";
import { sentryEventUrl } from "../../lib/admin/sentryLink";
import * as liveTurnSave from "../../features/tutor-session/lib/turn/liveTurnSave";
import * as doubtTurn from "../../features/tutor-session/lib/turn/doubtTurn";
import * as saveStatus from "../../features/tutor-session/lib/turn/saveStatus";
import type * as boardsClient from "../../lib/boards/boardsClient";

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
    figure_need: "required", billing_code: "none", strict_subjects: "physics,chemistry", provider: "azure",
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
    "[http] GET /api/chat 200 12ms",
  "approved HTTP access logs remove all appended text and tokens",
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
assert(read("lib/obs/sentryRuntime.ts").includes("sentryBeforeSendLog"), "server logs are scrubbed");
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
    if (key === "segments" && expected !== null && typeof expected === "object" && "none" in expected) return row.segments.length === 0;
    if (key === "sceneArtifacts" && expected !== null && typeof expected === "object" && "path" in expected && Array.isArray(expected.path)) {
      const value = expected.path.reduce((current: unknown, part: string) => current !== null && typeof current === "object"
        ? (current as Record<string, unknown>)[part] : undefined, actual);
      return "equals" in expected && value === expected.equals;
    }
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

function loadModule<T>(relative: string, dependencies: Record<string, unknown>, processEnv: Record<string, string | undefined> = { NODE_ENV: "test" }, globals: Record<string, unknown> = {}): T {
  // Local mutation runs supply ignored source copies; normal runs use the repo.
  const mutationSources: Record<string, string | undefined> = {
    "app/api/boards/[boardId]/turns/route.ts": process.env.SENTRY_TEST_PERSISTENCE_SOURCE,
    "lib/boards/turnCheckpoint.ts": process.env.SENTRY_TEST_CHECKPOINT_SOURCE,
    "lib/obs/sentryPrivacy.ts": process.env.SENTRY_TEST_PRIVACY_SOURCE,
    "lib/obs/failedTurnSentry.ts": process.env.SENTRY_TEST_REPORTER_SOURCE,
    "features/tutor-session/lib/turn/liveTurnSave.ts": process.env.SENTRY_TEST_LIVE_TURN_SAVE_SOURCE,
  };
  const file = mutationSources[relative] ?? resolve(root, relative);
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const compiledModule = { exports };
  vm.runInNewContext(code, {
    exports, module: compiledModule, require: (name: string) => {
      assert(name in dependencies, `missing fixture dependency: ${name}`);
      if (name === "./failedTurnRuntime") {
        const runtime = dependencies[name] as typeof failedTurnRuntime;
        // Imported helpers execute outside the VM, so their default env must
        // resolve to this module's environment, just as a real process does.
        return { ...runtime,
          failedTurnDeliveryEnabled: (values?: Record<string, string | undefined>) => runtime.failedTurnDeliveryEnabled(values ?? processEnv),
          failedTurnRuntimeEnvironment: (values?: Record<string, string | undefined>) => runtime.failedTurnRuntimeEnvironment(values ?? processEnv),
        };
      }
      return dependencies[name];
    },
    FormData, Blob, File, Request, Response, Headers, URL, Uint8Array, TextEncoder, TextDecoder,
    crypto, AbortSignal, Date, console, process: { env: processEnv },
    ...globals,
  }, { filename: relative });
  return compiledModule.exports as T;
}

// Bypass the event builder deliberately: the final scrub must stand on its
// own when a hostile SDK scope puts arbitrary prose into vocabulary tags.
const finalPrivacy = process.env.SENTRY_TEST_PRIVACY_SOURCE ? loadModule<typeof privacy>("lib/obs/sentryPrivacy.ts", {
  "./failedTurnTelemetry": telemetry, "./sentryTunnel": { SENTRY_TUNNEL_PATH },
}) : privacy;
for (const tag of ["code", "stage", "subject", "billing_code"] as const) {
  const hostile = `Synthetic private ${tag}: synthetic-user@example.test question text`;
  const finalScrub = finalPrivacy.scrubSentryEvent({ ...structuredClone(failureEvent),
    tags: { ...failureEvent.tags, [tag]: hostile },
  });
  assert(finalScrub, "the final scrub must retain a clean failure event");
  strictAssert.equal(finalScrub.tags?.[tag], "unknown", `the final ${tag} boundary enforces its own vocabulary`);
  assert(!JSON.stringify(finalScrub).includes(hostile), `the final scrub drops prose in the ${tag} tag`);
  assert(!JSON.stringify(finalScrub).includes("synthetic-user@example.test"), "neither tags nor grouping carry identity");
}

type NoLessonPath = "resume_without_ink" | "no_usable_step" | "empty_response" | "healthy";

function runActualNoLessonPath(path: NoLessonPath,
  page = doubtTurn.lessonPageRecord("synthetic-board", "Synthetic private question")) {
  const filename = process.env.SENTRY_TEST_QUESTION_HANDLER_SOURCE ?? resolve(root,
    "features/tutor-session/hooks/turn/useQuestionHandler.ts");
  const source = readFileSync(filename, "utf8");
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const branches = new Map<string, ts.IfStatement>();
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node)) branches.set(node.expression.getText(file), node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  const first = branches.get("resumeInkGate && !resumeInkGate.hasInk()");
  const unusable = branches.get("STREAM_SEGMENTS_LIVE && !usableTeachingStepReceived");
  const last = branches.get("responseText.length === 0");
  assert(first && unusable && last && first.end <= unusable.pos && unusable.end < last.pos,
    "drive the actual three normal-return branches from the question handler");
  // Execute the contiguous production code, including its actual conditions,
  // writes and returns. Only surrounding UI/stream dependencies are fixtures.
  const code = ts.transpileModule(`(function () {
    ${source.slice(first.getStart(file), last.end)}
    return "continued";
  })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  page.failureTelemetry = { subject: "physics" };
  const errors: unknown[] = [];
  const result = vm.runInNewContext(code, {
    page, resumeInkGate: path === "resume_without_ink" ? { hasInk: () => false } : null,
    resume: path === "resume_without_ink" ? { lessonQuestion: "Synthetic private question" } : null,
    resumeInkAttempts: 1, turnCancelled: false, question: "Synthetic private question",
    STREAM_SEGMENTS_LIVE: path !== "empty_response", usableTeachingStepReceived: path === "healthy",
    rawResponse: path === "empty_response" ? "" : "Synthetic private answer", rawResponseRef: { current: "" },
    conductor: null, codeLesson: false, streamStats: { reasoningChars: 0 },
    tel: { mark: () => {} }, offerPausedLessonResume: () => {},
    setNarrationText: () => {}, setCurrentSegmentText: () => {},
    emitError: (error: unknown) => errors.push(error), tutorDebug: () => {},
    throwIfTurnCancelled: () => {}, isCurrentTurn: () => true,
  }, { filename: "actual-question-handler-no-lesson-path" });
  if (path === "healthy") {
    strictAssert.equal(result, "continued", "normal teaching keeps its existing control flow");
    strictAssert.equal(page.failureTelemetry?.failed, undefined, "healthy teaching is never marked as failed");
    strictAssert.equal(errors.length, 0);
  } else {
    strictAssert.equal(result, undefined, `${path}: the actual failure branch returns normally`);
    strictAssert.equal(errors.length, 1, `${path}: the existing student error still appears`);
    strictAssert.deepEqual(JSON.parse(JSON.stringify(page.failureTelemetry)), {
      subject: "physics", failed: true, stage: "teaching", code: "lesson_not_taught",
    }, `${path}: a no-lesson return must mark the page snapshot before it closes`);
  }
  return page;
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
    $transaction: async (run: (client: unknown) => Promise<unknown>) => run(tx),
    $queryRaw: async () => [{ id: "synthetic-board" }],
    board: { findFirst: async () => ({ id: "synthetic-board" }), update: async () => ({}) },
    turn: {
      findMany: async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
        [...rows.values()].filter(row => matchesWhere(row, where)).slice(0, take),
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
          status: typeof data.status === "string" ? data.status : "complete", kind: "lesson", segments: [], sentryEventId: null,
          sentryFailureEvent: null, sentryNextAttemptAt: null, sentryReportedAt: null,
          createdAt: new Date(), updatedAt: new Date(),
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
      update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const row = [...rows.values()].find(item => matchesWhere(item, where));
        assert(row, "the saved checkpoint turn exists");
        Object.assign(row, data, { updatedAt: data.updatedAt ?? new Date() });
        return { ...row };
      },
    },
    segment: { createManyAndReturn: async ({ data }: { data: Array<{ turnId: string; narration: string; spokenText: string }> }) => {
      const segments = data.map(item => ({ ...item, id: crypto.randomUUID() }));
      for (const row of rows.values()) {
        const added = segments.filter(item => item.turnId === row.id);
        if (added.length) row.segments = [...row.segments, ...added];
      }
      return segments;
    },
    findMany: async ({ where }: { where: { turnId: string } }) => rows.get(where.turnId)?.segments ?? [],
    deleteMany: async ({ where }: { where: { turnId: string } }) => {
      const row = rows.get(where.turnId); if (row) row.segments = [];
      return { count: 0 };
    } },
  };
  const failureEnv = {
    NODE_ENV: "production", LLM_PROVIDER: "azure", AZURE_OPENAI_ENDPOINT: "https://synthetic.example.test",
    AZURE_OPENAI_API_KEY: "synthetic-not-a-secret", AZURE_OPENAI_DEPLOYMENT: "gpt-6.1-sol",
    SENTRY_RELEASE: "a".repeat(40), SENTRY_ENVIRONMENT: "production", DIAGRAM_STRICT_SUBJECTS: "physics,chemistry",
  };
  const reporter = loadModule<{
    queueFailedTurnSentry(tx: unknown, turn: FailedTurnInput & { id: string }, options?: {
      env?: Record<string, string | undefined>; now?: Date; eventId?: string; historical?: boolean; staleLive?: boolean;
    }): Promise<string | null>;
    runFailedTurnSentryBatch(options: { limit?: number; now: Date }, delivery?: FailedTurnSentryDelivery): Promise<{ reported: number; pending: number }>;
    queueAbandonedFailedTurns(now: Date, options?: { env?: Record<string, string | undefined>; startedAt?: Date }): Promise<number>;
    startFailedTurnSentryWorker(): () => void;
  }>("lib/obs/failedTurnSentry.ts", {
    "node:crypto": { randomUUID: () => crypto.randomUUID() },
    "@prisma/client": { Prisma: { JsonNull: null, DbNull: null } },
    "@sentry/nextjs": Sentry, "../db/prisma": { prisma: tx }, "./sentryPrivacy": privacy,
    "./failedTurnTelemetry": telemetry,
    "./failedTurnRuntime": failedTurnRuntime, "./workerFailureLog": workerFailureLog,
    "../boards/turnStatus": turnStatus, "../admin/turnFilters": turnFilters,
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
    "@/lib/boards/turnStatus": turnStatus,
    "@/lib/scene/turnScenePersistence": { canonicalizeTurnSceneMetadata: async (metadata: { segments: Array<Record<string, unknown>> }) => ({ ok: true,
      value: { ...metadata, segments: metadata.segments.map(segment => ({ ...segment, sourceOrderIndex: segment.orderIndex })) } }) },
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
    figure_need: "required", billing_code: "none", strict_subjects: "chemistry,physics", provider: "azure", deployment: "gpt-6.1-sol",
    release: "a".repeat(40), environment: "production", reporting_origin: "live" });
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

  // The live client saves through PUT checkpoints and PATCH closes. Execute
  // those real handlers with the real outbox queue, rather than mocking away
  // the integration whose removal this gate must detect.
  const checkpointNow = new Date();
  const canonicalizeCheckpoint = async (metadata: { segments: Array<Record<string, unknown>> }) => ({ ok: true,
    value: { ...metadata, segments: metadata.segments.map(segment => ({ ...segment, sourceOrderIndex: segment.orderIndex })) } });
  const checkpoint = loadModule<{
    handleTurnCheckpoint(request: Request, params: { boardId: string; turnId: string }): Promise<Response>;
    handleTurnClose(request: Request, params: { boardId: string; turnId: string }): Promise<Response>;
  }>("lib/boards/turnCheckpoint.ts", {
    "@prisma/client": { Prisma: { DbNull: null, PrismaClientKnownRequestError: class extends Error {} } },
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@heytutor/drawing": drawing, "@heytutor/scene-engine": sceneEngine,
    "@/lib/auth": { getUserId: async () => "synthetic-user", ensureUser: async () => {} },
    "@/lib/db/prisma": { prisma: tx },
    "@/lib/object-store/keys": objectKeys, "@/lib/object-store/mediaUrl": mediaUrl,
    "@/lib/object-store/s3": { uploadAudio: async () => { throw new Error("the telemetry gate performs no object-store network calls"); } },
    "@/lib/object-store/lectureAudioPersistence": { allowsMetadataOnlyLectureAudio: () => true },
    "@/lib/http/requestBody": requestBody,
    "@/lib/boards/storageAccounting": { turnMetadataStorageBytes: () => 100 },
    "@/lib/boards/storageQuota": {
      StorageQuotaError,
      reserveTurnStorage: async (input: { bytes: number }) => ({ bytes: input.bytes }),
      reserveTurnGrowthStorage: async (input: { bytes: number }) => ({ bytes: input.bytes }),
      settleTurnStorage: async () => {}, abandonTurnStorage: async () => {},
      prepareStorageAccounting: async () => {}, refundTurnMetadataStorage: async () => {},
      withUserStorageLock: async (_user: string, run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
    "@/lib/obs/traceOwnership": {},
    "@/lib/scene/turnScenePersistence": { canonicalizeTurnSceneMetadata: canonicalizeCheckpoint },
    "@/lib/scene/turnUploadLimits": uploadLimits, "@/lib/boards/turnStatus": turnStatus,
    "@/lib/boards/turnSaveRejection": { rejectTurnSave: (_code: string, error: string, status: number) => Response.json({ error }, { status }) },
    "@/lib/obs/failedTurnSentry": { queueFailedTurnSentry: (client: unknown, turn: FailedTurnInput & { id: string }) =>
      reporter.queueFailedTurnSentry(client, turn, { env: failureEnv, now: checkpointNow }) },
  });
  const checkpointTurnId = "11111111-1111-4111-8111-111111111111";
  const putRequest = () => {
    const form = new FormData();
    form.set("metadata", JSON.stringify({ ...failedTurn, question: "Synthetic checkpoint question",
      rawResponse: "Synthetic checkpoint answer", seq: 1, baseCount: 0, status: "complete",
      appendSegments: [{ orderIndex: 0, narration: "Synthetic checkpoint answer", spokenText: "Synthetic checkpoint answer", command: null }] }));
    return new Request(`https://example.test/api/boards/synthetic-board/turns/${checkpointTurnId}`, { method: "PUT", body: form });
  };
  const eventsBeforeCheckpoint = sentEvents.length;
  strictAssert.equal((await checkpoint.handleTurnCheckpoint(putRequest(), { boardId: "synthetic-board", turnId: checkpointTurnId })).status,
    200, "a failed PUT checkpoint still persists");
  const checkpointTurn = rows.get(checkpointTurnId)!;
  assert(checkpointTurn.sentryEventId, "the actual failed checkpoint PUT must reserve a Sentry id");
  assert(checkpointTurn.sentryFailureEvent, "the actual failed checkpoint PUT must queue a clean payload");
  strictAssert.equal(checkpointTurn.sentryFailureEvent.tags.code, "candidate_invalid");
  strictAssert.equal(sentEvents.length, eventsBeforeCheckpoint, "checkpoint saves queue locally without awaiting transport");
  const checkpointEventId = checkpointTurn.sentryEventId;
  strictAssert.equal((await checkpoint.handleTurnCheckpoint(putRequest(), { boardId: "synthetic-board", turnId: checkpointTurnId })).status, 200);
  strictAssert.equal(checkpointTurn.sentryEventId, checkpointEventId, "a replayed completed checkpoint retains its event reservation");
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: checkpointNow }, delivery)).reported, 1);
  strictAssert.equal(sentEvents.length, eventsBeforeCheckpoint + 1, "a failed checkpoint emits exactly one clean SDK event");
  strictAssert.equal(sentEvents.at(-1)?.event_id, checkpointEventId);
  strictAssert.ok(!JSON.stringify(sentEvents.at(-1)).includes("Synthetic"), "checkpoint delivery excludes lesson and identity text");

  // A metadata-free close deliberately enters closeStatusOnly, the separate
  // queue call on pagehide/Stop, rather than delegating back to the PUT path.
  const closeTurnId = "22222222-2222-4222-8222-222222222222";
  const closeTurn = await tx.turn.create({ data: { ...failedTurn, id: closeTurnId, boardId: "synthetic-board", userId: "synthetic-user",
    idempotencyKey: null, question: "Synthetic closed question", rawResponse: "Synthetic closed answer", status: "live",
    checkpointSeq: 1, submittedSegments: null, resumeState: null, metadataBytes: 100n, storageBytes: 100n } });
  closeTurn.segments = [{ narration: "Synthetic closed answer", spokenText: "Synthetic closed answer", command: null }];
  const closeRequest = () => new Request(`https://example.test/api/boards/synthetic-board/turns/${closeTurnId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ seq: 2, status: "stopped", appendSegments: [] }),
  });
  const eventsBeforeClose = sentEvents.length;
  strictAssert.equal((await checkpoint.handleTurnClose(closeRequest(), { boardId: "synthetic-board", turnId: closeTurnId })).status,
    200, "a failed status-only close still persists");
  assert(closeTurn.sentryEventId, "the actual failed status close must reserve a Sentry id");
  assert(closeTurn.sentryFailureEvent, "the actual failed status close must queue a clean payload");
  strictAssert.equal(closeTurn.status, "stopped");
  strictAssert.equal(closeTurn.sentryFailureEvent.tags.code, "candidate_invalid");
  strictAssert.equal(sentEvents.length, eventsBeforeClose, "status close queues locally without awaiting transport");
  const closeEventId = closeTurn.sentryEventId;
  strictAssert.equal((await checkpoint.handleTurnClose(closeRequest(), { boardId: "synthetic-board", turnId: closeTurnId })).status, 200);
  strictAssert.equal(closeTurn.sentryEventId, closeEventId, "repeated pagehide close keeps the same event reservation");
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: checkpointNow }, delivery)).reported, 0,
    "the status close keeps the late-checkpoint settlement grace");
  const settledClose = new Date(checkpointNow.getTime() + turnStatus.LIVE_TURN_IDLE_MS + 1);
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: settledClose }, delivery)).reported, 1);
  strictAssert.equal(sentEvents.length, eventsBeforeClose + 1, "a settled failed status close emits exactly one clean SDK event");
  strictAssert.equal(sentEvents.at(-1)?.event_id, closeEventId);
  strictAssert.ok(!JSON.stringify(sentEvents.at(-1)).includes("Synthetic"), "status-close delivery excludes lesson and identity text");
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(settledClose.getTime() + 120_000) }, delivery)).reported, 0);

  let registryCheckpointCalls = 0;
  const client = loadModule<typeof boardsClient>("lib/boards/boardsClient.ts", {
    "@/lib/scene/storedSceneSource": {},
    "@heytutor/tutor-core": { resolveApiUrl: (path: string) => `https://example.test${path}`, speechAudioMimeType: () => "audio/mpeg" },
    "@/lib/boards/boardTitle": {}, "@/lib/boards/turnStatus": turnStatus,
  }, { NODE_ENV: "test" }, {
    fetch: (url: string, init: RequestInit) => {
      const turnId = new URL(url).pathname.split("/").at(-1)!;
      return checkpoint.handleTurnCheckpoint(new Request(url, init), { boardId: "synthetic-board", turnId });
    },
  });
  const registryModule = process.env.SENTRY_TEST_LIVE_TURN_SAVE_SOURCE ? loadModule<typeof liveTurnSave>(
    "features/tutor-session/lib/turn/liveTurnSave.ts", {
      "@/lib/boards/boardsClient": client, "@heytutor/drawing": drawing,
      "./doubtTurn": doubtTurn, "./saveStatus": saveStatus, "@/lib/obs/failedTurnTelemetry": telemetry,
    }, { NODE_ENV: "test" }, { AbortController },
  ) : liveTurnSave;
  const createRegistry = (turnId: string) => new registryModule.LiveTurnSaveRegistry({
    transport: {
      checkpoint: (boardId, id, input) => { registryCheckpointCalls++; return client.checkpointTurn(boardId, id, input); },
      close: async () => { throw new Error("the no-lesson gate must use the actual registry checkpoint path"); },
    },
    setTimer: () => 0, clearTimer: () => {}, now: () => checkpointNow.getTime(), isOnline: () => true, mintId: () => turnId,
  });
  const settleRegistry = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
  for (const kind of ["doubt", "resume"] as const) {
    const healthyRegistry = createRegistry(`44444444-4444-4444-8444-${kind === "doubt" ? "000000000000" : "000000000001"}`);
    const healthyHandle = healthyRegistry.begin({ owner: {}, generation: 1, boardId: "synthetic-board", traceId: null,
      kind, question: "Synthetic private question", preview: "Synthetic private question", speedMultiplier: 1,
      continuesBoard: true, page: runActualNoLessonPath("healthy") });
    const before: number = registryCheckpointCalls;
    healthyHandle.close();
    await settleRegistry();
    strictAssert.equal(registryCheckpointCalls, before, `a healthy empty ${kind} retains the existing discard policy`);
  }
  for (const [index, path] of (["resume_without_ink", "no_usable_step", "empty_response"] as const).entries()) {
    const page = doubtTurn.lessonPageRecord("synthetic-board", "Synthetic private question");
    const noLessonId = `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`;
    const registry = createRegistry(noLessonId);
    const handle = registry.begin({ owner: {}, generation: 1, boardId: "synthetic-board", traceId: null,
      kind: path === "resume_without_ink" ? "resume" : path === "no_usable_step" ? "doubt" : "lesson",
      question: "Synthetic private question", preview: "Synthetic private question", speedMultiplier: 1,
      continuesBoard: path !== "empty_response", page });
    runActualNoLessonPath(path, page);
    const beforeCheckpoint: number = registryCheckpointCalls;
    registry.flushAll();
    await settleRegistry();
    strictAssert.equal(registryCheckpointCalls, beforeCheckpoint, `${path}: a live empty placeholder still waits`);
    handle.close();
    await settleRegistry();
    strictAssert.equal(registryCheckpointCalls, beforeCheckpoint + 1,
      `${path}: the actual registry must retain and checkpoint an ended failed turn`);
    const saved = rows.get(noLessonId)!;
    assert(saved.sentryEventId && saved.sentryFailureEvent, `${path}: the persisted no-lesson outcome reserves an event`);
    const eventId = saved.sentryEventId;
    const before: number = sentEvents.length;
    strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: settledClose }, delivery)).reported, 1,
      `${path}: the failed checkpoint emits after its settlement window`);
    strictAssert.equal(sentEvents.length, before + 1, `${path}: exactly one event reaches the real SDK`);
    const delivered = sentEvents.at(-1)!;
    strictAssert.equal(delivered.event_id, eventId);
    strictAssert.deepEqual(delivered.fingerprint, ["turn-failure", "teaching", "lesson_not_taught", "physics"]);
    strictAssert.equal(delivered.level, "error");
    strictAssert.ok(!JSON.stringify(delivered).includes("Synthetic"), `${path}: no question, answer or identity enters the event`);
    strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: settledClose }, delivery)).reported, 0,
      `${path}: repeating the worker never sends a second event`);
  }

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
      const event = telemetry.buildFailedTurnSentryEvent({ ...failedTurn, kind, visualStatus,
        sceneArtifacts: { turnPlan: { visualRequirement: "none" } } }, failureEnv);
      if (visualStatus === "retry_required") assert(event, "an explicit retry outcome still fails");
      else strictAssert.equal(event, null, `expected text is healthy for ${kind}`);
    }
  }
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, status: "live" }, failureEnv), null,
    "a provisional live checkpoint waits for final outcome");
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, visualStatus: "validated" }, failureEnv), null,
    "a taught verified diagram is not a failed turn");
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, visualStatus: "validated", segments: [] }, failureEnv)?.tags.code,
    "lesson_not_taught", "a verified scene cannot conceal a completed zero-teaching turn");
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, rawResponse: "", segments: [] }, failureEnv)?.level, "error",
    "a finalized failed turn that did not teach reports an error");
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({ ...failedTurn, visualStatus: "validated",
    sceneArtifacts: { failureTelemetry: { failed: true, stage: "teaching", code: "provider_error" } } }, failureEnv)?.level, "error",
  "a verified scene with finalized teaching failure still reports an error");
  const historical = telemetry.buildFailedTurnSentryEvent(failedTurn, failureEnv, { historical: true });
  assert(historical, "historical failures still get events");
  for (const tag of ["provider", "deployment", "release", "strict_subjects"]) {
    strictAssert.equal(historical.tags[tag], "unknown", `historical ${tag} cannot borrow today's deployment`);
  }
  strictAssert.equal(historical.tags.environment, "production", "an explicit production backfill retains its runtime environment");
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
  const quantityFailure = telemetry.buildFailedTurnSentryEvent({
    ...failedTurn,
    sceneArtifacts: {
      turnPlan: { visualRequirement: "required" },
      failureTelemetry: { subject: "chemistry", failed: true, stage: "validation", code: "candidate_invalid" },
      degradation: {
        reason: "candidate_invalid",
        candidateCount: 3,
        issueCodes: ["displayed_quantity_unverified", "scene_quantity_mismatch", "synthetic_private_issue"],
      },
    },
  }, failureEnv);
  assert(quantityFailure, "a quantity-agreement rejection still produces a failed-turn event");
  strictAssert.equal(quantityFailure.tags.subject, "chemistry");
  strictAssert.equal(quantityFailure.tags.stage, "validation");
  strictAssert.equal(quantityFailure.tags.code, "candidate_invalid");
  strictAssert.equal(quantityFailure.tags.figure_need, "required");
  strictAssert.deepEqual(quantityFailure.extra.issue_codes, ["displayed_quantity_unverified", "scene_quantity_mismatch", "unknown_issue"]);
  strictAssert.equal(quantityFailure.extra.unknown_issue_count, 1, "only the unrecognized issue code is counted as unknown");
  strictAssert.equal(quantityFailure.extra.validation_issue_count, 3);
  strictAssert.equal(quantityFailure.extra.candidate_count, 3);
  const scrubbedQuantity = scrubSentryEvent(quantityFailure);
  strictAssert.deepEqual(scrubbedQuantity.extra?.issue_codes, ["displayed_quantity_unverified", "scene_quantity_mismatch", "unknown_issue"],
    "the privacy boundary keeps the same validation codes");
  assert(!JSON.stringify(scrubbedQuantity).includes("synthetic_private_issue"), "an unrecognized issue code cannot pass the privacy boundary");
  strictAssert.deepEqual(telemetry.turnPlanFailureTelemetry({ code: "timeout", httpStatus: null }), { stage: "turn_plan", code: "planner_deadline" });
  strictAssert.deepEqual(telemetry.turnPlanFailureTelemetry({ code: "http_error", httpStatus: 429 }), { stage: "turn_plan", code: "rate_limit" });
  strictAssert.equal(telemetry.turnPlanFailureTelemetry({ code: "accepted", httpStatus: 200 }), undefined);
  strictAssert.deepEqual(telemetry.sceneRequestFailureTelemetry({ httpStatus: null, bodyParsed: false, errorPresent: true, declined: false, timedOut: false }),
    { stage: "scene_planner", code: "transport_error" });
  strictAssert.deepEqual(telemetry.sceneRequestFailureTelemetry({ httpStatus: 200, bodyParsed: true, errorPresent: false, declined: true, timedOut: false }),
    { stage: "scene_planner", code: "planner_declined" });
  const taughtNarration = [{ narration: "Synthetic taught narration." }];
  strictAssert.equal(telemetry.buildFailedTurnSentryEvent({
    ...failedTurn, visualStatus: "text_only", segments: taughtNarration,
    sceneArtifacts: {
      turnPlan: { visualRequirement: "optional" },
      failureTelemetry: { subject: "physics", stage: "scene_planner", code: "planner_declined" },
    },
  }, failureEnv), null, "an optional figure the planner skips is not a failed taught lesson");
  const requiredDecline = telemetry.buildFailedTurnSentryEvent({
    ...failedTurn, visualStatus: "text_only", segments: taughtNarration,
    sceneArtifacts: {
      turnPlan: { visualRequirement: "required" },
      failureTelemetry: { subject: "physics", stage: "scene_planner", code: "planner_declined" },
    },
  }, failureEnv);
  assert(requiredDecline, "a required figure the planner skips still fails");
  strictAssert.equal(requiredDecline.tags.code, "planner_declined");
  strictAssert.equal(requiredDecline.tags.figure_need, "required");
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
    "./failedTurnTelemetry": telemetry, "../boards/turnStatus": turnStatus, "../admin/turnFilters": turnFilters,
    "./failedTurnRuntime": failedTurnRuntime, "./workerFailureLog": workerFailureLog,
  }, { NODE_ENV: "production", SENTRY_ENVIRONMENT: "production", SENTRY_DSN: "https://synthetic@example.ingest.sentry.io/1" });
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
    sceneArtifacts: { turnPlan: { visualRequirement: "required" }, failureTelemetry: { subject: "maths" },
      degradation: { reason: "required_visual_unavailable" } },
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
  strictAssert.equal(laterNarrated.sentryFailureEvent.tags.code, "required_visual_unavailable");
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
  const sceneTimestamp = lateScene.sentryFailureEvent.timestamp;
  Object.assign(lateScene, { visualStatus: "validated", updatedAt: narrationAt,
    segments: [{ narration: "Synthetic verified scene narration" }] });
  await reporter.queueFailedTurnSentry(tx, { ...lateScene }, { env: failureEnv, now: narrationAt });
  strictAssert.deepEqual(Object.keys(lateScene.sentryFailureEvent ?? {}), ["timestamp", "reporting_origin"],
    "a recovered scene keeps only its deduplication timestamp and reporting origin");
  strictAssert.equal(lateScene.sentryFailureEvent?.timestamp, sceneTimestamp);
  strictAssert.equal(lateScene.sentryNextAttemptAt, null, "a recovered scene has no pending send time");
  strictAssert.equal(lateScene.sentryEventId, sceneReservation, "scene recovery does not churn the reserved event identity");
  const beforeRecoveryDrain = sentEvents.length;
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(narrationAt.getTime() + turnStatus.LIVE_TURN_IDLE_MS + 1) }, delivery)).reported, 0);
  strictAssert.equal(sentEvents.length, beforeRecoveryDrain, "the late verified scene never emits a stale failure");
  const partialTeaching: FixtureTurn = { ...persisted, id: "synthetic-partial-teaching", status: "stopped",
    visualStatus: "validated", updatedAt: narrationAt,
    sceneArtifacts: { failureTelemetry: { failed: true, subject: "other", stage: "teaching", code: "teaching_segment_failed" } },
    segments: [{ narration: "Synthetic first successful paragraph" }, { narration: "Synthetic final successful paragraph" }],
    sentryEventId: null, sentryFailureEvent: null, sentryReportedAt: null, sentryNextAttemptAt: null };
  rows.set(partialTeaching.id, partialTeaching);
  await reporter.queueFailedTurnSentry(tx, partialTeaching, { env: failureEnv, now: narrationAt });
  await reporter.queueFailedTurnSentry(tx, partialTeaching, { env: failureEnv, now: narrationAt });
  const beforePartial = sentEvents.length;
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(narrationAt.getTime() + turnStatus.LIVE_TURN_IDLE_MS + 1) }, delivery)).reported, 1);
  strictAssert.equal(sentEvents.length, beforePartial + 1, "a skipped paragraph emits exactly one event despite surrounding successful paragraphs");
  const partialEvent = sentEvents.at(-1)!;
  strictAssert.deepEqual(partialEvent.fingerprint, ["turn-failure", "teaching", "teaching_segment_failed", "other"]);
  strictAssert.equal(partialEvent.tags?.code, "teaching_segment_failed");
  strictAssert.equal(partialEvent.extra?.segment_count, 2);
  strictAssert.ok(!JSON.stringify(partialEvent).includes("Synthetic"), "teaching failure emits no student or paragraph text");
  const staleAt = new Date(narrationAt.getTime() + 10 * turnStatus.LIVE_TURN_IDLE_MS);
  const abandoned: FixtureTurn = { ...partialTeaching, id: "synthetic-abandoned-verified-teaching", status: "live",
    sentryEventId: null, sentryFailureEvent: null, sentryReportedAt: null, sentryNextAttemptAt: null };
  rows.set(abandoned.id, abandoned);
  const scanOptions = { env: failureEnv, startedAt: stoppedAt };
  strictAssert.equal(await reporter.queueAbandonedFailedTurns(staleAt, scanOptions), 1, "a lost close cannot hide terminal teaching failure behind verified geometry");
  strictAssert.equal(await reporter.queueAbandonedFailedTurns(staleAt, scanOptions), 0, "the abandoned turn reserves one event only");
  const beforeAbandoned = sentEvents.length;
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: new Date(staleAt.getTime() + turnStatus.LIVE_TURN_IDLE_MS + 1) }, delivery)).reported, 1);
  strictAssert.equal(sentEvents.length, beforeAbandoned + 1);
  strictAssert.equal(sentEvents.at(-1)?.tags?.code, "teaching_segment_failed");
  strictAssert.equal(sentEvents.at(-1)?.tags?.environment, "production", "recent abandoned tabs reach production alert filters");
  strictAssert.equal(sentEvents.at(-1)?.tags?.release, failureEnv.SENTRY_RELEASE);

  // A resumed turn cancels its pending send, then can be abandoned again.
  // The cancelled receipt preserves the original identity and timestamp.
  const resumed = makeStopped("synthetic-resume-then-abandon");
  rows.set(resumed.id, resumed);
  await reporter.queueFailedTurnSentry(tx, resumed, { env: failureEnv, now: stoppedAt });
  assert(resumed.sentryEventId && resumed.sentryFailureEvent, "the stopped turn has a receipt before resume");
  const resumedId = resumed.sentryEventId; const resumedTimestamp = resumed.sentryFailureEvent.timestamp;
  const resumedAt = new Date(stoppedAt.getTime() + 30_000);
  Object.assign(resumed, { status: "live", updatedAt: resumedAt,
    rawResponse: "Synthetic resumed narration", segments: [{ narration: "Synthetic resumed narration" }] });
  await reporter.queueFailedTurnSentry(tx, resumed, { env: failureEnv, now: resumedAt });
  strictAssert.equal(resumed.sentryEventId, resumedId);
  strictAssert.equal(resumed.sentryNextAttemptAt, null, "an active resumed turn cancels delivery");
  strictAssert.deepEqual(Object.keys(resumed.sentryFailureEvent ?? {}), ["timestamp", "reporting_origin"]);
  strictAssert.equal(resumed.sentryFailureEvent?.timestamp, resumedTimestamp);
  const abandonedAgainAt = new Date(resumedAt.getTime() + turnStatus.LIVE_TURN_IDLE_MS + 1);
  strictAssert.equal(await reporter.queueAbandonedFailedTurns(abandonedAgainAt, scanOptions), 1,
    "a cleared unreported reservation is rebuilt if the resumed tab disappears again");
  strictAssert.equal(resumed.sentryEventId, resumedId, "re-abandonment keeps the first event identity");
  strictAssert.equal(resumed.sentryFailureEvent?.timestamp, resumedTimestamp, "re-abandonment keeps the first event timestamp");
  strictAssert.equal(resumed.sentryFailureEvent?.tags.environment, "production");
  strictAssert.equal(resumed.sentryFailureEvent?.tags.provider, "azure", "recent recovery uses its actual deployment");
  const beforeResumedDelivery = sentEvents.length;
  strictAssert.equal((await reporter.runFailedTurnSentryBatch({ now: abandonedAgainAt }, delivery)).reported, 1);
  strictAssert.equal(sentEvents.length, beforeResumedDelivery + 1);
  strictAssert.equal(sentEvents.at(-1)?.event_id, resumedId);
  strictAssert.equal(sentEvents.at(-1)?.timestamp, resumedTimestamp);

  const beforeBoot = { ...makeStopped("synthetic-before-current-deploy"), status: "live", updatedAt: new Date(stoppedAt.getTime() - 1) };
  const beforeHour = { ...makeStopped("synthetic-older-than-one-hour"), status: "live", updatedAt: new Date(staleAt.getTime() - 3_600_001) };
  rows.set(beforeBoot.id, beforeBoot); rows.set(beforeHour.id, beforeHour);
  strictAssert.equal(await reporter.queueAbandonedFailedTurns(staleAt, scanOptions), 0,
    "startup scans leave old rows to the explicit historical backfill");
  strictAssert.equal(beforeBoot.sentryEventId, null, "pre-deploy abandonment is not attributed to this release");
  strictAssert.equal(beforeHour.sentryEventId, null, "abandonment older than one hour is not automatically queued");

  // A local server can inherit the same DSN. Neither queueing, startup nor
  // default delivery is enabled without the explicit production runtime.
  for (const runtimeEnv of [
    { NODE_ENV: "development", SENTRY_ENVIRONMENT: "production" },
    { NODE_ENV: "test", SENTRY_ENVIRONMENT: "production" },
    { NODE_ENV: "production", SENTRY_ENVIRONMENT: "lab" },
    { NODE_ENV: "production" },
  ]) {
    let databaseReads = 0, databaseWrites = 0, clientConstructions = 0;
    const offTx = { turn: { updateMany: async () => { databaseWrites++; return { count: 1 }; }, findFirst: async () => null } };
    const off = loadModule<typeof reporter>("lib/obs/failedTurnSentry.ts", {
      "node:crypto": { randomUUID: () => crypto.randomUUID() },
      "@prisma/client": { Prisma: { JsonNull: null, DbNull: null } },
      "@sentry/nextjs": { ...Sentry, NodeClient: class { constructor() { clientConstructions++; throw new Error("local delivery must stay disabled"); } } },
      "../db/prisma": { prisma: { $queryRaw: async () => { databaseReads++; return []; },
        turn: { findMany: async () => { databaseReads++; return []; } } } },
      "./sentryPrivacy": { ...privacy, sentryServerDsn: () => "https://synthetic@example.ingest.sentry.io/1" },
      "./failedTurnTelemetry": telemetry, "./failedTurnRuntime": failedTurnRuntime, "./workerFailureLog": workerFailureLog,
      "../boards/turnStatus": turnStatus, "../admin/turnFilters": turnFilters,
    }, runtimeEnv);
    strictAssert.equal(await off.queueFailedTurnSentry(offTx, { ...failedTurn, id: "synthetic-local-fail" }, { env: runtimeEnv }), null);
    strictAssert.equal(await off.queueAbandonedFailedTurns(staleAt, { env: runtimeEnv, startedAt: stoppedAt }), 0);
    const disabledBatch = await off.runFailedTurnSentryBatch({ now: staleAt });
    strictAssert.equal(disabledBatch.reported, 0); strictAssert.equal(disabledBatch.pending, 0);
    off.startFailedTurnSentryWorker()();
    strictAssert.equal(databaseReads, 0, "nonproduction delivery and recovery never inspect the database");
    strictAssert.equal(databaseWrites, 0, "nonproduction failed saves do not write the production outbox");
    strictAssert.equal(clientConstructions, 0, "a configured DSN cannot enable the local Sentry worker");
  }
  await Sentry.close();
  console.log("✓ Sentry: persisted fail, one clean SDK event, retry idempotency, bounded durable delivery and admin link verified");
}

void verifyFailedTurnDelivery().catch(error => { console.error(error); process.exitCode = 1; });
