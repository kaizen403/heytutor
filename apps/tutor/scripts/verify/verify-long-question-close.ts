/** A keepalive close keeps an existing turn's question: real browser save and close through the HTTP handlers, no external I/O. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import { Prisma } from "@prisma/client";
import { FIGURE_SOURCES, SCENE_ENGINE_VERSION, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import type { RecordedSegmentPayload, TurnCheckpointInput } from "../../lib/boards/boardsClient";

// Only external identity, database, and object-storage boundaries are replaced.
// Real quota, trace admission, upload, canonicalization, scene proof/source, and
// reopen source-read helpers run. No paid provider or existing DB is contacted.
const root = resolve(import.meta.dirname, "../..");
const load = createRequire(import.meta.url);
const modulePath = (path: string) => resolve(root, path);
const owner = "376c7567-0681-44d9-b8ec-ce78b8f14165";
const boardId = "b9db230b-331f-4811-9767-fe2a1a1010df";
const date = new Date("2026-10-10T00:00:00Z");
const board = { id: boardId, userId: owner, title: "Save/reopen regression", preview: "", createdAt: date, updatedAt: date };
const userId: string | null = owner;
let reservedBytes = 0n;
let pendingTurns = 0;
type Data = Record<string, unknown>;
const turns: Data[] = [];
const segments: Data[] = [];
const traces = new Map<string, Data>();
const cleanup = new Map<string, Data>();
const matches = (row: Data, where: Data) => Object.entries(where).every(([key, value]) => row[key] === value);
const cleanJsonNulls = (data: Data): Data => Object.fromEntries(Object.entries(data)
  .map(([key, value]) => [key, value === Prisma.DbNull ? null : value]));
const findTurn = (where: Data) => {
  const turn = turns.find((row) => matches(row, where));
  return turn ? { ...turn, segments: segments.filter((row) => row.turnId === turn.id) } : null;
};
const tx = {
  $queryRaw: async () => [{ id: owner }],
  board: {
    findFirst: async ({ where }: { where: Data }) => matches(board, where) ? board : null,
    findUnique: async ({ where }: { where: Data }) => matches(board, where) ? board : null,
    update: async ({ data }: { data: Data }) => Object.assign(board, data),
  },
  turn: {
    findFirst: async ({ where }: { where: Data }) => findTurn(where),
    findMany: async ({ where, skip = 0, take }: { where: Data; skip?: number; take?: number }) =>
      turns.filter((row) => matches(row, where)).sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex))
        .slice(skip, take === undefined ? undefined : skip + take),
    count: async ({ where }: { where: Data }) => turns.filter((row) => matches(row, where)).length,
    create: async ({ data }: { data: Data }) => {
      const turn = { status: "complete", kind: "lesson", checkpointSeq: 0, submittedSegments: null,
        resumeState: null, ...cleanJsonNulls(data), createdAt: date, updatedAt: new Date() };
      turns.push(turn);
      return turn;
    },
    update: async ({ where, data }: { where: Data; data: Data }) => {
      const turn = turns.find((row) => matches(row, where));
      assert(turn, "external DB fixture cannot update a missing turn");
      for (const [key, value] of Object.entries(cleanJsonNulls(data))) {
        if (value && typeof value === "object" && "increment" in value) {
          assert.equal(typeof turn[key], "bigint");
          assert.equal(typeof value.increment, "bigint");
          turn[key] = (turn[key] as bigint) + (value.increment as bigint);
        } else turn[key] = value;
      }
      turn.updatedAt = new Date();
      return { ...turn };
    },
  },
  segment: {
    createManyAndReturn: async ({ data }: { data: Data[] }) => {
      const rows = data.map((row) => ({ ...row, command: row.command ?? null, id: crypto.randomUUID() }));
      segments.push(...rows);
      return rows;
    },
    deleteMany: async ({ where }: { where: Data }) => {
      for (let index = segments.length - 1; index >= 0; index--) {
        if (matches(segments[index]!, where)) segments.splice(index, 1);
      }
      return {};
    },
    findMany: async ({ where }: { where: { turnId: string | { in: string[] } } }) =>
      segments.filter((row) => typeof where.turnId === "string" ? row.turnId === where.turnId :
        where.turnId.in.includes(String(row.turnId))).sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex)),
  },
  ownedTrace: {
    findUnique: async ({ where }: { where: { traceId: string } }) => traces.get(where.traceId) ?? null,
    update: async ({ where, data }: { where: { traceId: string }; data: Data }) => Object.assign(traces.get(where.traceId)!, data),
  },
  userStorage: {
    findUnique: async () => ({ userId: owner, reservedBytes, pendingTurns }),
    update: async ({ data }: { data: { reservedBytes?: bigint | { increment: bigint }; pendingTurns?: number | { increment: number } } }) => {
      if (typeof data.reservedBytes === "bigint") reservedBytes = data.reservedBytes;
      else if (data.reservedBytes) reservedBytes += data.reservedBytes.increment;
      if (typeof data.pendingTurns === "number") pendingTurns = data.pendingTurns;
      else if (data.pendingTurns) pendingTurns += data.pendingTurns.increment;
      return { userId: owner, reservedBytes, pendingTurns };
    },
  },
  boardChatMessage: { count: async () => 0 },
  objectDeletionJob: {
    findFirst: async () => [...cleanup.values()].find(job => job.attempts === 0 &&
      job.createdAt instanceof Date && job.createdAt.getTime() <= Date.now() - 30 * 60_000 &&
      job.nextAttemptAt instanceof Date && job.nextAttemptAt.getTime() <= Date.now()) ?? null,
    create: async ({ data }: { data: Data }) => {
      const job = { attempts: 0, ...data };
      cleanup.set(String(data.id), job);
      return job;
    },
    findUnique: async ({ where }: { where: { id: string } }) => cleanup.get(where.id) ?? null,
    delete: async ({ where }: { where: { id: string } }) => cleanup.delete(where.id),
    update: async ({ where, data }: { where: { id: string }; data: Data }) => Object.assign(cleanup.get(where.id)!, data),
  },
};
const prisma = { ...tx, $transaction: async <T>(run: (database: typeof tx) => Promise<T>) => run(tx) };
mock.module(modulePath("lib/auth.ts"), {
  namedExports: { getUserId: async () => userId, ensureUser: async () => undefined },
});
mock.module(modulePath("lib/db/prisma.ts"), { namedExports: { prisma } });
mock.module(modulePath("lib/obs/failedTurnSentry.ts"), { namedExports: { queueFailedTurnSentry: async () => null } });
mock.module(modulePath("lib/object-store/s3.ts"), {
  namedExports: { uploadAudio: async (key: string) => {
    return `/api/media?key=${encodeURIComponent(key)}`;
  } },
});

const originalEnv = process.env.NODE_ENV;
Object.assign(process.env, { NODE_ENV: "production" });
const post = load(modulePath("app/api/boards/[boardId]/turns/route.ts")) as typeof import("../../app/api/boards/[boardId]/turns/route");
const get = load(modulePath("app/api/boards/[boardId]/route.ts")) as typeof import("../../app/api/boards/[boardId]/route");
const checkpoint = load(modulePath("app/api/boards/[boardId]/turns/[turnId]/route.ts")) as typeof import("../../app/api/boards/[boardId]/turns/[turnId]/route");
const client = load(modulePath("lib/boards/boardsClient.ts")) as typeof import("../../lib/boards/boardsClient");
const context = { params: Promise.resolve({ boardId }) };
const originalFetch = globalThis.fetch;
const originalError = console.error;
const originalWarn = console.warn;
const serverLogs: unknown[][] = [];
const responses: Array<{ status: number; body: string }> = [];
let inHandler = false;
const captureServerLog = (...args: unknown[]) => {
  // Node emits loader/mock warnings asynchronously while a handler is running;
  // those are process diagnostics, not application rejection events.
  if (typeof args[0] === "string" && /^\(node:\d+\) (?:Experimental|Deprecation)Warning:/.test(args[0])) return;
  if (inHandler) serverLogs.push(args);
};
console.error = captureServerLog;
console.warn = captureServerLog;
globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(new URL(String(input), "https://save.test"), init);
  const url = new URL(request.url);
  const turnId = url.pathname.startsWith(`/api/boards/${boardId}/turns/`) ? url.pathname.split("/").at(-1) : null;
  assert(url.pathname === `/api/boards/${boardId}/turns` || url.pathname === `/api/boards/${boardId}` || turnId,
    "external network is prohibited in save/reopen verification");
  inHandler = true;
  try {
    if (request.method === "POST" && url.pathname.endsWith("/turns")) {
      const response = await post.POST(request, context);
      responses.push({ status: response.status, body: await response.clone().text() });
      return response;
    }
    if (turnId && (request.method === "PUT" || request.method === "PATCH")) {
      const turnContext = { params: Promise.resolve({ boardId, turnId }) };
      const response = request.method === "PUT" ? await checkpoint.PUT(request, turnContext) :
        await checkpoint.PATCH(request, turnContext);
      responses.push({ status: response.status, body: await response.clone().text() });
      return response;
    }
    assert.equal(request.method, "GET");
    return get.GET(request, context);
  } finally { inHandler = false; }
};


const planFor = (question: string): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
});
const mathsQuestion = "Draw a labelled line segment AB.";
const mathsDocument: SceneDocument = {
  schemaVersion: "scene-document/v2", source: { question: mathsQuestion },
  visualDecision: { mode: "scene", reason: "show the requested labelled segment" }, quantities: [],
  entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" },
    { id: "b", kind: "point", role: "endpoint", label: "B" },
    { id: "ab", kind: "segment", role: "segment", label: "AB" }],
  constructions: [{ id: "pa", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "pb", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "sab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
  relations: [], assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
  annotations: [], requiredEntityIds: ["a", "b", "ab"],
  revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw AB." }],
};

/**
 * #273 review: a keepalive close must never rewrite the question of a turn
 * that already exists. Before the fix, a long question lesson that
 * checkpointed a validated figure was refused by its close
 * (scene_source_question_mismatch) and stayed live, and a text only lesson
 * had its question cut and its plan dropped. The questions here are synthetic.
 */
const padded = (length: number) => {
  const base = "Draw a labelled line segment AB. ";
  const filler = "Keep the ruler straight and mark both ends clearly. ";
  return (base + filler.repeat(Math.ceil(length / filler.length))).slice(0, length).trimEnd() + ".";
};
const textRows = (count: number, base: number): RecordedSegmentPayload[] => Array.from({ length: count }, (_, k) => ({
  orderIndex: base + k,
  narration: `Step ${base + k}: the segment AB keeps its length while we describe it in words, sentence ${k}.`,
  spokenText: `Step ${base + k}: the segment AB keeps its length while we describe it in words, sentence ${k}.`,
  command: { type: "WRITE", params: [40, 100 + k * 20], text: `line ${base + k}`, charPosition: 0, narrationBefore: "" },
  audioBytes: null, durationMs: 100, timings: null,
}) as unknown as RecordedSegmentPayload);

function figureCheckpoint(question: string): TurnCheckpointInput {
  const turnPlan = planFor(question);
  const decision = liveDiagramStrategyDecision({ assignedStrategy: "current", subject: "maths", strictSubjects: ["maths"],
    chemistryLane: false, codeLesson: false, dsa: false, doubt: false });
  const validation = validateProductionSceneCandidate({ candidate: { ...mathsDocument, source: { question } }, question, turnPlan });
  assert(validation.valid, JSON.stringify(validation.errors));
  const selection = selectProductionScene({ question, turnPlan, problemIR: null,
    sceneCapabilities: inferSceneCapabilities(question, { turnPlan }), candidateValidation: validation,
    policy: { preferPlanner: true, allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)) } });
  const selected = selection.representation;
  assert(selected, `the long question figure must be admitted: ${selection.reason}`);
  const presentation = buildVerifiedDiagramPresentation(selected.sceneDocument, selected.renderScene, selected.family ? { figureFamily: selected.family } : {});
  const recorded: RecordedSegmentPayload[] = presentation.introSegments.map((segment, orderIndex) => ({
    orderIndex, narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
    audioBytes: null, durationMs: 100, timings: null,
  }));
  const traceId = crypto.randomUUID();
  traces.set(traceId, { traceId, userId: owner, expiresAt: new Date(Date.now() + 60_000), savedTurnId: null });
  return {
    seq: 1, status: "live", kind: "lesson", baseCount: 0, question, preview: question, rawResponse: "", speedMultiplier: 1, traceId,
    scene: { sceneDocument: selected.sceneDocument, sceneEngineVersion: SCENE_ENGINE_VERSION, validationReport: selected.validationReport,
      visualStatus: selection.visualStatus, sceneArtifacts: {
        schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: null, solverResult: null, solverAuthority: null,
        representationTier: selected.tier, nonMetric: selected.nonMetric, figureSource: selected.figureSource,
        diagramStrategy: decision.strategy, candidates: [], selectedCandidateId: null, selectionReason: selected.reason,
        diagramResultStatus: "ready", proofObligations: [] } },
    segments: client.withBoardEpochSegment(recorded),
  } as unknown as TurnCheckpointInput;
}

function textCheckpoint(question: string): TurnCheckpointInput {
  const traceId = crypto.randomUUID();
  traces.set(traceId, { traceId, userId: owner, expiresAt: new Date(Date.now() + 60_000), savedTurnId: null });
  return {
    seq: 1, status: "live", kind: "lesson", baseCount: 0, question, preview: question, rawResponse: "", speedMultiplier: 1, traceId,
    scene: { visualStatus: "text_only", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: planFor(question), problemIR: null,
      solverResult: null, solverAuthority: null, candidates: [], selectedCandidateId: null, diagramResultStatus: "text_only", proofObligations: [] } },
    segments: client.withBoardEpochSegment(textRows(1, 1)),
  } as unknown as TurnCheckpointInput;
}

async function closeKeepsQuestion(name: string, questionLength: number, tail: number, kind: "figure" | "text"): Promise<void> {
  const question = padded(questionLength);
  const turnId = crypto.randomUUID();
  const first = kind === "figure" ? figureCheckpoint(question) : textCheckpoint(question);
  const saved = await client.checkpointTurn(boardId, turnId, first);
  assert(saved.ok, `${name}: the first checkpoint must save: ${JSON.stringify(responses.at(-1))}`);
  const stored = turns.find((row) => row.id === turnId)!;
  const baseCount = segments.filter((row) => row.turnId === turnId).length;
  const planBefore = JSON.stringify((stored.sceneArtifacts as { turnPlan?: unknown }).turnPlan ?? null);
  const closeTail = textRows(tail, baseCount);
  const closeInput = {
    seq: 2, status: "stopped" as const, baseCount, segments: closeTail, rawResponse: closeTail.map((row) => row.narration).join(" "),
    question, preview: question, kind: "lesson" as const,
  };
  const body = JSON.parse(client.buildTurnCloseBody(closeInput)) as { question?: string; appendSegments?: unknown[] };
  assert.equal(body.appendSegments?.length, tail, `${name}: the close body carries the whole tail`);
  assert((body.question ?? "").length < question.length, `${name}: the close body carries a cut question, so the case exercises the rule`);
  const closed = await client.closeTurnKeepalive(boardId, turnId, closeInput);
  assert(closed.ok, `${name}: the close must be accepted: ${JSON.stringify(responses.at(-1))}`);
  const after = turns.find((row) => row.id === turnId)!;
  assert.equal(after.status, "stopped", `${name}: the close stops the turn`);
  assert.equal(after.question, question, `${name}: the close must keep the stored question`);
  assert.equal(segments.filter((row) => row.turnId === turnId).length, baseCount + tail, `${name}: every tail row is appended`);
  assert.equal(JSON.stringify((after.sceneArtifacts as { turnPlan?: unknown }).turnPlan ?? null), planBefore, `${name}: the plan survives the close`);
}

async function main(): Promise<void> {
  await closeKeepsQuestion("validated figure, 1,348 character question", 1_348, 33, "figure");
  await closeKeepsQuestion("text only, 1,348 character question", 1_348, 33, "text");
  await closeKeepsQuestion("validated figure, 3,322 character question", 3_322, 1, "figure");
  await closeKeepsQuestion("text only, 3,322 character question", 3_322, 1, "text");
  console.log("long question close: 4 cases keep the stored question, stop the turn, append every tail row and keep the plan");
}

void main().catch((error) => { originalError(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  console.warn = originalWarn;
  if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: originalEnv });
});
