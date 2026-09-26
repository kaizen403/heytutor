import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveLiveAudioPositionMs } from "@heytutor/tutor-core";
import {
  browserRecoveryPlaybackRate,
  createPauseAwareSpeechClock,
  speakWithPauseOwnedFallback,
  speakWithStartupRecovery,
  speechPlaybackOverdue,
  waitForSpeechStartup,
} from "../../features/tutor-session/lib/turn/speechStartup";

/** Exercise the runner's actual clock and browser onStart callback without mounting React. */
function verifyRestartedBrowserSpeechDoesNotLeadInk(runner: string) {
  const source = ts.createSourceFile("useSegmentRunner.ts", runner, ts.ScriptTarget.Latest, true);
  let maxDeclaration: ts.VariableDeclaration | undefined;
  let positionDeclaration: ts.VariableDeclaration | undefined;
  let browserOnStart: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) {
      if (node.name.getText(source) === "maxAudioPositionMs") maxDeclaration = node;
      if (node.name.getText(source) === "liveAudioPositionMs") positionDeclaration = node;
    }
    if (ts.isCallExpression(node) && node.expression.getText(source).includes("browserSpeechRef.current!.speakSegment")) {
      const options = node.arguments[1];
      if (options && ts.isObjectLiteralExpression(options)) {
        const start = options.properties.find((property) =>
          ts.isPropertyAssignment(property) && property.name.getText(source) === "onStart",
        );
        if (start && ts.isPropertyAssignment(start) && ts.isArrowFunction(start.initializer)) {
          browserOnStart = start.initializer;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(maxDeclaration?.initializer && positionDeclaration?.initializer && browserOnStart,
    "the test must execute the live runner's media clock and browser fallback onStart");

  const harness = `
    let audioStartedAtMs: number | null = null;
    let audioStartedAtActiveMs: number | null = null;
    let usingBrowserFallback = true;
    const tts = { getPlaybackPositionMs: () => 1_600 };
    const speechClockRef = { current: clock };
    const segmentPlaybackRate = () => 1;
    const isCancelled = () => false;
    const onStart = () => {};
    const options = { onStart: () => {
      if (audioStartedAtMs === null) {
        audioStartedAtMs = now();
        audioStartedAtActiveMs = clock.elapsedMs();
      }
    } };
    let speechComplete = false;
    let capturedDurationMs: number | null = null;
    let capturedTimings: null = null;
    const estimateSpeechMs = 4_000;
    let maxAudioPositionMs = ${maxDeclaration.initializer.getText(source)};
    const liveAudioPositionMs = ${positionDeclaration.initializer.getText(source)};
    const restart = ${browserOnStart.getText(source)};
    return { liveAudioPositionMs, restart };
  `;
  const compiled = ts.transpileModule(`function makeHarness(clock: unknown, now: () => number) { ${harness} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const makeHarness = new Function("resolveLiveAudioPositionMs", `${compiled}\nreturn makeHarness;`)(
    resolveLiveAudioPositionMs,
  ) as (clock: ReturnType<typeof createPauseAwareSpeechClock>, now: () => number) => {
    liveAudioPositionMs: () => number;
    restart: () => void;
  };

  let nowMs = 0;
  const clock = createPauseAwareSpeechClock(() => nowMs);
  const { liveAudioPositionMs, restart } = makeHarness(clock, () => nowMs);
  restart(); // First browser utterance starts the sentence.
  nowMs = 1_600;
  assert.equal(liveAudioPositionMs(), 1_600, "ink had followed the first utterance");
  clock.pause(); // Browser pause cancels this utterance.
  nowMs = 7_600;
  assert.equal(liveAudioPositionMs(), 1_600, "paused time must not advance ink");
  clock.resume();
  restart(); // Resume starts the same sentence from the beginning.
  assert.equal(liveAudioPositionMs(), 0, "restarted voice must not inherit earlier ink position");
  nowMs = 7_780;
  assert.equal(liveAudioPositionMs(), 180, "draw clock must follow restarted speech, not the old 1.6s high water");
}

async function main() {
  assert.equal(browserRecoveryPlaybackRate(1.5), 1, "browser TTS must not pitch up at lesson speed");
  assert.equal(browserRecoveryPlaybackRate(0.75), 0.75, "slower-than-natural speech remains available");
  let now = 0;
  const clock = createPauseAwareSpeechClock(() => now);
  now = 2_000;
  clock.pause();
  now = 32_000;
  assert.equal(clock.elapsedMs(), 2_000, "pause time must not consume the segment deadline");
  assert(!speechPlaybackOverdue({ elapsedMs: clock.elapsedMs(), audioDurationMs: 4_000, playbackRate: 1, paused: false }));
  clock.resume();
  now = 39_000;
  assert.equal(clock.elapsedMs(), 9_000);
  clock.pause();
  now = 49_000;
  clock.resume();
  assert.equal(clock.elapsedMs(), 9_000, "successive pauses must not consume active time");
  assert(speechPlaybackOverdue({ elapsedMs: clock.elapsedMs(), audioDurationMs: 4_000, playbackRate: 1, paused: false }));

  const pending = new Promise<void>(() => {});
  const startupClock = createPauseAwareSpeechClock();
  startupClock.pause();
  let outcome: string | null = null;
  const startup = waitForSpeechStartup(pending, pending, 10, startupClock).then((value) => { outcome = value; });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(outcome, null, "startup timeout must be suspended while paused");
  startupClock.resume();
  await startup;
  assert.equal(outcome, "timeout");

  let settlePrimary!: () => void;
  const primary = new Promise<void>((resolve) => { settlePrimary = resolve; });
  const settledClock = createPauseAwareSpeechClock();
  settledClock.pause();
  let recoveries = 0;
  let completed = false;
  const recovered = speakWithStartupRecovery({
    primary: () => primary,
    fallback: async () => { recoveries++; },
    abandonPrimary: () => {},
    hasStarted: () => false,
    canFallback: () => true,
    deadlineMs: 10,
    clock: settledClock,
  }).then(() => { completed = true; });
  settlePrimary();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(completed, false, "a primary settling during pause must not silently finish the segment");
  assert.equal(recoveries, 0);
  settledClock.resume();
  await recovered;
  assert.equal(recoveries, 1, "recovery must start after resume");

  let paused = false;
  let generation = 0;
  let releaseFirst!: () => void;
  let releaseResume!: () => void;
  const resumed = new Promise<void>((resolve) => { releaseResume = resolve; });
  const starts: number[] = [];
  let attempts = 0;
  let finished = false;
  const fallback = speakWithPauseOwnedFallback({
    speak: async ({ onStart, onEnd }) => {
      attempts++;
      starts.push(attempts);
      onStart();
      if (attempts === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      else onEnd();
    },
    waitWhilePaused: async () => { if (paused) await resumed; return true; },
    isCancelled: () => false,
    pauseGeneration: () => generation,
  }).then(() => { finished = true; });
  await Promise.resolve();
  paused = true;
  generation++;
  releaseFirst(); // Browser client's pause() cancels its utterance and settles speakSegment.
  await Promise.resolve();
  assert.equal(finished, false, "cancelled browser utterance must not count as a completed beat");
  paused = false;
  releaseResume();
  await fallback;
  assert.deepEqual(starts, [1, 2], "resume must retry a browser utterance cancelled by pause");

  let cancelled = false;
  let stopUtterance!: () => void;
  let startsAfterFailure = 0;
  const stoppedFallback = speakWithPauseOwnedFallback({
    speak: async ({ onStart }) => {
      startsAfterFailure++;
      onStart();
      await new Promise<void>((resolve) => { stopUtterance = resolve; });
    },
    waitWhilePaused: async () => true,
    isCancelled: () => cancelled,
    pauseGeneration: () => 0,
  });
  await Promise.resolve();
  cancelled = true;
  stopUtterance();
  await stoppedFallback;
  assert.equal(startsAfterFailure, 1, "a failed/stopped beat must not restart browser speech");
  await assert.rejects(speakWithPauseOwnedFallback({
    speak: async () => {},
    waitWhilePaused: async () => true,
    isCancelled: () => false,
    pauseGeneration: () => 0,
  }), /Browser speech did not complete/, "a silent browser fallback cannot advance the lesson");

  const runner = readFileSync(new URL("../../features/tutor-session/hooks/turn/useSegmentRunner.ts", import.meta.url), "utf8");
  const control = readFileSync(new URL("../../features/tutor-session/hooks/turn/useTurnControl.ts", import.meta.url), "utf8");
  assert.match(runner, /clock\.elapsedMs\(\)/, "live runner must use active time for playback and hard deadlines");
  assert.match(runner, /waitClock\.elapsedMs\(\)/, "the live initial ink wait must exclude pauses too");
  assert.match(runner, /speakWithPauseOwnedFallback\(/, "live runner must await the pause-owned browser utterance");
  assert.match(runner, /browserRecoveryRate = browserRecoveryPlaybackRate\(/);
  assert.match(runner, /browserSpeechRef\.current\.setPlaybackRate\(segmentPlaybackRate\(\)\)/);
  assert.match(runner, /audioStartedAtMs = performance\.now\(\);\s*audioStartedAtActiveMs = clock\.elapsedMs\(\);/, "browser speech restarting after pause must reset its media clock");
  assert.match(runner, /playbackRate: segmentPlaybackRate\(\)/);
  assert.match(runner, /getPlaybackRate: segmentPlaybackRate/g);
  assert.match(runner, /if \(\(audioStartedAtMs === null \|\| usingBrowserFallback\) && !isCancelled\(\)\) throw error;/, "failed browser recovery must not count as a successful lesson beat even after partial audio");
  assert.match(runner, /speechAborted = true;\s*if \(browserFallbackOwnerRef\.current === segmentFallbackOwner\) stopFallbackSpeech\(\);/, "an obsolete segment must not stop a newer turn's browser voice");
  assert.match(control, /pauseFallbackSpeech\(\)/);
  assert.match(control, /resumeFallbackSpeech\(\)/);
  assert.match(runner, /const stopFallbackSpeech = \(\) => \{[\s\S]*?speechClockRef\.current\?\.resume\(\);/, "stopping a paused turn must release its pending startup deadline");
  assert.match(control, /stopFallbackSpeech\(\)/);
  verifyRestartedBrowserSpeechDoesNotLeadInk(runner);
  console.log("verified live speech deadlines, browser fallback, and restarted-voice ink clock");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
