/**
 * A stopped (partial) turn restores and replays like a short finished one,
 * and the server keeps what Continue needs.
 *
 * Restore shape: the board GET turn of a stopped lesson goes through
 * `fetchBoardDetail` with its status, kind, trace and resume state intact;
 * `storedTurnStatus` reads a missing status as complete and an idle live turn
 * as stopped; the replay timeline ends at the last saved row and a row without
 * audio still plays from its duration; a resume saved with the continuation
 * marker and no CLEAR stays on the stopped lesson's page.
 *
 * Server fixes from the resume review (lib/scene/turnScenePersistence.ts):
 * a validated turn keeps its continuation marker and never gets the figure
 * intro re-inserted; a fresh validated lesson still does; a text-only lesson
 * keeps its validated plan.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LocalDeterministicSolverProvider,
  compileSceneDocument,
  type ProblemIR,
  type SceneArtifactsV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { isStoredCommandTrustedGeometry, serializeSegmentCommands, getSegmentCommands } from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { fetchBoardDetail, storedTurnKind, storedTurnStatus, type StoredTurn } from "../../lib/boards/boardsClient";
import {
  boardContinuationArtifacts,
  boardContinuationOf,
  pageTurnsEndingAt,
  storedTurnContinuesBoard,
} from "../../lib/boards/boardContinuation";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";

const QUESTION = "Use a number line to find 2+3.";
const CLEAR = { type: "CLEAR" as const, params: [], charPosition: 0, narrationBefore: "" };
const write = (text: string) => ({ type: "WRITE" as const, params: [90, 145, 28], text, charPosition: 0, narrationBefore: "" });

function storedSegment(orderIndex: number, narration: string, command: unknown, audioUrl: string | null, durationMs: number | null) {
  return { id: `s-${orderIndex}`, orderIndex, narration, spokenText: narration, command: command as StoredTurn["segments"][number]["command"],
    audioUrl, durationMs, timings: null };
}

async function restoreShape(): Promise<void> {
  const stoppedLesson = {
    id: "turn-lesson", orderIndex: 0, question: QUESTION, rawResponse: "Start at 2.", speedMultiplier: 1,
    traceId: "trace-lesson", sceneDocument: null, sceneEngineVersion: null, validationReport: null,
    visualStatus: "text_only", sceneArtifacts: null, status: "stopped", kind: "lesson",
    resumeState: { v: 1, solverProjection: { answer: 5 } }, createdAt: 1, updatedAt: 2,
    segments: [
      storedSegment(0, "", CLEAR, null, 50),
      storedSegment(1, "Start at 2.", write("2"), "/api/lecture-audio?key=a", 1200),
      storedSegment(2, "Move three steps.", write("2 + 3"), null, 900),
    ],
  };
  const resume = {
    ...stoppedLesson, id: "turn-resume", orderIndex: 1, status: "live", kind: "resume", traceId: "trace-resume",
    resumeState: null, updatedAt: Date.now() - 3 * 60_000,
    sceneArtifacts: boardContinuationArtifacts(QUESTION),
    segments: [storedSegment(0, "So we land on 5.", write("= 5"), null, 700)],
  };
  const legacy = { ...stoppedLesson, id: "turn-legacy", orderIndex: 2 } as Record<string, unknown>;
  delete legacy.status;
  delete legacy.kind;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    board: { id: "board-1", title: "Sum", preview: QUESTION, createdAt: 1 },
    turns: [stoppedLesson, resume, legacy],
    nextPage: null,
  });
  let detail;
  try {
    detail = await fetchBoardDetail("board-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(detail);
  const [lesson, resumed, old] = detail.turns;
  assert.equal(lesson!.status, "stopped", "restore keeps the stopped status");
  assert.equal(lesson!.kind, "lesson");
  assert.equal(lesson!.traceId, "trace-lesson", "restore keeps the trace a Continue chains from");
  assert.deepEqual(lesson!.resumeState, { v: 1, solverProjection: { answer: 5 } });
  assert.equal(storedTurnStatus(lesson!), "stopped");
  assert.equal(storedTurnStatus(resumed!), "stopped", "a live turn idle for over 120 s reads as stopped");
  assert.equal(storedTurnStatus({ status: "live", updatedAt: Date.now() }), "live");
  assert.equal(storedTurnStatus(old!), "complete", "a legacy turn without status is complete");
  assert.equal(storedTurnKind(old!), "lesson");
  assert.equal(storedTurnKind(resumed!), "resume");

  const timeline = buildReplayTimeline([lesson!]);
  const cues = timeline.cues.filter((cue) => cue.turnIndex === 0);
  assert.equal(cues.length, 3, "replay covers exactly the saved rows");
  assert.equal(timeline.totalMs, 50 + 1200 + 900, "the timeline ends at the last saved row");
  assert.equal(cues[2]!.audioUrl, null);
  assert.equal(cues[2]!.durationMs, 900, "a row without audio still plays from its duration");

  assert.equal(storedTurnContinuesBoard(resumed!), true, "a resume with the marker and no CLEAR continues the page");
  assert.deepEqual(pageTurnsEndingAt([lesson!, resumed!]).map((turn) => turn.id), ["turn-lesson", "turn-resume"],
    "the stopped lesson and its resume share one page");
}

async function serverContinuation(): Promise<void> {
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3",
    question: QUESTION,
    givens: [
      { id: "two", symbol: "a", value: 2, provenance: "given", sourceText: "2" },
      { id: "three", symbol: "b", value: 3, provenance: "given", sourceText: "3" },
    ],
    unknowns: [{ id: "answer", symbol: "A" }],
    derived: [{ id: "answer", symbol: "A", value: 5, provenance: "derived", sourceText: "2+3", dependsOn: ["two", "three"] }],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: [],
    visualRequirement: "required",
  };
  const problemIR: ProblemIR = {
    schemaVersion: "problem-ir/v1",
    id: "arithmeticProblem",
    question: QUESTION,
    facts: [{ id: "requestedAnswer", kind: "requested", statement: "Find the value of 2+3",
      evidence: { source: "question", start: 0, end: QUESTION.length, quote: QUESTION } }],
    entities: [],
    expressions: [{ id: "sumExpression", valueType: "scalar",
      root: { kind: "binary", operator: "+", left: { kind: "number", value: 2 }, right: { kind: "number", value: 3 } },
      evidenceFactIds: ["requestedAnswer"] }],
    constraints: [],
    representationIntents: [],
    solveRequests: [{ id: "evaluateSum", kind: "evaluate", expressionId: "sumExpression",
      resultBinding: { turnPlanQuantityId: "answer", symbol: "A", evidenceFactIds: ["requestedAnswer"] } }],
  };
  const solverResult = await new LocalDeterministicSolverProvider().solve(problemIR);
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verified number-line construction" },
    source: { question: QUESTION, representationTier: "exact_verified", nonMetric: false },
    quantities: [{ id: "two", value: 2 }, { id: "three", value: 3 }, { id: "answer", value: 5 }],
    entities: [
      { id: "line_start", kind: "point", role: "number-line start" },
      { id: "line_end", kind: "point", role: "number-line end" },
      { id: "number_line", kind: "segment", role: "number line" },
      { id: "start_value", kind: "point", role: "starting value", label: "2" },
      { id: "sum_value", kind: "point", role: "sum", label: "5" },
      { id: "add_three", kind: "vector", role: "add three" },
    ],
    constructions: [
      { id: "make_line_start", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["line_start"] },
      { id: "make_line_end", operator: "point", inputs: { x: 6, y: 0, coordinateSpace: "world" }, outputs: ["line_end"] },
      { id: "make_number_line", operator: "segment", inputs: { start: "line_start", end: "line_end" }, outputs: ["number_line"] },
      { id: "make_start_value", operator: "point", inputs: { x: "two", y: 0, coordinateSpace: "world" }, outputs: ["start_value"] },
      { id: "make_sum_value", operator: "point", inputs: { x: "answer", y: 0, coordinateSpace: "world" }, outputs: ["sum_value"] },
      { id: "make_add_three", operator: "vector", inputs: { start: "start_value", end: "sum_value" }, outputs: ["add_three"] },
    ],
    relations: [],
    assertions: [
      { id: "start_on_line", predicate: "on", entities: ["start_value", "number_line"], expected: true, severity: "fatal" },
      { id: "sum_on_line", predicate: "on", entities: ["sum_value", "number_line"], expected: true, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: ["line_start", "line_end", "number_line", "start_value", "sum_value", "add_three"],
    revealGroups: [{ id: "number_line_setup", entityIds: ["line_start", "line_end", "number_line", "start_value", "sum_value", "add_three"],
      dependsOn: [], narrationCue: "show addition on the number line" }],
    teachingTimeline: [{ id: "show_number_line", action: "reveal", targetId: "number_line_setup", dependsOn: [],
      narrationIntent: "move three units from two to five" }],
  };
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "fixture compiles");
  const introSegments = buildVerifiedDiagramPresentation(document, compiled.renderScene).introSegments;
  assert.ok(introSegments.length > 0);
  const artifacts: SceneArtifactsV3 = {
    schemaVersion: "scene-artifacts/v3", turnPlan: plan, problemIR, solverResult,
    representationTier: "exact_verified", nonMetric: false, candidates: [], diagramResultStatus: "ready",
  };
  const teachingRow = { orderIndex: 0, narration: "So 2 plus 3 lands on 5.", spokenText: "So 2 plus 3 lands on 5.",
    command: serializeSegmentCommands([write("2 + 3 = 5")], { trustedDiagramGeometry: false }) };

  // A resume after Stop: the lesson's validated scene plus the marker, no CLEAR, no intro rows.
  const resumed = await canonicalizeTurnSceneMetadata({
    question: QUESTION, sceneDocument: document, visualStatus: "validated",
    sceneArtifacts: { ...artifacts, ...boardContinuationArtifacts(QUESTION) },
    segments: [teachingRow],
  });
  assert.ok(resumed.ok, resumed.ok ? "" : resumed.error);
  assert.equal(boardContinuationOf(resumed.value.sceneArtifacts)?.lessonQuestion, QUESTION,
    "a validated continuation keeps its page marker");
  assert.equal(resumed.value.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)), false,
    "the figure intro is never re-inserted into a turn that continues the page");
  assert.equal(resumed.value.segments.length, 1);

  // Submitted intro ink on a continuation is still replaced by the server's.
  const clientIntro = introSegments.map((segment, index) => ({
    orderIndex: index, narration: segment.narration, spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment).map((command) => ({ ...command })), { trustedDiagramGeometry: true }),
  }));
  const withIntro = await canonicalizeTurnSceneMetadata({
    question: QUESTION, sceneDocument: document, visualStatus: "validated",
    sceneArtifacts: { ...artifacts, ...boardContinuationArtifacts(QUESTION) },
    segments: [...clientIntro, { ...teachingRow, orderIndex: clientIntro.length }],
  });
  assert.ok(withIntro.ok, withIntro.ok ? "" : withIntro.error);
  assert.equal(withIntro.value.segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command)).length,
    clientIntro.length, "submitted intro rows keep their place with server ink");

  // A fresh lesson still gets the whole intro when the client sent none.
  const fresh = await canonicalizeTurnSceneMetadata({
    question: QUESTION, sceneDocument: document, visualStatus: "validated", sceneArtifacts: artifacts,
    segments: [teachingRow],
  });
  assert.ok(fresh.ok, fresh.ok ? "" : fresh.error);
  assert.ok(fresh.value.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)),
    "a lesson that opens its own page still gets the server intro");
  assert.equal(boardContinuationOf(fresh.value.sceneArtifacts), null);

  // A text-only lesson keeps its validated plan, so Continue and a doubt have it after reload.
  const textOnly = await canonicalizeTurnSceneMetadata({
    question: QUESTION, visualStatus: "text_only",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: plan },
    segments: [teachingRow],
  });
  assert.ok(textOnly.ok, textOnly.ok ? "" : textOnly.error);
  assert.equal((textOnly.value.sceneArtifacts as { turnPlan?: TurnPlanV3 } | null)?.turnPlan?.question, QUESTION,
    "a text-only save keeps its validated plan");
  const noPlan = await canonicalizeTurnSceneMetadata({
    question: QUESTION, visualStatus: "text_only", sceneArtifacts: { forged: true }, segments: [teachingRow],
  });
  assert.ok(noPlan.ok);
  assert.equal(noPlan.value.sceneArtifacts, null, "with no valid plan, marker, failure or code lesson, nothing is kept");
}

function boardGetSource(): void {
  const root = resolve(import.meta.dirname, "../..");
  const source = readFileSync(resolve(root, "app/api/boards/[boardId]/route.ts"), "utf8");
  const start = source.indexOf("export async function GET");
  const end = source.indexOf("export async function PATCH");
  assert.ok(start >= 0 && end > start, "both GET anchors exist");
  const get = source.slice(start, end);
  assert.match(get, /status: effectiveTurnStatus\(turn\.status, turn\.updatedAt, now\)/, "the board GET reports the effective status");
  assert.match(get, /omit: \{ submittedSegments: true \}/, "the board GET never loads the submitted rows");
  assert.match(get, /kind: isTurnKind\(turn\.kind\)/);
  assert.match(get, /traceId: turn\.traceId/);
}

async function main() {
  await restoreShape();
  await serverContinuation();
  boardGetSource();
  console.log("verify-partial-turn-restore: stopped turn restore shape, replay, page continuation, server marker and plan kept");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
