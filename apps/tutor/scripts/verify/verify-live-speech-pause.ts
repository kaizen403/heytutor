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
    const canAcceptBrowser = () => true;
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

/** Run the live consumer's failure branch, including a failure after onStart. */
function verifyTerminalSpeechFailureReachesQueue(runner: string) {
  const source = ts.createSourceFile("useSegmentRunner.ts", runner, ts.ScriptTarget.Latest, true);
  let failureBody: ts.Block | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCatchClause(node) && node.block.getText(source).includes('"segment speech failed"')) {
      failureBody = node.block;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(failureBody, "execute the actual live speech consumer catch, not a copied policy");
  const compiled = ts.transpileModule(`function fail(error: Error, state: { cancelled: boolean; started: boolean; browser: boolean; recovery: boolean; ownsFallback?: boolean }, observe: (value: unknown) => void) {
    let speechAborted = false, terminalSpeechFailure = false;
    let stopped = 0, abandoned = 0;
    const isCancelled = () => state.cancelled;
    const browserFallbackOwnerRef = { current: state.ownsFallback === false ? "successor" : "owner" }, segmentFallbackOwner = "owner";
    const stopFallbackSpeech = () => { stopped++; };
    const tutorDebug = () => {}, tel = { mark() {} }, index = 0, timedOut = false;
    const tts = { abandonSpeaking: () => { abandoned++; } };
    const providerRecoveryAttempted = state.recovery;
    const audioStartedAtMs = state.started ? 100 : null, usingBrowserFallback = state.browser;
    try ${failureBody.getText(source)} finally {
      // Observe the actual consumer's state and media cleanup even when it
      // propagates the original error to the queue.
      observe?.({ speechAborted, terminalSpeechFailure, stopped, abandoned });
    }
    return { speechAborted, terminalSpeechFailure, stopped, abandoned };
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const fail = new Function(`${compiled}\nreturn fail;`)() as (error: Error, state: {
    cancelled: boolean; started: boolean; browser: boolean; recovery: boolean; ownsFallback?: boolean;
  }, observe?: (value: { speechAborted: boolean; terminalSpeechFailure: boolean; stopped: number; abandoned: number }) => void) => {
    speechAborted: boolean; terminalSpeechFailure: boolean; stopped: number; abandoned: number;
  };
  const error = new Error("partial playback stalled");
  for (const started of [false, true]) {
    for (const browser of [false, true]) {
      for (const ownsFallback of [true, false]) {
        let observed: unknown;
        assert.throws(() => fail(error, { cancelled: false, started, browser, recovery: false, ownsFallback }, value => { observed = value; }),
          (actual) => actual === error,
          "provider and browser failures must reach the queue even after audio started");
        assert.deepEqual(observed, { speechAborted: true, terminalSpeechFailure: true, stopped: ownsFallback ? 1 : 0, abandoned: 1 },
          "a terminal speech failure cleans its own fallback without stopping a replacement browser voice");
      }
    }
  }
  for (const started of [false, true]) {
    for (const browser of [false, true]) {
      for (const ownsFallback of [true, false]) {
        let cancelled: unknown;
        assert.doesNotThrow(() => { cancelled = fail(error, { cancelled: true, started, browser, recovery: false, ownsFallback }); },
          "cancelled/superseded speech failures do not reach the queue");
        assert.deepEqual(cancelled, { speechAborted: true, terminalSpeechFailure: false, stopped: ownsFallback ? 1 : 0, abandoned: 1 },
          "a cancelled/superseded turn stays quiet and never stops a replacement browser voice");
      }
    }
  }
  for (const ownsFallback of [true, false]) {
    let observed: unknown;
    assert.throws(() => fail(error, { cancelled: false, started: true, browser: false, recovery: true, ownsFallback }, value => { observed = value; }),
      (actual) => actual instanceof Error && actual.message === "Provider voice recovery failed" && actual.cause === error,
      "failed recovery is not tolerated as an intro startup miss");
    assert.deepEqual(observed, { speechAborted: true, terminalSpeechFailure: true, stopped: ownsFallback ? 1 : 0, abandoned: 1 },
      "failed recovery retains terminal state and cleans only its owned fallback");
    let cancelledRecovery: unknown;
    assert.doesNotThrow(() => { cancelledRecovery = fail(error, { cancelled: true, started: true, browser: false, recovery: true, ownsFallback }); },
      "cancelled recovery does not report a new terminal error");
    assert.deepEqual(cancelledRecovery, { speechAborted: true, terminalSpeechFailure: false, stopped: ownsFallback ? 1 : 0, abandoned: 1 },
      "cancelled recovery neither throws a terminal failure nor stops successor speech");
  }
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

  // A cancellation rejection can arrive after rapid Pause/Resume, when the
  // boolean is no longer paused. Ownership is the attempt's pause generation.
  let rejectedGeneration = 0;
  let rejectedAttempts = 0;
  await speakWithPauseOwnedFallback({
    speak: async ({ onStart, onEnd, onError }) => {
      rejectedAttempts++;
      onStart();
      if (rejectedAttempts === 1) {
        rejectedGeneration++;
        const error = new DOMException("pause interrupted browser start", "AbortError");
        onError(error);
        throw error;
      }
      onEnd();
    },
    waitWhilePaused: async () => true,
    isCancelled: () => false,
    pauseGeneration: () => rejectedGeneration,
  });
  assert.equal(rejectedAttempts, 2, "a rejected pause-owned attempt must replay the same sentence after rapid resume");

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

  const runner = readFileSync(process.env.LIVE_SPEECH_PAUSE_TEST_SOURCE ?? new URL("../../features/tutor-session/hooks/turn/useSegmentRunner.ts", import.meta.url), "utf8");
  const control = readFileSync(new URL("../../features/tutor-session/hooks/turn/useTurnControl.ts", import.meta.url), "utf8");
  assert.match(runner, /clock\.elapsedMs\(\)/, "live runner must use active time for playback and hard deadlines");
  assert.match(runner, /waitClock\.elapsedMs\(\)/, "the live initial ink wait must exclude pauses too");
  assert.match(runner, /speakWithPauseOwnedFallback\(/, "live runner must await the pause-owned browser utterance");
  assert.match(runner, /browserRecoveryRate = browserRecoveryPlaybackRate\(/);
  assert.match(runner, /browserSpeechRef\.current\.setPlaybackRate\(segmentPlaybackRate\(\)\)/);
  assert.match(runner, /audioStartedAtMs = performance\.now\(\);\s*audioStartedAtActiveMs = clock\.elapsedMs\(\);/, "browser speech restarting after pause must reset its media clock");
  assert.match(runner, /playbackRate: segmentPlaybackRate\(\)/);
  assert.match(runner, /getPlaybackRate: segmentPlaybackRate/g);
  verifyTerminalSpeechFailureReachesQueue(runner);
  assert.match(runner, /if \(providerRecoveryAttempted && !isCancelled\(\)\)[\s\S]*?throw new Error\("Provider voice recovery failed"/, "failed provider recovery must not be swallowed as a tolerable intro startup miss");

  assert.match(control, /pauseFallbackSpeech\(\)/);
  assert.match(control, /resumeFallbackSpeech\(\)/);
  assert.match(runner, /const stopFallbackSpeech = \(\) => \{[\s\S]*?speechClockRef\.current\?\.resume\(\);/, "stopping a paused turn must release its pending startup deadline");
  assert.match(control, /stopFallbackSpeech\(\)/);
  verifyRestartedBrowserSpeechDoesNotLeadInk(runner);
  console.log("verified live speech deadlines, owned/superseded fallback failure cleanup, and restarted-voice ink clock");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
