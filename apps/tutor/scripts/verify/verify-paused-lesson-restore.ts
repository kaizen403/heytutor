/**
 * A stopped lesson is a chat: Stop, come back (even after a reload), Continue.
 *
 * 1. `pausedLessonFromStoredTurns` derives the paused lesson from the saved
 *    turns: the last page's lesson chain, offered when its last turn stopped.
 * 2. `lessonResumeState` persists only what the turns cannot give back.
 * 3. `pausedLessonOnStop` decides what a plain Stop leaves to continue.
 * 4. The cut row rule (decision 12): the row Stop cut off is saved with the
 *    stopped turn; Continue starts at that step, finishes it in words and never
 *    writes its line again. Live and after a reload it is handed the same step
 *    and the same rows, so the step shows once either way.
 * 5. The real `useTurnControl`: Stop offers Continue, a Stop mid figure keeps
 *    the finished beats and hands the rest to Continue, a Stop of a resume is
 *    offered again, and a restored board offers without ever continuing.
 * 6. Source anchors for the handler (billing lineage, resume state, remainder).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InputBar } from "../../features/tutor-session/components/InputBar";
import { SessionInputChrome } from "../../features/tutor-session/components/SessionInputChrome";
import {
  isStoredCommandTrustedGeometry,
  serializeSegmentCommands,
  type DrawCommand,
  type TutorSegment,
} from "@heytutor/drawing";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import type { StoredSegment, StoredTurn } from "../../lib/boards/boardsClient";
import {
  lessonPageRecord,
  pausedLessonOnStop,
  resumePageRecord,
  type BoardPageRecord,
  type PausedLessonRequest,
} from "../../features/tutor-session/lib/turn/doubtTurn";
import {
  lessonResumeState,
  MAX_RESUME_SOLVER_PROJECTION_BYTES,
  pausedLessonFromStoredTurns,
  resumeStateSolverProjection,
} from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import {
  buildResumeTeachingPrompt,
  resumeInkRetryUserPrompt,
  resumeLessonUserPrompt,
} from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

// The components compile with the classic JSX runtime under tsx.
Object.defineProperty(globalThis, "React", { value: React, configurable: true });
const app = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(path.join(app, file), "utf8");
function between(file: string, start: string, end: string): string {
  const source = read(file);
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone; repoint this gate, do not relax it`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone; repoint this gate, do not relax it`);
  return source.slice(from, to);
}

const BOARD = "board-1";
const LESSON = "A 2 kg block slides down a 30 degree incline with mu = 0.2. Find its acceleration.";
const PLAN: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: LESSON,
  givens: [
    { id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given" },
    { id: "theta", symbol: "theta", value: 30, unit: "deg", provenance: "given" },
    { id: "mu", symbol: "mu", value: 0.2, provenance: "given" },
  ],
  unknowns: [{ id: "a", symbol: "a", unit: "m/s^2" }],
  derived: [{ id: "a", symbol: "a", value: 3.2, unit: "m/s^2", provenance: "derived", sourceText: "a = g (sin θ − μ cos θ)" }],
  qualitativeClaims: [],
  lawIds: ["newton-second-law"],
  assumptions: [],
  visualRequirement: "required",
};
const PROJECTION = { a: { value: 3.2, unit: "m/s^2" } };

const command = (type: DrawCommand["type"], text = "", params: number[] = [90, 142]): DrawCommand =>
  ({ type, text, params, charPosition: 0, narrationBefore: "" }) as DrawCommand;

let segmentId = 0;
function segment(orderIndex: number, narration: string, commands: DrawCommand[], options: { trusted?: boolean; audio?: boolean } = {}): StoredSegment {
  segmentId += 1;
  return {
    id: `seg-${segmentId}`,
    orderIndex,
    narration,
    spokenText: narration,
    command: commands.length ? serializeSegmentCommands(commands, { trustedDiagramGeometry: options.trusted === true }) : null,
    audioUrl: options.audio === false ? null : `blob:${segmentId}`,
    durationMs: options.audio === false ? null : 900,
    timings: null,
  };
}
const clear = (orderIndex = 0) => segment(orderIndex, "", [command("CLEAR", "", [])], { audio: false });
const writeRow = (orderIndex: number, narration: string, row: string, audio = true) =>
  segment(orderIndex, narration, [command("WRITE", row)], { audio });
const figureBeat = (orderIndex: number) =>
  segment(orderIndex, "Here is the incline.", [command("DRAW_LINE", "", [600, 500, 900, 300])], { trusted: true });

let turnIndex = 0;
function stored(input: {
  question?: string;
  kind?: StoredTurn["kind"];
  status?: StoredTurn["status"];
  segments: StoredSegment[];
  traceId?: string;
  scene?: Partial<Pick<StoredTurn, "sceneDocument" | "visualStatus" | "sceneArtifacts">>;
  resumeState?: unknown;
  updatedAt?: number;
}): StoredTurn {
  turnIndex += 1;
  return {
    id: `turn-${turnIndex}`,
    orderIndex: turnIndex,
    question: input.question ?? LESSON,
    rawResponse: input.segments.map((entry) => entry.narration).join(" "),
    speedMultiplier: 1,
    traceId: input.traceId ?? `trace-${turnIndex}`,
    sceneDocument: input.scene?.sceneDocument ?? null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: input.scene?.visualStatus ?? "text_only",
    sceneArtifacts: input.scene?.sceneArtifacts ?? null,
    segments: input.segments,
    ...(input.status ? { status: input.status, persistedStatus: input.status } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.resumeState !== undefined ? { resumeState: input.resumeState } : {}),
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
  };
}
const CUT_STEP = "Resolving along the slope, the net force is mg sin theta minus";
const validatedLesson = (status: StoredTurn["status"] = "stopped") => stored({
  kind: "lesson",
  status,
  traceId: "trace-lesson",
  scene: { sceneDocument: { id: "incline" }, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: PLAN } },
  resumeState: lessonResumeState(PROJECTION),
  segments: [
    clear(0),
    figureBeat(1),
    writeRow(2, "Newton's second law along the slope.", "F = ma"),
    // The row Stop cut off: ink and words, no audio (decision 12).
    writeRow(3, CUT_STEP, "F = mg sin θ − μ mg cos θ", false),
  ],
});
const doubtOn = (lessonQuestion: string, status: StoredTurn["status"] = "complete") => stored({
  question: "Doubt: why sin theta",
  kind: "doubt",
  status,
  scene: { sceneArtifacts: boardContinuationArtifacts(lessonQuestion) },
  segments: [writeRow(0, "Because the slope tilts the weight.", "mg sin θ")],
});
const resumeOf = (status: StoredTurn["status"], rows: string[], narration = "So the acceleration is") => stored({
  kind: "resume",
  status,
  traceId: "trace-resume",
  scene: { sceneDocument: { id: "incline" }, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: PLAN, ...boardContinuationArtifacts(LESSON) } },
  segments: rows.map((row, index) => writeRow(index, index === rows.length - 1 ? narration : `step ${index}`, row)),
});

// ---------------------------------------------------------------------------
// 1. Derivation from the saved turns
// ---------------------------------------------------------------------------
{
  const lesson = validatedLesson();
  const offered = pausedLessonFromStoredTurns([lesson], { boardId: BOARD });
  assert(offered, "a stopped lesson is offered after a reload");
  assert.equal(offered.boardId, BOARD);
  assert.equal(offered.reason, "stop", "nothing was asked after it: a plain Stop");
  assert.equal(offered.lessonQuestion, LESSON);
  assert.equal(offered.parentTraceId, "trace-lesson", "billing lineage names the stopped turn's trace");
  assert.equal(offered.turnPlan?.question, LESSON, "the lesson's validated plan comes back");
  assert.deepEqual(offered.solverProjection, PROJECTION, "the persisted solver projection comes back");
  assert.equal(offered.figureDrawn, true, "the stored figure is drawn by restore");
  assert.equal(offered.codeLesson, false);
  assert.equal(offered.scene?.visualStatus, "validated", "the lesson's scene rides along");
  assert.equal(offered.interruptedStep, CUT_STEP, "the step Stop cut off is where Continue starts");
  assert.deepEqual(offered.lessonBoardRows?.map((row) => row.text), ["F = ma", "F = mg sin θ − μ mg cos θ"],
    "every line the lesson wrote, the cut row included, is completed work");
  assert.equal(offered.remainingIntro, undefined, "a reloaded figure is whole: nothing owed");

  assert.equal(pausedLessonFromStoredTurns([validatedLesson("complete")], { boardId: BOARD }), null,
    "a finished lesson offers nothing");
  assert.equal(pausedLessonFromStoredTurns([lesson], { boardId: "" }), null, "no board, no offer");
  assert.equal(pausedLessonFromStoredTurns([], { boardId: BOARD }), null);

  const withDoubts = pausedLessonFromStoredTurns([lesson, doubtOn(LESSON), doubtOn(LESSON, "stopped")], { boardId: BOARD });
  assert.equal(withDoubts?.reason, "doubt", "doubts answered after the Stop do not close it, and the resume may say so");
  assert.equal(withDoubts?.interruptedStep, CUT_STEP, "a doubt's words are not the lesson's step");
  assert.deepEqual(withDoubts?.lessonBoardRows?.map((row) => row.text), ["F = ma", "F = mg sin θ − μ mg cos θ"],
    "a doubt's rows are not the lesson's work");

  assert.equal(
    pausedLessonFromStoredTurns([lesson, doubtOn(LESSON), resumeOf("complete", ["a = 3.2 m/s^2"])], { boardId: BOARD }),
    null,
    "a resume that finished closes the lesson",
  );

  const stoppedResume = pausedLessonFromStoredTurns([lesson, resumeOf("stopped", ["N = mg cos θ", "a = g sin θ"])], { boardId: BOARD });
  assert(stoppedResume, "a stopped resume is offered again after a reload");
  assert.equal(stoppedResume.lessonQuestion, LESSON, "under the lesson's question, from the marker");
  assert.equal(stoppedResume.parentTraceId, "trace-resume", "billing lineage names the resume that stopped");
  assert.equal(stoppedResume.interruptedStep, "So the acceleration is");
  assert.equal(stoppedResume.turnPlan?.question, LESSON, "the plan still comes from the lesson");
  assert.deepEqual(stoppedResume.solverProjection, PROJECTION, "the projection falls back to the lesson's");
  const ownState = { ...resumeOf("stopped", ["a = 3.2"]), resumeState: lessonResumeState({ a: { value: 3.25 } }) };
  assert.deepEqual(pausedLessonFromStoredTurns([lesson, ownState], { boardId: BOARD })?.solverProjection, { a: { value: 3.25 } },
    "the latest chain turn's projection wins");
  assert.deepEqual(stoppedResume.lessonBoardRows?.map((row) => row.text),
    ["F = ma", "F = mg sin θ − μ mg cos θ", "N = mg cos θ", "a = g sin θ"]);

  const nextLesson = stored({ question: "What is a free body diagram?", kind: "lesson", status: "complete", segments: [clear(0), writeRow(1, "a sketch", "FBD")] });
  assert.equal(pausedLessonFromStoredTurns([lesson, nextLesson], { boardId: BOARD }), null,
    "only the last page is offered: an older stopped page stays as it is");

  const textOnly = stored({
    kind: "lesson", status: "stopped",
    scene: { visualStatus: "text_only", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: PLAN } },
    segments: [clear(0), writeRow(1, "Given the mass.", "m = 2 kg")],
  });
  const textOffer = pausedLessonFromStoredTurns([textOnly], { boardId: BOARD });
  assert.equal(textOffer?.turnPlan?.question, LESSON, "a text-only lesson keeps its plan");
  assert.equal(textOffer?.figureDrawn, false, "and has no figure to keep");
  assert.equal(textOffer?.solverProjection, null);

  const codePlan = getMockCodeLessonPlan("two sum with a hash map");
  const dsa = stored({
    question: codePlan.question, kind: "lesson", status: "stopped",
    scene: { sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: null, codeLesson: codePlan } },
    segments: [clear(0), segment(1, "Here is the array.", [command("TYPE", "b1")])],
  });
  assert.equal(pausedLessonFromStoredTurns([dsa], { boardId: BOARD })?.codeLesson, true, "a stopped code lesson resumes as one");

  const empty = stored({ kind: "lesson", status: "stopped", segments: [clear(0)] });
  assert.equal(pausedLessonFromStoredTurns([empty], { boardId: BOARD }), null,
    "a lesson that died before its first step offers Teach it again, not Continue");

  const now = Date.parse("2026-10-06T12:00:00Z");
  const live = (updatedAt: number) => ({ ...validatedLesson("live"), updatedAt });
  assert.equal(pausedLessonFromStoredTurns([live(now - 5_000)], { boardId: BOARD, now }), null,
    "a turn still being taught elsewhere is not offered");
  assert(pausedLessonFromStoredTurns([live(now - 121_000)], { boardId: BOARD, now, ownerState: "inactive" }),
    "a live turn idle past two minutes reads as stopped and is offered");
  // A crashed tab or a lost keepalive close leaves a fresh turn reading live.
  // No tab on this page teaches it, so it is stopped at once.
  const orphan = live(now - 5_000);
  assert.equal(pausedLessonFromStoredTurns([orphan], { boardId: BOARD, now, ownerState: "inactive", isLiveHere: () => false }), null,
    "fresh raw live state remains conservative even with an inactive observed claim");
  assert.equal(pausedLessonFromStoredTurns([{ ...validatedLesson(), persistedStatus: undefined }], { boardId: BOARD, ownerState: "inactive" }), null, "missing raw status cannot prove explicit Stop");
  assert.equal(pausedLessonFromStoredTurns([lesson, { ...ownState, resumeState: null }], { boardId: BOARD })?.solverProjection, null, "explicit solver-state clear does not fall back to an older projection");
  assert.equal(pausedLessonFromStoredTurns([orphan], { boardId: BOARD, now, isLiveHere: (id) => id === orphan.id }), null,
    "a turn this tab still teaches is not offered");
  const legacy = { ...validatedLesson(), status: undefined };
  assert.equal(pausedLessonFromStoredTurns([legacy], { boardId: BOARD }), null, "legacy turns read as complete");

  const ownPage = stored({
    kind: "resume", status: "stopped", traceId: "trace-own",
    scene: { sceneArtifacts: boardContinuationArtifacts(LESSON) },
    segments: [clear(0), writeRow(1, "On a fresh page.", "a = 3.2")],
  });
  const ownOffer = pausedLessonFromStoredTurns([validatedLesson("complete"), ownPage], { boardId: BOARD });
  assert.equal(ownOffer?.turnPlan?.question, LESSON, "a resume that opened its own page still finds the lesson's plan");
  assert.equal(ownOffer?.lessonQuestion, LESSON);
}

// ---------------------------------------------------------------------------
// 2. Resume state: only what the turns cannot rebuild, bounded
// ---------------------------------------------------------------------------
{
  const state = lessonResumeState(PROJECTION);
  assert.deepEqual(state, { v: 1, solverProjection: PROJECTION });
  assert.deepEqual(resumeStateSolverProjection(state), PROJECTION);
  assert.equal(lessonResumeState(null), null);
  assert.equal(lessonResumeState(undefined), null);
  assert.equal(lessonResumeState({ big: "x".repeat(MAX_RESUME_SOLVER_PROJECTION_BYTES) }), null, "an oversize projection is dropped");
  assert.equal(resumeStateSolverProjection({ v: 2, solverProjection: PROJECTION }), null, "an unknown version is ignored");
  assert.equal(resumeStateSolverProjection("junk"), null);
}

// ---------------------------------------------------------------------------
// 3. What a plain Stop leaves to continue
// ---------------------------------------------------------------------------
const introBeats: TutorSegment[] = [
  { narration: "Here is the incline.", command: null },
  { narration: "The block sits on it.", command: null },
  { narration: "Its weight points down.", command: null },
];
function lessonRecord(figureDrawn: boolean): BoardPageRecord {
  const record = lessonPageRecord(BOARD, LESSON);
  record.turnPlan = PLAN;
  record.solverProjection = PROJECTION;
  record.figureDrawn = figureDrawn;
  record.turn.scene = { sceneDocument: { id: "incline" }, sceneEngineVersion: null, validationReport: null, visualStatus: "validated", sceneArtifacts: { turnPlan: PLAN } };
  return record;
}
const liveRows = [{ workId: "w1", text: "F = ma" }, { workId: "w2", text: "F = mg sin θ − μ mg cos θ" }];
{
  const base = {
    boardId: BOARD, activeResume: null, liveQuestion: LESSON, codeLesson: false,
    lessonBoardRows: liveRows, interruptedStep: CUT_STEP, parentTraceId: "trace-lesson",
  };
  const stop = pausedLessonOnStop({ ...base, record: lessonRecord(true), taught: true, remainingIntro: introBeats.slice(2) });
  assert(stop, "a lesson that taught something is offered after Stop");
  assert.equal(stop.reason, "stop");
  assert.equal(stop.parentTraceId, "trace-lesson");
  assert.equal(stop.figureDrawn, true);
  assert.deepEqual(stop.remainingIntro, introBeats.slice(2), "the figure's missing beats are owed to Continue");
  assert.deepEqual(stop.solverProjection, PROJECTION);
  assert.equal(pausedLessonOnStop({ ...base, record: lessonRecord(true), taught: false }), null,
    "a lesson stopped before teaching anything offers nothing");
  const planned = pausedLessonOnStop({ ...base, record: lessonRecord(false), taught: true, remainingIntro: introBeats });
  assert.equal(planned?.figureDrawn, false, "a planned figure is not ink");
  assert.equal(planned?.remainingIntro, undefined, "Continue draws a never drawn figure whole, from its scene");
  const doubtRecord = { ...lessonRecord(true), turn: { ...lessonRecord(true).turn, kind: "doubt" as const } };
  assert.equal(pausedLessonOnStop({ ...base, record: doubtRecord, taught: true }), null, "a stopped doubt is not a lesson to continue");
  assert.equal(pausedLessonOnStop({ ...base, record: { ...lessonRecord(true), boardId: "other" }, taught: true }), null,
    "another board's page is never offered here");

  const request: PausedLessonRequest = { ...stop, reason: "doubt", remainingIntro: introBeats.slice(1) };
  const pageBefore = lessonRecord(true);
  const resumePage = resumePageRecord({ boardId: BOARD, lessonQuestion: LESSON, figureDrawn: true, turnPlan: PLAN, solverProjection: PROJECTION, scene: pageBefore.turn.scene });
  const again = pausedLessonOnStop({
    ...base, record: resumePage, activeResume: { request, pageBefore }, taught: true,
    lessonBoardRows: [...liveRows, { workId: "w3", text: "N = mg cos θ" }], interruptedStep: "so N is", parentTraceId: "trace-resume",
  });
  assert.equal(again?.reason, "stop", "a user Stop of a resume is offered again, as a Stop");
  assert.equal(again?.parentTraceId, "trace-resume");
  assert.equal(again?.interruptedStep, "so N is");
  assert.equal(again?.lessonBoardRows?.length, 3);
  const early = pausedLessonOnStop({ ...base, record: pageBefore, activeResume: { request, pageBefore }, taught: false });
  assert.equal(early?.reason, "doubt", "a resume stopped before it started hands back the request it came from");
  assert.deepEqual(early?.remainingIntro, introBeats.slice(1), "still owing the figure's beats");
  const drawn = pausedLessonOnStop({ ...base, record: pageBefore, activeResume: { request, pageBefore }, taught: false, remainingIntro: [] });
  assert.equal(drawn?.remainingIntro, undefined, "beats it drew are not owed again");
}

// ---------------------------------------------------------------------------
// 4. The cut row rule: live and after a reload Continue gets the same step
// ---------------------------------------------------------------------------
{
  const live = pausedLessonOnStop({
    record: lessonRecord(true), boardId: BOARD, activeResume: null, taught: true, liveQuestion: LESSON,
    codeLesson: false, lessonBoardRows: liveRows, interruptedStep: CUT_STEP, parentTraceId: "trace-lesson",
  })!;
  const reloaded = pausedLessonFromStoredTurns([validatedLesson()], { boardId: BOARD })!;
  assert.equal(live.interruptedStep, reloaded.interruptedStep, "the same cut step, live and after a reload");
  assert.deepEqual(live.lessonBoardRows?.map((row) => row.text), reloaded.lessonBoardRows?.map((row) => row.text),
    "the same written rows, the cut row among them");
  const cutRow = validatedLesson().segments.at(-1)!;
  assert(cutRow.audioUrl === null && !isStoredCommandTrustedGeometry(cutRow.command), "the cut row is saved with its ink and no audio");

  const promptInput = {
    lessonQuestion: LESSON, boardRows: liveRows, lessonBoardRows: reloaded.lessonBoardRows, interruptedStep: reloaded.interruptedStep,
    rowsLeftOnPage: 4, nextRowY: 330, diagramPromptAddon: "figure ids: block, incline", codePanelShowing: false,
    turnPlan: PLAN, solverProjection: PROJECTION, familiarity: "normal" as const, fastMode: false,
  };
  const afterStop = buildResumeTeachingPrompt({ ...promptInput, reason: "stop" });
  assert(afterStop.systemPrompt.includes("Start here: finish explaining this step in words without writing its line again"),
    "Continue starts at the cut step and never rewrites its line");
  assert(afterStop.systemPrompt.includes(CUT_STEP), "the cut step is named");
  assert(afterStop.systemPrompt.includes("Use these as the completed work, not as lines to write again") &&
    afterStop.systemPrompt.includes("F = mg sin θ − μ mg cos θ"), "the cut row is completed work");
  assert(afterStop.systemPrompt.includes("Never [WRITE] a row that is still on this page"));
  for (const text of [afterStop.systemPrompt, afterStop.continuationPrompt, resumeLessonUserPrompt(null, "stop"), resumeInkRetryUserPrompt("stop")]) {
    assert(!/doubt/i.test(text.replace(/HINGLISH[\s\S]*$/, "")), `a plain Stop's resume never mentions a doubt: ${text.slice(0, 80)}`);
  }
  assert(afterStop.systemPrompt.includes("has come back to it"), "the student came back to a stopped lesson");
  const afterDoubt = buildResumeTeachingPrompt({ ...promptInput, reason: "doubt" });
  assert(afterDoubt.systemPrompt.includes("The doubt has been answered"), "after a doubt the resume still says so");
  assert(resumeLessonUserPrompt(null, "doubt").includes("A doubt on this board has been answered"));
}

// ---------------------------------------------------------------------------
// 5. The real useTurnControl
// ---------------------------------------------------------------------------
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
type Log = string[];
function loadTurnControl(log: Log, speaking: { current: string }, runSegment: (...args: unknown[]) => Promise<void>) {
  const file = path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts");
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const hookModule = { exports: {} as Record<string, unknown> };
  const localRequire = (specifier: string) => {
    if (specifier === "react") {
      return { useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useEffect: () => {}, useState: (value: unknown) => [value, () => {}] };
    }
    if (specifier === "./useSegmentRunner") {
      return { useSegmentRunner: () => ({ runSegment, pauseFallbackSpeech() {}, resumeFallbackSpeech() {}, stopFallbackSpeech() {}, speakingNarrationRef: speaking }) };
    }
    if (specifier === "../../lib/turn/liveTurnSave") {
      return {
        liveTurnSave: () => ({
          closeOwner: () => log.push(`close figureDrawn=${String(pageRef.current?.figureDrawn)}`),
          figureCommitted: () => log.push("figureCommitted"),
          dropIntroRows: (_owner: unknown, generation: number) => log.push(`dropIntroRows ${generation}`),
          captureShown() {},
          turnIdFor() { return "local-stopped-id"; },
          resumeTurns(_board: string, turns: unknown) { return turns; },
          recordRow() {},
          setResumeState() {},
          isLiveHere: (turnId: string) => liveHereIds.has(turnId),
        }),
      };
    }
    if (specifier === "../../lib/turn/lessonOwnership") return { lessonAdmission: () => ({ probe: async () => "inactive", cancel() {}, hasAttempt: () => false }) };
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", compiled)(localRequire, hookModule, hookModule.exports, () => 1, () => {});
  return hookModule.exports.useTurnControl as typeof import("../../features/tutor-session/hooks/turn/useTurnControl").useTurnControl;
}
const pageRef: { current: BoardPageRecord | null } = { current: null };
/** Turns the stubbed save registry says this tab is still teaching. */
const liveHereIds = new Set<string>();

function mount(options: { runSegment?: (...args: unknown[]) => Promise<void> } = {}) {
  const log: Log = [];
  let savepoints = 0;
  const speaking = { current: "" };
  const useTurnControl = loadTurnControl(log, speaking, options.runSegment ?? (async () => {}));
  const ref = <T,>(current: T) => ({ current });
  const asked: Array<{ question: string; options: { resume?: PausedLessonRequest; doubt?: unknown; onAdmission?: (admitted: boolean) => void } | undefined }> = [];
  const wb = {
    beginDrawTransaction: () => { log.push("begin"); return "tx"; },
    createDrawSavepoint: () => `sp-${(savepoints += 1) - 1}`,
    rollbackDrawSavepoint: (_tx: string, savepoint: string) => log.push(`rollback ${savepoint}`),
    commitDrawTransaction: () => log.push("commit"),
    abortDrawTransaction: () => log.push("abort"),
    finishAbortedDrawTransaction: () => log.push("finishAbort"),
    cancelAnimations() {}, setPaused() {}, clearSpotlight() {},
  };
  const params = {
    sessionId: BOARD, phase: "speaking", isReplaying: false, boardLoaded: true, enableKeyboardControls: false,
    whiteboardRef: ref(wb), pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(false), phaseRef: ref("speaking"),
    isPausedRef: ref(false), rewoundRef: ref(false), conversationHistoryRef: ref([]), liveQuestionRef: ref(LESSON),
    ttsClientRef: ref(null), ensureTTSClient: () => ({}), currentTraceIdRef: ref<string | null>("trace-lesson"),
    replayAudioRef: ref(null), replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    cancelRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1), turnAbortRef: ref(null),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()), collectedSegmentsRef: ref([]),
    recordedSegmentsRef: ref<Array<{ narration: string }>>([]), narrationSinceEpochRef: ref(""),
    activeVerifiedDiagramRef: ref(null), codeLessonControllerRef: ref(null), fbdPhaseMarkedRef: ref(false),
    fbdPhaseStartedRef: ref(false), setActiveVerifiedDiagram() {}, segmentPlanStatsRef: ref({}), stopTurnRef: ref(null),
    replayGenerationRef: ref(0), replayCueRef: ref(null), turnTelemetryRef: ref(null),
    setPhase() {}, setIsPaused() {}, setNarrationText() {}, setCurrentSegmentText() {}, setInputInteracted() {},
    setLastError() {}, setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {}, clearCancelTimers() {},
    pendingSegmentCountRef: ref(0), executeCommandWithCancel: async () => {},
    boardLayoutRef: ref({ rects: [
      { x: 90, y: 142, width: 120, height: 30, text: "F = ma", workId: "w1" },
      { x: 90, y: 186, width: 220, height: 30, text: "F = mg sin θ − μ mg cos θ", workId: "w2" },
    ] }),
    boardPageRef: pageRef,
    boardShowsStoppedReplayRef: ref(false),
  };
  const handleQuestionRef = ref(async (question: string, opts?: { resume?: PausedLessonRequest; doubt?: unknown; onAdmission?: (admitted: boolean) => void }) => {
    asked.push({ question, options: opts });
    opts?.onAdmission?.(true);
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks -- a VM with inert render hooks, not a React render
  const control = useTurnControl(params as never, handleQuestionRef as never);
  const idle = () => {
    params.phaseRef.current = "idle";
    params.turnActiveRef.current = false;
    params.pendingSegmentCountRef.current = 0;
  };
  return { control, params, log, speaking, asked, idle, handleQuestionRef };
}

async function main() {
  // Actual Continue hook owns one synchronous pending receipt, including repeated clicks.
  {
    pageRef.current = lessonRecord(true);
    const shell = mount(); shell.idle();
    const request = pausedLessonFromStoredTurns([validatedLesson()], { boardId: BOARD })!;
    shell.control.offerPausedLessonResume(request);
    shell.handleQuestionRef.current = async (question, options) => { shell.asked.push({ question, options }); };
    shell.control.flushPausedLesson(); shell.control.flushPausedLesson();
    assert.equal(shell.asked.length, 1, "two clicks before acquisition share exactly one pending Continue");
    shell.asked[0]!.options!.onAdmission!(true);
    shell.control.flushPausedLesson();
    assert.equal(shell.asked.length, 1, "successful receipt consumes snapshot and cannot leave duplicate offer");
    const denied = mount(); denied.idle(); denied.control.offerPausedLessonResume(request);
    denied.handleQuestionRef.current = async (question, options) => { denied.asked.push({ question, options }); };
    denied.control.flushPausedLesson(); denied.asked[0]!.options!.onAdmission!(false);
    denied.control.flushPausedLesson();
    assert.equal(denied.asked.length, 2, "denied acquisition keeps the same offer available for a later click");
    assert.equal(denied.asked[1]!.options!.resume, request);
  }

  // 5a. A plain Stop of a lesson offers Continue, with reason "stop".
  {
    pageRef.current = lessonRecord(false);
    const shell = mount();
    shell.params.recordedSegmentsRef.current = [{ narration: "Newton's second law along the slope." }];
    shell.speaking.current = CUT_STEP;
    shell.control.stopTurn();
    shell.idle();
    shell.control.flushPausedLesson();
    const resume = shell.asked.at(-1)?.options?.resume;
    assert(resume, "Stop leaves the lesson to continue, and Continue resumes it");
    assert.equal(shell.asked.at(-1)?.question, LESSON);
    assert.equal(resume.reason, "stop");
    assert.equal(resume.parentTraceId, "trace-lesson");
    assert.equal(resume.interruptedStep, CUT_STEP, "the cut step, as the reload derives it");
    assert.deepEqual(resume.lessonBoardRows?.map((row) => row.text), liveRows.map((row) => row.text));
  }

  // 5b. Stop in the middle of the figure keeps the finished beats, takes back
  // the one it cut off, closes the save after the figure is marked drawn, and
  // hands the rest of the figure to Continue (decision 4).
  {
    pageRef.current = lessonRecord(false);
    let releaseBeat: () => void = () => {};
    let beatStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => { beatStarted = resolve; });
    const held: { shell?: ReturnType<typeof mount> } = {};
    const runSegment = async (...args: unknown[]) => {
      const index = args[1] as number;
      if (index === 0) {
        const row = { narration: introBeats[0]!.narration };
        held.shell!.params.recordedSegmentsRef.current.push(row);
        (args[6] as (row: unknown) => void)(row);
        return;
      }
      beatStarted();
      await new Promise<void>((resolve) => { releaseBeat = resolve; });
    };
    const shell = mount({ runSegment });
    held.shell = shell;
    shell.log.length = 0;
    shell.control.enqueueVerifiedIntro(introBeats, 1);
    await started;
    // Stop replaces the chain; the stopped intro unwinds on the old one.
    const stoppedChain = shell.params.segmentChainRef.current.catch(() => undefined);
    shell.control.stopTurn();
    releaseBeat();
    await stoppedChain;
    assert(shell.log.includes("rollback sp-1") && !shell.log.includes("rollback sp-0"), `only the beat Stop cut off is taken back: ${shell.log.join(", ")}`);
    assert(shell.log.includes("commit") && !shell.log.includes("abort"), "the finished beats stay: the figure commits");
    assert(shell.log.includes("close figureDrawn=true"), "the figure is marked drawn before the save closes, so its rows go with it");
    assert(shell.log.indexOf("commit") < shell.log.indexOf("close figureDrawn=true"));
    shell.idle();
    shell.control.flushPausedLesson();
    const resume = shell.asked.at(-1)?.options?.resume;
    assert.equal(resume?.figureDrawn, true);
    assert.deepEqual(resume?.remainingIntro?.map((beat) => beat.narration), introBeats.slice(1).map((beat) => beat.narration),
      "Continue finishes the figure: the cut beat and every beat after it");
  }

  // 5c. Continue draws those beats as a remainder: held, then dropped, never saved.
  {
    pageRef.current = resumePageRecord({ boardId: BOARD, lessonQuestion: LESSON, figureDrawn: true, turnPlan: PLAN, solverProjection: null, scene: null });
    const held: { shell?: ReturnType<typeof mount> } = {};
    let figureDrawnWhileDrawing: boolean | undefined;
    const runSegment = async (...args: unknown[]) => {
      figureDrawnWhileDrawing = pageRef.current?.figureDrawn;
      const row = { narration: "beat" };
      held.shell!.params.recordedSegmentsRef.current.push(row);
      (args[6] as (row: unknown) => void)(row);
    };
    const shell = mount({ runSegment });
    held.shell = shell;
    shell.control.enqueueVerifiedIntro(introBeats.slice(1), 1, { remainder: true });
    await shell.params.segmentChainRef.current;
    assert.equal(figureDrawnWhileDrawing, false, "the remainder's rows are held, not sent, while it draws");
    assert(shell.log.includes("dropIntroRows 1"), "then dropped: the stopped turn's save already holds the whole figure");
    assert(shell.log.indexOf("dropIntroRows 1") < shell.log.indexOf("figureCommitted"));
    assert.equal(pageRef.current?.figureDrawn, true, "and the page has its figure again");
    assert.equal(shell.params.recordedSegmentsRef.current.length, 0, "the remainder is not a recorded row of the resume");
  }

  // 5d. A user Stop of a resume is offered again; one stopped before it began
  // hands back the request it started from.
  {
    pageRef.current = lessonRecord(true);
    const shell = mount();
    shell.params.recordedSegmentsRef.current = [{ narration: "Newton's second law along the slope." }];
    shell.control.stopTurn();
    shell.idle();
    shell.handleQuestionRef.current = async (question, opts) => {
      shell.asked.push({ question, options: opts });
      shell.params.turnActiveRef.current = true;
      shell.params.phaseRef.current = "speaking";
      pageRef.current = resumePageRecord({ boardId: BOARD, lessonQuestion: LESSON, figureDrawn: true, turnPlan: PLAN, solverProjection: PROJECTION, scene: lessonRecord(true).turn.scene });
      shell.params.recordedSegmentsRef.current = [{ narration: "The normal force balances." }];
      shell.params.currentTraceIdRef.current = "trace-resume";
      shell.speaking.current = "so N is";
    };
    shell.control.flushPausedLesson();
    assert.equal(shell.asked.length, 1, "Continue starts the resume");
    shell.control.stopTurn();
    shell.idle();
    shell.control.flushPausedLesson();
    const again = shell.asked.at(-1)?.options?.resume;
    assert.equal(shell.asked.length, 2, "a stopped resume is offered again");
    assert.equal(again?.reason, "stop");
    assert.equal(again?.parentTraceId, "trace-resume");
    assert.equal(again?.interruptedStep, "so N is");

    // Stopped before it drew anything: the request it came from.
    shell.control.stopTurn();
    shell.idle();
    shell.handleQuestionRef.current = async (question, opts) => {
      shell.asked.push({ question, options: opts });
      shell.params.turnActiveRef.current = true;
      shell.params.phaseRef.current = "thinking";
      shell.params.recordedSegmentsRef.current = [];
      shell.speaking.current = "";
    };
    const asksBefore = shell.asked.length;
    shell.control.flushPausedLesson();
    assert.equal(shell.asked.length, asksBefore + 1, "Continue starts the resume again");
    const before = shell.asked.at(-1)!.options!.resume!;
    const asks = shell.asked.length;
    shell.control.stopTurn();
    shell.idle();
    shell.control.flushPausedLesson();
    assert.equal(shell.asked.length, asks + 1, "a resume stopped before it taught anything is offered again");
    assert.deepEqual(shell.asked.at(-1)?.options?.resume, before, "nothing taught: the same lesson is offered again");
  }

  // 5e. A doubt after Stop: the resume knows a doubt was answered.
  {
    pageRef.current = lessonRecord(true);
    const shell = mount();
    shell.params.recordedSegmentsRef.current = [{ narration: "Newton's second law along the slope." }];
    shell.control.stopTurn();
    shell.idle();
    shell.control.handleAskDoubt("why sin theta?");
    assert(shell.asked.at(-1)?.options?.doubt, "the doubt is answered on the board");
    shell.control.flushPausedLesson();
    assert.equal(shell.asked.at(-1)?.options?.resume?.reason, "doubt");
  }

  // 5f. A restored board offers the stopped lesson and never continues on its own.
  {
    pageRef.current = null;
    const shell = mount();
    shell.idle();
    const offered = await shell.control.restorePausedLesson([validatedLesson(), doubtOn(LESSON)]);
    assert.equal(offered?.reason, "doubt");
    assert.equal(shell.asked.length, 0, "restore only offers: never auto continue (decision 3)");
    assert.equal(await shell.control.restorePausedLesson([validatedLesson("complete")]), null, "fresh completion clears the previous offer");
    await shell.control.restorePausedLesson([validatedLesson(), doubtOn(LESSON)]);
    shell.control.flushPausedLesson();
    assert.equal(shell.asked.at(-1)?.options?.resume?.lessonQuestion, LESSON, "Continue resumes the restored lesson");

    // A snapshot this tab took before the board was redrawn (a board switch
    // stops the lesson on the way out) gives way to the saved turns.
    pageRef.current = lessonRecord(true);
    const switched = mount();
    switched.params.recordedSegmentsRef.current = [{ narration: "Newton's second law along the slope." }];
    switched.control.stopTurn();
    switched.idle();
    assert.equal(await switched.control.restorePausedLesson([validatedLesson("complete")]), null,
      "a lesson the saved turns show finished is not offered from a stale snapshot");
    switched.control.flushPausedLesson();
    assert.equal(switched.asked.length, 0, "and Continue has nothing to resume");
    const again = mount();
    again.params.recordedSegmentsRef.current = [{ narration: "x" }];
    again.control.stopTurn();
    again.idle();
    const derived = await again.control.restorePausedLesson([validatedLesson()]);
    assert.equal(derived?.interruptedStep, CUT_STEP, "the saved turns' snapshot replaces the tab's");

    const busy = mount();
    assert.equal(await busy.control.restorePausedLesson([validatedLesson()]), null, "a turn owns the board: not yet");
    busy.idle();
    assert(await busy.control.restorePausedLesson([validatedLesson()]), "and offered once it is idle");

    // Reopened before the two minute cutoff: the saved turn still reads live.
    const fresh = { ...validatedLesson("live"), updatedAt: Date.now() };
    const reopened = mount();
    reopened.idle();
    assert.equal(await reopened.control.restorePausedLesson([fresh]), null,
      "fresh raw live state suppresses an orphan offer during idle window");
    // This tab is still teaching it: not yet, and the null is not kept.
    liveHereIds.add(fresh.id);
    const teaching = mount();
    teaching.idle();
    assert.equal(await teaching.control.restorePausedLesson([fresh]), null, "a turn this tab teaches is not offered");
    liveHereIds.delete(fresh.id);
    assert.equal(await teaching.control.restorePausedLesson([fresh]), null, "fresh state still owns its idle window after local release");
    assert(await teaching.control.restorePausedLesson([{ ...fresh, updatedAt: Date.now() - 121_000 }]), "old raw live state with confirmed inactive ownership may be offered");
  }

  // ---------------------------------------------------------------------------
  // 6. Sources the VM cannot reach
  // ---------------------------------------------------------------------------
  {
    const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
    const handler = read(file);
    assert(handler.includes("? resume.parentTraceId ?? currentTraceIdRef.current ?? undefined"),
      "after a reload a resume bills as a follow-on of the turn that stopped");
    assert(/parentTraceId: previousTraceId,/.test(handler), "billing gets that lineage");
    assert(/traceId: currentTraceIdRef\.current,\s*kind: doubt \? "doubt" : resume \? "resume" : "lesson",/.test(handler),
      "a resume saves under its own trace, as kind resume");
    const plan = between(file, "page.solverProjection = problemAuthority?.projection ?? null;", "page.turn.scene = {");
    assert(plan.includes("setResumeState(cancelRef, turnGeneration, lessonResumeState(page.solverProjection))"),
      "the lesson's solver projection rides its checkpoints for a reload");
    assert(handler.includes("if (resume) liveTurnSave().setResumeState(cancelRef, turnGeneration, lessonResumeState(resume.solverProjection));"),
      "and a resume's rides its own");
    const branch = between(file, "} else if (resume) {", "diagramSource = activeDiagram ?");
    assert(branch.includes("activeDiagram = resume.figureDrawn || resume.codeLesson ? activeVerifiedDiagramRef.current : null;"),
      "a figure a Stop caught before its first beat is drawn whole by Continue");
    assert(branch.includes("sceneV2IntroSegments = [...resume.remainingIntro];") && branch.includes("resumeIntroRemainder = true;"),
      "Continue draws the beats a Stop cut off");
    assert(handler.includes("enqueueVerifiedIntro(introSegments, turnGeneration, { remainder: resumeIntroRemainder });"),
      "as a remainder, never saved");
    assert(handler.includes("reason: resume.reason,") && handler.includes("resumeInkRetryUserPrompt(resume?.reason)") &&
      /resumeLessonUserPrompt\([\s\S]{0,200}resume\.reason,\s*\)/.test(handler),
      "every resume prompt is told why the lesson paused");

    const control = "features/tutor-session/hooks/turn/useTurnControl.ts";
    const stop = between(control, "const stopTurn = useCallback(", "liveTurnSave().closeOwner(cancelRef);");
    assert(stop.includes("pausedLessonOnStop("), "Stop takes the snapshot before its save closes");
    const restore = between(control, "const restorePausedLesson = useCallback(", "const flushPausedLesson = useCallback(");
    assert(restore.includes("pausedLessonFromStoredTurns(") && !restore.includes("handleQuestionRef"),
      "restore derives the offer and never starts the lesson");
  }

  // ---------------------------------------------------------------------------
  // 7. Teach it again on an old board with only a title prefills, never sends
  // (decision 13): the composer takes the text through SessionInputChrome.
  // ---------------------------------------------------------------------------
  {
    const noop = () => {};
    let sent = 0;
    const bar = renderToStaticMarkup(createElement(InputBar, {
      onSubmit: () => { sent += 1; }, prefill: { text: "Projectile range at 45 degrees", nonce: 1 },
    }));
    assert(/<textarea[^>]*>Projectile range at 45 degrees<\/textarea>/.test(bar), "the composer shows the prefilled text");
    assert.equal(sent, 0, "a prefill is never sent");
    const plain = renderToStaticMarkup(createElement(InputBar, { onSubmit: noop }));
    assert(/<textarea[^>]*><\/textarea>/.test(plain), "no prefill, an empty composer");
    const chrome = renderToStaticMarkup(createElement(SessionInputChrome, {
      isInputOverlay: false, phase: "idle", isPaused: false, inputSubmitMode: "follow-up",
      onSubmit: noop, onAskDoubt: noop, onPauseToggle: noop, onCancel: noop, onUserInteractionChange: noop,
      prefill: { text: "Projectile range at 45 degrees", nonce: 2 },
      pausedLessonOffer: true, pausedLessonReason: "stop",
    }));
    assert(chrome.includes(">Projectile range at 45 degrees</textarea>"), "SessionInputChrome passes the prefill to the composer");
    assert(chrome.includes("Lesson stopped") && chrome.includes("Continue lesson") && !chrome.includes("doubt is answered"),
      "a stopped lesson's bar says so, with Continue lesson");
  }

  console.log("verify-paused-lesson-restore: stored derivation, resume state, Stop snapshot, cut row rule, live hook, sources, prefill");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
