/** Drives the actual runner against controlled TTS/executor boundaries, with the real save registry. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import type { DrawCommand, TutorSegment } from "@heytutor/drawing";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";
const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const defer = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};
function fixture() {
  const ref = <T>(current: T) => ({ current });
  const cancelRef = ref(false);
  let prefetch = 0;
  const speech = defer<void>();
  let speechOptions: { onStart?: () => void; onEnd?: () => void } | null = null;
  const tts = {
    getPlaybackRate: () => 1,
    getPlaybackPositionMs: () => 1,
    getAudioContextState: () => "running",
    prefetchSegment: () => {
      prefetch++;
    },
    speakSegment: async (_text: string, options: typeof speechOptions) => {
      speechOptions = options;
      await speech.promise;
      options?.onEnd?.();
    },
    stop() {},
    resume() {},
    abandonSpeaking() {},
  };
  const registry = new LiveTurnSaveRegistry({
    transport: {
      checkpoint: async () => ({
        ok: false,
        status: 403,
        error: "offline fixture",
        reason: "forbidden",
        retryable: false,
      }),
      close: async () => ({
        ok: false,
        status: 403,
        error: "offline fixture",
        reason: "forbidden",
        retryable: false,
      }),
    },
    mintId: () => "turn",
    now: () => 1000,
    isOnline: () => true,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  registry.begin({
    owner: cancelRef,
    generation: 1,
    boardId: "board",
    traceId: null,
    kind: "resume",
    question: "lesson",
    preview: "lesson",
    speedMultiplier: 1,
    continuesBoard: true,
  });
  const executed = defer<ExecuteCommandOptions>();
  const draw = defer<void>();
  let failDraw = false;
  const params = {
    sessionId: "board",
    cancelRef,
    turnGenerationRef: ref(1),
    turnActiveRef: ref(true),
    isPausedRef: ref(false),
    activeVerifiedDiagramRef: ref(null),
    turnTelemetryRef: ref(null),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }),
    recordedSegmentsRef: ref([]),
    narrationSinceEpochRef: ref(""),
    currentTraceIdRef: ref(null),
    narrationDensityRef: ref(0),
    drawChainRef: ref(Promise.resolve()),
    ensureTTSClient: () => tts,
    cancellableDelay: async () => {},
    raceWithCancel: <T>(job: Promise<T>) => job,
    applyTurnPhase: () => {},
    setCurrentSegmentText: () => {},
    reserveTextCommandPlacements: async (command: DrawCommand) => [command],
    executeCommandWithCancel: async (
      _command: DrawCommand,
      options: ExecuteCommandOptions,
    ) => {
      executed.resolve(options);
      await draw.promise;
      if (failDraw) throw Error("executor failed");
    },
  };
  const filename = path.join(
    app,
    "features/tutor-session/hooks/turn/useSegmentRunner.ts",
  );
  const js = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const hookModule = {
    exports: {} as {
      useSegmentRunner: (params: unknown) => {
        runSegment: (
          s: TutorSegment,
          i: number,
          all: TutorSegment[],
          g: number,
        ) => Promise<void>;
      };
    },
  };
  const localRequire = (id: string) => {
    if (id === "react")
      return {
        useRef: (current: unknown) => ({ current }),
        useCallback: (fn: unknown) => fn,
      };
    if (id === "../../lib/turn/liveTurnSave")
      return { liveTurnSave: () => registry };
    if (id === "@heytutor/drawing")
      return { ...requireApp(id), prefetchStrokePaths: async () => {} };
    return requireApp(
      id.startsWith(".") ? path.resolve(path.dirname(filename), id) : id,
    );
  };
  new Function("require", "module", "exports", js)(
    localRequire,
    hookModule,
    hookModule.exports,
  );
  return {
    runner: hookModule.exports.useSegmentRunner(params),
    registry,
    params,
    executed,
    draw,
    speech,
    get speechOptions() {
      return speechOptions;
    },
    get prefetch() {
      return prefetch;
    },
    fail: () => {
      failDraw = true;
    },
  };
}
const write: DrawCommand = {
  type: "WRITE",
  text: "x = 2",
  params: [90, 145, 28],
  charPosition: 0,
  narrationBefore: "",
};
async function main() {
  Object.defineProperty(globalThis, "window", {
    value: { setTimeout, clearTimeout },
    configurable: true,
  });
  // Silent draw queued/prepared but not revealed: no first cut. The callback is actual executor options.
  for (const shown of [false, true]) {
    const h = fixture();
    const segment: TutorSegment = { narration: "", command: write };
    const job = h.runner.runSegment(
      segment,
      0,
      [segment, { narration: "future prefetch", command: null }],
      1,
    );
    const options = await h.executed.promise;
    assert.equal(
      h.prefetch,
      1,
      "lookahead TTS preparation never establishes shown ownership",
    );
    if (shown) options.onInkStarted!();
    h.registry.pageHideClose();
    h.params.cancelRef.current = true;
    h.draw.resolve();
    await job;
    const snapshot = h.registry.reopen("board");
    assert.equal(
      snapshot.length,
      shown ? 1 : 0,
      "only actual ink callback creates first interrupted row",
    );
    if (shown) {
      assert.equal(snapshot[0]!.rows[0]!.audioBytes, null);
      assert.equal(
        h.params.recordedSegmentsRef.current.length,
        0,
        "late finally cannot duplicate captured row",
      );
    }
  }
  // Heard voice is evidence; prefetched/generated audio before accepted onStart is not.
  for (const [shown, intro] of [
    [false, false],
    [true, false],
    [true, true],
  ]) {
    const h = fixture();
    const segment: TutorSegment = {
      narration: "The first explanation.",
      command: null,
      ...(intro ? { verifiedDiagramIntro: true } : {}),
    };
    const job = h.runner.runSegment(segment, 0, [segment], 1);
    await tick();
    assert(h.speechOptions, "real runner reached the controlled TTS boundary");
    if (shown) h.speechOptions.onStart!();
    h.registry.pageHideClose();
    h.params.cancelRef.current = true;
    h.speech.resolve();
    await job.catch((error) => {
      if (shown) throw error;
    });
    const snapshot = h.registry.reopen("board");
    assert.equal(
      snapshot.length,
      shown && !intro ? 1 : 0,
      "accepted voice makes a cut; no-start and uncommitted verified intro remain excluded",
    );
    if (shown && !intro) {
      assert.equal(snapshot[0]!.rows[0]!.narration, "The first explanation.");
      assert.equal(snapshot[0]!.rows[0]!.audioBytes, null);
    }
  }
  const failure = fixture();
  const segment: TutorSegment = { narration: "", command: write };
  const job = failure.runner.runSegment(segment, 0, [segment], 1);
  const options = await failure.executed.promise;
  options.onInkStarted!();
  failure.fail();
  failure.draw.resolve();
  await assert.rejects(job, /executor failed/);
  failure.registry.closeOwner(failure.params.cancelRef);
  assert.equal(
    failure.registry.reopen("board")[0]!.rows.length,
    1,
    "draw failure without cancel keeps actual shown first work",
  );
  console.log(
    "verify-lesson-segment-capture: actual runner queued/prefetch vs observed ink/voice, failure cuts, pagehide idempotency and atomic intro",
  );
}
const watchdog = setTimeout(() => {
  throw Error("consumer probe did not settle");
}, 10_000);
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
