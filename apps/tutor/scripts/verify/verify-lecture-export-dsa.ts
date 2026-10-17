/** Actual Download hook, export timeline, executor and Konva nodes; inert codecs/pixels only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { getSegmentCommands, parseStoredSegmentCommands, serializeSegmentCommands, verifiedDiagramCommandToDrawCommand, type DrawCommand } from "@heytutor/drawing";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { LECTURE_PAGE_CACHE_REVISION, lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { storedCodeLessonPlan } from "../../lib/code-lesson/persistedCodeLesson";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import type { LectureExportApi } from "../../features/tutor-session/hooks/useLectureExport";
import { measuredLesson } from "./fixtures/export/measuredLesson";
import type { exportLectureMp4, LectureExportResult } from "../../lib/lecture-export/exportLectureMp4";

const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const hooks = path.join(app, "features/tutor-session/hooks");
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
  useEffect: () => {}, useLayoutEffect: () => {}, useState: (v: unknown) => [typeof v === "function" ? v() : v, () => {}] };
type Module = Record<string, unknown>;
function hook(file: string, overrides: Module = {}): Module {
  const mod = { exports: {} as Module };
  const source = file === path.join(hooks, "useLectureExport.ts") ? process.env.DSA_EXPORT_HOOK_SOURCE ?? file :
    file === path.join(app, "lib/lecture-export/canExportLectureMp4.ts") ? process.env.DSA_EXPORT_CACHE_REVISION_SOURCE ?? file : file;
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
  // Ink style changes as live instruments move; the regression concerns the
  // compiled diagram's geometry, labels and frame ownership rather than paint.
  const geometry = new Set(["data", "points", "x", "y", "width", "height", "radius", "radiusX", "radiusY", "text", "fontSize"]);
  return board.getDrawLayer()!.getChildren().map(node => {
    const { className, attrs } = node.toObject();
    return JSON.stringify({ className, attrs: Object.fromEntries(Object.entries(attrs)
      .filter(([key]) => geometry.has(key))
      .sort(([a], [b]) => a.localeCompare(b))) });
  }).sort();
}

/** The pixel boundary retains semantic ink; the actual code renderer runs against this context. */
class Canvas {
  width = 1200; height = 700; ink: string[] = []; code: string[] = [];
  getContext() {
    const painter = {
      fillRect: (x: number, y: number, width: number, height: number) => {
        if (x === 0 && y === 0 && width === this.width && height === this.height) { this.ink = []; this.code = []; }
      },
      drawImage: (source: Canvas) => { this.ink = source.ink.slice(); this.code = source.code.slice(); },
      fillText: (text: string) => { this.code.push(text); },
      measureText: (text: string) => ({ width: text.length * 8 }),
      getImageData: () => ({ data: new Uint8ClampedArray(new TextEncoder().encode(JSON.stringify([this.ink, this.code]))) }),
    };
    return new Proxy(painter, { get: (target, name) => name in target ? target[name as keyof typeof target] : () => {} });
  }
}

const question = "Explain binary search. Example: nums = [2, 5, 8, 12, 16, 23, 38], target = 16.";
const plan = getMockCodeLessonPlan(question);
plan.sections.at(-1)!.blocks[0]!.code = "nums = [2, 5, 8, 12, 16, 23, 38]\nprint(binary_search(nums, 16))";
const walk = resolveDsaFrames(question, plan.diagramHint, plan);
assert(walk && walk.frames.length >= 4, "binary search fixture must have an opening, two range changes and a later result");
assert.equal(walk.frames[2]!.id, "probe2", "oracle is the third simulated binary-search frame");

function lesson(id: string, advances = 2, openingDurationMs = 20_000): StoredTurn {
  const first = walk!.frames[0]!.presentation;
  const source = walk!.scenes.frames[0]!;
  const typed: DrawCommand = { type: "TYPE", params: [], text: plan.sections[0]!.blocks[0]!.code,
    charPosition: 0, narrationBefore: "", shownChars: 6, semanticRef: { entityId: plan.sections[0]!.blocks[0]!.id } };
  const segments = [
    // Keep both short and long persisted openings: neither may leave recorded
    // FRAME advances behind when the bounded export tail settles.
    ...first.introSegments.map(segment => ({ narration: segment.narration, commands: getSegmentCommands(segment), trusted: true, durationMs: openingDurationMs })),
    { narration: "The function starts here.", commands: [typed], trusted: false, durationMs: 4_000 },
    ...Array.from({ length: advances }, () => ({ narration: "Compare the middle value and narrow the range.",
      commands: [{ type: "FRAME", params: [], charPosition: 0, narrationBefore: "" } as DrawCommand], trusted: false, durationMs: 4_000 })),
  ];
  const turn: StoredTurn = {
    id, orderIndex: 0, status: "complete", persistedStatus: "complete", kind: "lesson", question, rawResponse: "Recorded binary-search walk", speedMultiplier: 1, traceId: null,
    sceneDocument: { ...source.document, source: { ...source.document.source, question, nonMetric: walk!.nonMetric, representationTier: walk!.tier } },
    sceneEngineVersion: source.renderScene.engineVersion, validationReport: source.validationReport, visualStatus: "validated",
    sceneArtifacts: { codeLesson: structuredClone(plan), representationTier: walk!.tier, nonMetric: walk!.nonMetric },
    segments: segments.map((segment, orderIndex) => ({ id: `${id}-${orderIndex}`, orderIndex,
      narration: segment.narration, spokenText: segment.narration, audioUrl: null, durationMs: segment.durationMs, timings: null,
      command: serializeSegmentCommands(segment.commands, { trustedDiagramGeometry: segment.trusted }) })),
  };
  assert(storedCodeLessonPlan(turn.sceneArtifacts), "the saved CodeLessonPlan passes the real persisted-plan reader");
  return JSON.parse(JSON.stringify(turn)) as StoredTurn;
}

function continuation(id: string, kind: "doubt" | "resume"): StoredTurn {
  const opening = lesson(id, 0);
  return { ...opening, orderIndex: 1, kind, sceneDocument: null, visualStatus: "text_only",
    sceneArtifacts: boardContinuationArtifacts(question),
    segments: [{ id: `${id}-advance`, orderIndex: 0, narration: "Narrow the range again.", spokenText: "Narrow the range again.",
      command: { type: "FRAME", params: [], charPosition: 0, narrationBefore: "" }, audioUrl: null, durationMs: 4_000, timings: null }] };
}

async function expectedFrame(index: number): Promise<string[]> {
  const board = mountTestWhiteboard();
  try {
    const cancelRef = ref(false), fbdStarted = ref(true);
    const layout = (hook(path.join(hooks, "useBoardLayout.ts")).useBoardLayout as typeof import("../../features/tutor-session/hooks/useBoardLayout").useBoardLayout)({
      whiteboardRef: ref(board), cancelRef, fbdPhaseStartedRef: fbdStarted, liveQuestionRef: ref(question), viewportMode: "fixed" });
    const executor = (hook(path.join(hooks, "useCommandExecution.ts")).useCommandExecution as typeof import("../../features/tutor-session/hooks/useCommandExecution").useCommandExecution)({
      whiteboardRef: ref(board), cancelRef, speedRef: ref(1), boardLayoutRef: layout.boardLayoutRef,
      forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef, fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: fbdStarted,
      activeVerifiedDiagramRef: ref(walk!.frames[index]!.presentation.diagram), turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef,
      narrationSinceEpochRef: layout.narrationSinceEpochRef, cancellableDelay: async () => {}, forgetErasedTextRects: layout.forgetErasedTextRects,
      resetBoardLayout: layout.resetBoardLayout, resolveTextPlacement: layout.resolveTextPlacement, raceWithCancel: async <T>(value: Promise<T>) => value,
      inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1),
    });
    // Independent oracle: draw exactly the compiled frame named by saved FRAME receipts.
    // No restore controller, replay timeline, export completion helper or current export state.
    for (const command of walk!.frames[index]!.presentation.diagram.commands) {
      await executor.executeCommand(verifiedDiagramCommandToDrawCommand(command), { durationScale: 0, trustedDiagramGeometry: true, applyLayout: false });
    }
    return ink(board);
  } finally { unmountTestWhiteboard(board); }
}

async function download(turns: StoredTurn[], cancelAtFrame = false, cancelAtExpiredScene = false) {
  const board = mountTestWhiteboard();
  const frames: { ink: string[]; code: string[]; start: number; duration: number }[] = [];
  const executionTrace: { type: string; startMs: number; endMs?: number; durationScale?: number; trusted?: boolean }[] = [];
  let finalized = 0, downloaded = 0, cancelled = 0, frameCommands = 0;
  let result: LectureExportResult | undefined, failure: unknown;
  let api!: LectureExportApi;
  const cacheLookups: string[] = [];
  const oldCacheKeys = [6, 7].map(revision => lecturePageCacheKey(turns).replace(/@video\d+(?=\.|$)/, `@video${revision}`));
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const ownedSetTimeout = (fn: () => void, ms?: number) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
    timers.add(timer); return timer;
  };
  const ownedSetInterval = (fn: () => void, ms?: number) => {
    const timer = setInterval(fn, ms); timers.add(timer); return timer;
  };
  const ownedClearTimer = (timer: ReturnType<typeof setTimeout>) => { clearTimeout(timer); timers.delete(timer); };
  class BufferTarget { buffer = new ArrayBuffer(4); }
  class Output { addVideoTrack() {} addAudioTrack() {} async start() {} async finalize() { finalized++; } async cancel() { cancelled++; } }
  class CanvasSource { constructor(private canvas: Canvas) {} async add(start: number, duration: number) { frames.push({ ink: this.canvas.ink.slice(), code: this.canvas.code.slice(), start, duration }); } }
  class OfflineAudioContext { createBuffer() { return { copyToChannel() {} }; } }
  const source = process.env.DSA_EXPORT_SOURCE ?? path.join(app, "lib/lecture-export/exportLectureMp4.ts");
  const mod = { exports: {} as { exportLectureMp4: typeof exportLectureMp4 } };
  const context = vm.createContext({ module: mod, exports: mod.exports, require: (name: string) => {
    if (name === "mediabunny") return { CanvasSource, BufferTarget, Output, AudioBufferSource: class { async add() {} }, Quality: class {}, Mp4OutputFormat: class {}, WebMOutputFormat: class {} };
    if (name.startsWith("@/")) return requireApp(path.join(app, name.slice(2)));
    if (name.startsWith(".")) return requireApp(path.join(app, "lib/lecture-export", name));
    return requireApp(name);
  }, document: { createElement: () => new Canvas() }, Blob, DOMException, Error, console, performance,
    setTimeout: ownedSetTimeout, clearTimeout: ownedClearTimer, Uint8ClampedArray, Float32Array, ArrayBuffer, OfflineAudioContext });
  new vm.Script(ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText).runInContext(context);
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldPerformance = Object.getOwnPropertyDescriptor(globalThis, "performance");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: ownedSetTimeout, clearTimeout: ownedClearTimer,
    setInterval: ownedSetInterval, clearInterval: ownedClearTimer } });
  // Export media time is authoritative. Freeze only the ambient wall-clock
  // boundary so accidental TYPE wall-time waits fail regardless of host CPU
  // contention; the real export clock, timers and codec adapter still advance.
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => 0 } });
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    api = (hook(path.join(hooks, "useLectureExport.ts"), {
      "@/lib/lecture-export/exportLectureMp4": { supportsLectureMp4Encode: async () => true,
        exportLectureMp4: async (options: Parameters<typeof exportLectureMp4>[0]) => {
          try {
            result = await mod.exports.exportLectureMp4({ ...options,
              whiteboard: { ...options.whiteboard, captureFrame: () => { const canvas = new Canvas(); canvas.ink = ink(board); return canvas as unknown as HTMLCanvasElement; } },
              executeCommand: async (command, execution) => {
                const trace = { type: command.type, startMs: options.clock.now(), endMs: undefined as number | undefined, durationScale: execution?.durationScale, trusted: execution?.trustedDiagramGeometry };
                executionTrace.push(trace);
                if (command.type === "FRAME") { frameCommands++; if (cancelAtFrame) api.cancelDownload(); }
                if (cancelAtExpiredScene && trace.trusted && trace.durationScale === 0) api.cancelDownload();
                await options.executeCommand(command, execution);
                trace.endMs = options.clock.now();
              },
              profile: { container: "mp4", videoCodec: "avc", audioCodec: "pcm-s16", mimeType: "video/mp4", extension: "mp4" }, tailLimitMs: 8_000,
            });
            return result;
          } catch (error) { failure = error; throw error; }
          finally { complete(); }
        } },
      "@/lib/lecture-export/canExportLectureMp4": hook(path.join(app, "lib/lecture-export/canExportLectureMp4.ts")),
      "@/lib/lecture-export/lectureExportCache": {
        getCachedLectureExport: async (key: string) => {
          cacheLookups.push(key);
          return oldCacheKeys.includes(key) ? { blob: new Blob(["old frozen DSA video"]), mimeType: "video/mp4", extension: "mp4", noVoice: true, missingAudioCues: 0 } : null;
        }, rememberLectureExport: () => {},
      },
      "@/lib/lecture-export/downloadBlob": { downloadBlob: () => { downloaded++; complete(); } },
      "@/lib/client/exportNotesPdf": { notesPdfBlob: () => { throw Error("Video gate never requests PDF"); } },
    }).useLectureExport as typeof import("../../features/tutor-session/hooks/useLectureExport").useLectureExport)({
      storedTurnsRef: ref(turns), storedTurnsCount: turns.length, phase: "idle", sessionId: "dsa-export-gate" });
    api.exportBoardRef.current = board;
    api.downloadVideo();
    await Promise.race([done, new Promise((_, reject) => { watchdog = setTimeout(() => reject(Error("actual DSA Download hook did not finish")), 12_000); })]);
    for (let index = 0; index < 10; index++) await Promise.resolve();
    return { frames, finalized, downloaded, cancelled, frameCommands, result, failure, cacheLookups, oldCacheKeys, executionTrace };
  } finally {
    if (watchdog) clearTimeout(watchdog);
    api?.cancelDownload(); board.setTimeSource(null); unmountTestWhiteboard(board);
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (oldPerformance) Object.defineProperty(globalThis, "performance", oldPerformance); else Reflect.deleteProperty(globalThis, "performance");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
  }
}

async function cacheUpgradePrunesPreviousRevisions(): Promise<void> {
  const file = process.env.DSA_EXPORT_CACHE_SOURCE ?? path.join(app, "lib/lecture-export/lectureExportCache.ts");
  const cacheModule = { exports: {} as typeof import("../../lib/lecture-export/lectureExportCache") };
  const value = { blob: new Blob(["retained current export"]), mimeType: "video/mp4", extension: "mp4", noVoice: true, missingAudioCues: 0 };
  const currentVersion = Number(LECTURE_PAGE_CACHE_REVISION.slice("video".length));
  const currentKey = `page@1@${LECTURE_PAGE_CACHE_REVISION}`;
  const keys = ["page@1.25@video6", "page@1.25@video7", "page@1.25@video7.webm", "page@1.25@video8", "page@1.25@video8.webm", "page@1.25@video9", "page@1.25@video9.webm", "page@1@video10", "page@1@video10.webm", currentKey, `${currentKey}.webm`, `page@1@video${currentVersion + 1}`, "unrelated"];
  const rows = new Map(keys.map(key => [key, value]));
  let openedVersion: number | undefined;
  let finishUpgrade: (() => void) | undefined;
  const store = {
    openCursor: () => {
      const originalKeys = [...rows.keys()];
      let index = 0;
      const request = { result: null as null | { key: string; delete: () => void; continue: () => void }, onsuccess: undefined as (() => void) | undefined };
      const next = () => queueMicrotask(() => {
        const key = originalKeys[index++];
        request.result = key === undefined ? null : { key, delete: () => { rows.delete(key); }, continue: next };
        request.onsuccess?.();
        if (key === undefined) finishUpgrade?.();
      });
      next();
      return request;
    },
    get: (key: string) => {
      const request = { result: rows.get(key), onsuccess: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const db = { objectStoreNames: { contains: () => true }, close: () => {}, transaction: () => ({ objectStore: () => store }) };
  const indexedDb = { open: (_name: string, version: number) => {
    openedVersion = version;
    const request = { result: db, transaction: { objectStore: () => store }, onupgradeneeded: undefined as (() => void) | undefined, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => {
      // The browser opens only after the upgrade transaction's cursor finishes.
      finishUpgrade = () => queueMicrotask(() => request.onsuccess?.());
      request.onupgradeneeded?.();
    });
    return request;
  } };
  const context = vm.createContext({ module: cacheModule, exports: cacheModule.exports, Blob, indexedDB: indexedDb, require: (name: string) => {
    if (name === "./canExportLectureMp4") return hook(path.join(app, "lib/lecture-export/canExportLectureMp4.ts"));
    return requireApp(name);
  } });
  new vm.Script(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText).runInContext(context);
  const current = await cacheModule.exports.getCachedLectureExport(currentKey);
  assert.equal(openedVersion, currentVersion, "the actual IndexedDB cache upgrades past truncated and pitched files");
  assert.equal(current?.blob, value.blob, "the current valid cached file remains usable");
  assert.deepEqual([...rows.keys()], keys.slice(9), "the actual cache cursor deletes older video6/video7, pitched video8/video9, and pre-pointing video10 blobs, retaining current, future and unrelated keys");
}

async function main() {
  const fingerprint = (nodes: string[] | undefined) => createHash("sha256").update(JSON.stringify(nodes)).digest("hex");
  const expected = await Promise.all([0, 1, 2, 3].map(expectedFrame));
  const success = (outcome: Awaited<ReturnType<typeof download>>, advances: number) => {
    assert.equal(outcome.failure, undefined);
    assert.equal(outcome.finalized, 1, "completed DSA export publishes a file");
    assert.equal(outcome.downloaded, 1, "the actual Download hook offers the completed file");
    assert.equal(outcome.frameCommands, advances, "the persisted timeline executes every recorded range change");
    assert.equal(outcome.result?.tailTruncated, false, `the recorded walk finishes within the default bounded export tail: ${JSON.stringify(outcome.executionTrace.filter(command => command.type === "TYPE" || command.type === "FRAME"))}`);
    assert.ok(outcome.frames.at(-1)?.code.join("").includes("def bi"), "the exported code panel retains the recorded nonzero TYPE prefix");
    assert.equal(outcome.frames.at(-1)?.code.join("").includes("target):"), false, "the exported panel does not invent unrecorded code");
  };
  const shortSource = lesson("short-opening-two-range-changes", 2, 4_000);
  // The executor already freezes runtime ink preferences on command objects.
  // Compare the persisted replay semantics while excluding that existing cache.
  const savedSemantics = (segments: StoredTurn["segments"]) => JSON.stringify(segments, (key, value: unknown) => key === "inkSettings" ? undefined : value);
  const originalSavedCommands = savedSemantics(shortSource.segments);
  const shortOpening = await download([shortSource]);
  assert.equal(savedSemantics(shortSource.segments), originalSavedCommands, "export catch-up does not mutate saved commands or cue durations");
  assert.equal(shortOpening.finalized, 1, "a short opening regenerates the actual video instead of reusing an obsolete cache entry");
  assert.equal(fingerprint(shortOpening.frames.at(-1)?.ink), fingerprint(expected[2]),
    `a four-second opening reaches the recorded final probe2: ${JSON.stringify(shortOpening.executionTrace.filter(command => command.type === "TYPE" || command.type === "FRAME"))}`);
  success(shortOpening, 2);
  for (const [index, command] of shortOpening.executionTrace.filter(command => command.type === "FRAME").entries()) {
    const cueEndMs = (3 + index) * 4_000;
    assert.equal(command.durationScale === 0, command.startMs >= cueEndMs, "each recorded FRAME uses its own current cue deadline, including later cues on the same turn");
  }
  const shortOpeningMarks = shortOpening.executionTrace.filter(command => command.trusted);
  assert.ok(shortOpeningMarks.some(command => command.startMs < 4_000 && command.durationScale !== 0), "the opening animates while its recorded cue is active");
  assert.ok(shortOpeningMarks.some(command => command.startMs >= 4_000 && command.durationScale === 0), "remaining verified opening marks catch up after the short recorded cue ends");
  assert.ok(shortOpeningMarks.every(command => command.durationScale !== 0 || command.startMs >= 4_000), "catch-up never runs verified opening marks before their recorded deadline");
  const shortFinal = await download([lesson("short-opening-three-range-changes", 3, 4_000)]);
  success(shortFinal, 3);
  assert.equal(fingerprint(shortFinal.frames.at(-1)?.ink), fingerprint(expected[3]), "expired recorded FRAME advances still land on their own compiled final figure");
  assert.ok(shortFinal.executionTrace.some(command => command.type === "FRAME" && command.durationScale === 0), "a recorded FRAME whose cue expired uses the actual controller's catch-up path");
  const mixed = lesson("expired-trusted-work-and-focus", 2, 4_000);
  const mixedOpening = mixed.segments[0]!;
  const anchor = walk!.frames[0]!.presentation.diagram.anchors[0];
  assert(anchor, "the compiled opening supplies a real target for transient FOCUS");
  const work: DrawCommand = { type: "WRITE", params: [40, 142, 24], text: "range", charPosition: 0, narrationBefore: "" };
  const focus: DrawCommand = { type: "FOCUS", params: [], semanticRef: { entityId: anchor.id }, charPosition: 0, narrationBefore: "" };
  mixedOpening.command = serializeSegmentCommands([...parseStoredSegmentCommands(mixedOpening.command), work, focus], { trustedDiagramGeometry: true });
  const mixedVideo = await download([mixed]);
  success(mixedVideo, 2);
  const workTrace = mixedVideo.executionTrace.find(command => command.type === "WRITE");
  const focusTrace = mixedVideo.executionTrace.find(command => command.type === "FOCUS");
  assert(workTrace && workTrace.startMs >= 4_000, "the actual mixed trusted WRITE runs after its opening cue expired");
  assert.equal(workTrace.durationScale, undefined, "expired narrated work keeps its real glyph schedule rather than scene catch-up");
  assert.ok((workTrace.endMs ?? workTrace.startMs) > workTrace.startMs, "the actual glyph executor still writes the expired work");
  assert(focusTrace && focusTrace.startMs >= 4_000, "the actual mixed FOCUS runs after its opening cue expired");
  assert.equal(focusTrace.durationScale, undefined, "transient FOCUS keeps its normal presentation behavior");
  for (const kind of ["resume", "doubt"] as const) {
    const standalone = lesson(`standalone-first-${kind}`);
    standalone.kind = kind;
    standalone.sceneArtifacts = { ...(standalone.sceneArtifacts as Record<string, unknown>), ...boardContinuationArtifacts(question) };
    const openingMissing = await download([standalone]);
    success(openingMissing, 2);
    assert.equal(fingerprint(openingMissing.frames.at(-1)?.ink), fingerprint(expected[2]), `a first retained ${kind} with its own saved plan and figure restores the walk when the original opening is absent`);
  }
  const full = await download([lesson("two-range-changes")]);
  success(full, 2);
  assert.equal(fingerprint(full.frames.at(-1)?.ink), fingerprint(expected[2]), "DSA MP4 terminal board reaches probe2 after two saved FRAME commands instead of freezing on probe0");
  assert.ok(full.cacheLookups.length === 1 && !full.oldCacheKeys.includes(full.cacheLookups[0]!), "the actual Download hook invalidates the prior frozen video6 and truncated video7 cache entries");

  // Older persisted DSA figures can lack the later synthesizedDsa stamp. Its
  // opening scene then restores with the generic layout; completion must read
  // the current controller figure rather than releasing stale opening marks.
  const legacy = lesson("legacy-scene-stamp", 2, 4_000);
  const legacyDocument = legacy.sceneDocument as { source: Record<string, unknown> };
  delete legacyDocument.source.synthesizedDsa;
  const legacyVideo = await download([legacy]);
  success(legacyVideo, 2);
  assert.equal(fingerprint(legacyVideo.frames.at(-1)?.ink), fingerprint(expected[2]), "completion follows the advanced DSA figure even when the stored opening has legacy scene metadata");

  for (const kind of ["doubt", "resume"] as const) {
    const continued = await download([lesson(`${kind}-opening`, 1, 4_000), continuation(`${kind}-tail`, kind)]);
    success(continued, 2);
    assert.equal(fingerprint(continued.frames.at(-1)?.ink), fingerprint(expected[2]), `${kind} retains the current same-page frame and advances it instead of restarting its walk`);
  }
  const nextPage = { ...lesson("new-independent-question", 1, 4_000), orderIndex: 1 };
  const pages = await download([lesson("older-page", 2, 4_000), nextPage]);
  success(pages, 3);
  assert.equal(fingerprint(pages.frames.at(-1)?.ink), fingerprint(expected[1]), "a new independent page resets the controller and its figure without borrowing the previous page's advances");

  const stopped = await download([{ ...lesson("stopped-subset", 1, 4_000), status: "stopped", persistedStatus: "stopped" }]);
  success(stopped, 1);
  assert.equal(fingerprint(stopped.frames.at(-1)?.ink), fingerprint(expected[1]), "a stopped saved lesson exports exactly its recorded frame subset");
  assert.notEqual(fingerprint(stopped.frames.at(-1)?.ink), fingerprint(expected[3]), "a stopped saved lesson never flushes an unrecorded terminal result");

  const aborted = await download([lesson("cancel-during-advance")], true);
  assert.equal((aborted.failure as { name?: string } | undefined)?.name, "AbortError");
  assert.equal(aborted.frameCommands, 1, "Cancel interrupts the first recorded frame advance");
  assert.equal(aborted.finalized, 0, "a cancelled DSA export never finalizes a file");
  assert.equal(aborted.downloaded, 0, "the actual Download hook offers no cancelled file");
  assert.ok(aborted.cancelled >= 1, "the real export cancels its codec adapter");
  const expiredCancelled = await download([lesson("cancel-expired-opening", 2, 4_000)], false, true);
  assert.equal((expiredCancelled.failure as { name?: string } | undefined)?.name, "AbortError", "expired scene catch-up still honors current export cancellation");
  assert.equal(expiredCancelled.frameCommands, 0, "cancelled opening cannot advance a later recorded frame");
  assert.equal(expiredCancelled.finalized, 0);
  assert.equal(expiredCancelled.downloaded, 0);
  assert.ok(expiredCancelled.cancelled >= 1);
  const unrelated = measuredLesson("non-code-expired-scene");
  const unrelatedVideo = await download([unrelated]);
  assert.equal(unrelatedVideo.failure, undefined);
  assert.equal(unrelatedVideo.finalized, 1);
  assert.equal(unrelatedVideo.downloaded, 1);
  assert.equal(unrelatedVideo.result?.tailTruncated, false);
  const unrelatedOpening = unrelatedVideo.executionTrace.slice(0, parseStoredSegmentCommands(unrelated.segments[0]!.command).length);
  assert.ok(unrelatedOpening.some(command => command.startMs >= 100), "the independent measured-span intro includes a real mark after its cue deadline");
  assert.ok(unrelatedOpening.every(command => command.durationScale !== 0), "export catch-up does not change a non-code verified intro's pacing");
  await cacheUpgradePrunesPreviousRevisions();
  console.log("verify-lecture-export-dsa: 15 actual hook/export/cache groups (standalone resume/doubt, two FRAME advances + code, old cache, legacy completion, doubt/resume retention, new page, stopped subset, cancellation)");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
