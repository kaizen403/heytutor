/** Actual Download hook cache-hit path keeps the warning attached to the cached file. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { StoredTurn } from "../../lib/boards/boardsClient";
const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const cache = requireApp(
  "./lib/lecture-export/lectureExportCache",
) as typeof import("../../lib/lecture-export/lectureExportCache");
const sourceModule = requireApp(
  "./lib/lecture-export/lectureExportSource",
) as typeof import("../../lib/lecture-export/lectureExportSource");
const profile = requireApp(
  "./lib/lecture-export/canExportLectureMp4",
) as typeof import("../../lib/lecture-export/canExportLectureMp4");
async function main() {
  for (const [noVoice, missingAudioCues, note, historicalCut] of [
    [true, 1, "no-voice", false],
    [false, 1, "some-voice-missing", false],
    [false, 0, null, false],
    [false, 1, "some-voice-missing", true],
  ] as const) {
    const turn: StoredTurn = {
      id: `cached-${note}-${historicalCut}`,
      orderIndex: 0,
      question: "lesson",
      rawResponse: "heard line",
      speedMultiplier: 1,
      traceId: null,
      status: "complete",
      persistedStatus: "complete",
      sceneDocument: null,
      sceneEngineVersion: null,
      validationReport: null,
      visualStatus: "text_only",
      sceneArtifacts: null,
      segments: [
        {
          id: "row",
          orderIndex: 0,
          narration: "heard line",
          spokenText: "heard line",
          command: null,
          audioUrl: null,
          durationMs: 1000,
          timings: null,
        },
      ],
    };
    const older = {
      ...turn,
      id: "earlier-cut",
      orderIndex: -1,
      status: "stopped" as const,
      persistedStatus: "stopped" as const,
    };
    const turns = historicalCut ? [older, turn] : [turn];
    const liveTurn = historicalCut
      ? {
          ...older,
          segments: [
            {
              ...older.segments[0]!,
              narration: "shown silent cut",
              audioBytes: null,
            },
          ],
        }
      : null;
    const source = sourceModule.buildLectureExportSource({
      storedTurns: turns,
      liveTurn,
    });
    assert.equal(
      source.partial,
      false,
      "completed current tail permits complete filename/cache despite earlier cut",
    );
    const key = profile.lecturePageCacheKey(source.turns, "mp4");
    const obsoleteKey = key.replace(/@video\d+$/, "@video4");
    cache.rememberLectureExport(obsoleteKey, {
      blob: new Blob(["old video with full queued TYPE revealed"], { type: "video/mp4" }),
      mimeType: "video/mp4", extension: "mp4", noVoice: true, missingAudioCues: 1,
    });
    assert.equal(await cache.getCachedLectureExport(key), null,
      "a cached pre-prefix TYPE video cannot bypass current recorded-reveal semantics");
    const blob = new Blob(["same encoded video bytes"], { type: "video/mp4" });
    cache.rememberLectureExport(key, {
      blob,
      mimeType: "video/mp4",
      extension: "mp4",
      noVoice,
      missingAudioCues,
    });
    const states: unknown[] = [];
    let downloads = 0;
    let delivered: Blob | null = null;
    const ref = (current: unknown) => ({ current });
    const react = {
      useRef: ref,
      useCallback: (fn: unknown) => fn,
      useEffect: () => {},
      useState: (initial: unknown) => [
        initial,
        (value: unknown) => states.push(value),
      ],
    };
    const filename = path.join(
      app,
      "features/tutor-session/hooks/useLectureExport.ts",
    );
    const js = ts.transpileModule(
      readFileSync(
        process.env.LESSON_EXPORT_HOOK_TEST_SOURCE ?? filename,
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    const hookModule = {
      exports: {} as {
        useLectureExport: (input: unknown) => { downloadVideo: () => void };
      },
    };
    const overrides: Record<string, unknown> = {
      "@/lib/lecture-export/lectureExportCache": cache,
      "@/lib/lecture-export/downloadBlob": {
        downloadBlob: (value: Blob) => {
          downloads++;
          delivered = value;
        },
      },
      "./useBoardLayout": {
        useBoardLayout: () => ({
          boardLayoutRef: ref({ rects: [] }),
          notesEpochsRef: ref([]),
          narrationSinceEpochRef: ref(""),
          forceSequentialWorkLayoutRef: ref(false),
          resetBoardLayout: () => {},
          forgetErasedTextRects: () => {},
          resolveTextPlacement: () => {},
        }),
      },
      "./useCancelControl": {
        useCancelControl: () => ({
          raceWithCancel: <T>(job: Promise<T>) => job,
          clearCancelTimers: () => {},
        }),
      },
      "./useCommandExecution": {
        useCommandExecution: () => ({
          executeCommandWithCancel: async () => {
            throw Error("cache hit must not render/encode");
          },
        }),
      },
      "@/lib/lecture-export/exportLectureMp4": {
        exportLectureMp4: async () => {
          throw Error("cache hit must not encode");
        },
        supportsLectureMp4Encode: async () => {
          throw Error("cache hit must not need codec probe");
        },
      },
    };
    const localRequire = (id: string) =>
      id === "react"
        ? react
        : id in overrides
          ? overrides[id]
          : requireApp(
              id.startsWith(".")
                ? path.resolve(path.dirname(filename), id)
                : id,
            );
    new Function("require", "module", "exports", js)(
      localRequire,
      hookModule,
      hookModule.exports,
    );
    const hook = hookModule.exports.useLectureExport({
      storedTurnsRef: { current: turns },
      storedTurnsCount: turns.length,
      getLiveTurn: () => liveTurn,
      phase: "idle",
      sessionId: "board",
      lectureFileType: "mp4",
    });
    hook.downloadVideo();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(downloads, 1);
    assert.equal(delivered, blob, "cached download returns the same file");
    const done = states.find(
      (state): state is { kind: "done"; note: unknown } =>
        typeof state === "object" &&
        state !== null &&
        "kind" in state &&
        state.kind === "done",
    );
    assert(done, "actual hook settles Download");
    assert.equal(
      done.note,
      note,
      "cache-hit notice matches missing-voice evidence of original file",
    );
  }
  await actualPartialCodePdf();
  console.log(
    "verify-lesson-export-cache: actual Download cache hit retains no-voice/some-missing notices and complete-voice control",
  );
}
async function actualPartialCodePdf() {
  requireApp("./lib/code-render/codeLessonNotesImages");
  const { CODE_RENDER_METRICS } = requireApp("./lib/code-render/renderCodeToCanvas");
  const core = requireApp("@heytutor/tutor-core");
  const plan = core.getMockCodeLessonPlan("Explain binary search on a sorted array.");
  const { CodeLessonController } = requireApp("./features/tutor-session/lib/code-lesson/codeLessonController");
  const controller = new CodeLessonController(); controller.commit(plan);
  const first = plan.sections[0].blocks[0]; const prefix = first.code.slice(0, 5);
  controller.getState().revealedChars[first.id] = prefix.length;
  const turn: StoredTurn = {
    id: "partial-code", orderIndex: 0, question: plan.question, rawResponse: "shown so far",
    speedMultiplier: 1, traceId: null, status: "stopped", persistedStatus: "stopped",
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: { codeLesson: plan }, segments: [],
  };
  const original = { window: globalThis.window, document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame };
  const paints: Array<() => void> = []; const deliveries: string[][] = []; let captured = 0;
  const ref = (current: unknown) => ({ current });
  const react = { useRef: ref, useCallback: (fn: unknown) => fn, useEffect() {}, useState: (initial: unknown) => [initial, () => {}] };
  const load = (relative: string, overrides: Record<string, unknown>) => {
    const filename = path.join(app, relative);
    const source = relative.endsWith("useLectureExport.ts") ? process.env.LESSON_EXPORT_HOOK_TEST_SOURCE ?? filename : filename;
    const js = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} as Record<string, (...args: unknown[]) => unknown> };
    new Function("require", "module", "exports", js)((id: string) => id === "react" ? react : id in overrides ? overrides[id] : requireApp(id.startsWith(".") ? path.resolve(path.dirname(filename), id) : id), mod, mod.exports);
    return mod.exports;
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: (fn: () => void) => { fn(); return 0; } } });
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (fn: () => void) => { paints.push(fn); return paints.length; } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
    const texts: string[] = [];
    const canvas = { width: 0, height: 0 };
    const ctx = new Proxy({ fillText: (text: string, x: number, y: number) => {
      if (x >= CODE_RENDER_METRICS.gutterWidth + CODE_RENDER_METRICS.codeLeftPadding && y > CODE_RENDER_METRICS.sectionBarHeight && y < canvas.height / 2 - CODE_RENDER_METRICS.statusBarHeight) texts.push(text);
    }, measureText: (text: string) => ({ width: text.length * 8 }) }, {
      get: (target, key) => key in target ? target[key as keyof typeof target] : () => {}, set: () => true,
    });
    return Object.assign(canvas, { getContext: () => ctx, toDataURL: () => texts.join("") });
  } } });
  try {
    const replayModule = load("features/tutor-session/hooks/useReplay.ts", {});
    const replay = replayModule.useReplay({
      whiteboardRef: ref({ captureSnapshot: () => { captured++; return "board-at-click"; } }),
      notesEpochsRef: ref([]), narrationSinceEpochRef: ref("shown so far"), liveQuestionRef: ref(plan.question),
      storedTurnsRef: ref([turn]), codeLessonControllerRef: ref(controller), replayCueRef: ref(null), phaseRef: ref("teaching"),
    }) as { collectNotesSlides: () => Promise<string[]> };
    const exportModule = load("features/tutor-session/hooks/useLectureExport.ts", {
      "./useBoardLayout": { useBoardLayout: () => ({ boardLayoutRef: ref({ rects: [] }), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""), forceSequentialWorkLayoutRef: ref(false), resetBoardLayout() {}, forgetErasedTextRects() {}, resolveTextPlacement() {} }) },
      "./useCancelControl": { useCancelControl: () => ({ raceWithCancel: <T>(p: Promise<T>) => p, clearCancelTimers() {} }) },
      "./useCommandExecution": { useCommandExecution: () => ({ executeCommandWithCancel() {} }) },
      "@/lib/client/exportNotesPdf": { notesPdfBlob: (images: string[]) => { deliveries.push(images); return new Blob(["pdf"]); } },
      "@/lib/lecture-export/downloadBlob": { downloadBlob() {} },
    });
    const download = exportModule.useLectureExport({ storedTurnsRef: ref([turn]), storedTurnsCount: 1, phase: "teaching", sessionId: "board", collectNotesSlides: replay.collectNotesSlides }) as { downloadNotesPdf: () => void };
    download.downloadNotesPdf();
    assert.equal(captured, 1, "actual PDF hook freezes board/code before the first paint yield");
    controller.getState().revealedChars[first.id] = first.code.length;
    for (let i = 0; i < 30; i++) { paints.shift()?.(); await Promise.resolve(); }
    assert.equal(deliveries.length, 1, "actual PDF consumer produces a file");
    assert.equal(deliveries[0]!.length, 2, "partial code contributes one shown section plus the board");
    assert(deliveries[0]![1]!.includes(prefix), "actual replay collector passes the captured visible prefix");
    assert(!deliveries[0]![1]!.includes(first.code.slice(5, 15)), "typing after the click cannot enter the partial PDF");
  } finally {
    for (const [key, value] of Object.entries(original)) Object.defineProperty(globalThis, key, { configurable: true, value });
  }
}
const watchdog = setTimeout(() => {
  throw Error("cache consumer did not settle");
}, 10_000);
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
