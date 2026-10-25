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
const timeoutPath = path.join(app, "features/tutor-session/lib/turn/ttsSegmentTimeout.ts");
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const narration = "Force equals mass times acceleration.";
const segment: TutorSegment = { narration, command: {
  type: "WRITE", text: "F = ma", params: [90, 142], charPosition: 0, narrationBefore: narration,
} };
// inkfail: the voice speaks but the beat's draw throws, a real board failure the queue counts.
type Outcome = "stall" | "reject" | "success" | "pending" | "inkfail" | "blocked";
type Job = { options: SpeakSegmentOptions; resolve: () => void; reject: (error: Error) => void; outcome: Outcome };

/** Controlled render/clock/media ports; real runner, ink planner, queue and save registry. */
/** `timings: "duration"` is a voice with no alignment (Sarvam): only the WAV length is known. */
type PlaybackFixture = { narration: string; rate: number; durationMs: number; timings?: boolean | "duration"; freezeAtMs?: number };
function mount(position: number | null, outcomes: Outcome[] = [], deferFirstDraw = false, playback?: PlaybackFixture) {
  let now = 1_000, sequence = 0, mint = 0, browserAttempts = 0, abandonCalls = 0;
  let startup: UseTurnLifecycleParams["onSpeechStartupStatus"] extends ((status: infer S) => void) | undefined ? S : never = null;
  const timers = new Map<number, { at: number; run: () => void }>();
  const jobs: Job[] = [], drawn: string[] = [], errors: Array<{ message: string; question: string }> = [];
  const executed: Array<{ command: NonNullable<TutorSegment["command"]>; options: ExecuteCommandOptions }> = [];
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
  const spoken = core.mathToSpeech(playback?.narration ?? narration);
  const durationSec = playback ? playback.durationMs / 1000 : 2;
  const timings = { totalDuration: durationSec, charStartTimes: [...spoken].map((_, i) => i * durationSec / spoken.length),
    charDurations: [...spoken].map(() => durationSec / spoken.length) };
  let rate = playback?.rate ?? 1.25, mediaPosition = 0, mediaLastAt = now, mediaPaused = false;
  const sampleMedia = () => {
    if (!mediaPaused) mediaPosition += (now - mediaLastAt) * rate;
    if (playback?.freezeAtMs !== undefined) mediaPosition = Math.min(mediaPosition, playback.freezeAtMs);
    mediaLastAt = now;
    return mediaPosition;
  };
  const tts = {
    speakSegment: (_text: string, options: SpeakSegmentOptions) => new Promise<void>((resolve, reject) => {
      if (playback) { mediaPosition = 0; mediaLastAt = now; }
      const outcome = outcomes[jobs.length] ?? "pending";
      jobs.push({ options, resolve, reject, outcome });
      if (playback?.timings === "duration") options.onTimings?.({ totalDuration: durationSec, charStartTimes: [], charDurations: [] });
      else if (!playback || playback.timings !== false) options.onTimings?.(outcome === "pending" ? { ...timings, totalDuration: 60 } : timings);
      // A browser autoplay refusal: the provider holds the clip and reports it.
      if (outcome === "blocked") options.onPlaybackBlocked?.({ reason: "not-allowed", audioContextState: "running" });
      else options.onStart?.();
      if (outcome === "success" && playback) {
        const finish = () => {
          if (sampleMedia() >= playback.durationMs) { options.onEnd?.(); resolve(); }
          else setTimer(finish, 100);
        };
        setTimer(finish, 100);
      } else if (outcome === "success" || outcome === "inkfail") setTimer(() => { options.onEnd?.(); resolve(); }, 1_000);
      else if (outcome === "reject") setTimer(() => reject(new Error("offline primary failed after start")), 200);
    }),
    getPlaybackPositionMs: () => playback && (jobs[0]?.outcome === "success" || playback.freezeAtMs !== undefined) ? sampleMedia() : position, getPlaybackRate: () => rate,
    peekSegmentTimings: () => playback?.timings === false || playback?.timings === "duration" ? null : timings, prefetchSegment: noop, abandonSpeaking: () => { abandonCalls++; }, stop: noop,
    // The gesture plays the retained clip: start, clear the block, finish.
    unlockAudio: noop, resume: () => {
      const job = jobs.at(-1);
      if (!job || job.outcome !== "blocked") return;
      job.options.onStart?.(); job.options.onPlaybackBlocked?.(null);
      setTimer(() => { job.options.onEnd?.(); job.resolve(); }, 1_000);
    },
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
      : file === controlPath ? process.env.STARTED_SPEECH_CONTROL_SOURCE ?? file
      : file === timeoutPath ? process.env.STARTED_SPEECH_TIMEOUT_SOURCE ?? file : file;
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
      if (specifier.endsWith("/ttsSegmentTimeout")) return load(timeoutPath);
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
    turnTelemetryRef: ref({ mark: (name: string, data: Record<string, unknown>) => telemetry.push({ name, ...data, atMs: now }),
      span: () => ({ end: noop }), meta: noop, durationMs: () => now, flush: async () => {} }),
    onSpeechStartupStatus: (value: typeof startup) => { startup = value; },
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
      drawn.push(command.text ?? command.type); executed.push({ command, options }); options.onInkStarted?.();
      if (jobs.at(-1)?.outcome === "inkfail") {
        // Fails part way through its stroke, after the beat has started.
        await new Promise<void>(resolve => setTimer(resolve, 500));
        throw new Error("offline ink failed");
      }
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
  return { params, control, runner, handle, begin, jobs, drawn, executed, errors, telemetry, registry, flush, advance,
    now: () => now, browserAttempts: () => browserAttempts,
    startup: () => startup, abandonCalls: () => abandonCalls,
    setRate: (next: number) => { sampleMedia(); rate = next; },
    setPaused: (paused: boolean) => {
      sampleMedia(); mediaPaused = paused; params.isPausedRef.current = paused;
      if (paused) runner.pauseFallbackSpeech(); else runner.resumeFallbackSpeech();
    },
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
    // A started voice that fails is taught silently: the caller never sees a failure to count.
    assert.equal(result, null, "an onStart accepted primary failure is taught silently, even with positive/zero/missing media clock");
    const degraded = h.telemetry.find(event => event.name === "tts-voice-degraded");
    assert(degraded, "the silent beat is reported");
    assert.match(String(degraded.error), outcome === "reject" ? /offline primary failed/ : /playback stalled/);
    assert.equal(h.params.recordedSegmentsRef.current.length, 1, "the silently taught beat is recorded");
    assert.equal(h.browserAttempts(), 0, "no new recovery policy after primary speech started");
    assert.deepEqual(h.drawn, ["F = ma"], "the beat's work is drawn whatever the media clock said");
    const shown = h.handle.submittedRows().find(row => parseStoredSegmentCommands(row.command).some(command => command.text === "F = ma"));
    assert(shown, "the taught row is saved after the opening CLEAR epoch");
    assert.equal(shown.audioBytes, null, "a failed voice cannot invent complete audio");
    const heardFinish = h.telemetry.find(event => event.name === "tts-segment-degraded");
    if (position && position > 0 && outcome === "stall") {
      // Heard, then the local clip froze: the segment finishes instead of failing.
      assert(heardFinish, "the degraded speech is still reported");
      assert.match(String(heardFinish.error), /playback stalled/);
      assert(!h.telemetry.some(event => event.name === "tts-segment-failed"), "not a terminal speech failure");
      console.log(`started speech ${outcome}/${String(position)}: heard then frozen, segment finishes, rest taught silently`);
      return;
    }
    // An unheard stall or a provider failure is not the heard finish: it takes
    // the silent path through the terminal speech branch.
    assert.equal(heardFinish, undefined, "an unheard stall or a provider failure is not finished as heard");
    assert(h.telemetry.some(event => event.name === "tts-segment-failed"), "the failed voice is reported as failed speech");
    console.log(`started speech ${outcome}/${String(position)}: taught silently, work saved`);
  } finally { h.close(); }
}

/** A heard clip that freezes never counts toward abandoning the turn. */
async function heardFailuresKeepTurn(outcomes: Outcome[]) {
  const h = mount(120, outcomes);
  try {
    for (let index = 0; index < outcomes.length; index++) h.control.enqueueSegment(segment, 1);
    await h.advance(h.now() + 35_000); await h.params.segmentChainRef.current;
    assert.equal(h.params.cancelRef.current, false, "two heard frozen clips in a row cannot cancel the lesson");
    assert.equal(h.errors.length, 0, "no retry warning for a lesson that is still teaching");
    assert.equal(h.jobs.length, outcomes.length, "every later segment still runs");
    assert.equal(h.drawn.length, outcomes.length, "every segment's ink completes");
    assert.equal(h.params.recordedSegmentsRef.current.length, outcomes.length);
    assert(!h.telemetry.some(event => event.name === "segment-failed"));
    const stalls = outcomes.filter(outcome => outcome === "stall").length;
    assert.equal(h.telemetry.filter(event => event.name === "tts-segment-degraded").length, stalls, "each heard frozen clip finishes as heard");
    assert.equal(h.telemetry.filter(event => event.name === "tts-voice-degraded").length, stalls, "and the rest of each is taught silently");
    console.log(`started speech heard queue ${outcomes.join("/")}: turn continues, every segment completes`);
  } finally { h.close(); }
}

/**
 * v3 p4e1-t2: a fully local Sarvam WAV froze, paused, at 1.63 s of 8.7 s, then
 * the next at 5.9 s. Sarvam sends no character timings, only the WAV length.
 * The watch must arm on that length alone, well before the character timeout,
 * and the turn must not be cancelled.
 */
async function frozenPausedNoAlignment() {
  const text = "The relative velocity of the rain with respect to the man is the velocity of the rain minus the velocity of the man, and we draw it as a triangle of vectors before we compute anything at all.";
  const durationMs = 8_700;
  const h = mount(0, ["pending", "pending"], false, { narration: text, rate: 1, durationMs, timings: "duration", freezeAtMs: 1_600 });
  const beat: TutorSegment = { narration: text, command: { type: "WRITE", text: "v_rm = v_r - v_m", params: [90, 142], charPosition: 0, narrationBefore: "" } };
  try {
    const helper = await import("../../features/tutor-session/lib/turn/ttsSegmentTimeout");
    const characterTimeoutMs = helper.speakSegmentTimeoutMs(core.mathToSpeech(text), 1);
    const durationWatchMs = Math.max(8_000, durationMs * 1.35 + 3_000);
    assert(characterTimeoutMs > durationWatchMs + 10_000, "the fixture separates the two watchdogs");
    const startedAt = h.now();
    h.control.enqueueSegment(beat, 1); h.control.enqueueSegment(beat, 1);
    await h.advance(startedAt + durationWatchMs + 1_000);
    const firstCaught = h.telemetry.find(event => event.name === "tts-segment-degraded");
    assert(firstCaught, "the duration watch caught the frozen first segment before the character timeout");
    // #275: the unheard rest of the sentence is then taught silently, for at
    // most its estimated length, and the next segment starts after it, still
    // well before the character timeout.
    const firstSilent = h.telemetry.find(event => event.name === "tts-voice-degraded");
    assert(firstSilent && firstSilent.atMs === firstCaught.atMs, "the rest of the frozen sentence is taught silently at once");
    // While that rest is taught, the frozen clip no longer owns the pen's clock.
    assert.equal(h.jobs.length, 1, "the rest of the first sentence is still being taught");
    const firstWrite = h.executed.find(entry => entry.command.type === "WRITE");
    assert(firstWrite?.options.writeSchedule?.isAudioActive, "the WRITE follows the segment's live clock");
    assert.equal(firstWrite.options.writeSchedule.isAudioActive(), false, "a silently taught rest has no live provider clock");
    const silentMs = Number(firstSilent.estimated_ms);
    assert(Number.isFinite(silentMs) && silentMs > 0);
    const releaseBy = Number(firstCaught.atMs) + silentMs + 1_000;
    assert(releaseBy < startedAt + characterTimeoutMs, "the silent rest still ends before the character timeout");
    await h.advance(releaseBy);
    assert.equal(h.jobs.length, 2, "the duration watch released the frozen first segment before the character timeout");
    await h.advance(releaseBy + durationWatchMs + 1_000 + silentMs + 1_000); await h.params.segmentChainRef.current;
    const degraded = h.telemetry.filter(event => event.name === "tts-segment-degraded");
    assert.equal(degraded.length, 2, "both frozen clips are reported");
    assert.equal(h.telemetry.filter(event => event.name === "tts-voice-degraded").length, 2, "both unheard rests are taught silently");
    for (const event of degraded) {
      assert.match(String(event.error), /playback stalled/, "caught by the duration watch, not the character timeout");
      assert.equal(event.heard_ms, 1_600);
    }
    assert.equal(h.params.cancelRef.current, false, "the turn is not cancelled");
    assert.equal(h.errors.length, 0);
    const ink = h.executed.filter(entry => entry.command.type !== "POINT");
    assert.deepEqual(ink.map(entry => [entry.command.type, entry.command.text]),
      [["WRITE", "v_rm = v_r - v_m"], ["WRITE", "v_rm = v_r - v_m"]], "both segments' ink completes");
    // The long sentence leaves time after its WRITE, so main's explanation
    // pointing walks the pen over that row while the voice talks (#211). It is
    // transient motion, never ink, and it must end with the frozen clip: the
    // tour reads the segment's own speech clock, which the release completes.
    assert.deepEqual(h.executed.map(entry => entry.command.type),
      ["WRITE", "POINT", "WRITE", "POINT"], "at most one pointing tour after each segment's ink");
    for (const point of h.executed.filter(entry => entry.command.type === "POINT")) {
      assert.equal(point.command.text, "last", "the tour points at the row just written");
      assert.equal(point.options.explanationPointing, true, "only the transient explanation tour, never an authored point");
      assert.equal(point.options.spokenClock?.isSpeechComplete?.(), true,
        "the released frozen clip completes the tour's speech clock, so the pen cannot keep touring");
    }
    assert.equal(h.params.recordedSegmentsRef.current.length, 2, "both segments complete");
    assert.equal(h.params.pendingSegmentCountRef.current, 0);
    console.log("started speech frozen paused clip, no alignment: duration watch, segments complete, turn continues");
  } finally { h.close(); }
}

async function queueFailures(outcomes: Outcome[]) {
  const h = mount(0, outcomes);
  try {
    for (let index = 0; index < outcomes.length; index++) h.control.enqueueSegment(segment, 1);
    await h.advance(h.now() + 35_000); await h.params.segmentChainRef.current;
    // Voice stalls never count; two consecutive failed draws still stop the lesson.
    const consecutive = outcomes[0] === "inkfail" && outcomes[1] === "inkfail";
    assert.equal(h.params.cancelRef.current, consecutive, "two consecutive failed draws cancel; voice stalls never do; a success resets failure history");
    assert.equal(h.errors.length, consecutive ? 1 : 0, "real queue exposes exactly the existing retryable student error after repeated speech failures");
    if (consecutive) {
      assert.deepEqual(h.errors[0], { message: "The lesson could not continue playing. Please try again.", question: "Explain force." });
      assert.equal(h.telemetry.filter(x => x.name === "student-error").length, 1);
      assert.equal(h.jobs.length, 2, "queued later paragraph cannot start after the repeated-failure stop");
    } else {
      assert.equal(h.jobs.length, outcomes.length, "every sentence is taught");
      const stalls = outcomes.filter(outcome => outcome === "stall").length;
      assert.equal(h.telemetry.filter(x => x.name === "tts-voice-degraded").length, stalls, "each stalled sentence is taught silently");
      assert.equal(h.params.recordedSegmentsRef.current.length, outcomes.filter(outcome => outcome !== "inkfail").length,
        "every taught sentence is recorded; a failed draw is not");
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
  const h = mount(120, ["pending", "inkfail", "inkfail"]);
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
  const h = mount(120, ["success", "inkfail", "inkfail"], true);
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
  const h = mount(120, ["inkfail", "inkfail", "inkfail"]);
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

async function slowPlayback(rate: number, chars: number, durationMs: number, changeRate = false, pause = false) {
  const text = "a".repeat(chars);
  const h = mount(0, ["success"], false, { narration: text, rate: changeRate ? 1 : rate, durationMs });
  const beat: TutorSegment = { narration: text, command: null };
  try {
    let settled = false;
    const result = h.runner.runSegment(beat, 0, [beat], 1).then(() => { settled = true; return null; }, error => { settled = true; return error as unknown; });
    await h.flush();
    if (changeRate) { await h.advance(h.now() + 1_000); h.setRate(rate); }
    if (pause) {
      await h.advance(h.now() + 1_000); h.setPaused(true);
      await h.advance(h.now() + 200_000);
      assert.equal(settled, false, "pause time cannot consume even the slow segment's expanded deadline");
      h.setPaused(false);
    }
    const wallMs = durationMs / rate;
    await h.advance(h.now() + wallMs + 1_000);
    assert.equal(await result, null, "valid advancing slow playback must finish rather than reach the character watchdog");
    assert.equal(h.params.recordedSegmentsRef.current.length, 1, "actual successful slow voice completes exactly one recorded beat");
    assert.equal(h.browserAttempts(), 0, "slow native playback needs no browser retry");
    assert(!h.telemetry.some(event => event.name === "tts-segment-failed"));
    console.log(`started speech slow ${rate}x/${chars} chars${changeRate ? "/live-speed-change" : ""}${pause ? "/pause" : ""}: actual voice completes`);
  } finally { h.close(); }
}

const mathsDenseNarration = "Simplify each expression: " + Array.from({ length: 30 }, () => "x²+2x=3").join("; ") + ".";
async function slowMathPlayback(rate: number, changeRate = false) {
  const text = mathsDenseNarration;
  assert.equal(text.length, 295);
  assert.equal(core.mathToSpeech(text).length, 745, "maths notation expands into the actual spoken words");
  // 64s of native media is valid at the measured slow voice rate (~11.6
  // spoken chars/s), but exceeds the raw-character wall budget at either rate.
  const h = mount(0, ["success"], false, { narration: text, rate: changeRate ? 1 : rate, durationMs: 64_000 });
  const beat: TutorSegment = { narration: text, command: null };
  try {
    const result = h.runner.runSegment(beat, 0, [beat], 1).then(() => null, error => error as unknown);
    if (changeRate) { await h.advance(h.now() + 1_000); h.setRate(rate); }
    await h.advance(h.now() + 64_000 / rate + 1_000);
    assert.equal(await result, null, "valid advancing maths-dense speech must use its spoken characters for the watchdog");
    assert.equal(h.params.recordedSegmentsRef.current.length, 1);
    assert.equal(h.browserAttempts(), 0);
    assert(!h.telemetry.some(event => event.name === "tts-segment-failed"));
    console.log(`started speech maths dense ${rate}x${changeRate ? "/live-speed-change" : ""}: 295 written/745 spoken characters complete`);
  } finally { h.close(); }
}

async function mathsDeadClock() {
  const h = mount(0, ["pending"], false, { narration: mathsDenseNarration, rate: .5, durationMs: 64_000, timings: false });
  const beat: TutorSegment = { narration: mathsDenseNarration, command: null };
  try {
    let settled = false;
    const result = h.runner.runSegment(beat, 0, [beat], 1).then(() => { settled = true; return null; }, error => { settled = true; return error as unknown; });
    await h.advance(h.now() + 120_000);
    assert.equal(settled, false, "maths speech keeps its spoken-character allowance even without final alignment");
    await h.advance(h.now() + 50_000);
    assert.equal(settled, true, "nonadvancing maths audio still fails within the bounded slow-speed deadline");
    assert.equal(await result, null, "the bounded stall is taught silently, not counted");
    assert.match(String(h.telemetry.find(event => event.name === "tts-voice-degraded")?.error), /tts segment timeout/);
    assert.equal(h.params.recordedSegmentsRef.current.length, 1, "the silently taught beat is recorded");
    assert.equal(h.browserAttempts(), 0);
    console.log("started speech maths dense zero clock/no alignment: bounded timeout, taught silently");
  } finally { h.close(); }
}

async function slowDeadClock(cancelled: boolean, stale = false, rate = .5) {
  const text = "a".repeat(250);
  // Missing alignment makes the character watchdog the only completion bound.
  const h = mount(0, ["pending"], false, { narration: text, rate, durationMs: 21_500, timings: false });
  const beat: TutorSegment = { narration: text, command: null };
  try {
    let settled = false;
    const result = h.runner.runSegment(beat, 0, [beat], 1).then(() => { settled = true; return null; }, error => { settled = true; return error as unknown; });
    await h.flush();
    if (cancelled) { if (stale) h.params.turnGenerationRef.current++; else h.params.cancelRef.current = true; }
    await h.advance(h.now() + 80_000);
    assert.equal(settled, true, "missing alignment still has a finite slow-speed watchdog");
    const error = await result;
    assert.equal(error, null, cancelled ? "slow timeout after Stop/successor stays quiet" : "a bounded slow timeout is taught silently");
    if (!cancelled) assert.match(String(h.telemetry.find(event => event.name === "tts-voice-degraded")?.error), /tts segment timeout/);
    assert.equal(h.params.recordedSegmentsRef.current.length, cancelled ? 0 : 1);
    assert.equal(h.browserAttempts(), 0);
    console.log(`started speech slow no-alignment ${cancelled ? stale ? "stale" : "cancel" : "timeout"}: bounded owned release`);
  } finally { h.close(); }
}

async function slowAlignmentDeadClock() {
  const text = "a".repeat(250);
  const h = mount(0, ["stall"], false, { narration: text, rate: .5, durationMs: 21_500 });
  const beat: TutorSegment = { narration: text, command: null };
  try {
    const result = h.runner.runSegment(beat, 0, [beat], 1).then(() => null, error => error as unknown);
    await h.advance(h.now() + 70_000);
    assert.equal(await result, null, "a finite playback stall is taught silently");
    assert.match(String(h.telemetry.find(event => event.name === "tts-voice-degraded")?.error), /playback stalled/);
    assert.equal(h.params.recordedSegmentsRef.current.length, 1, "the watchdog still fires; the beat is then taught without a voice");
    console.log("started speech slow aligned zero clock: finite playback stall, taught silently");
  } finally { h.close(); }
}

async function queuedSlowPlayback() {
  const text = "a".repeat(250);
  const h = mount(0, ["success", "success"], false, { narration: text, rate: .5, durationMs: 21_500 });
  const beat: TutorSegment = { narration: text, command: null };
  try {
    h.control.enqueueSegment(beat, 1); h.control.enqueueSegment(beat, 1);
    await h.advance(h.now() + 90_000); await h.params.segmentChainRef.current;
    assert.equal(h.params.cancelRef.current, false, "two valid slow sentences cannot reach the repeated-failure stop");
    assert.equal(h.errors.length, 0, "actual queue must not tell a slow-speed student their valid lesson failed");
    assert.equal(h.params.recordedSegmentsRef.current.length, 2);
    assert.equal(h.jobs.length, 2);
    assert.equal(h.params.pendingSegmentCountRef.current, 0);
    console.log("started speech slow two-beat queue: both complete without retry warning");
  } finally { h.close(); }
}

async function speedIncreaseAfterSlowPlayback() {
  const text = "a".repeat(1_000);
  const h = mount(0, ["success"], false, { narration: text, rate: .5, durationMs: 65_000 });
  const beat: TutorSegment = { narration: text, command: null };
  try {
    const result = h.runner.runSegment(beat, 0, [beat], 1).then(() => null, error => error as unknown);
    await h.advance(h.now() + 60_000); h.setRate(1);
    await h.advance(h.now() + 36_000);
    assert.equal(await result, null, "elapsed slow playback must remain valid when the same sentence is sped up");
    assert.equal(h.params.recordedSegmentsRef.current.length, 1);
    console.log("started speech live speed increase: prior slow media time remains valid");
  } finally { h.close(); }
}

async function timeoutRateControls() {
  const helper = await import("../../features/tutor-session/lib/turn/ttsSegmentTimeout");
  assert.equal(helper.speakSegmentTimeoutMs("a".repeat(250), .5), 75_000);
  assert.equal(helper.speakSegmentTimeoutMs("a".repeat(1_000), .5), 180_000, "natural 90s ceiling scales with slow playback");
  assert.equal(helper.speakSegmentTimeoutMs("a".repeat(250), 1e-9), 75_000, "an unsupported tiny client rate cannot create an unbounded watchdog");
  for (const rate of [1, 1.25, 3, 0, -1, NaN, Infinity]) {
    assert.equal(helper.speakSegmentTimeoutMs("a".repeat(250), rate), 37_500, "fast/default/invalid rates retain the original bounded budget");
  }
  console.log("started speech timeout rates: finite slow budget; default/invalid/faster unchanged");
}

/**
 * A browser autoplay refusal is a wait for the student's tap, not provider
 * latency. The beat keeps its place past every normal startup and playback
 * deadline, never races a gesture blocked browser voice, and the tap delivers
 * the same beat before the next one.
 */
async function permissionRecovery(mode: "tap" | "cancel" | "pause") {
  const h = mount(120, ["blocked", "success"]);
  try {
    h.control.enqueueSegment({ narration, command: null }, 1);
    h.control.enqueueSegment({ narration, command: null }, 1);
    const queue = h.params.segmentChainRef.current;
    await h.advance(h.now() + 60_000);
    assert.equal(h.browserAttempts(), 0, "permission denial retains provider bytes, never races a browser fallback");
    assert.equal(h.params.recordedSegmentsRef.current.length, 0);
    assert.equal(h.jobs.length, 1, "blocked beat retains its place");
    assert.equal(h.errors.length, 0, "a permission wait is not a failed beat");
    assert.equal(h.params.cancelRef.current, false);
    assert(!h.telemetry.some(event => event.name === "tts-segment-failed"), "no watchdog expired while waiting for the tap");
    const status = h.startup(); assert(status, "Enable audio action remains available after the normal startup deadline");
    if (mode === "cancel") {
      h.control.stopTurn(); await h.advance(h.now() + 60_000); await queue;
      status.enableAudio(); // A stale retained UI closure cannot restart the stopped lesson.
      await h.advance(h.now() + 5_000);
      assert.equal(h.jobs.length, 1); assert.equal(h.errors.length, 0);
      assert(!h.telemetry.some(event => event.name === "tts-segment-failed"));
      console.log("started speech permission cancel: stop releases the wait; stale tap is inert");
      return;
    }
    if (mode === "pause") { h.setPaused(true); await h.advance(h.now() + 30_000); h.setPaused(false); await h.advance(h.now() + 30_000); }
    assert.equal(h.params.recordedSegmentsRef.current.length, 0, "resume from Pause alone does not restart the deadline of a blocked clip");
    assert(!h.telemetry.some(event => event.name === "tts-segment-failed"));
    status.enableAudio(); await h.advance(h.now() + 5_000); await queue;
    assert.equal(h.params.recordedSegmentsRef.current.length, 2, "the tap delivers the SAME beat, then the next");
    assert.equal(h.errors.length, 0); assert.equal(h.abandonCalls(), 0);
    assert.equal(h.startup(), null, "accepted playback clears the recovery action");
    console.log(`started speech permission ${mode}: beat waits for the tap, then both beats deliver`);
  } finally { h.close(); }
}

async function main() {
  const cases: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "permission-recovery", run: () => permissionRecovery("tap") },
    { name: "permission-cancel", run: () => permissionRecovery("cancel") },
    { name: "permission-pause", run: () => permissionRecovery("pause") },
    { name: "timeout-rate-controls", run: timeoutRateControls },
    { name: "maths-slow-half", run: () => slowMathPlayback(.5) },
    { name: "maths-slow-three-quarter", run: () => slowMathPlayback(.75) },
    { name: "maths-live-slowdown", run: () => slowMathPlayback(.5, true) },
    { name: "maths-zero-clock-timeout", run: mathsDeadClock },
    { name: "slow-queue", run: queuedSlowPlayback },
    { name: "slow-half", run: () => slowPlayback(.5, 250, 21_500) },
    { name: "slow-three-quarter", run: () => slowPlayback(.75, 600, 52_000) },
    { name: "slow-long-cap", run: () => slowPlayback(.5, 1_000, 65_000) },
    { name: "slow-live-rise", run: speedIncreaseAfterSlowPlayback },
    { name: "slow-live-change", run: () => slowPlayback(.5, 250, 21_500, true) },
    { name: "slow-pause", run: () => slowPlayback(.5, 250, 21_500, false, true) },
    { name: "malformed-tiny-rate-timeout", run: () => slowDeadClock(false, false, 1e-9) },
    { name: "slow-alignment-zero-clock", run: slowAlignmentDeadClock },
    { name: "slow-no-alignment-timeout", run: () => slowDeadClock(false) },
    { name: "slow-cancel", run: () => slowDeadClock(true) },
    { name: "slow-stale", run: () => slowDeadClock(true, true) },
    { name: "positive-stall", run: () => runnerFailure(120, "stall") },
    { name: "zero-stall", run: () => runnerFailure(0, "stall") },
    { name: "missing-stall", run: () => runnerFailure(null, "stall") },
    { name: "started-reject", run: () => runnerFailure(120, "reject") },
    { name: "queue-repeated", run: () => queueFailures(["stall", "stall", "success"]) },
    { name: "queue-repeated-stalls", run: () => queueFailures(["stall", "stall", "stall", "stall"]) },
    { name: "queue-repeated-ink", run: () => queueFailures(["inkfail", "inkfail", "success"]) },
    { name: "queue-ink-recovery", run: () => queueFailures(["inkfail", "success", "inkfail", "success"]) },
    { name: "queue-recovery", run: () => queueFailures(["stall", "success", "stall", "success"]) },
    { name: "heard-stalls-keep-turn", run: () => heardFailuresKeepTurn(["stall", "stall", "success"]) },
    { name: "frozen-paused-no-alignment", run: frozenPausedNoAlignment },
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
