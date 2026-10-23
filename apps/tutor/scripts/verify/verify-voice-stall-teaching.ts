/**
 * A voice failure never abandons the lesson (production 20 to 23 Oct 2026).
 *
 * Drives the real `useSegmentRunner` (transpiled, fake clock, no network) with
 * the production pattern: the provider gives no first byte, the 6.5 s startup
 * deadline hands over to browser speech, and browser speech fails too. The
 * sentence must still be taught: its WRITE ink draws, its row is saved
 * without audio, and the runner resolves instead of throwing, so the queue
 * never counts it toward `shouldAbandonTurn`. A failed draw still rejects, a
 * stopped turn stays quiet, Pause holds the silent sentence, and the next
 * sentence asks the provider again.
 *
 * Mutation: set SEGMENT_RUNNER_SOURCE to a runner whose speech catch rethrows
 * every terminal failure (the old code) and this gate goes red.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import type { SpeakSegmentOptions, TTSClient } from "@heytutor/tutor-core";
import type { TutorSegment } from "@heytutor/drawing";
import type { UseSegmentRunnerParams } from "../../features/tutor-session/hooks/turn/types";
import { classifyTurnFailure } from "../../lib/obs/turnFailureClassification";
import { FAILED_TURN_ISSUE_CODES, readFailedTurnTelemetry, TEACHING_VOICE_DEGRADED, withTeachingVoiceDegraded } from "../../lib/obs/failedTurnTelemetry";
import {
  shouldAbandonTurn, silentSentenceRemainingMs, voiceFailureDisposition,
} from "../../features/tutor-session/lib/turn/turnFailurePolicy";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const runnerPath = path.join(app, "features/tutor-session/hooks/turn/useSegmentRunner.ts");
const controlPath = path.join(app, "features/tutor-session/hooks/turn/useTurnControl.ts");
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const segment = (narration: string, paired = true): TutorSegment => ({ narration, command: paired ? {
  type: "WRITE", text: "F = ma", params: [90, 142], charPosition: 0, narrationBefore: narration,
} : null });
type Job = { text: string; options: SpeakSegmentOptions; resolve: () => void; reject: (error: Error) => void; abandoned: boolean };
type ProviderMode = "silent" | "speaks";

function mount(opts: { failDraw?: boolean } = {}) {
  let now = 1_000, sequence = 0;
  let providerMode: ProviderMode = "silent";
  const timers = new Map<number, { at: number; run: () => void }>();
  const jobs: Job[] = [], drawn: string[] = [], telemetry: string[] = [];
  let browserAttempts = 0;
  const original = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const setTimer = (run: () => void, delay = 0) => {
    const id = ++sequence; timers.set(id, { at: now + delay, run }); return id;
  };
  const clearTimer = (id: number) => { timers.delete(id); };
  replace("performance", { now: () => now });
  replace("setTimeout", setTimer); replace("clearTimeout", clearTimer);
  replace("window", { setTimeout: setTimer, clearTimeout: clearTimer });
  replace("fetch", () => { throw new Error("voice stall gate forbids network calls"); });
  const flush = async () => { for (let turn = 0; turn < 80; turn++) await Promise.resolve(); };
  const advance = async (target: number) => {
    await flush();
    while (true) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      now = due[1].at; timers.delete(due[0]); due[1].run(); await flush();
    }
    now = target; await flush();
  };
  const tts = {
    speakSegment: (text: string, options: SpeakSegmentOptions) => new Promise<void>((resolve, reject) => {
      const job: Job = { text, options, resolve, reject, abandoned: false };
      jobs.push(job);
      if (providerMode === "silent") return; // No first byte: the production stall.
      const spoken = core.mathToSpeech(text);
      options.onTimings?.({ totalDuration: 1, charStartTimes: [...spoken].map((_, i) => i / spoken.length),
        charDurations: [...spoken].map(() => 1 / spoken.length) });
      options.onStart?.();
      setTimer(() => { options.onEnd?.(); resolve(); }, 1_000);
    }),
    getPlaybackPositionMs: () => 120, getPlaybackRate: () => 1,
    peekSegmentTimings: () => null, prefetchSegment: noop,
    abandonSpeaking: () => { const job = jobs.at(-1); if (job) job.abandoned = true; },
    stop: noop,
  } as unknown as TTSClient;
  class BrowserVoice {
    setPlaybackRate() {} resume() {} stop() {} pause() {}
    async speakSegment() {
      browserAttempts++;
      throw new Error("SpeechSynthesis error: synthesis-failed");
    }
  }
  const compiled = ts.transpileModule(readFileSync(process.env.SEGMENT_RUNNER_SOURCE ?? runnerPath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn };
    if (specifier === "@heytutor/tutor-core") return { ...core, tutorDebug: noop, SpeechSynthesisTTSClient: BrowserVoice };
    if (specifier.endsWith("/liveTurnSave")) return { liveTurnSave: () => ({ prepareSegment: () => null, recordRow: noop }) };
    return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(runnerPath), specifier) : specifier);
  }, mod, mod.exports);
  let rejectDraw: ((error: Error) => void) | undefined;
  const params = {
    sessionId: "offline-voice-stall", activeVerifiedDiagramRef: ref(null),
    cancelRef: ref(false), isPausedRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1),
    turnTelemetryRef: ref({ mark: (name: string) => { telemetry.push(name); }, span: () => ({ end: noop }) }),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }),
    recordedSegmentsRef: ref<UseSegmentRunnerParams["recordedSegmentsRef"]["current"]>([]),
    narrationSinceEpochRef: ref(""), currentTraceIdRef: ref(null), narrationDensityRef: ref(0),
    drawChainRef: ref(Promise.resolve()), ensureTTSClient: () => tts, applyTurnPhase: noop,
    setCurrentSegmentText: noop,
    cancellableDelay: (ms: number) => new Promise<void>(resolve => setTimer(resolve, ms)),
    raceWithCancel: async <T,>(promise: Promise<T>) => promise,
    reserveTextCommandPlacements: async (command: NonNullable<TutorSegment["command"]>) => [command],
    executeCommandWithCancel: async (command: NonNullable<TutorSegment["command"]>, options: Parameters<UseSegmentRunnerParams["executeCommandWithCancel"]>[1]) => {
      if (options?.isCancelled?.()) return;
      drawn.push(command.text ?? command.type); options?.onInkStarted?.();
      if (opts.failDraw) await new Promise<void>((_resolve, reject) => { rejectDraw = reject; });
    },
  };
  const hook = mod.exports as unknown as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner");
  const runner = hook.useSegmentRunner(params as unknown as UseSegmentRunnerParams);
  /** Run one segment to its outcome, advancing the fake clock up to `limitMs`. */
  const settle = async <T,>(promise: Promise<T>, limitMs = 60_000, onTick?: (elapsed: number) => void) => {
    let result: { value?: T; error?: unknown } | null = null;
    void promise.then(value => { result = { value }; }, error => { result = { error }; });
    const start = now;
    while (!result && now - start < limitMs) { await advance(now + 50); onTick?.(now - start); }
    return { result: result as { value?: T; error?: unknown } | null, elapsedMs: now - start };
  };
  return {
    runner, params, jobs, drawn, telemetry, settle, flush, advanceBy: (ms: number) => advance(now + ms),
    browserAttempts: () => browserAttempts,
    setProvider: (mode: ProviderMode) => { providerMode = mode; },
    failDraw: (error: Error) => { assert(rejectDraw, "the draw must be in flight"); rejectDraw(error); },
    close: () => {
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

const cases: Array<[string, () => Promise<void>]> = [];
const check = (name: string, run: () => Promise<void>) => { cases.push([name, run]); };

check("policy: a voice failure is taught silently, a draw failure still fails, a stop stays quiet", async () => {
  assert.equal(voiceFailureDisposition({ cancelled: false, drawFailed: false, providerRecoveryAttempted: false }), "teach_silently");
  assert.equal(voiceFailureDisposition({ cancelled: false, drawFailed: true, providerRecoveryAttempted: false }), "fail");
  assert.equal(voiceFailureDisposition({ cancelled: false, drawFailed: false, providerRecoveryAttempted: true }), "fail");
  assert.equal(voiceFailureDisposition({ cancelled: false, drawFailed: false, providerRecoveryAttempted: false, codeBeatOwed: true }), "fail");
  assert.equal(voiceFailureDisposition({ cancelled: true, drawFailed: true, providerRecoveryAttempted: true }), "quiet");
  assert.equal(silentSentenceRemainingMs({ estimateSpeechMs: 4_000, playbackRate: 2, elapsedMs: 500 }), 1_500);
  assert.equal(silentSentenceRemainingMs({ estimateSpeechMs: 4_000, playbackRate: 1, elapsedMs: 9_000 }), 0);
  assert.equal(silentSentenceRemainingMs({ estimateSpeechMs: Number.NaN, playbackRate: 0, elapsedMs: -5 }), 0);
  assert.equal(silentSentenceRemainingMs({ estimateSpeechMs: 4_000, playbackRate: 1e-9, elapsedMs: 0 }), 8_000, "a malformed tiny rate cannot hold the board for ever");
});

check("two stalled sentences in a row are both taught: ink drawn, rows saved, nothing thrown", async () => {
  const h = mount();
  try {
    const first = segment("Newton's second law says force equals mass times acceleration.");
    const second = segment("So doubling the force doubles the acceleration for the same mass.");
    for (const [index, beat] of [first, second].entries()) {
      const { result, elapsedMs } = await h.settle(h.runner.runSegment(beat, index, [first, second], 1));
      assert(result, `sentence ${index} must finish, not hang`);
      assert.equal(result.error, undefined, `sentence ${index}: a voice failure must not reject the beat (it would count toward shouldAbandonTurn)`);
      assert.deepEqual(result.value, { voiceDegraded: true }, `sentence ${index} reports a voice degraded beat`);
      assert(elapsedMs >= 6_500, "the provider had its full startup deadline first");
      assert.equal(h.jobs[index]!.abandoned, true, "the stalled provider sentence is abandoned");
    }
    assert.equal(h.browserAttempts() >= 2, true, "browser speech was tried for each sentence");
    assert.deepEqual(h.drawn, ["F = ma", "F = ma"], "each sentence's WRITE ink still reaches the board");
    const rows = h.params.recordedSegmentsRef.current;
    assert.equal(rows.length, 2, "every taught segment is saved");
    assert(rows.every((row) => row.audioBytes === null && row.timings === null), "silent rows keep no audio or alignment");
    assert.equal(h.telemetry.filter((name) => name === "tts-voice-degraded").length, 2, "each silent sentence is reported");
    // The queue only counts rejected beats; two resolved beats never reach the abandon threshold.
    assert.equal(shouldAbandonTurn(0), false);
  } finally { h.close(); }
});

check("a narration only sentence holds the board for its estimated length, then moves on", async () => {
  const h = mount();
  try {
    const beat = segment("Take a moment to picture the block sliding on the table.", false);
    const { result, elapsedMs } = await h.settle(h.runner.runSegment(beat, 0, [beat], 1));
    assert.deepEqual(result?.value, { voiceDegraded: true });
    assert(elapsedMs > 6_500 + 500, "the silent sentence is not skipped instantly");
    assert.equal(h.params.recordedSegmentsRef.current.length, 1);
  } finally { h.close(); }
});

check("a voice that recovers speaks the next sentence", async () => {
  const h = mount();
  try {
    const first = segment("The block starts from rest.");
    const second = segment("Its speed grows by two metres per second every second.");
    const stalled = await h.settle(h.runner.runSegment(first, 0, [first, second], 1));
    assert.deepEqual(stalled.result?.value, { voiceDegraded: true });
    h.setProvider("speaks");
    const spoken = await h.settle(h.runner.runSegment(second, 1, [first, second], 1));
    assert.equal(spoken.result?.error, undefined);
    assert.equal(spoken.result?.value, undefined, "a spoken beat is an ordinary beat");
    assert.equal(h.jobs.length, 2, "the provider was asked again for the next sentence");
    assert.equal(h.jobs[1]!.abandoned, false);
    assert.equal(h.params.recordedSegmentsRef.current.length, 2);
  } finally { h.close(); }
});

check("Stop during a silent sentence stays quiet and records nothing", async () => {
  const h = mount();
  try {
    const beat = segment("Friction acts against the motion of the block.", false);
    const { result } = await h.settle(h.runner.runSegment(beat, 0, [beat], 1), 60_000, (elapsed) => {
      if (elapsed >= 9_500) h.params.cancelRef.current = true;
    });
    assert(result, "a stopped silent sentence ends");
    assert.equal(result.error, undefined, "a stopped turn stays quiet");
    assert.equal(h.params.recordedSegmentsRef.current.length, 0, "a stopped beat is not saved as taught");
  } finally { h.close(); }
});

check("Pause holds a silent sentence until resume", async () => {
  const h = mount();
  try {
    const beat = segment("Friction acts against the motion of the block, which slows it steadily.", false);
    let pausedAt = -1;
    const pending = h.runner.runSegment(beat, 0, [beat], 1);
    let finished = false;
    void pending.then(() => { finished = true; }, () => { finished = true; });
    // Past the 6.5 s deadline and the failed browser attempt: the silent sentence is running.
    for (let step = 0; step < 200 && !h.telemetry.includes("tts-voice-degraded"); step++) await h.advanceBy(50);
    assert(h.telemetry.includes("tts-voice-degraded"), "the sentence went silent");
    h.params.isPausedRef.current = true; h.runner.pauseFallbackSpeech(); pausedAt = 1;
    await h.advanceBy(60_000);
    assert.equal(finished, false, "Pause holds the silent sentence");
    h.params.isPausedRef.current = false; h.runner.resumeFallbackSpeech();
    const { result } = await h.settle(pending);
    assert(pausedAt > 0 && result && result.error === undefined, "resume lets the silent sentence finish");
    assert.equal(h.params.recordedSegmentsRef.current.length, 1);
  } finally { h.close(); }
});

check("a failed draw still rejects the beat and counts", async () => {
  const h = mount({ failDraw: true });
  h.setProvider("speaks");
  try {
    const beat = segment("Force equals mass times acceleration.");
    const failure = new Error("whiteboard command failed");
    const pending = h.runner.runSegment(beat, 0, [beat], 1);
    let outcome: unknown = "pending";
    void pending.then(() => { outcome = null; }, (error) => { outcome = error; });
    for (let step = 0; step < 100 && h.drawn.length === 0; step++) await h.advanceBy(25);
    h.failDraw(failure);
    const { result } = await h.settle(pending);
    assert.equal(result?.error, failure, "a real draw failure is still a failed beat");
    assert.equal(outcome, failure);
    assert.equal(h.params.recordedSegmentsRef.current.length, 0);
  } finally { h.close(); }
});

check("telemetry: voice degraded is saved, never a failure", async () => {
  const marked = withTeachingVoiceDegraded(withTeachingVoiceDegraded({ subject: "physics", issueCodes: ["planner_declined"] }));
  assert.deepEqual(marked.issueCodes, [TEACHING_VOICE_DEGRADED, "planner_declined"], "noted once, first, other codes kept");
  assert.equal(marked.failed, undefined);
  assert.equal(marked.code, undefined);
  const full = FAILED_TURN_ISSUE_CODES.filter((code) => code !== TEACHING_VOICE_DEGRADED).slice(0, 32);
  const crowded = withTeachingVoiceDegraded({ subject: "maths", issueCodes: [...full] });
  const persisted = readFailedTurnTelemetry(JSON.parse(JSON.stringify(crowded)));
  assert(persisted?.issueCodes?.includes(TEACHING_VOICE_DEGRADED), "the persistence allowlist keeps the code");
  const segments = [{ narration: "Force equals mass times acceleration.", command: { type: "WRITE" } }];
  for (const visualStatus of ["text_only", "validated", null]) {
    const verdict = classifyTurnFailure({
      visualStatus, status: "complete", segments,
      sceneArtifacts: { failureTelemetry: readFailedTurnTelemetry(withTeachingVoiceDegraded({ subject: "physics" })) },
    });
    assert.notEqual(verdict.classification, "failed", `a voice degraded lesson is not a failed turn (${String(visualStatus)})`);
  }
});

check("the queue marks voice degraded beats and keeps counting only rejections", async () => {
  const control = readFileSync(controlPath, "utf8");
  const start = control.indexOf("const enqueueSegment = useCallback(");
  const end = control.indexOf("const enqueueVerifiedIntro = useCallback(");
  assert(start > 0 && end > start, "enqueueSegment anchors");
  const enqueue = control.slice(start, end);
  assert(/const outcome = await runSegment\(/.test(enqueue), "the queue reads the beat outcome");
  assert(enqueue.includes("noteVoiceDegradedBeat(outcome,"), "a voice degraded beat marks the lesson");
  const tryAt = enqueue.indexOf("const outcome = await runSegment(");
  const catchAt = enqueue.indexOf("} catch (error) {", tryAt);
  const increment = enqueue.indexOf("consecutiveSegmentFailuresRef.current += 1");
  assert(catchAt > tryAt && increment > catchAt, "failures are counted only in the catch, never for a resolved beat");
  const introStart = control.indexOf("const enqueueVerifiedIntro = useCallback(");
  const introEnd = control.indexOf("const processResponseText = useCallback(");
  assert(introEnd > introStart, "verified intro anchors");
  assert(control.slice(introStart, introEnd).includes("noteVoiceDegradedBeat(beatOutcome,"), "intro beats mark the lesson too");
});

let finished = false;
process.on("beforeExit", () => { if (!finished) { console.error("voice stall gate never finished"); process.exitCode = 1; } });
(async () => {
  let failures = 0;
  for (const [name, run] of cases) {
    try { await run(); console.log(`ok   ${name}`); } catch (error) { failures++; console.error(`FAIL ${name}`); console.error(error); }
  }
  finished = true;
  if (failures > 0) { console.error(`${failures} voice stall check(s) failed`); process.exitCode = 1; }
  else console.log(`voice stall teaching: ${cases.length} checks passed`);
})();
