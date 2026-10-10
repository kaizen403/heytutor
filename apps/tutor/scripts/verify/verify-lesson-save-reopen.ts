/** Real browser save -> HTTP handlers -> reopened board, without external I/O. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mock } from "node:test";
import { Prisma } from "@prisma/client";
import {
  FIGURE_SOURCES, LocalDeterministicSolverProvider, SCENE_ENGINE_VERSION, compileSceneDocument,
  validateProblemIR, validateSolverResult, validateTurnPlanV3, verifyTurnPlanAgainstSolver,
  type ProblemIR, type SceneDocument, type SolverAuthorityAudit, type SolverResult, type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  focusEmphasisOf, getSegmentCommands, isStoredCommandTrustedGeometry, parseStoredSegmentCommands,
  prepareVerifiedLessonSegments, resolveVerifiedDiagramFocusTargets, serializeSegmentCommands, type DrawCommand,
} from "@heytutor/drawing";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { currentPausedLesson, pausedLessonFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import { resumeTurnScene } from "../../features/tutor-session/lib/turn/doubtTurn";
import { pageTurnsEndingAt, storedTurnContinuesBoard } from "../../lib/boards/boardContinuation";
import type { RecordedSegmentPayload, StoredTurn } from "../../lib/boards/boardsClient";
import { MAX_TURN_AUDIO_BYTES, MAX_TURN_SEGMENTS } from "../../lib/scene/turnUploadLimits";

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
let userId: string | null = owner;
let reservedBytes = 0n;
let pendingTurns = 0;
let uploads = 0;
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
  objectDeletionJob: {
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
mock.module(modulePath("lib/object-store/s3.ts"), {
  namedExports: { uploadAudio: async (key: string) => {
    uploads++;
    return `/api/media?key=save-reopen-fixture&object=${encodeURIComponent(key)}`;
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
const mathsPlan = planFor(mathsQuestion);
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
const physicsQuestion = "A 12 V battery is connected across a 4 Ω resistor. Find the current.";
const physicsPlan: TurnPlanV3 = { ...planFor(physicsQuestion), givens: [
  { id: "V", symbol: "V", value: 12, unit: "V", provenance: "given", sourceText: "12 V" },
  { id: "R", symbol: "R", value: 4, unit: "Ω", provenance: "given", sourceText: "4 Ω" },
] };

interface SolvedIncompleteFixture {
  question: string;
  turnPlan: TurnPlanV3;
  problemIR: ProblemIR;
  solverResult: SolverResult;
  solverAuthority: SolverAuthorityAudit;
}

async function solvedIncompleteFixture(subject: "maths" | "physics"): Promise<SolvedIncompleteFixture> {
  const question = subject === "maths" ? `${mathsQuestion} Also calculate 2+3.` : physicsQuestion;
  const turnPlan: TurnPlanV3 = {
    ...structuredClone(subject === "maths" ? mathsPlan : physicsPlan), question,
    unknowns: subject === "maths" ? [{ id: "sum", symbol: "s" }] : [{ id: "I", symbol: "I", unit: "A" }],
    derived: subject === "maths" ? [
      { id: "sum", symbol: "s", value: 5, provenance: "derived", sourceText: "s = 2+3 = 5" },
    ] : [
      { id: "I", symbol: "I", value: 3, unit: "A", provenance: "derived", sourceText: "I = 3 A" },
    ],
  };
  const evidence = (quote: string) => {
    const start = question.indexOf(quote);
    assert(start >= 0, "solver fixture facts must be grounded in the public question");
    return { source: "question" as const, start, end: start + quote.length, quote };
  };
  const problemIR: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: `${subject}IncompleteBinding`, question,
    facts: subject === "maths" ? [
      { id: "requested", kind: "requested", statement: "Calculate the requested sum.", evidence: evidence("calculate 2+3") },
    ] : [
      { id: "voltage", kind: "given", statement: "The battery voltage is 12 V.", evidence: evidence("12 V") },
      { id: "resistance", kind: "given", statement: "The resistance is 4 Ω.", evidence: evidence("4 Ω") },
      { id: "requested", kind: "requested", statement: "Find the current.", evidence: evidence("Find the current") },
    ],
    entities: [], expressions: [{
      id: "answer", valueType: "scalar",
      root: { kind: "binary", operator: subject === "maths" ? "+" : "/",
        left: { kind: "number", value: subject === "maths" ? 2 : 12 },
        right: { kind: "number", value: subject === "maths" ? 3 : 4 } },
      evidenceFactIds: subject === "maths" ? ["requested"] : ["voltage", "resistance", "requested"],
    }], constraints: [], representationIntents: [],
    // A supported solved request without an explicit TurnPlan binding is the
    // reachable "incomplete" audit case, not a failed/partial solver result.
    solveRequests: [{ id: "evaluateAnswer", kind: "evaluate", expressionId: "answer" }],
  };
  const problemValidation = validateProblemIR(problemIR, question);
  assert(problemValidation.valid, JSON.stringify(problemValidation.issues));
  const planValidation = validateTurnPlanV3(turnPlan, question);
  assert(planValidation.valid, JSON.stringify(planValidation.issues));
  const solverResult = await new LocalDeterministicSolverProvider().solve(problemIR);
  const resultValidation = validateSolverResult(solverResult, problemIR);
  assert(resultValidation.valid, JSON.stringify(resultValidation.issues));
  assert.equal(solverResult.status, "solved");
  assert.equal(solverResult.values[0]?.approximate, subject === "maths" ? 5 : 3);
  const solverAuthority = verifyTurnPlanAgainstSolver(problemIR, solverResult, turnPlan, question);
  assert.equal(solverAuthority.status, "incomplete");
  assert.deepEqual(solverAuthority.issues.map((issue) => issue.code), ["unbound_unknown"]);
  assert.deepEqual(solverAuthority.bindings, []);
  return { question, turnPlan, problemIR, solverResult, solverAuthority };
}

interface GestureFixture {
  kind: "FOCUS" | "ANNOTATE";
  mode: "semantic-only" | "disagreeing-text" | "unknown";
}

function lessonPayload(subject: "maths" | "physics", solver?: SolvedIncompleteFixture, gesture?: GestureFixture) {
  const question = solver?.question ?? (subject === "maths" ? mathsQuestion : physicsQuestion);
  const turnPlan = solver?.turnPlan ?? (subject === "maths" ? mathsPlan : physicsPlan);
  const decision = liveDiagramStrategyDecision({
    assignedStrategy: "current", subject, strictSubjects: ["maths"],
    chemistryLane: false, codeLesson: false, dsa: false, doubt: false,
  });
  assert.equal(decision.strategy, subject === "maths" ? "strict" : "current");
  const validation = subject === "maths" ? validateProductionSceneCandidate({
    candidate: { ...mathsDocument, source: { question } }, question, turnPlan,
  }) : undefined;
  if (validation) assert(validation.valid, JSON.stringify(validation.errors));
  const selection = selectProductionScene({
    question, turnPlan, problemIR: solver?.problemIR ?? null,
    sceneCapabilities: inferSceneCapabilities(question, { turnPlan, problemIR: solver?.problemIR }),
    candidateValidation: validation,
    policy: { preferPlanner: decision.strategy === "strict",
      allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)) },
  });
  const selected = selection.representation;
  assert(selected, `${subject}: production must admit the public fixture: ${selection.reason}`);
  const presentation = buildVerifiedDiagramPresentation(selected.sceneDocument, selected.renderScene,
    selected.family ? { figureFamily: selected.family } : {});
  const recorded: RecordedSegmentPayload[] = presentation.introSegments.map((segment, orderIndex) => ({
    orderIndex, narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
    audioBytes: new Uint8Array([73, 68, 51, orderIndex, 1, 2]), durationMs: 100, timings: null,
  }));
  recorded.push({ orderIndex: recorded.length, narration: "Now write the result.", spokenText: "Now write the result.",
    command: { type: "WRITE", params: [40, 100], text: subject === "maths" ? "AB" : "I = 3 A", charPosition: 0, narrationBefore: "" },
    audioBytes: new Uint8Array([73, 68, 51, 9, 1, 2]), durationMs: 100, timings: null });
  if (gesture) {
    const anchor = presentation.diagram.anchors[0];
    assert(anchor, `${subject}: semantic fixture needs a real compiler-owned anchor`);
    const command: DrawCommand = {
      type: gesture.kind, params: [], charPosition: 0, narrationBefore: "Notice the named figure part.",
      semanticRef: { entityId: gesture.mode === "unknown" ? "PRIVATE_UNKNOWN_TARGET" : `${anchor.id}|spotlight` },
      ...(gesture.mode === "disagreeing-text" ? { text: "PRIVATE_WRONG_TARGET|pulse" } : {}),
    };
    if (gesture.mode !== "unknown") {
      const live = prepareVerifiedLessonSegments([{ narration: "Notice the named figure part.", command }], presentation.diagram);
      assert.equal(live.blockedCommandCount, 0, `${subject}: compiler-bound semantic gesture must be live-admitted`);
      assert.deepEqual(getSegmentCommands(live.segments[0]!), [command]);
      assert.deepEqual(resolveVerifiedDiagramFocusTargets(command, presentation.diagram).map((target) => target.id), [anchor.id]);
      assert.equal(focusEmphasisOf(command), "spotlight", "live semantic target/emphasis overrides disagreeing text");
    }
    recorded.push({ orderIndex: recorded.length, narration: "Notice the named figure part.", spokenText: "Notice the named figure part.",
      command: serializeSegmentCommands([command]),
      audioBytes: new Uint8Array([73, 68, 51, 10, 1, 2]), durationMs: 100, timings: null });
  }
  const traceId = crypto.randomUUID();
  traces.set(traceId, { traceId, userId: owner, expiresAt: new Date(Date.now() + 60_000), savedTurnId: null });
  return {
    question, rawResponse: "[STEP] Now write the result.", speedMultiplier: 1, traceId,
    sceneDocument: selected.sceneDocument, sceneEngineVersion: SCENE_ENGINE_VERSION,
    validationReport: selected.validationReport, visualStatus: selection.visualStatus,
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", turnPlan, problemIR: solver?.problemIR ?? null,
      solverResult: solver?.solverResult ?? null, solverAuthority: solver?.solverAuthority ?? null,
      representationTier: selected.tier, nonMetric: selected.nonMetric, figureSource: selected.figureSource,
      diagramStrategy: decision.strategy, candidates: [], selectedCandidateId: null,
      selectionReason: selected.reason, diagramResultStatus: "ready", proofObligations: [],
    },
    // The real lesson caller adds this runtime-owned page reset before saving.
    segments: client.withBoardEpochSegment(recorded),
  };
}

async function saveAndReopen(subject: "maths" | "physics", solver?: SolvedIncompleteFixture, gesture?: GestureFixture): Promise<StoredTurn> {
  const payload = lessonPayload(subject, solver, gesture);
  const saved = await client.saveTurn(boardId, payload);
  assert(saved, `${subject}: lesson must save; HTTP outcome ${JSON.stringify(responses.at(-1))}`);
  const detail = await client.fetchBoardDetail(boardId);
  const reopened = detail?.turns.find((turn) => turn.id === saved.id);
  assert(reopened, `${subject}: successful save must survive reopening`);
  assert.equal(reopened.visualStatus, "validated", `${subject}: reopening must retain the validated figure`);
  assert.deepEqual(reopened.sceneDocument, saved.sceneDocument);
  assert.equal((reopened.sceneArtifacts as { diagramStrategy: string }).diagramStrategy, subject === "maths" ? "strict" : "current");
  if (gesture) {
    const recordedCommand = parseStoredSegmentCommands(payload.segments.at(-1)!.command)[0]!;
    const restoredCommands = reopened.segments.flatMap((segment) => parseStoredSegmentCommands(segment.command))
      .filter((command) => command.type === gesture.kind);
    if (gesture.mode === "unknown") {
      assert.deepEqual(restoredCommands, [], "an unknown FOCUS is filtered without losing the recording");
    } else {
      assert.equal(restoredCommands.length, 1, `${subject}: semantic-only ${gesture.kind} must survive reopening`);
      const restored = restoredCommands[0]!;
      assert.equal(restored.text, recordedCommand.semanticRef!.entityId,
        `${subject}: canonical text must preserve the live semantic target and emphasis`);
      assert.equal(focusEmphasisOf(restored), "spotlight");
      assert.deepEqual(restored.params, [], "semantic gestures cannot acquire model coordinates");
      const compiled = compileSceneDocument(payload.sceneDocument);
      assert(compiled.ok && compiled.renderScene);
      const diagram = buildVerifiedDiagramPresentation(payload.sceneDocument, compiled.renderScene).diagram;
      assert.deepEqual(resolveVerifiedDiagramFocusTargets(restored, diagram).map((target) => target.id),
        resolveVerifiedDiagramFocusTargets(recordedCommand, diagram).map((target) => target.id));
      assert(!reopened.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command) &&
        parseStoredSegmentCommands(segment.command).some((command) => command.type === gesture.kind)),
      "ordinary gestures must never be promoted to trusted diagram ink");
    }
  }
  if (solver) {
    const artifacts = reopened.sceneArtifacts as SolvedIncompleteFixture;
    assert.deepEqual(artifacts.problemIR, solver.problemIR, `${subject}: reopening must retain the validated source-grounded problem`);
    assert.equal(artifacts.solverResult.status, "solved", `${subject}: reopening must retain the independently solved result`);
    assert.equal(artifacts.solverResult.values[0]?.approximate, subject === "maths" ? 5 : 3);
    assert.equal(artifacts.solverAuthority.status, "incomplete", `${subject}: binding incompleteness must not be relabelled verified`);
    assert.deepEqual(artifacts.solverAuthority.issues.map((issue) => issue.code), ["unbound_unknown"]);
    assert.deepEqual(artifacts.solverAuthority.bindings, []);
  }
  assert.equal(parseStoredSegmentCommands(reopened.segments[0]?.command)[0]?.type, "CLEAR",
    `${subject}: replay must start on the same fresh page as the live lesson`);
  assert(reopened.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)),
    `${subject}: server-verified figure ink must survive reopening`);
  assert(reopened.segments.some((segment) => parseStoredSegmentCommands(segment.command).some((command) => command.type === "WRITE")),
    `${subject}: narrated working must survive reopening alongside the figure`);
  assert(reopened.segments.some((segment) => segment.audioUrl?.startsWith("/api/media?key=save-reopen-fixture")),
    `${subject}: recording must survive the server intro canonicalization`);
  assert.equal(pendingTurns, 0, "successful saves settle their storage allowance");
  assert.equal(cleanup.size, 0, "successful saves settle their cleanup intent");
  return reopened;
}

async function rejectForgery(kind: "wrong-source" | "failed-proof"): Promise<void> {
  const payload = lessonPayload("maths");
  payload.rawResponse = "PRIVATE_RAW_RESPONSE_MUST_NOT_BE_LOGGED";
  const document = structuredClone(payload.sceneDocument);
  if (kind === "wrong-source") document.source.question = "PRIVATE_SOURCE_QUESTION_MUST_NOT_BE_LOGGED";
  else document.assertions[0]!.expected = false;
  payload.sceneDocument = document;
  const before = (await client.fetchBoardDetail(boardId))!.turns.map((turn) => turn.id);
  const beforeUploads = uploads;
  const logStart = serverLogs.length;
  const saved = await client.saveTurn(boardId, payload);
  assert.equal(saved, null, `${kind}: a forged scene must not become a saved turn`);
  const response = responses.at(-1)!;
  assert.equal(response.status, 400, `${kind}: scene rejection must be a client error`);
  const rejectionCode = kind === "wrong-source" ? "scene_source_question_mismatch" : "scene_compile_failed";
  assert.equal((JSON.parse(response.body) as { code: string }).code, rejectionCode,
    `${kind}: scene rejection must identify its real validator leaf`);
  assert.match(response.body, kind === "wrong-source" ? /source question does not match/ : /does not compile|proof.*failed/,
    `${kind}: denial must come from the intended real validator, not an unrelated fixture failure`);
  assert.deepEqual((await client.fetchBoardDetail(boardId))!.turns.map((turn) => turn.id), before,
    `${kind}: reopening must show only the previously saved valid lessons`);
  assert.equal(uploads, beforeUploads, `${kind}: rejected geometry cannot allocate object storage`);
  assertRejectionLog(kind, logStart, rejectionCode, 400, [payload.question, payload.rawResponse]);
}

function assertRejectionLog(name: string, logStart: number, code: string, status: number, privateText: string[] = [],
  entryPoint = "legacy_post"): void {
  const emitted = serverLogs.slice(logStart);
  assert.equal(emitted.length, 1, `${name}: rejection must emit exactly one server event`);
  const event = emitted[0]!.find((value) => value && typeof value === "object") as Data | undefined;
  assert(event, `${name}: rejection must include structured fields`);
  assert.equal(event.event, "turn_save_rejected");
  assert.equal(event.code, code, `${name}: logs identify the real rejection phase`);
  assert.equal(event.status, status, `${name}: logs identify the response status`);
  assert.equal(event.entryPoint, entryPoint, `${name}: logs identify the actual save entry point`);
  assert(Object.keys(event).every((key) => ["event", "code", "status", "entryPoint", "boardId", "traceId", "turnId"].includes(key)),
    `${name}: rejection log cannot include error/body/metadata fields`);
  const logText = JSON.stringify(emitted);
  for (const text of [...privateText, mathsQuestion, physicsQuestion, "PRIVATE_", "Now write the result."]) {
    assert(!logText.includes(text), `${name}: logs must not contain student text or malformed correlation IDs`);
  }
}

function metadataForm(): { metadata: Data; form: FormData } {
  const payload = lessonPayload("maths");
  const metadata = {
    ...payload,
    segments: payload.segments.map((segment) => ({
      orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText,
      command: segment.command, durationMs: segment.durationMs ?? undefined, timings: segment.timings ?? undefined,
    })),
  };
  const form = new FormData();
  form.set("metadata", JSON.stringify(metadata));
  return { metadata, form };
}

async function rejectAtHttpBoundary(input: {
  name: string;
  code: string;
  status: number;
  configure?: (metadata: Data, form: FormData) => void;
  actingUser?: string | null;
  targetBoard?: string;
}): Promise<void> {
  const { metadata, form } = metadataForm();
  metadata.rawResponse = "PRIVATE_RAW_RESPONSE_MUST_NOT_BE_LOGGED";
  input.configure?.(metadata, form);
  form.set("metadata", JSON.stringify(metadata));
  const before = (await client.fetchBoardDetail(boardId))!.turns.map((turn) => turn.id);
  const beforeUploads = uploads;
  const beforeBytes = reservedBytes;
  const logStart = serverLogs.length;
  const target = input.targetBoard ?? boardId;
  const previousUser = userId;
  if (input.actingUser !== undefined) userId = input.actingUser;
  inHandler = true;
  let response: Response;
  try {
    response = await post.POST(new Request(`https://save.test/api/boards/${target}/turns`, {
      method: "POST", body: form,
    }), { params: Promise.resolve({ boardId: target }) });
  } finally { inHandler = false; userId = previousUser; }
  assert.equal(response.status, input.status, `${input.name}: denial must come from the intended real boundary`);
  const body = await response.json() as { code: string };
  assert.equal(body.code, input.code, `${input.name}: response must identify the intended validator phase`);
  assertRejectionLog(input.name, logStart, input.code, input.status);
  assert.deepEqual((await client.fetchBoardDetail(boardId))!.turns.map((turn) => turn.id), before,
    `${input.name}: denial cannot appear as a saved turn after reopening`);
  assert.equal(uploads, beforeUploads, `${input.name}: denial cannot allocate object storage`);
  assert.equal(reservedBytes, beforeBytes, `${input.name}: denial cannot reserve storage`);
  assert.equal(pendingTurns, 0, `${input.name}: denial cannot consume a save allowance`);
}

async function verifyHttpHardNegatives(): Promise<void> {
  await rejectAtHttpBoundary({ name: "unauthenticated save", code: "unauthorized", status: 401, actingUser: null });
  await rejectAtHttpBoundary({ name: "another student's board", code: "board_not_found", status: 404,
    actingUser: "f7b70d28-dc7b-46cf-aa9b-7580d11ff461" });
  await rejectAtHttpBoundary({ name: "another student's trace", code: "save_allowance_required", status: 403,
    configure: (metadata) => { traces.get(String(metadata.traceId))!.userId = "another-student"; } });
  await rejectAtHttpBoundary({ name: "private text in board ID", code: "board_not_found", status: 404,
    targetBoard: "PRIVATE_BOARD_QUESTION_MUST_NOT_BE_LOGGED" });
  await rejectAtHttpBoundary({ name: "private text in trace ID", code: "save_allowance_required", status: 403,
    configure: (metadata) => { metadata.traceId = "PRIVATE_TRACE_QUESTION_MUST_NOT_BE_LOGGED"; } });
  await rejectAtHttpBoundary({ name: "private unexpected multipart field", code: "upload_parts_invalid", status: 400,
    configure: (_metadata, form) => { form.set("PRIVATE_MULTIPART_QUESTION_MUST_NOT_BE_LOGGED", "PRIVATE_FIELD_VALUE"); } });
  await rejectAtHttpBoundary({ name: "invalid segment ordering", code: "upload_parts_invalid", status: 400,
    configure: (metadata) => { (metadata.segments as Data[])[0]!.orderIndex = -1; } });
  await rejectAtHttpBoundary({ name: "oversized segment count", code: "upload_parts_invalid", status: 413,
    configure: (metadata) => { metadata.segments = Array.from({ length: MAX_TURN_SEGMENTS + 1 }, (_, orderIndex) => ({
      orderIndex, narration: "PRIVATE_SEGMENT_TEXT", spokenText: "PRIVATE_SEGMENT_TEXT", command: null,
    })); } });
  await rejectAtHttpBoundary({ name: "oversized segment narration", code: "segment_fields_invalid", status: 400,
    configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.narration = "PRIVATE_SEGMENT_TEXT".repeat(700); } });
  await rejectAtHttpBoundary({ name: "invalid segment duration", code: "segment_fields_invalid", status: 400,
    configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.durationMs = -1; } });
  await rejectAtHttpBoundary({ name: "unsupported audio type", code: "upload_parts_invalid", status: 415,
    configure: (_metadata, form) => { form.set("audio-1", new Blob([new Uint8Array([73, 68, 51])], { type: "image/png" })); } });
  await rejectAtHttpBoundary({ name: "mismatched audio content", code: "audio_format_mismatch", status: 415,
    configure: (_metadata, form) => { form.set("audio-1", new Blob([new Uint8Array([0, 1, 2])], { type: "audio/mpeg" })); } });
  await rejectAtHttpBoundary({ name: "oversized audio part", code: "upload_parts_invalid", status: 413,
    configure: (_metadata, form) => { form.set("audio-1", new Blob([new Uint8Array(MAX_TURN_AUDIO_BYTES + 1)], { type: "audio/mpeg" })); } });
  await rejectAtHttpBoundary({ name: "oversized teaching command envelope", code: "scene_teaching_envelope_invalid", status: 400,
    configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.command = { commands: Array.from({ length: 17 }, () => ({
      type: "PAUSE", params: [1], charPosition: 0, narrationBefore: "",
    })) }; } });
  await rejectAtHttpBoundary({ name: "TYPE without a committed code lesson", code: "scene_teaching_type_plan_required", status: 400,
    configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.command = {
      type: "TYPE", params: [], text: "PRIVATE_UNCOMMITTED_CODE", charPosition: 0, narrationBefore: "",
    }; } });
  await rejectAtHttpBoundary({ name: "untrusted teaching diagram ink", code: "scene_teaching_command_not_allowed", status: 400,
    configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.command = {
      type: "DRAW_LINE", params: [400, 100, 500, 200], text: "PRIVATE_UNVERIFIED_INK", charPosition: 0, narrationBefore: "",
    }; } });
  for (const kind of ["FOCUS", "ANNOTATE"] as const) {
    await rejectAtHttpBoundary({ name: `${kind} non-string semantic target overrides valid text`, code: "scene_teaching_command_not_allowed", status: 400,
      configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.command = {
        type: kind, params: [], text: "ab", semanticRef: { entityId: { question: "PRIVATE_SEMANTIC_TARGET" } },
        charPosition: 0, narrationBefore: "",
      }; } });
    await rejectAtHttpBoundary({ name: `${kind} oversized semantic target`, code: "scene_teaching_command_not_allowed", status: 400,
      configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.command = {
        type: kind, params: [], text: "ab", semanticRef: { entityId: "PRIVATE_TARGET_".repeat(20) },
        charPosition: 0, narrationBefore: "",
      }; } });
    await rejectAtHttpBoundary({ name: `${kind} non-string text with a valid semantic target`, code: "scene_teaching_command_not_allowed", status: 400,
      configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.command = {
        type: kind, params: [], text: { question: "PRIVATE_RAW_TARGET_TEXT" }, semanticRef: { entityId: "ab" },
        charPosition: 0, narrationBefore: "",
      }; } });
    await rejectAtHttpBoundary({ name: `${kind} oversized text with a valid semantic target`, code: "scene_teaching_command_not_allowed", status: 400,
      configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.command = {
        type: kind, params: [], text: "PRIVATE_RAW_TARGET_TEXT".repeat(20), semanticRef: { entityId: "ab" },
        charPosition: 0, narrationBefore: "",
      }; } });
  }
  await rejectAtHttpBoundary({ name: "unknown semantic ANNOTATE target", code: "scene_teaching_command_not_allowed", status: 400,
    configure: (metadata) => { (metadata.segments as Data[]).at(-1)!.command = {
      type: "ANNOTATE", params: [], semanticRef: { entityId: "PRIVATE_UNKNOWN_TARGET" }, charPosition: 0, narrationBefore: "",
    }; } });
}

async function rejectCheckpointAtSceneBoundary(kind: "wrong-source" | "invalid-gesture"): Promise<void> {
  const payload = lessonPayload("maths", undefined, { kind: "FOCUS", mode: "semantic-only" });
  payload.rawResponse = "PRIVATE_CHECKPOINT_RESPONSE_MUST_NOT_BE_LOGGED";
  if (kind === "wrong-source") {
    payload.sceneDocument = structuredClone(payload.sceneDocument);
    payload.sceneDocument.source.question = "PRIVATE_CHECKPOINT_SOURCE_MUST_NOT_BE_LOGGED";
  } else {
    payload.segments.at(-1)!.command = {
      type: "FOCUS", params: [], semanticRef: { entityId: { privateText: "PRIVATE_CHECKPOINT_TARGET" } },
      charPosition: 0, narrationBefore: "",
    } as unknown as DrawCommand;
  }
  const before = (await client.fetchBoardDetail(boardId))!.turns.map((turn) => turn.id);
  const beforeUploads = uploads;
  const beforeBytes = reservedBytes;
  const logStart = serverLogs.length;
  const saved = await client.checkpointTurn(boardId, crypto.randomUUID(), {
    seq: 1, status: "live", baseCount: 0, question: payload.question,
    rawResponse: payload.rawResponse, traceId: payload.traceId, scene: payload, segments: payload.segments,
  });
  assert.equal(saved.ok, false, `${kind}: a rejected checkpoint cannot become a saved turn`);
  const response = responses.at(-1)!;
  assert.equal(response.status, 400, `${kind}: checkpoint must reject at the real scene boundary`);
  const code = kind === "wrong-source" ? "scene_source_question_mismatch" : "scene_teaching_command_not_allowed";
  assert.equal((JSON.parse(response.body) as { code?: string }).code, code,
    `${kind}: checkpoint response must identify the same validator leaf as the one-shot save`);
  assertRejectionLog(`checkpoint ${kind}`, logStart, code, 400, [payload.rawResponse], "checkpoint_put");
  assert.deepEqual((await client.fetchBoardDetail(boardId))!.turns.map((turn) => turn.id), before);
  assert.equal(uploads, beforeUploads, "a refused checkpoint cannot upload media");
  assert.equal(reservedBytes, beforeBytes, "a refused checkpoint cannot reserve storage");
  assert.equal(pendingTurns, 0, "a refused checkpoint cannot consume a turn allowance");
}

async function progressiveSaveReloadAndContinue(subject: "maths" | "physics"): Promise<void> {
  const payload = lessonPayload(subject, undefined, { kind: "FOCUS", mode: "semantic-only" });
  const turnId = crypto.randomUUID();
  const firstCount = 1; // The runtime page reset checkpoints before the first figure beat.
  const first = await client.checkpointTurn(boardId, turnId, {
    seq: 1, status: "live", kind: "lesson", baseCount: 0,
    question: payload.question, rawResponse: "The lesson has started.", traceId: payload.traceId,
    scene: payload, segments: payload.segments.slice(0, firstCount), resumeState: null,
  });
  assert(first.ok, `${subject}: first in-progress checkpoint must save: ${JSON.stringify(responses.at(-1))}`);
  assert.equal(first.serverCount, firstCount, "checkpoint acknowledgement counts submitted rows, not inserted figure beats");
  assert.equal(first.serverSeq, 1);
  assert.equal(first.turn.persistedStatus, "live");
  assert.equal(first.turn.visualStatus, "validated");
  const started = (await client.fetchBoardDetail(boardId))!;
  const restoredStart = started.turns.find((turn) => turn.id === turnId)!;
  assert(restoredStart, `${subject}: the first incomplete lecture is already reopenable`);
  assert.equal(restoredStart.rawResponse, "The lesson has started.");
  assert.equal(restoredStart.persistedStatus, "live");
  assert(restoredStart.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)),
    "the in-progress GET retains server-verified figure ink");
  assert(restoredStart.segments.some((segment) => segment.audioRef === null &&
    isStoredCommandTrustedGeometry(segment.command)), "server-filled figure beats are explicitly audio-less");
  assert.equal(pausedLessonFromStoredTurns(started.turns, { boardId, ownerState: "active" }), null,
    "a reload cannot offer Continue while another tab owns the live lesson");
  assert.equal(pausedLessonFromStoredTurns(started.turns, { boardId, ownerState: "inactive" }), null,
    "a fresh raw live checkpoint is not mistaken for an explicit Stop");

  const appended = await client.checkpointTurn(boardId, turnId, {
    seq: 2, status: "live", baseCount: first.serverCount!, rawResponse: payload.rawResponse,
    traceId: payload.traceId, scene: payload, segments: payload.segments.slice(firstCount),
  });
  assert(appended.ok, `${subject}: semantic-only FOCUS must save while the lecture is still live`);
  assert.equal(appended.serverCount, payload.segments.length);
  assert.equal(appended.turn.persistedStatus, "live");
  const focusBeforeStop = appended.turn.segments.flatMap((segment) => parseStoredSegmentCommands(segment.command))
    .filter((command) => command.type === "FOCUS");
  assert.equal(focusBeforeStop.length, 1, "an appended semantic-only focus survives the real progressive canonicalizer");
  const semanticFocus = parseStoredSegmentCommands(payload.segments.at(-1)!.command)[0]!;
  assert.equal(focusBeforeStop[0]!.text, semanticFocus.semanticRef!.entityId);
  assert.equal(focusEmphasisOf(focusBeforeStop[0]!), "spotlight");

  // pagehide sends its last words/ink but no audio. It names the saved figure
  // only through the live semantic reference, as an ordinary lesson does.
  const cutStep = "Notice this part before continuing.";
  const closeRow: RecordedSegmentPayload = {
    orderIndex: payload.segments.length, narration: cutStep, spokenText: cutStep,
    command: serializeSegmentCommands([{ ...semanticFocus, type: "ANNOTATE" }]),
    audioBytes: new Uint8Array([73, 68, 51, 11, 1, 2]), durationMs: 100, timings: null,
  };
  const closed = await client.closeTurnKeepalive(boardId, turnId, {
    seq: 3, status: "stopped", baseCount: appended.serverCount!, traceId: payload.traceId,
    segments: [closeRow], rawResponse: `${payload.rawResponse}\n${cutStep}`, resumeState: null,
  });
  assert(closed.ok, `${subject}: keepalive close must save semantic-only ANNOTATE under the held scene`);
  assert.equal(closed.turn.persistedStatus, "stopped");
  assert.equal(closed.serverCount, payload.segments.length + 1);

  // Throw away the checkpoint response and derive Continue solely from a new
  // authenticated board GET, exactly the reload admission boundary.
  const reloaded = (await client.fetchBoardDetail(boardId))!;
  const stopped = reloaded.turns.find((turn) => turn.id === turnId)!;
  assert(stopped, `${subject}: stopped in-progress lesson must survive a reload`);
  assert.equal(stopped.persistedStatus, "stopped");
  assert.equal(stopped.kind, "lesson");
  assert.deepEqual(stopped.sceneDocument, JSON.parse(JSON.stringify(payload.sceneDocument)));
  assert.equal((stopped.sceneArtifacts as { diagramStrategy: string }).diagramStrategy,
    subject === "maths" ? "strict" : "current");
  const expectedTarget = semanticFocus.semanticRef!.entityId;
  const gestures = stopped.segments.flatMap((segment) => parseStoredSegmentCommands(segment.command))
    .filter((command) => command.type === "FOCUS" || command.type === "ANNOTATE");
  assert.deepEqual(gestures.map((command) => [command.type, command.text, focusEmphasisOf(command), command.params]),
    [["FOCUS", expectedTarget, "spotlight", []], ["ANNOTATE", expectedTarget, "spotlight", []]],
    "both live-admitted semantic gestures retain their target/emphasis without becoming model-coordinate ink");
  for (const [index, submitted] of payload.segments.entries()) {
    if (!submitted.audioBytes) continue;
    const replay = stopped.segments.find((segment) => segment.audioRef === index);
    assert(replay?.audioUrl, `${subject}: submitted clip ${index} survives canonical figure-intro insertion`);
    assert(new URL(`https://save.test${replay.audioUrl}`).searchParams.get("object")?.endsWith(`/${index}.mp3`),
      "audioRef follows the submitted row, not its shifted canonical order");
  }
  const silentTail = stopped.segments.find((segment) => segment.audioRef === payload.segments.length);
  assert(silentTail, "keepalive tail keeps its submitted audio identity");
  assert.equal(silentTail.audioUrl, null, "keepalive never carries the supplied tail audio bytes");
  const offered = pausedLessonFromStoredTurns(reloaded.turns, { boardId, ownerState: "inactive" });
  assert(offered, `${subject}: reload must offer Continue for the saved stopped lesson`);
  assert.equal(offered.parentTurnId, turnId);
  assert.equal(offered.parentTraceId, payload.traceId);
  assert.equal(offered.interruptedStep, cutStep);
  assert.equal(offered.turnPlan?.question, payload.question);
  assert.equal(offered.figureDrawn, true);
  assert.deepEqual(offered.lessonBoardRows?.map((row) => row.text), [subject === "maths" ? "AB" : "I = 3 A"]);
  const admitted = currentPausedLesson(offered, (await client.fetchBoardDetail(boardId))!.turns);
  assert(admitted, "Continue rechecks the fresh saved chain instead of trusting the old offer");

  const resumeId = crypto.randomUUID();
  const resumeTrace = crypto.randomUUID();
  traces.set(resumeTrace, { traceId: resumeTrace, userId: owner, expiresAt: new Date(Date.now() + 60_000), savedTurnId: null });
  const resumeScene = resumeTurnScene(admitted.scene, admitted.lessonQuestion);
  const resumeRow: RecordedSegmentPayload = {
    orderIndex: 0, narration: "Continue from the saved step.", spokenText: "Continue from the saved step.",
    command: serializeSegmentCommands([{ ...semanticFocus, type: "ANNOTATE" }]),
    audioBytes: new Uint8Array([73, 68, 51, 12, 1, 2]), durationMs: 100, timings: null,
  };
  const continued = await client.checkpointTurn(boardId, resumeId, {
    seq: 1, status: "live", kind: "resume", baseCount: 0, question: admitted.lessonQuestion,
    rawResponse: "[STEP] Continue from the saved step.", traceId: resumeTrace,
    scene: resumeScene, segments: [resumeRow], resumeState: null,
  });
  assert(continued.ok, `${subject}: Continue can progressively save a new turn on the existing page`);
  assert.equal(continued.turn.segments.length, 1, "resume canonicalization cannot reinsert the original figure intro");
  assert(storedTurnContinuesBoard(continued.turn), "the real saved resume retains its board continuation marker");
  assert(!continued.turn.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)),
    "the figure already on the page is not stored or drawn twice");
  assert.equal(parseStoredSegmentCommands(continued.turn.segments[0]!.command)[0]?.text, expectedTarget);

  const finishRow: RecordedSegmentPayload = {
    orderIndex: 1, narration: "The lesson is complete.", spokenText: "The lesson is complete.",
    command: { type: "WRITE", params: [40, 140], text: "Done", charPosition: 0, narrationBefore: "" },
    audioBytes: new Uint8Array([73, 68, 51, 13, 1, 2]), durationMs: 100, timings: null,
  };
  const finished = await client.checkpointTurn(boardId, resumeId, {
    seq: 2, status: "complete", kind: "resume", baseCount: continued.serverCount!,
    rawResponse: "[STEP] Continue from the saved step.\n[STEP] The lesson is complete.", traceId: resumeTrace,
    scene: resumeScene, segments: [finishRow],
  });
  assert(finished.ok, `${subject}: the resumed lecture must finish and save`);
  assert.equal(finished.serverCount, null, "complete turns no longer expose appendable submitted rows");
  const reopened = (await client.fetchBoardDetail(boardId))!;
  const finalTurn = reopened.turns.find((turn) => turn.id === resumeId)!;
  assert(finalTurn, `${subject}: final resumed turn must reopen`);
  assert.equal(finalTurn.persistedStatus, "complete");
  assert.equal(finalTurn.segments.length, 2);
  assert(storedTurnContinuesBoard(finalTurn));
  assert.deepEqual(pageTurnsEndingAt(reopened.turns).map((turn) => turn.id), [turnId, resumeId],
    "reopened board rebuilds one page from the stopped lesson and its completed continuation");
  assert.equal(pausedLessonFromStoredTurns(reopened.turns, { boardId, ownerState: "inactive" }), null,
    "a completed continuation closes the stopped lesson after reload");
  assert.equal(currentPausedLesson(offered, reopened.turns), null, "an old Continue offer cannot restart a completed chain");
  const finalAgain = await client.checkpointTurn(boardId, resumeId, {
    seq: 3, status: "live", baseCount: 2, traceId: resumeTrace, scene: resumeScene, segments: [finishRow],
  });
  assert(finalAgain.ok && finalAgain.final && finalAgain.stale, "a delayed live save cannot reopen a completed turn");
  assert.deepEqual(finalAgain.turn.segments, finalTurn.segments, "final replay is read-only, including clip identities");
  assert.equal(pendingTurns, 0, "all progressive create/growth reservations settle");
  assert.equal(cleanup.size, 0, "successful progressive clips leave no recoverable deletion intent");
}

async function textOnlyCheckpointKeepsResumePlan(subject: "maths" | "physics"): Promise<void> {
  const payload = lessonPayload(subject);
  const turnId = crypto.randomUUID();
  const scene = {
    visualStatus: "text_only" as const,
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: payload.sceneArtifacts.turnPlan,
      diagramStrategy: subject === "maths" ? "strict" : "current" },
  };
  const textRows = client.withBoardEpochSegment([{
    orderIndex: 0, narration: "Read the givens first.", spokenText: "Read the givens first.",
    command: { type: "WRITE", params: [40, 100], text: "Given", charPosition: 0, narrationBefore: "" },
    audioBytes: null, durationMs: 100, timings: null,
  }]);
  const started = await client.checkpointTurn(boardId, turnId, {
    seq: 1, status: "live", baseCount: 0, question: payload.question, rawResponse: "Read the givens first.",
    traceId: payload.traceId, scene, segments: textRows,
  });
  assert(started.ok, `${subject}: an in-progress text-only checkpoint may precede the figure`);
  const closed = await client.closeTurnKeepalive(boardId, turnId, {
    seq: 2, baseCount: started.serverCount!, traceId: payload.traceId,
  });
  assert(closed.ok, `${subject}: a status-only pagehide close preserves the saved text and plan`);
  const reloaded = (await client.fetchBoardDetail(boardId))!;
  const turn = reloaded.turns.find((saved) => saved.id === turnId)!;
  assert.equal(turn.visualStatus, "text_only");
  assert.equal(turn.persistedStatus, "stopped");
  const offered = pausedLessonFromStoredTurns(reloaded.turns, { boardId, ownerState: "inactive" });
  assert(offered, `${subject}: a stopped text-only checkpoint must offer Continue after reload`);
  assert.equal(offered.parentTurnId, turnId);
  assert.deepEqual(offered.turnPlan, payload.sceneArtifacts.turnPlan,
    "minimal text-only scene artifacts must retain the validated plan #94 uses to continue");
  assert.equal(offered.figureDrawn, false);
  assert.deepEqual(offered.lessonBoardRows, [{ text: "Given" }]);
  const completed = await client.checkpointTurn(boardId, turnId, {
    seq: 3, status: "complete", baseCount: started.serverCount!, traceId: payload.traceId,
    rawResponse: "Read the givens first. The text-only lesson is complete.", scene, segments: [],
  });
  assert(completed.ok);
  assert.equal(pausedLessonFromStoredTurns((await client.fetchBoardDetail(boardId))!.turns,
    { boardId, ownerState: "inactive" }), null);
}

async function main(): Promise<void> {
  await saveAndReopen("maths");
  await saveAndReopen("physics");
  await saveAndReopen("maths", await solvedIncompleteFixture("maths"));
  await saveAndReopen("physics", await solvedIncompleteFixture("physics"));
  const semanticFailures: string[] = [];
  for (const subject of ["maths", "physics"] as const) {
    for (const kind of ["FOCUS", "ANNOTATE"] as const) {
      try { await saveAndReopen(subject, undefined, { kind, mode: "semantic-only" }); }
      catch (error) { semanticFailures.push(`${subject} ${kind}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  assert.deepEqual(semanticFailures, [], "all four live-admitted semantic-only gestures must save and reopen");
  for (const kind of ["FOCUS", "ANNOTATE"] as const) {
    await saveAndReopen("maths", undefined, { kind, mode: "disagreeing-text" });
  }
  await saveAndReopen("maths", undefined, { kind: "FOCUS", mode: "unknown" });
  assert.equal((await client.fetchBoardDetail(boardId))?.turns.length, 11);
  assert(uploads > 0, "positive saves must exercise real media-prefix admission before object storage");
  assert(reservedBytes > 0n, "positive saves must exercise real storage accounting");
  await progressiveSaveReloadAndContinue("maths");
  await progressiveSaveReloadAndContinue("physics");
  await textOnlyCheckpointKeepsResumePlan("maths");
  await textOnlyCheckpointKeepsResumePlan("physics");
  assert.equal(serverLogs.length, 0, "valid lessons must not emit save rejection logs");
  const checkpointFailures: string[] = [];
  for (const kind of ["wrong-source", "invalid-gesture"] as const) {
    try { await rejectCheckpointAtSceneBoundary(kind); }
    catch (error) { checkpointFailures.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  assert.deepEqual(checkpointFailures, [], "progressive saves must retain leaf-coded private rejection diagnostics");
  await rejectForgery("wrong-source");
  await rejectForgery("failed-proof");
  await verifyHttpHardNegatives();
  userId = "f7b70d28-dc7b-46cf-aa9b-7580d11ff461";
  assert.equal(await client.fetchBoardDetail(boardId), null,
    "another student cannot reopen the owner’s saved board");
  userId = null;
  const unauthorized = await get.GET(new Request(`https://save.test/api/boards/${boardId}`), context);
  assert.equal(unauthorized.status, 401, "reopening never bypasses authentication");
  console.log("lesson save/reopen: 11 one-shot positives, strict maths/current physics progressive live/close/reload/Continue/final and text-only plan roundtrips, 2 checkpoint scene denials, distinct source/compile leaves, 25 HTTP hard negatives, private rejection logs and replay passed");
}

void main().catch((error) => { originalError(error); process.exitCode = 1; }).finally(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
  console.warn = originalWarn;
  if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: originalEnv });
  mock.restoreAll();
});
