/** The live ink consumer forwards this segment's playback ownership, never a global voice flag. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import { drawSegmentInk, planSegmentInk, type SegmentInkClock } from "../../features/tutor-session/lib/turn/segmentInk";
import type { ExecuteCommandOptions, UseSegmentRunnerParams } from "../../features/tutor-session/hooks/turn/types";
import type { DrawCommand, TutorSegment } from "@heytutor/drawing";
import type { SpeakSegmentOptions, TTSClient } from "@heytutor/tutor-core";
import { mathToSpeech } from "@heytutor/tutor-core";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { probabilityIntroFixture } from "./fixtures/probabilityIntro";

const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const inkSource = fileURLToPath(new URL("../../features/tutor-session/lib/turn/segmentInk.ts", import.meta.url));
function loadInkSource(sourceFile: string): typeof import("../../features/tutor-session/lib/turn/segmentInk") {
  const compiled = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (specifier: string) => requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(inkSource), specifier) : specifier);
  new Function("require", "module", "exports", compiled)(localRequire, mod, mod.exports);
  return mod.exports as typeof import("../../features/tutor-session/lib/turn/segmentInk");
}
const ink = process.env.LIVE_AUDIO_INK_SOURCE ? loadInkSource(process.env.LIVE_AUDIO_INK_SOURCE) : { drawSegmentInk, planSegmentInk };

async function verifyForwarding() {
  const narration = "t minus one";
  const spoken = mathToSpeech(narration);
  const command: DrawCommand = { type: "WRITE", text: "t-1", params: [90, 208], charPosition: 0, narrationBefore: narration };
  let active = true;
  let scheduledWrites = 0;
  const isAudioActive = () => active;
  const clock: SegmentInkClock & { isAudioActive?: () => boolean } = {
    narration, getTimings: () => ({ charStartTimes: [...spoken].map((_, i) => i * .6), charDurations: [...spoken].map(() => .6), totalDuration: spoken.length * .6 }),
    totalSpeechMs: spoken.length * 600, estimatedSpeechMs: spoken.length * 600,
    getAudioPositionMs: () => 3050, getPlaybackRate: () => 1.25, isAudioActive,
    // Match the real live runner's completion owner: this stub ends speech
    // inside its WRITE callback, so there is no spoken explanation tail.
    isSpeechComplete: () => !active,
  };
  await ink.drawSegmentInk({
    plan: ink.planSegmentInk({ commands: [command], hasNarration: true, verifiedDiagramIntro: false }),
    verifiedDiagramIntro: false, clock, getDiagram: () => null,
    isCancelled: () => false, waitWhilePaused: async () => true,
    commandOptions: () => ({}), execute: async (_command, options: ExecuteCommandOptions) => {
      scheduledWrites++;
      const schedule = options.writeSchedule as (ExecuteCommandOptions["writeSchedule"] & { isAudioActive?: () => boolean }) | undefined;
      assert(schedule, "the actual live consumer produces its schedule without waiting for future TTS");
      assert.equal(schedule.isAudioActive, isAudioActive, "live ink must forward its segment-owned callback to the real handwriting consumer");
      assert.equal(schedule.isAudioActive?.(), true);
      active = false;
      assert.equal(schedule.isAudioActive?.(), false, "speech completion must be read live, not frozen at schedule construction");
    },
  });
  assert.equal(scheduledWrites, 1, "the original authored WRITE must reach its schedule consumer exactly once");
  console.log("verify-live-active-audio-write: dynamic segment playback ownership reaches scheduled ink");
}

const ref = <T>(current: T) => ({ current });
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean, message: string) {
  const deadline = performance.now() + 1000;
  while (!predicate() && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
  assert(predicate(), message);
}

/** Mount the complete production hook; only React, speech transport and persistence are inert. */
async function verifyRunner(mode: "onEnd" | "finally" | "failure" | "cancel" | "late-timings" | "browser" | "stale-onEnd" | "intro-failure" | "intro-cancel" | "heard-failure" | "intro-heard-failure") {
  const narration = "t minus one";
  const command: DrawCommand = { type: "WRITE", text: "t-1", params: [90, 208], charPosition: 0, narrationBefore: narration };
  const intro = mode.startsWith("intro-");
  // "failure" modes model a voice that started but was never heard (no
  // media clock). A heard clip whose local playback froze finishes its segment.
  const unheardFailure = mode === "failure" || mode === "intro-failure";
  const heardFailure = mode === "heard-failure" || mode === "intro-heard-failure";
  const introCommands = probabilityIntroFixture.commands.filter(row => row.type.startsWith("DRAW_")).slice(0, 2);
  const segment: TutorSegment = intro
    ? { narration, command: null, commands: structuredClone(introCommands), verifiedDiagramIntro: true }
    : { narration, command };
  const board = intro ? mountTestWhiteboard() : null;
  const transaction = board?.beginDrawTransaction();
  const executed: ExecuteCommandOptions[] = [];
  const voice = deferred(); const browserVoice = deferred(); const draw = deferred(); const cancellation = deferred();
  let providerOptions: SpeakSegmentOptions | undefined;
  let browserOptions: SpeakSegmentOptions | undefined;
  let seenClock: SegmentInkClock | undefined;
  let seenSchedule: ExecuteCommandOptions["writeSchedule"];
  const voiceDegradedFlags: boolean[] = [];
  const spoken = mathToSpeech(narration);
  const timings = { charStartTimes: [...spoken].map((_, i) => i * .6), charDurations: [...spoken].map(() => .6), totalDuration: spoken.length * .6 };
  const tts = {
    speakSegment: (_text: string, options: SpeakSegmentOptions) => { providerOptions = options; return voice.promise; },
    getPlaybackPositionMs: () => unheardFailure ? null : 3050, getPlaybackRate: () => 1.25,
    peekSegmentTimings: () => mode === "late-timings" || mode === "browser" ? null : timings,
    abandonSpeaking() {}, stop() {}, resume() {},
  } as unknown as TTSClient;
  class BrowserVoice {
    setPlaybackRate() {} stop() {} pause() {} resume() {}
    speakSegment(_text: string, options: SpeakSegmentOptions) {
      browserOptions = options; options.onStart?.(); return browserVoice.promise;
    }
  }
  const sourceFile = process.env.LIVE_AUDIO_RUNNER_SOURCE ?? fileURLToPath(new URL("../../features/tutor-session/hooks/turn/useSegmentRunner.ts", import.meta.url));
  const compiled = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = (specifier: string) => {
    if (specifier === "react") return { useRef: ref, useCallback: <T>(fn: T) => fn };
    if (specifier === "@heytutor/tutor-core") return { ...core, tutorDebug() {}, SpeechSynthesisTTSClient: BrowserVoice };
    if (specifier.endsWith("/segmentInk")) return { planSegmentInk: ink.planSegmentInk, drawSegmentInk: async (input: Parameters<typeof drawSegmentInk>[0]) => {
      seenClock = input.clock; await ink.drawSegmentInk(input);
    } };
    if (specifier.endsWith("/liveTurnSave")) return { liveTurnSave: () => ({ prepareSegment: () => null, recordRow() {} }) };
    if (specifier.endsWith("/turnTelemetry")) return { recordFirstAudible() {}, recordTtsFirstByte() {} };
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(fileURLToPath(new URL("../../features/tutor-session/hooks/turn/useSegmentRunner.ts", import.meta.url))), specifier) : specifier);
  };
  new Function("require", "module", "exports", compiled)(localRequire, mod, mod.exports);
  const runnerHooks = mod.exports as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner");
  const params: UseSegmentRunnerParams = {
    sessionId: "offline-audio-clock", activeVerifiedDiagramRef: ref(null),
    cancellableDelay: async () => {}, ensureTTSClient: () => tts,
    executeCommandWithCancel: async (_command, options) => {
      seenSchedule = options?.writeSchedule;
      if (options) executed.push(options);
      if (board) await board.drawShape("M 600 200 L 650 200", 0, { shouldCancel: options?.isCancelled });
      await draw.promise;
    },
    raceWithCancel: <T>(promise: Promise<T>) => Promise.race([promise, cancellation.promise]) as Promise<T>,
    applyTurnPhase() {}, cancelRef: ref(false), isPausedRef: ref(false), turnActiveRef: ref(true), turnGenerationRef: ref(1),
    turnTelemetryRef: ref(null), turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), recordedSegmentsRef: ref([]),
    narrationSinceEpochRef: ref(""), currentTraceIdRef: ref(null), setCurrentSegmentText() {},
    narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()), reserveTextCommandPlacements: async row => [row],
    onVoiceDegraded: degraded => { voiceDegradedFlags.push(degraded); },
  };
  const hook = runnerHooks.useSegmentRunner(params);
  const run = hook.runSegment(segment, 0, [segment], 1);
  // Observe immediately so an intentionally failed transport is never unhandled.
  const joined = run.then(() => undefined, error => error);
  try {
    await until(() => providerOptions !== undefined, "the actual runner dispatches its owned provider attempt");
    if (mode === "browser") {
      voice.resolve();
      await until(() => seenSchedule !== undefined, "browser recovery reaches the estimated live ink consumer");
      assert.equal(seenSchedule?.isAudioActive?.(), false, "browser wall time cannot claim an authoritative provider media clock");
      browserOptions?.onEnd?.(); browserVoice.resolve();
    } else {
      providerOptions?.onStart?.();
      await until(() => intro ? executed.length > 0 : seenSchedule !== undefined, "the actual runner reaches its live ink consumer");
      assert.equal(seenClock?.isAudioActive?.(), true, "an accepted live segment owns its positive provider clock");
      assert.equal(seenClock?.isSpeechComplete?.(), false);
      if (mode === "late-timings") {
        assert.equal(seenClock?.getTimings(), null, "estimated ink begins before late provider alignment arrives");
        providerOptions?.onTimings?.(timings);
        assert.equal(seenClock?.getTimings(), timings, "later alignment remains available to subsequent commands");
      }
      if (mode === "onEnd") {
        providerOptions?.onEnd?.();
        assert.equal(seenSchedule?.isAudioActive?.(), false, "accepted onEnd releases the exact schedule before the provider promise settles");
      } else if (unheardFailure) voice.reject(new Error("offline provider failed after starting"));
      else if (heardFailure) voice.reject(new Error("Native audio playback clock did not advance"));
      else if (mode === "cancel" || mode === "intro-cancel") { params.cancelRef.current = true; cancellation.resolve(); }
      else if (mode === "stale-onEnd") {
        params.turnGenerationRef.current++;
        providerOptions?.onEnd?.();
        assert.equal(seenClock?.isSpeechComplete?.(), false, "an obsolete provider onEnd cannot complete a superseded segment");
        cancellation.resolve();
      }
      voice.resolve();
    }
    await until(() => seenClock?.isAudioActive?.() === false, `${mode}: the actual speech finally path releases positive-clock authority`);
    const voiceFailed = unheardFailure;
    if (intro) {
      // The silent hold runs for the sentence's estimated length, heard or not.
      if (voiceFailed || heardFailure) await until(() => seenClock?.isSpeechComplete?.() === true, "the silent sentence ends");
      assert.equal(seenClock?.isSpeechComplete?.(), true, "failure finally releases the speech wait");
      // A voice failure, heard or not, is taught silently: the figure's ink keeps drawing. Stop still cancels it.
      if (heardFailure) assert.equal(executed[0]?.isCancelled?.(), false, "a heard voice that fails keeps drawing its verified figure");
      else assert.equal(executed[0]?.isCancelled?.(), !voiceFailed, "Stop cancels the retained figure draw; a voice failure does not");
    }
    draw.resolve();
    const outcome = await joined;
    if (heardFailure) {
      assert.equal(outcome, undefined, `${mode}: a heard voice that fails finishes its segment instead of rejecting`);
      assert.equal(params.recordedSegmentsRef.current.length, 1, `${mode}: the finished segment is recorded`);
      if (board) assert(executed.length >= 2, "every verified mark of the figure beat is drawn");
      // #275: the unheard rest of the sentence is shown as words, not dropped.
      assert.equal(voiceDegradedFlags.at(-1), true, `${mode}: the student is told the voice failed and sees the words`);
      if (board && transaction) { board.abortDrawTransaction(transaction); board.finishAbortedDrawTransaction(transaction); }
      console.log(`live runner ${mode}: heard voice failed, segment finished`);
      return;
    }
    // A started voice that fails is taught silently and resolves; the queue never counts it.
    assert.equal(outcome, undefined, `${mode}: the actual consumer settles after its owned speech outcome`);
    assert.equal(seenClock?.isAudioActive?.(), false, "a retained schedule never follows a later segment's speech state");
    if (mode === "intro-failure") {
      assert.equal(params.recordedSegmentsRef.current.length, 1, "the silently taught intro beat completes and waits for its figure");
      if (board && transaction) { board.abortDrawTransaction(transaction); board.finishAbortedDrawTransaction(transaction); }
    } else if (board && transaction) {
      assert.equal(executed.length, 1, "failure/Stop cannot execute or fast-forward the remaining verified mark");
      assert(executed.every(options => options.finishVerifiedDiagramIntro !== true), "failed intro speech cannot authorize catch-up");
      assert.equal(params.recordedSegmentsRef.current.length, 0, "failed intro has no successful persistence row");
      assert(board.getDrawLayer()!.getChildren().length > 0, "the owner must roll back actual already-drawn speculative ink");
      board.abortDrawTransaction(transaction); board.finishAbortedDrawTransaction(transaction);
      assert.equal(board.getDrawLayer()!.getChildren().length, 0, "the transaction owner removes the interrupted intro's actual ink");
    }
    console.log(`live runner ${mode}: owned media clock released`);
  } finally {
    params.cancelRef.current = true; cancellation.resolve(); voice.resolve(); browserVoice.resolve(); draw.resolve();
    await joined;
    if (board) unmountTestWhiteboard(board);
  }
}

async function main() {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
  try {
    await verifyForwarding();
    for (const mode of ["onEnd", "finally", "failure", "cancel", "late-timings", "browser", "stale-onEnd", "intro-failure", "intro-cancel", "heard-failure", "intro-heard-failure"] as const) await verifyRunner(mode);
  } finally { Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow }); }
}
const watchdog = setTimeout(() => { console.error("live audio ownership verifier exceeded its 10s watchdog"); process.exit(1); }, 10_000);
void main().then(() => { clearTimeout(watchdog); }, error => { clearTimeout(watchdog); console.error(error); process.exitCode = 1; });
