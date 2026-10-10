/** Reload a completed compatible code resume through actual hydration and controller. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { getMockCodeLessonPlan, type CodeLessonPlan } from "@heytutor/tutor-core";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { CodeLessonController } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
const ref = <T>(current: T) => ({ current });
const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
function executor(controller: CodeLessonController, delay: (ms: number) => Promise<void> = async () => {}) {
  const file = path.join(app, "features/tutor-session/hooks/useCommandExecution.ts");
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as { useCommandExecution: typeof import("../../features/tutor-session/hooks/useCommandExecution").useCommandExecution } };
  new Function("require", "module", "exports", js)((id: string) => id === "react" ? { useRef: ref, useCallback: (fn: unknown) => fn }
    : requireApp(id.startsWith(".") ? path.resolve(path.dirname(file), id) : id), mod, mod.exports);
  const board = { getInkSettings: () => ({ inkColor: "white", pencilThickness: 2 }), setAnimationSpeed() {},
    getDrawLayer: () => ({}), clearBoard: async () => {}, flyCursorTo: async () => {}, setCursorState() {} };
  return mod.exports.useCommandExecution({ whiteboardRef: ref(board), cancelRef: ref(false), speedRef: ref(1),
    boardLayoutRef: ref({ rects: [] }), fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false), activeVerifiedDiagramRef: ref(null),
    turnTelemetryRef: ref(null), cancellableDelay: delay, forgetErasedTextRects() {}, resetBoardLayout() {},
    forceSequentialWorkLayoutRef: ref(false), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async <T,>(p: Promise<T>) => p, resolveTextPlacement: async () => ({ x: 0, y: 0 }),
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), codeLessonControllerRef: ref(controller),
  } as never);
}
async function hydrate(turns: StoredTurn[]): Promise<CodeLessonController> {
  const controller = new CodeLessonController();
  const execute = executor(controller);
  const file = path.join(app, "features/tutor-session/hooks/useBoardSession.ts");
  const js = ts.transpileModule(readFileSync(file.endsWith("useBoardSession.ts") ? process.env.COMPLETED_CODE_RESTORE_SOURCE ?? file : file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const effects: Array<() => void> = [];
  const empty = new LiveTurnSaveRegistry({ transport: { checkpoint: async () => { throw Error("no save in hydration fixture"); }, close: async () => { throw Error("no close in hydration fixture"); } },
    mintId: () => "unused", now: () => 0, isOnline: () => true, setTimer: () => 0, clearTimer() {} });
  const mod = { exports: {} as { useBoardSession: (params: unknown) => { storedTurnsRef: { current: StoredTurn[] }; settleBoardRestore: () => Promise<void> } } };
  let fetched = 0;
  new Function("require", "module", "exports", js)((id: string) => {
    if (id === "react") return { useRef: ref, useCallback: (fn: unknown) => fn, useState: (initial: unknown) => [initial, () => {}],
      useEffect: (fn: () => void) => effects.push(fn), useLayoutEffect: (fn: () => void) => fn(), useSyncExternalStore: (_listen: unknown, get: () => unknown) => get() };
    if (id.endsWith("/turn/liveTurnSave")) return { ...requireApp(path.join(app, "features/tutor-session/lib/turn/liveTurnSave")), liveTurnSave: () => empty };
    if (id === "@/lib/boards/boardsClient") return { ...requireApp(id), fetchBoardDetail: async () => { fetched++; return { turns }; }, createBoard: async () => { throw Error("existing fixture must not create a board"); } };
    return requireApp(id.startsWith(".") ? path.resolve(path.dirname(file), id) : id);
  }, mod, mod.exports);
  const board = mod.exports.useBoardSession({ sessionId: "board", isDraft: false, router: { push() {} }, phase: "idle", speedMultiplier: 1,
    whiteboardRef: ref({ clearBoard: async () => {}, getDrawLayer: () => ({}) }), cancelRef: ref(false), notesEpochsRef: ref([]),
    narrationSinceEpochRef: ref(""), liveQuestionRef: ref(""), captureNotesEpoch: () => false, ttsClientRef: ref(null), voicePreferencesRef: ref({}), speedRef: ref(1),
    stopTurnRef: ref(null), replayAudioRef: ref(null), replayAudioPreloadRef: ref(new Map()), setNarrationText() {}, setCurrentSegmentText() {}, resetBoardLayout() {},
    executeCommand: execute.executeCommand, codeLessonControllerRef: ref(controller),
  });
  const start = effects.find(effect => effect.toString().includes("restoreBoardFromApiRef.current(sessionId"));
  assert(start, "actual board-session restoration effect is mounted"); start();
  for (let index = 0; index < 100; index++) await Promise.resolve();
  assert.equal(fetched, 1, "actual hydration reaches one controlled authenticated read");
  assert.equal(board.storedTurnsRef.current.length, turns.length);
  await board.settleBoardRestore();
  return controller;
}
const question = "Explain binary search on a sorted array.";
const plan = getMockCodeLessonPlan(question);
function turn(id: string, options: { continuation?: string; codePlan?: CodeLessonPlan | null; status?: "stopped" | "complete"; partial?: boolean; legacy?: boolean; clear?: boolean; question?: string; empty?: boolean; doubt?: boolean } = {}): StoredTurn {
  const source = options.codePlan ?? plan;
  const segments: StoredTurn["segments"] = (options.empty ? [] : source.sections.flatMap(section => section.blocks)).map((block, orderIndex) => ({
    id: `${id}-${orderIndex}`, orderIndex, narration: "Typed source", spokenText: "Typed source", audioUrl: null, durationMs: null, timings: null,
    command: { type: "TYPE", text: block.code, params: [], charPosition: 0, narrationBefore: "", semanticRef: { entityId: block.id }, ...(options.partial ? { shownChars: 6 } : {}) },
  }));
  if (options.clear) segments.unshift({ id: `${id}-clear`, orderIndex: -1, narration: "", spokenText: "", audioUrl: null, durationMs: null, timings: null, command: { type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" } });
  return { id, orderIndex: 0, kind: options.continuation ? options.doubt ? "doubt" : "resume" : "lesson", question: options.question ?? question, rawResponse: "Typed lesson", speedMultiplier: 1, traceId: null,
    ...(options.legacy ? {} : { status: options.status ?? "complete", persistedStatus: options.status ?? "complete" }),
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: { ...(options.codePlan === null ? {} : { codeLesson: source }), ...(options.continuation ? boardContinuationArtifacts(options.continuation) : {}) }, segments };
}
async function main() {
  const stopped = turn("original", { status: "stopped", partial: true });
  const completed = turn("resume", { continuation: question, codePlan: null });
  const controller = await hydrate([stopped, completed]);
  assert.equal(controller.getState().mode, "complete", "completed compatible same-page resume must restore practice availability");
  controller.startTypeAlong();
  assert.equal(controller.getState().mode, "type_along", "actual controller admits practice after reloaded completion");
  const partial = await hydrate([stopped, turn("partial", { continuation: question, codePlan: null, status: "stopped", partial: true })]);
  assert.equal(partial.getState().mode, "lesson", "stopped resume still owes teaching and cannot restore practice");
  const block = plan.sections[0]!.blocks[0]!;
  assert.equal(partial.getState().revealedChars[block.id], 6, "partial restore cannot borrow future code");
  partial.startTypeAlong(); assert.equal(partial.getState().mode, "lesson", "actual practice entry rejects partial lesson");
  const laterStopped = await hydrate([stopped, completed, turn("later-stop", { continuation: question, codePlan: null, status: "stopped", partial: true })]);
  assert.equal(laterStopped.getState().mode, "lesson", "an earlier completed resume cannot override the final stopped resume");
  for (const [label, opening, tail] of [
    ["unchanged completed opening", turn("complete"), []],
    ["legacy completed opening", turn("legacy", { legacy: true }), []],
    ["legacy completed resume", stopped, [turn("legacy-resume", { continuation: question, codePlan: null, legacy: true })]],
    ["equal validated plan", stopped, [turn("equal-plan", { continuation: question, codePlan: structuredClone(plan) })]],
    ["intervening compatible doubt", stopped, [turn("doubt", { continuation: question, codePlan: null, doubt: true, empty: true }), completed]],
  ] as const) {
    const restored = await hydrate([opening, ...tail]);
    assert.equal(restored.getState().mode, "complete", label);
    assert.equal(restored.getState().revealedChars[block.id], block.code.length, `${label}: completed recorded TYPE remains readable`);
  }
  const changed = { ...plan, title: "Changed code plan" };
  const changedCode = structuredClone(plan); changedCode.sections[0]!.blocks[0]!.code += "\n# changed source";
  const invalid = { ...turn("invalid", { continuation: question, codePlan: null, empty: true }), sceneArtifacts: { ...boardContinuationArtifacts(question), codeLesson: { ...plan, schemaVersion: "invalid" } } };
  for (const [label, tail] of [
    ["wrong page marker", [turn("wrong-page", { continuation: "Another page", codePlan: null, empty: true })]],
    ["changed plan", [turn("changed", { continuation: question, codePlan: changed, empty: true })]],
    ["changed source", [turn("changed-code", { continuation: question, codePlan: changedCode, empty: true })]],
    ["invalid plan", [invalid]],
    ["invalid then absent", [invalid, turn("after-invalid", { continuation: question, codePlan: null, empty: true })]],
    ["changed then absent", [turn("changed", { continuation: question, codePlan: changed, empty: true }), turn("after-changed", { continuation: question, codePlan: null, empty: true })]],
    ["completed doubt", [turn("doubt-complete", { continuation: question, codePlan: null, doubt: true, empty: true })]],
  ] as const) {
    const restored = await hydrate([stopped, ...tail]);
    assert.equal(restored.getState().mode, "lesson", `${label}: incompatible/ordinary doubt cannot complete stopped code`);
    assert.equal(restored.getState().revealedChars[block.id], 6, `${label}: completion cannot reveal unrecorded source`);
  }
  const noReceipt = await hydrate([stopped, turn("empty-complete", { continuation: question, codePlan: null, empty: true })]);
  assert.equal(noReceipt.getState().revealedChars[block.id], 6, "even a completion flag cannot fill missing TYPE receipts");
  const current = await hydrate([turn("older-complete"), turn("new-partial", { status: "stopped", partial: true })]);
  assert.equal(current.getState().mode, "lesson", "a new current page does not borrow earlier completion");
  assert.equal(current.getState().revealedChars[block.id], 6, "a new page does not borrow earlier code");
  const clear = await hydrate([stopped, turn("clear", { continuation: question, codePlan: null, clear: true, empty: true })]);
  assert.equal(clear.getState().plan, null, "CLEAR breaks same-page plan inheritance");
  console.log("verify-completed-code-resume: actual hydration/practice, partial/finality, legacy and page/plan boundaries complete");
}
const watchdog = setTimeout(() => { console.error("completed-code-resume did not reach explicit completion"); process.exitCode = 1; }, 10_000);
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
