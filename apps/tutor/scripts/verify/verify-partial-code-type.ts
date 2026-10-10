/** Actual code/save/canonicalizer/executor/Continue chain for interrupted TYPE. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { storedCodeLessonSegmentCommands } from "../../lib/code-lesson/persistedCodeLesson";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { buildCodeLessonExportTrack, codeLessonFrameSpec } from "../../lib/lecture-export/codeLessonExportTrack";
import { appendCodeLessonNotesImages } from "../../lib/code-render/codeLessonNotesImages";
import { CODE_RENDER_METRICS } from "../../lib/code-render/renderCodeToCanvas";
import { CodeLessonController, codeTypingCharOffsetsMs } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { createCodeLessonConductor, fullyRevealedBlockIds } from "../../features/tutor-session/lib/code-lesson/codeLessonSegments";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { resumePageRecord } from "../../features/tutor-session/lib/turn/doubtTurn";
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
async function hydrate(turn: StoredTurn): Promise<CodeLessonController> {
  const controller = new CodeLessonController();
  const execute = executor(controller);
  const file = path.join(app, "features/tutor-session/hooks/useBoardSession.ts");
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const effects: Array<() => void> = [];
  const empty = new LiveTurnSaveRegistry({ transport: { checkpoint: async () => { throw Error("no save in hydration fixture"); }, close: async () => { throw Error("no close in hydration fixture"); } },
    mintId: () => "unused", now: () => 0, isOnline: () => true, setTimer: () => 0, clearTimer() {} });
  const mod = { exports: {} as { useBoardSession: (params: unknown) => { storedTurnsRef: { current: StoredTurn[] }; settleBoardRestore: () => Promise<void> } } };
  let fetched = 0;
  new Function("require", "module", "exports", js)((id: string) => {
    if (id === "react") return { useRef: ref, useCallback: (fn: unknown) => fn, useState: (initial: unknown) => [initial, () => {}],
      useEffect: (fn: () => void) => effects.push(fn), useLayoutEffect: (fn: () => void) => fn(), useSyncExternalStore: (_listen: unknown, get: () => unknown) => get() };
    if (id.endsWith("/turn/liveTurnSave")) return { ...requireApp(path.join(app, "features/tutor-session/lib/turn/liveTurnSave")), liveTurnSave: () => empty };
    if (id === "@/lib/boards/boardsClient") return { ...requireApp(id), fetchBoardDetail: async () => { fetched++; return { turns: [turn] }; }, createBoard: async () => { throw Error("existing fixture must not create a board"); } };
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
  assert.equal(board.storedTurnsRef.current.length, 1);
  await board.settleBoardRestore();
  return controller;
}
function assertNotesPrefix(turn: StoredTurn, expected: string, future: string) {
  const original = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
    const texts: string[] = []; const canvas = { width: 0, height: 0 };
    const ctx = new Proxy({ fillText: (text: string, x: number, y: number) => {
      if (x >= CODE_RENDER_METRICS.gutterWidth + CODE_RENDER_METRICS.codeLeftPadding && y > CODE_RENDER_METRICS.sectionBarHeight && y < canvas.height / 2 - CODE_RENDER_METRICS.statusBarHeight) texts.push(text);
    }, measureText: (text: string) => ({ width: text.length * 8 }) }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {}, set: () => true });
    return Object.assign(canvas, { getContext: () => ctx, toDataURL: () => texts.join("") });
  } } });
  try {
    const sections = [{ question: turn.question, images: [] as string[], workLines: [], narration: "", planFacts: [], interrupted: true }];
    appendCodeLessonNotesImages(sections, [turn]);
    assert(sections[0]!.images.join("").includes(expected), "actual notes renderer retains explicit recorded prefix without audio timings");
    assert(!sections[0]!.images.join("").includes(future), "actual notes renderer omits future queued source");
  } finally { Object.defineProperty(globalThis, "document", { configurable: true, value: original }); }
}
async function main() {
  const question = "Explain binary search on a sorted array.";
  const plan = getMockCodeLessonPlan(question);
  const block = plan.sections[0]!.blocks[0]!;
  const controller = new CodeLessonController(); controller.commit(plan);
  const owner = {}; const page = resumePageRecord({ boardId: "board", lessonQuestion: question, figureDrawn: false, turnPlan: null, solverProjection: null,
    scene: { sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: { codeLesson: plan } } });
  const registry = new LiveTurnSaveRegistry({ transport: {
    checkpoint: async () => ({ ok: false, status: 403, error: "offline", reason: "forbidden", retryable: false }),
    close: async () => ({ ok: false, status: 403, error: "offline", reason: "forbidden", retryable: false }),
  }, mintId: () => "partial-code", now: () => 1000, isOnline: () => true, setTimer: () => 1, clearTimer() {} });
  registry.begin({ owner, generation: 1, boardId: "board", traceId: null, kind: "resume", question, preview: question, speedMultiplier: 1, continuesBoard: true, page });
  const command = { type: "TYPE" as const, params: [], text: block.code, charPosition: 0, narrationBefore: "", semanticRef: { entityId: block.id } };
  const token = registry.prepareSegment(owner, 1, { orderIndex: 0, narration: "Explain this function.", spokenText: "Explain this function.", command,
    audioBytes: null, durationMs: null, timings: null }, Object.assign({ intro: false }, { getTypeShownChars: (id: string) => controller.getState().revealedChars[id] ?? 0 }));
  assert(token); token.markShown();
  let time = 0; let cancelled = false; let shownAtStop = 0;
  await controller.typeBlock(block.id, { clock: () => time, shouldCancel: () => cancelled, delay: async () => {
    time += 120;
    if (time >= 720) {
      shownAtStop = controller.getState().revealedChars[block.id] ?? 0;
      registry.captureShown(owner); registry.pageHideClose(); cancelled = true;
    }
  } });
  assert(shownAtStop > 0 && shownAtStop < block.code.length, "virtual speech clock reaches a real partial prefix before Stop");
  const snapshot = registry.reopen("board")[0]!;
  assert(snapshot && snapshot.rows.length === 1, "synchronous Stop captures exactly one shown row");
  const canonical = await canonicalizeTurnSceneMetadata({ question, visualStatus: "text_only", sceneArtifacts: { codeLesson: plan },
    segments: snapshot.rows.map(row => ({ orderIndex: row.orderIndex, narration: row.narration, spokenText: row.spokenText, command: row.command })) });
  assert(canonical.ok);
  const stored: StoredTurn = { id: "saved", orderIndex: 0, question, rawResponse: "Explain this function.", speedMultiplier: 1, traceId: null,
    ...canonical.value, status: "stopped", persistedStatus: "stopped", segments: canonical.value.segments.map((row, index) => ({ ...row, command: serializeSegmentCommands(parseStoredSegmentCommands(row.command)), id: `saved-${index}`, durationMs: null, timings: null, audioUrl: null })) };
  const restored = new CodeLessonController(); restored.commit(plan);
  const run = executor(restored);
  for (const cmd of parseStoredSegmentCommands(canonical.value.segments[0]!.command)) await run.executeCommand(cmd, { durationScale: 0 });
  assert.equal(restored.getState().revealedChars[block.id], shownAtStop, "reload must restore only characters shown before interrupted TYPE, never its full queued command");
  assert.equal(controller.getState().revealedChars[block.id], shownAtStop, "cancellation itself must not fill unseen source characters");
  assert.equal((await hydrate(stored)).getState().revealedChars[block.id], shownAtStop, "actual saved-board consumer restores the same shown prefix");
  assertNotesPrefix(stored, block.code.slice(0, shownAtStop), block.code.slice(shownAtStop, shownAtStop + 15));
  const timeline = buildReplayTimeline([stored]);
  const track = buildCodeLessonExportTrack(stored, timeline.cues); assert(track);
  assert.equal(track.blocks[0]!.charAppearMs.length, shownAtStop, "MP4 cannot schedule unseen characters from the full queued command");
  assert.equal(codeLessonFrameSpec(track, Number.POSITIVE_INFINITY).code.slice(0, codeLessonFrameSpec(track, Number.POSITIVE_INFINITY).revealedChars), block.code.slice(0, shownAtStop), "terminal export frame is the shown prefix");
  for (const [status, durationMs, count] of [["stopped", null, 0], ["complete", null, block.code.length], ["stopped", 1000, block.code.length]] as const) {
    const legacy = { ...stored, status, persistedStatus: status, segments: [{ ...stored.segments[0]!, durationMs, command }] };
    assert.equal((await hydrate(legacy)).getState().revealedChars[block.id] ?? 0, count, `${status}/${durationMs}: actual hydration applies honest legacy compatibility`);
    const replayed = new CodeLessonController(); replayed.commit(plan);
    const replay = executor(replayed);
    for (const cmd of buildReplayTimeline([legacy]).cues[0]!.commands) await replay.executeCommand(cmd, { durationScale: 0 });
    assert.equal(replayed.getState().revealedChars[block.id] ?? 0, count, "replay seek and hydration agree for legacy TYPE");
    assert.deepEqual(storedCodeLessonSegmentCommands(legacy, legacy.segments[0]!).map(cmd => cmd.type), ["TYPE"]);
  }
  for (const [count, expected] of [[-1, 0], [10000, block.code.length], [3, 3]] as const) {
    const normalized = await canonicalizeTurnSceneMetadata({ question, visualStatus: "text_only", sceneArtifacts: { codeLesson: plan }, segments: [{ orderIndex: 0, narration: "", spokenText: "", command: { ...command, shownChars: count } }] });
    assert(normalized.ok);
    assert.equal(parseStoredSegmentCommands(normalized.value.segments[0]!.command)[0]!.shownChars, expected, "valid integer receipts clamp to their validated source block");
  }
  for (const shownChars of ["6", 2.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const normalized = await canonicalizeTurnSceneMetadata({ question, visualStatus: "text_only", sceneArtifacts: { codeLesson: plan }, segments: [{ orderIndex: 0, narration: "", spokenText: "", command: { ...command, shownChars } }] });
    assert(normalized.ok);
    assert.equal(parseStoredSegmentCommands(normalized.value.segments[0]!.command).length, 0, "malformed receipt never falls back to an unbounded TYPE command");
  }
  // A genuine silent executor observation occurs on its first visible character.
  const silent = new CodeLessonController(); silent.commit(plan); silent.revealPanel();
  let cancelledSilent = false; let observedInk = 0;
  const silentRun = executor(silent, async () => {});
  await silentRun.executeCommand(command, { onInkStarted: () => { observedInk++; cancelledSilent = true; }, isCancelled: () => cancelledSilent });
  assert.equal(observedInk, 1, "actual TYPE executor reports first shown character once without requiring voice");
  assert((silent.getState().revealedChars[block.id] ?? 0) > 0 && (silent.getState().revealedChars[block.id] ?? 0) < block.code.length);
  // Count and pacing use the renderer's UTF-16 units, including a surrogate cut.
  const unicodePlan = structuredClone(plan);
  unicodePlan.sections[0]!.blocks[0]!.code += "\n# 😀 after";
  const unicodeBlock = unicodePlan.sections[0]!.blocks[0]!;
  const unicodeCommand = { ...command, text: unicodeBlock.code };
  const surrogateIndex = unicodeBlock.code.indexOf("😀");
  assert(codeTypingCharOffsetsMs(unicodeBlock.code, 1000).every(Number.isFinite), "non-BMP source cannot poison the pacing clock");
  for (const shownChars of [surrogateIndex + 1, surrogateIndex + 2]) {
    const normalized = await canonicalizeTurnSceneMetadata({ question, visualStatus: "text_only", sceneArtifacts: { codeLesson: unicodePlan }, segments: [{ orderIndex: 0, narration: "", spokenText: "", command: { ...unicodeCommand, shownChars } }] });
    assert(normalized.ok);
    const unicode = new CodeLessonController(); unicode.commit(unicodePlan);
    for (const cmd of parseStoredSegmentCommands(normalized.value.segments[0]!.command)) await executor(unicode).executeCommand(cmd, { durationScale: 0 });
    assert.equal(unicode.getState().revealedChars[block.id], shownChars, "UTF-16 receipt restores the exact renderer boundary even inside a surrogate pair");
  }
  const errorCut = new CodeLessonController(); errorCut.commit(plan);
  await assert.rejects(errorCut.typeBlock(block.id, { clock: () => 0, delay: async () => { throw Error("clock stopped"); } }), /clock stopped/);
  assert.equal(errorCut.getState().revealedChars[block.id], 1, "failed typing cannot reveal queued future source");
  const missingBlock = await canonicalizeTurnSceneMetadata({ question, visualStatus: "text_only", sceneArtifacts: { codeLesson: plan }, segments: [{ orderIndex: 0, narration: "", spokenText: "", command: { ...command, semanticRef: { entityId: "other-plan-block" }, shownChars: block.code.length } }] });
  assert(missingBlock.ok);
  assert.equal(parseStoredSegmentCommands(missingBlock.value.segments[0]!.command).length, 0, "receipt cannot reveal a block absent from its validated plan");
  const already = fullyRevealedBlockIds(plan, restored.getState().revealedChars);
  assert(!already.includes(block.id), "Continue must still owe the interrupted block");
  const conductor = createCodeLessonConductor(plan, { alreadyRevealedBlockIds: already });
  assert(conductor.status().missingBlockIds.includes(block.id));
  const continued = conductor.resolve([{ narration: "Finish this function.", command }]);
  assert(continued.segments.some(segment => parseStoredSegmentCommands(segment.command).some(cmd => cmd.type === "TYPE" && cmd.semanticRef?.entityId === block.id)), "actual Continue conductor retains the partial block");
  const reveals: number[] = []; restored.subscribe(() => reveals.push(restored.getState().revealedChars[block.id] ?? 0));
  let resumeTime = 0;
  await restored.typeBlock(block.id, { clock: () => resumeTime, delay: async () => { resumeTime += 1000; } });
  assert.equal(restored.getState().revealedChars[block.id], block.code.length, "Continue finishes the remainder");
  assert(reveals.every(count => count >= shownAtStop), "Continue never erases its previously shown prefix");
  const completedResume: StoredTurn = { ...stored, id: "resumed", orderIndex: 1, status: "complete", persistedStatus: "complete", segments: [{ ...stored.segments[0]!, id: "resumed-0", command, durationMs: null }] };
  const cumulative = buildReplayTimeline([stored, completedResume]);
  const resumedTrack = buildCodeLessonExportTrack(stored, cumulative.cues); assert(resumedTrack);
  const finalFrame = codeLessonFrameSpec(resumedTrack, Number.POSITIVE_INFINITY);
  assert.equal(finalFrame.code.slice(0, finalFrame.revealedChars), block.code, "later completed TYPE finishes a prior partial block in export without losing its first prefix");
  console.log("verify-partial-code-type: actual shown cut survives canonical save, restore and Continue remainder");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
