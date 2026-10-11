/** Started speech must still report terminal failure through the real turn queue. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import type { SpeakSegmentOptions, TTSClient } from "@heytutor/tutor-core";
import type { TutorSegment } from "@heytutor/drawing";
import { parseStoredSegmentCommands } from "@heytutor/drawing";
import type { ExecuteCommandOptions, UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const runnerPath = path.join(app, "features/tutor-session/hooks/turn/useSegmentRunner.ts");
const controlPath = path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts");
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const narration = "Force equals mass times acceleration.";
const segment: TutorSegment = { narration, command: {
  type: "WRITE", text: "F = ma", params: [90, 142], charPosition: 0, narrationBefore: narration,
} };
type Outcome = "stall" | "reject" | "success" | "pending";
type Job = { options: SpeakSegmentOptions; resolve: () => void; reject: (error: Error) => void; outcome: Outcome };

/** Controlled render/clock/media ports; real runner, ink planner, queue and save registry. */
function mount(position: number | null, outcomes: Outcome[] = [], deferFirstDraw = false) {
  let now = 1_000, sequence = 0, mint = 0, browserAttempts = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const jobs: Job[] = [], drawn: string[] = [], errors: Array<{ message: string; question: string }> = [];
  const telemetry: Array<{ name: string; [key: string]: unknown }> = [];
  let rejectOldDraw: ((error: Error) => void) | null = null;
  const original = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const setTimer = (run: () => void, delay = 0): number => {
    const id = ++sequence; timers.set(id, { at: now + delay, run }); return id;
  };
  const clearTimer = (id: number) => { timers.delete(id); };
  replace("performance", { now: () => now });
  replace("setTimeout", setTimer); replace("clearTimeout", clearTimer);
  replace("window", { setTimeout: setTimer, clearTimeout: clearTimer });
  replace("fetch", () => { throw new Error("gate forbids network/provider dispatch"); });
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  const advance = async (target: number) => {
    await flush();
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].run(); await flush();
    }
    now = target; await flush();
  };
  const timings = { totalDuration: 2, charStartTimes: [...core.mathToSpeech(narration)].map((_, i) => i * .04),
    charDurations: [...core.mathToSpeech(narration)].map(() => .04) };
  const tts = {
    speakSegment: (_text: string, options: SpeakSegmentOptions) => new Promise<void>((resolve, reject) => {
      const outcome = outcomes[jobs.length] ?? "pending";
      jobs.push({ options, resolve, reject, outcome });
      options.onTimings?.(outcome === "pending" ? { ...timings, totalDuration: 60 } : timings); options.onStart?.();
      if (outcome === "success") setTimer(() => { options.onEnd?.(); resolve(); }, 1_000);
      else if (outcome === "reject") setTimer(() => reject(new Error("offline primary failed after start")), 200);
    }),
    getPlaybackPositionMs: () => position, getPlaybackRate: () => 1.25,
    peekSegmentTimings: () => timings, prefetchSegment: noop, abandonSpeaking: noop, stop: noop,
  } as unknown as TTSClient;
  const registry = new LiveTurnSaveRegistry({ transport: {
    checkpoint: async () => { throw new Error("gate forbids persistence transport"); },
    close: async () => { throw new Error("gate forbids persistence transport"); },
  }, now: () => now, isOnline: () => false, mintId: () => `offline-${++mint}`,
  setTimer: (fn, ms) => setTimer(fn, ms), clearTimer: id => clearTimer(id as number) });
  class BrowserVoice {
    setPlaybackRate() {} stop() {} pause() {} resume() {}
    async speakSegment() { browserAttempts++; throw new Error("started primary must not start browser recovery"); }
  }
  const cache = new Map<string, Record<string, unknown>>();
  const load = (file: string): Record<string, unknown> => {
    const cached = cache.get(file); if (cached) return cached;
    const sourceFile = file === runnerPath ? process.env.STARTED_SPEECH_RUNNER_SOURCE ?? file
      : file === controlPath ? process.env.STARTED_SPEECH_CONTROL_SOURCE ?? file : file;
    const compiled = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", compiled)((specifier: string) => {
      if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn,
        useEffect: noop, useState: (value: unknown) => [value, noop] };
      if (specifier === "@heytutor/tutor-core") return { ...core, tutorDebug: noop, SpeechSynthesisTTSClient: BrowserVoice };
      if (specifier.endsWith("/liveTurnSave")) return { liveTurnSave: () => registry };
      if (specifier === "./useSegmentRunner") return load(runnerPath);
      return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
    }, mod, mod.exports);
    cache.set(file, mod.exports); return mod.exports;
  };
  const params = {
    sessionId: "offline-started-speech", phase: "speaking", isReplaying: false, boardLoaded: false, enableKeyboardControls: false,
    whiteboardRef: ref(null), boardPageRef: ref(null), boardShowsStoppedReplayRef: ref(false),
    pendingQuestionRef: ref(null), autoSubmitDoneRef: ref(null), phaseRef: ref("speaking"),
    isPausedRef: ref(false), rewoundRef: ref(false), conversationHistoryRef: ref([]), liveQuestionRef: ref("Explain force."),
    ttsClientRef: ref(tts), ensureTTSClient: () => tts, currentTraceIdRef: ref(null),
    replayAudioRef: ref(null), replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()),
    cancelRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1), turnAbortRef: ref(null),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()), collectedSegmentsRef: ref<TutorSegment[]>([]),
    recordedSegmentsRef: ref<UseTurnLifecycleParams["recordedSegmentsRef"]["current"]>([]), narrationSinceEpochRef: ref(""),
    activeVerifiedDiagramRef: ref(null), fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false),
    segmentPlanStatsRef: ref({}), stopTurnRef: ref(null), replayGenerationRef: ref(0), replayCueRef: ref(null),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), narrationDensityRef: ref(0),
    turnTelemetryRef: ref({ mark: (name: string, data: Record<string, unknown>) => telemetry.push({ name, ...data }),
      span: () => ({ end: noop }) }),
    setPhase: noop, setIsPaused: noop, setNarrationText: noop, setCurrentSegmentText: noop, setInputInteracted: noop,
    setLastError: (error: { message: string; question: string }) => errors.push(error),
    onError: (error: { message: string; question: string }) => telemetry.push({ name: "student-error", ...error }),
    setIsReplaying: noop, setReplayProgressMs: noop, setReplayTotalMs: noop, clearCancelTimers: noop,
    pendingSegmentCountRef: ref(0), boardLayoutRef: ref({ rects: [], nextY: 142 }),
    cancellableDelay: (ms: number) => new Promise<void>(resolve => setTimer(resolve, ms)),
    raceWithCancel: async <T,>(promise: Promise<T>) => promise,
    reserveTextCommandPlacements: async (command: NonNullable<TutorSegment["command"]>) => [command],
    executeCommandWithCancel: async (command: NonNullable<TutorSegment["command"]>, options: ExecuteCommandOptions) => {
      if (options.isCancelled?.()) return;
      drawn.push(command.text ?? command.type); options.onInkStarted?.();
      if (deferFirstDraw && drawn.length === 1) await new Promise<void>((_resolve, reject) => { rejectOldDraw = reject; });
    },
  };
  const begin = () => registry.begin({ owner: params.cancelRef, generation: params.turnGenerationRef.current,
    boardId: params.sessionId, traceId: null, kind: "lesson", question: "Explain force.", preview: "Explain force.",
    speedMultiplier: 1, continuesBoard: false });
  const handle = begin();
  const runnerHooks = load(runnerPath) as unknown as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner");
  const controlHooks = load(controlPath) as unknown as typeof import("../../features/tutor-session/hooks/turn/useTurnControl");
  const runner = runnerHooks.useSegmentRunner({ ...params, applyTurnPhase: noop } as unknown as Parameters<typeof runnerHooks.useSegmentRunner>[0]);
  const control = controlHooks.useTurnControl(params as unknown as UseTurnLifecycleParams, ref(async () => {}));
  return { params, control, runner, handle, begin, jobs, drawn, errors, telemetry, registry, flush, advance,
    now: () => now, browserAttempts: () => browserAttempts,
    rejectOldDraw: () => { assert(rejectOldDraw, "real old draw entered its asynchronous port"); rejectOldDraw(new Error("obsolete asynchronous ink failed")); },
    close: () => { for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    } },
  };
}

async function runnerFailure(position: number | null, outcome: Outcome) {
  const h = mount(position, [outcome]);
  try {
    const promise = h.runner.runSegment(segment, 0, [segment], 1).then(() => null, error => error as unknown);
    await h.advance(h.now() + 9_000);
    const result = await promise;
    assert(result instanceof Error, "an onStart accepted primary failure must reach the actual caller, even with positive/zero/missing media clock");
    assert.match(result.message, outcome === "reject" ? /offline primary failed/ : /playback stalled/);
    assert.equal(h.params.recordedSegmentsRef.current.length, 0, "a failed speech beat never becomes a completed captured row");
    assert.equal(h.browserAttempts(), 0, "no new recovery policy after primary speech started");
    if (position && position > 0) {
      assert.deepEqual(h.drawn, ["F = ma"], "the student already saw the accepted work");
      const shown = h.handle.submittedRows().find(row => parseStoredSegmentCommands(row.command).some(command => command.text === "F = ma"));
      assert(shown, "real preparedSave.interrupt preserves accepted shown work after the opening CLEAR epoch");
      assert.equal(shown.audioBytes, null, "interrupted work cannot invent complete audio");
    }
    console.log(`started speech ${outcome}/${String(position)}: rejects, shown work retained`);
  } finally { h.close(); }
}

async function queueFailures(outcomes: Outcome[]) {
  const h = mount(120, outcomes);
  try {
    for (let index = 0; index < outcomes.length; index++) h.control.enqueueSegment(segment, 1);
    await h.advance(h.now() + 35_000); await h.params.segmentChainRef.current;
    const consecutive = outcomes[0] === "stall" && outcomes[1] === "stall";
    assert.equal(h.params.cancelRef.current, consecutive, "two consecutive actual started-speech stalls cancel; a success resets failure history");
    assert.equal(h.errors.length, consecutive ? 1 : 0, "real queue exposes exactly the existing retryable student error after repeated speech failures");
    if (consecutive) {
      assert.deepEqual(h.errors[0], { message: "The lesson could not continue playing. Please try again.", question: "Explain force." });
      assert.equal(h.telemetry.filter(x => x.name === "student-error").length, 1);
      assert.equal(h.jobs.length, 2, "queued later paragraph cannot start after the repeated-failure stop");
    }
    assert.equal(h.params.pendingSegmentCountRef.current, 0, "actual queue drains its pending count");
    console.log(`started speech queue ${outcomes.join("/")}: student retry and recovery semantics`);
  } finally { h.close(); }
}

async function staleFailure(cancelled: boolean) {
  const h = mount(120, ["pending", "success"]);
  try {
    h.control.enqueueSegment(segment, 1); await h.flush(); await h.advance(h.now() + 50);
    assert.equal(h.jobs.length, 1);
    if (cancelled) h.params.cancelRef.current = true;
    else { h.params.turnGenerationRef.current++; h.params.segmentChainRef.current = Promise.resolve(); h.params.pendingSegmentCountRef.current = 0;
      h.params.collectedSegmentsRef.current = []; h.begin(); h.control.enqueueSegment(segment, 2); }
    h.jobs[0]!.reject(new Error("obsolete speech failed after starting"));
    await h.advance(h.now() + 2_000); await h.params.segmentChainRef.current;
    assert.equal(h.errors.length, 0, "cancelled or stale primary rejection cannot expose an error in the current turn");
    if (!cancelled) {
      assert.equal(h.params.cancelRef.current, false, "old failed speech cannot cancel its successor");
      assert.equal(h.params.recordedSegmentsRef.current.length, 1, "the successor's actual successful onEnd completes normally");
    }
    console.log(`started speech ${cancelled ? "cancel" : "stale successor"}: quiet owned cleanup`);
  } finally { h.close(); }
}

async function lateOldCompletion(outcome: "resolve" | "reject") {
  const h = mount(120, ["pending", "stall", "stall"]);
  try {
    h.control.enqueueSegment({ narration, command: null }, 1); await h.flush();
    assert.equal(h.jobs.length, 1, "obsolete narration is still awaiting its transport");
    h.params.turnGenerationRef.current = 2; h.params.segmentChainRef.current = Promise.resolve();
    h.params.pendingSegmentCountRef.current = 0; h.params.collectedSegmentsRef.current = []; h.begin();
    h.control.enqueueSegment(segment, 2);
    await h.advance(h.now() + 9_000); await h.params.segmentChainRef.current;
    assert.equal(h.errors.length, 0, "the successor's first stall remains recoverable");
    if (outcome === "resolve") h.jobs[0]!.resolve();
    else h.jobs[0]!.reject(new Error("late obsolete speech rejection"));
    await h.flush();
    h.control.enqueueSegment(segment, 2);
    await h.advance(h.now() + 9_000); await h.params.segmentChainRef.current;
    assert.equal(h.params.cancelRef.current, true, "an obsolete queue completion cannot reset the successor's real first failure before its second stall");
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0]!.message, "The lesson could not continue playing. Please try again.");
    assert.equal(h.telemetry.filter(x => x.name === "student-error").length, 1);
    console.log(`started speech late old ${outcome}: successor failure counter retained`);
  } finally { h.close(); }
}

async function cancelledRunnerRejection(stale: boolean) {
  const h = mount(120, ["pending"]);
  try {
    const result = h.runner.runSegment(segment, 0, [segment], 1).then(() => null, error => error as unknown);
    await h.flush(); await h.advance(h.now() + 50);
    assert.equal(h.jobs.length, 1);
    if (stale) h.params.turnGenerationRef.current++;
    else h.params.cancelRef.current = true;
    h.jobs[0]!.reject(new Error("late failed speech after cancellation"));
    await h.flush();
    assert.equal(await result, null, "actual runner must keep cancelled/stale late terminal speech errors quiet, before any queue catch guard");
    assert.equal(h.params.recordedSegmentsRef.current.length, 0);
    console.log(`started speech direct ${stale ? "stale" : "cancel"}: late rejection quiet`);
  } finally { h.close(); }
}

async function lateOldDrawFailure() {
  const h = mount(120, ["success", "stall", "stall"], true);
  try {
    h.control.enqueueSegment(segment, 1); await h.advance(h.now() + 1_500);
    assert.deepEqual(h.drawn, ["F = ma"]);
    h.params.turnGenerationRef.current = 2; h.params.segmentChainRef.current = Promise.resolve();
    h.params.pendingSegmentCountRef.current = 0; h.params.collectedSegmentsRef.current = []; h.begin();
    h.control.enqueueSegment(segment, 2); await h.flush();
    h.rejectOldDraw(); await h.flush();
    assert(!h.telemetry.some(event => event.name === "segment-failed"), "obsolete real draw rejection cannot publish current-turn failure telemetry");
    await h.advance(h.now() + 9_000); await h.params.segmentChainRef.current;
    assert.equal(h.params.cancelRef.current, false, "obsolete catch cannot poison the successor's first actual failure");
    assert.equal(h.errors.length, 0);
    h.control.enqueueSegment(segment, 2);
    await h.advance(h.now() + 9_000); await h.params.segmentChainRef.current;
    assert.equal(h.params.cancelRef.current, true, "two actual owned failures still stop the successor");
    assert.equal(h.errors.length, 1);
    console.log("started speech late old draw: no stale counter/error mutation");
  } finally { h.close(); }
}

async function newGenerationStartsFresh() {
  const h = mount(120, ["stall", "stall", "stall"]);
  try {
    h.control.enqueueSegment(segment, 1);
    await h.advance(h.now() + 9_000); await h.params.segmentChainRef.current;
    assert.equal(h.errors.length, 0, "the old generation's single failure is recoverable");
    h.params.turnGenerationRef.current = 2; h.params.segmentChainRef.current = Promise.resolve();
    h.params.pendingSegmentCountRef.current = 0; h.params.collectedSegmentsRef.current = []; h.begin();
    h.control.enqueueSegment(segment, 2);
    await h.advance(h.now() + 9_000); await h.params.segmentChainRef.current;
    assert.equal(h.params.cancelRef.current, false, "a new turn's first failure cannot inherit the previous turn's failure count");
    assert.equal(h.errors.length, 0);
    h.control.enqueueSegment(segment, 2);
    await h.advance(h.now() + 9_000); await h.params.segmentChainRef.current;
    assert.equal(h.params.cancelRef.current, true, "the new generation's own second failure still stops and warns");
    assert.equal(h.errors.length, 1);
    console.log("started speech new generation: first failure recoverable, own second stops");
  } finally { h.close(); }
}

async function main() {
  const cases: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "positive-stall", run: () => runnerFailure(120, "stall") },
    { name: "zero-stall", run: () => runnerFailure(0, "stall") },
    { name: "missing-stall", run: () => runnerFailure(null, "stall") },
    { name: "started-reject", run: () => runnerFailure(120, "reject") },
    { name: "queue-repeated", run: () => queueFailures(["stall", "stall", "success"]) },
    { name: "queue-recovery", run: () => queueFailures(["stall", "success", "stall", "success"]) },
    { name: "cancel", run: () => staleFailure(true) },
    { name: "stale-successor", run: () => staleFailure(false) },
    { name: "late-old-resolve", run: () => lateOldCompletion("resolve") },
    { name: "late-old-reject", run: () => lateOldCompletion("reject") },
    { name: "late-old-draw", run: lateOldDrawFailure },
    { name: "runner-cancel-reject", run: () => cancelledRunnerRejection(false) },
    { name: "runner-stale-reject", run: () => cancelledRunnerRejection(true) },
    { name: "new-generation", run: newGenerationStartsFresh },
  ];
  const selected = cases.filter(test => !process.env.STARTED_SPEECH_CASE || test.name === process.env.STARTED_SPEECH_CASE);
  assert(selected.length > 0, "requested actual-consumer case exists");
  for (const test of selected) await test.run();
  console.log(`verify-started-speech-failure: ${selected.length} actual consumer groups passed; no providers`);
}
const watchdog = setTimeout(() => { console.error("started speech verifier exceeded its 15s watchdog"); process.exit(1); }, 15_000);
void main().then(() => clearTimeout(watchdog), error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
