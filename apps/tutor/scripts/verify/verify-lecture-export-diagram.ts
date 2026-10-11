/** Actual export/timeline/executor and Konva nodes; only codec and pixel adapters are inert. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { parseStoredSegmentCommands, verifiedDiagramCommandToDrawCommand, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts, storedTurnContinuesBoard } from "../../lib/boards/boardContinuation";
import { buildLectureExportSource } from "../../lib/lecture-export/lectureExportSource";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import { measuredLesson } from "./fixtures/export/measuredLesson";

const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const hooks = path.join(app, "features/tutor-session/hooks");
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useEffect: () => {}, useLayoutEffect: () => {}, useState: (v: unknown) => [typeof v === "function" ? v() : v, () => {}] };
// These are actual hook bodies with inert React reconciliation, not alternate executors.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Hook = Record<string, any>;
function hook(file: string, overrides: Record<string, unknown> = {}): Hook {
  const mod = { exports: {} as Hook };
  const source = file === path.join(hooks, "useLectureExport.ts") ? process.env.EXPORT_HOOK_SOURCE ?? file : file;
  const code = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (name in overrides) return overrides[name];
    if (name === "react") return react;
    if (name.startsWith("@/")) return requireApp(path.join(app, name.slice(2)));
    if (name.startsWith(".")) {
      const resolved = path.resolve(path.dirname(file), name);
      return resolved.startsWith(hooks) ? hook(`${resolved}.ts`, overrides) : requireApp(resolved);
    }
    return requireApp(name);
  }, mod, mod.exports);
  return mod.exports;
}
function ink(board: ReturnType<typeof mountTestWhiteboard>): string[] {
  return board.getDrawLayer()!.getChildren().map(node => {
    const { className, attrs } = node.toObject();
    return JSON.stringify({ className, attrs: Object.fromEntries(Object.entries(attrs)
      .filter(([key, value]) => !key.startsWith("ht") && key !== "id" && !(key === "dash" && Array.isArray(value) && value.length === 0))
      .sort(([a], [b]) => a.localeCompare(b))) });
  }).sort();
}
class Canvas {
  width = 1200; height = 700; ink: string[] = [];
  getContext() {
    return { fillStyle: "", fillRect: () => { this.ink = []; }, drawImage: (source: Canvas) => { this.ink = source.ink.slice(); },
      getImageData: () => ({ data: new TextEncoder().encode(JSON.stringify(this.ink)) }) };
  }
}

async function exportPage(turns: StoredTurn[], cancelAtMark = false, throughDownloadHook = false) {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  const diagramRef = ref<VerifiedDiagram | null>(null);
  const cancelRef = ref(false);
  const fbdStarted = ref(false);
  const layout = hook(path.join(hooks, "useBoardLayout.ts")).useBoardLayout({ whiteboardRef: ref(board), cancelRef, fbdPhaseStartedRef: fbdStarted, liveQuestionRef: ref("") });
  const executor = hook(path.join(hooks, "useCommandExecution.ts")).useCommandExecution({
    whiteboardRef: ref(board), cancelRef, speedRef: ref(1), boardLayoutRef: layout.boardLayoutRef,
    forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef, fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: fbdStarted,
    activeVerifiedDiagramRef: diagramRef, turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef,
    narrationSinceEpochRef: layout.narrationSinceEpochRef, cancellableDelay: async () => {},
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout,
    resolveTextPlacement: layout.resolveTextPlacement, raceWithCancel: async <T>(value: Promise<T>) => value,
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.source.now,
  });
  const commands: string[] = [];
  const execute = async (command: DrawCommand, options: Record<string, unknown> = {}) => {
    commands.push(command.semanticRef?.primitiveId ?? command.text ?? command.type);
    if (cancelAtMark && command.semanticRef?.primitiveId?.includes("length")) cancelRef.current = true;
    await executor.executeCommand(command, { ...options, durationScale: 0 });
  };
  const frames: { ink: string[]; start: number; duration: number }[] = [];
  let finalized = 0;
  const exportModule = { exports: {} as { exportLectureMp4: (options: unknown) => Promise<{ tailTruncated: boolean }> } };
  class BufferTarget { buffer = new ArrayBuffer(4); }
  class Output { addVideoTrack() {} addAudioTrack() {} async start() {} async finalize() { finalized++; } async cancel() {} }
  class CanvasSource { constructor(private canvas: Canvas) {} async add(start: number, duration: number) { frames.push({ ink: this.canvas.ink.slice(), start, duration }); } }
  class OfflineAudioContext {
    createBuffer() { return { copyToChannel() {} }; }
  }
  const sourcePath = process.env.EXPORT_DIAGRAM_SOURCE ?? path.join(app, "lib/lecture-export/exportLectureMp4.ts");
  const transpiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = vm.createContext({ module: exportModule, exports: exportModule.exports, require: (name: string) => {
    if (name === "mediabunny") return { CanvasSource, BufferTarget, Output, AudioBufferSource: class { async add() {} }, Quality: class {}, Mp4OutputFormat: class {}, WebMOutputFormat: class {} };
    if (name.startsWith("@/")) return requireApp(path.join(app, name.slice(2)));
    if (name.startsWith(".")) return requireApp(path.join(app, "lib/lecture-export", name));
    return requireApp(name);
  }, document: { createElement: () => new Canvas() }, Blob, DOMException, Error, console, performance, setTimeout, clearTimeout, Uint8ClampedArray, Float32Array, ArrayBuffer, OfflineAudioContext });
  new vm.Script(transpiled).runInContext(context);
  let result: { tailTruncated: boolean } | null = null, failure: unknown;
  try {
    const captureBoard = { ...board, captureFrame: () => { const canvas = new Canvas(); canvas.ink = ink(board); return canvas; } };
    const profile = { container: "mp4", videoCodec: "avc", audioCodec: "pcm-s16", mimeType: "video/mp4", extension: "mp4" };
    if (throughDownloadHook) {
      const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
      Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0) } });
      let downloaded!: () => void;
      const done = new Promise<void>(resolve => { downloaded = resolve; });
      try {
        const api = hook(path.join(hooks, "useLectureExport.ts"), {
          "@/lib/lecture-export/exportLectureMp4": {
            supportsLectureMp4Encode: async () => true,
            // The real Download hook calls the real exporter. Only the codec
            // profile and capture adapter are deterministic; callback and
            // layout reset wiring cannot be supplied by this test wrapper.
            exportLectureMp4: async (options: Record<string, unknown>) => {
              result = await exportModule.exports.exportLectureMp4({ ...options, profile, tailLimitMs: 8_000 });
              return result;
            },
          },
          "@/lib/lecture-export/lectureExportCache": { getCachedLectureExport: async () => null, rememberLectureExport: () => {} },
          "@/lib/lecture-export/downloadBlob": { downloadBlob: downloaded },
          "@/lib/client/exportNotesPdf": { notesPdfBlob: () => { throw new Error("Video gate never requests PDF"); } },
        }).useLectureExport({ storedTurnsRef: ref(turns), storedTurnsCount: turns.length, phase: "idle", sessionId: "real-export-hook-gate" });
        api.exportBoardRef.current = captureBoard;
        api.downloadVideo();
        await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("real Download hook/exporter did not finish")), 8_000))]);
      } finally {
        if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
      }
    } else result = await exportModule.exports.exportLectureMp4({
      turn: turns.at(-1), pageTurns: turns, whiteboard: { ...board, captureFrame: () => { const canvas = new Canvas(); canvas.ink = ink(board); return canvas; } },
      executeCommand: execute, clock, shouldCancel: () => cancelRef.current, resetBoardLayout: layout.resetBoardLayout,
      onTurnStart: (_turn: StoredTurn, diagram: VerifiedDiagram | null) => { diagramRef.current = diagram; fbdStarted.current = Boolean(diagram); },
      profile: { container: "mp4", videoCodec: "avc", audioCodec: "pcm-s16", mimeType: "video/mp4", extension: "mp4" }, tailLimitMs: 8_000,
    });
    // Independent oracle: full compiler ink for completed pages, recorded intro
    // ink for partial pages, and the retained narrated work. No completion helper.
    await board.clearBoard(); layout.resetBoardLayout(false, false);
    board.setTimeSource(clock.source);
    const oracleCommand = async (command: DrawCommand, options: Record<string, unknown>) => {
      // The native Download executor animates FOCUS while the standalone
      // adapter uses instant FOCUS. Preserve that native annotation ink style
      // in the independent oracle rather than deleting style from comparison.
      let done = false;
      const drawing = executor.executeCommand(command, { ...options, durationScale: throughDownloadHook && command.type === "FOCUS" ? 1 : 0 }) as Promise<void>;
      void drawing.finally(() => { done = true; });
      for (let index = 0; !done && index < 100; index++) { clock.advance(1_000); clock.pump(); await new Promise<void>(resolve => setImmediate(resolve)); }
      assert(done, "independent native oracle completes its retained ink");
      await drawing;
    };
    let previous: StoredTurn | undefined;
    for (const turn of turns) {
      if (previous && !storedTurnContinuesBoard(turn)) { await board.clearBoard(); layout.resetBoardLayout(false, false); }
      if (!storedTurnContinuesBoard(turn)) {
        const diagram = restoreVerifiedDiagramFromTurn(turn);
        // The independent oracle owns a fresh restored figure. Export FOCUS
        // has consumed its runtime's deferred list; never reuse that state.
        diagramRef.current = turn.visualStatus === "validated" ? diagram : null;
        fbdStarted.current = Boolean(diagramRef.current);
        const completed = turn.status !== "live" && turn.status !== "stopped";
        if (diagram && turn.visualStatus === "validated") {
          for (const command of completed ? diagram.commands.map(verifiedDiagramCommandToDrawCommand) : turn.segments.flatMap(segment => parseStoredSegmentCommands(segment.command)).filter(command => command.type !== "WRITE")) {
            await oracleCommand(command, { trustedDiagramGeometry: true, applyLayout: false });
          }
        }
      }
      for (const command of turn.segments.flatMap(segment => parseStoredSegmentCommands(segment.command)).filter(command => command.type === "WRITE")) {
        await oracleCommand(command, { applyLayout: false });
      }
      previous = turn;
    }
    return { result, finalInk: frames.at(-1)?.ink, expected: ink(board), commands, frames, finalized, failure };
  } catch (error) { failure = error; return { result, finalInk: frames.at(-1)?.ink, expected: [], commands, frames, finalized, failure }; }
  finally { cancelRef.current = true; clock.pump(); unmountTestWhiteboard(board); }
}

/** The actual Download hook must publish its restored diagram to its real executor. */
async function exportHookKeepsVerifiedDiagram(): Promise<void> {
  const board = mountTestWhiteboard();
  const turn = { ...measuredLesson("hook-focus"), status: "stopped" as const };
  let activeClock = createVirtualWhiteboardClock();
  let downloaded!: () => void;
  const done = new Promise<void>(resolve => { downloaded = resolve; });
  const timer = setInterval(() => { activeClock.advance(1_000); activeClock.pump(); }, 1);
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0) } });
  try {
    const api = hook(path.join(hooks, "useLectureExport.ts"), {
      "@/lib/lecture-export/exportLectureMp4": {
        supportsLectureMp4Encode: async () => true,
        // Encoding is the adapter here; callback and command execution are
        // the real hook consumer. A stopped figure must be revealable by FOCUS
        // while never receiving a terminal-completion flush.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        exportLectureMp4: async (options: any) => {
          activeClock = options.clock;
          options.whiteboard.setTimeSource(activeClock.source);
          options.onTurnStart(options.turn, restoreVerifiedDiagramFromTurn(options.turn));
          await options.executeCommand({ type: "FOCUS", text: "length", params: [], charPosition: 0, narrationBefore: "", semanticRef: { entityId: "length" } }, { durationScale: 0, applyLayout: false });
          return { blob: new Blob(["fixture"]), mimeType: "video/mp4", extension: "mp4", noVoice: true, missingAudioCues: 0, tailTruncated: false, totalMs: 100 };
        },
      },
      "@/lib/lecture-export/lectureExportCache": { getCachedLectureExport: async () => null, rememberLectureExport: () => {} },
      "@/lib/lecture-export/downloadBlob": { downloadBlob: downloaded },
      "@/lib/client/exportNotesPdf": { notesPdfBlob: () => { throw new Error("Video gate never requests PDF"); } },
    }).useLectureExport({ storedTurnsRef: ref([turn]), storedTurnsCount: 1, phase: "idle", sessionId: "export-hook-gate" });
    api.exportBoardRef.current = board;
    api.downloadVideo();
    await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error("actual Download hook did not finish")), 5_000))]);
    assert.ok(ink(board).length >= 4, "actual Download hook publishes the verified diagram so FOCUS retains its measurement bar, witnesses and label");
  } finally {
    clearInterval(timer); board.setTimeSource(null); unmountTestWhiteboard(board);
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
  }
}

async function main() {
  const success = (outcome: Awaited<ReturnType<typeof exportPage>>) => {
    assert.equal(outcome.failure, undefined);
    assert.equal(outcome.finalized, 1, "expected-success exports publish a file");
    assert.equal(outcome.result?.tailTruncated, false, "expected-success exports finish retained ink within the tail");
    assert.ok(outcome.finalInk?.some(node => node.includes('"stroke":"#222222"')), "expected-success exports retain their narrated work");
  };
  const complete = measuredLesson();
  assert.equal(lecturePageCacheKey([complete]).endsWith("@video5"), false, "previous videos missing completed figure marks must be invalidated");
  const focusedPartial: StoredTurn = {
    ...complete, id: "stopped-focused-measurement", status: "stopped",
    segments: [
      ...complete.segments.slice(0, -1),
      { ...complete.segments.at(-1)!, id: "retained-focus", orderIndex: complete.segments.length - 1,
        command: { type: "FOCUS", text: "length", params: [], charPosition: 0, narrationBefore: "", semanticRef: { entityId: "length" } } },
      { ...complete.segments.at(-1)!, orderIndex: complete.segments.length },
    ],
  };
  const focused = await exportPage([focusedPartial]);
  success(focused);
  assert.deepEqual(focused.finalInk, focused.expected, "real exporter publishes its diagram before retained FOCUS marks in a stopped lesson");
  assert(focused.commands.includes("length"), "stopped fixture actually dispatches recorded FOCUS");


  const full = await exportPage([complete]);
  success(full);
  assert.equal(full.failure, undefined);
  assert.deepEqual(full.finalInk, full.expected, "MP4 terminal frame retains the full compiled figure and final work row");
  assert.equal(full.result!.tailTruncated, false);
  assert.ok(full.commands.some(command => command.includes("length") && command.includes("label")), "unnamed length label reaches export executor");
  for (const status of ["live", "stopped"] as const) {
    const saved = await exportPage([{ ...complete, status }]);
    success(saved);
    assert.equal(saved.failure, undefined);
    assert.deepEqual(saved.finalInk, saved.expected, `${status} export keeps only the figure marks that were actually shown`);
    const snapshotBuilder = process.env.EXPORT_SNAPSHOT_SOURCE ? requireApp(process.env.EXPORT_SNAPSHOT_SOURCE).buildLectureExportSource as typeof buildLectureExportSource : buildLectureExportSource;
    const snapshot = snapshotBuilder({ storedTurns: [], liveTurn: { ...complete, status, segments: complete.segments.map(segment => ({ ...segment, audioBytes: null })) } });
    const local = await exportPage(snapshot.turns);
    success(local);
    assert.equal(local.failure, undefined);
    assert.deepEqual(local.finalInk, saved.finalInk, `${status} in-tab snapshot must preserve partial completion authority`);
  }

  const later = { ...measuredLesson("second", false), orderIndex: 1 };
  const pages = await exportPage([complete, later]);
  const last = await exportPage([later]);
  success(pages); success(last);
  assert.equal(pages.failure, undefined); assert.equal(last.failure, undefined);
  assert.deepEqual(pages.finalInk, last.finalInk, "new question without stored CLEAR resets export page and its verified figure");
  const hookPages = await exportPage([complete, later], false, true);
  success(hookPages);
  assert.deepEqual(hookPages.finalInk, last.finalInk, "real Download hook passes layout reset through the real exporter for independent page work rows");
  const hookFocused = await exportPage([focusedPartial], false, true);
  success(hookFocused);
  assert.deepEqual(hookFocused.finalInk, hookFocused.expected, "real Download hook and exporter preserve the stopped student's native FOCUS marks");

  const doubt: StoredTurn = { ...complete, id: "doubt", orderIndex: 1, kind: "doubt", sceneDocument: null, visualStatus: "text_only",
    sceneArtifacts: boardContinuationArtifacts(complete.question), segments: [{ ...complete.segments.at(-1)!, id: "doubt-row", command: { type: "WRITE", params: [30, 180, 24], text: "d = L", charPosition: 0, narrationBefore: "" } }] };
  const continued = await exportPage([complete, doubt]);
  success(continued);
  assert.equal(continued.failure, undefined);
  assert.deepEqual(continued.finalInk, continued.expected, "doubt retains opening figure and both work rows without duplicate final marks");
  const interrupted = { ...complete, status: "stopped" as const };
  const stoppedDoubt = await exportPage([interrupted, doubt]);
  success(stoppedDoubt);
  assert.equal(stoppedDoubt.failure, undefined);
  assert.equal(stoppedDoubt.commands.some(command => command.includes("length") && command.includes("label")), false, "complete doubt cannot finish interrupted opening figure");
  const resume = { ...doubt, kind: "resume" as const, question: complete.question, sceneDocument: complete.sceneDocument, visualStatus: "validated" as const };
  const resumed = await exportPage([interrupted, resume]);
  success(resumed);
  assert.equal(resumed.failure, undefined);
  assert.deepEqual(resumed.finalInk, continued.finalInk, "compatible completed resume ends on the completed original figure");
  const wrongPage = await exportPage([interrupted, { ...resume, sceneArtifacts: boardContinuationArtifacts("Another question") }]);
  success(wrongPage);
  assert.equal(wrongPage.failure, undefined);
  assert.equal(wrongPage.commands.some(command => command.includes("length") && command.includes("label")), false, "mismatched resume cannot finish another page's figure");
  const invalid = await exportPage([{ ...complete, sceneDocument: { schemaVersion: "invalid" }, visualStatus: "retry_required" }]);
  success(invalid);
  assert.deepEqual(invalid.finalInk, invalid.expected, "invalid scene retains the exact recorded work board");
  assert.equal(invalid.failure, undefined); assert.equal(invalid.finalized, 1); assert.ok(invalid.finalInk!.length > 0, "invalid figure still exports retained work");
  assert.equal(invalid.commands.some(command => command.includes("length") && command.includes("label")), false, "invalid scene invents no final figure marks");
  const unvalidated = await exportPage([{ ...complete, visualStatus: "retry_required" }]);
  success(unvalidated);
  const workInk = (nodes: string[] | undefined) => nodes?.filter(node => node.includes('"stroke":"#222222"'));
  assert.deepEqual(workInk(unvalidated.finalInk), workInk(unvalidated.expected), "unvalidated scene retains exact recorded work ink");
  assert.equal(unvalidated.failure, undefined); assert.equal(unvalidated.finalized, 1); assert.ok(unvalidated.finalInk!.length > 0, "unvalidated figure still exports retained work");
  assert.equal(unvalidated.commands.some(command => command.includes("length") && command.includes("label")), false, "unvalidated scene receives no terminal completion");
  const cancelled = await exportPage([complete], true);
  assert.equal((cancelled.failure as { name: string }).name, "AbortError");
  assert.equal(cancelled.finalized, 0, "cancellation during final figure completion never publishes a completed video");
  await exportHookKeepsVerifiedDiagram();
  console.log("verify-lecture-export-diagram: 17 actual export groups (full figure/work, saved and local partials, pages, doubts, resumes, source validation, cancellation, Download hook FOCUS and real exporter/layout wiring)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
