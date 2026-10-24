/** Late failures may clean their own voice, never a successor's shared client. */
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

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const runnerPath = path.join(app, "features/tutor-session/hooks/turn/useSegmentRunner.ts");
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const segment = (narration: string, paired = false): TutorSegment => ({ narration, command: paired ? {
  type: "WRITE", text: "F = ma", params: [90, 142], charPosition: 0, narrationBefore: narration,
} : null });
type Job = { options: SpeakSegmentOptions; resolve: () => void; reject: (error: Error) => void; abandoned: boolean };

function mount(deferFirstDraw = false, browserStartup = false) {
  let now = 1_000, sequence = 0, browserAttempts = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const jobs: Job[] = [], browserJobs: Job[] = [], abandons: number[] = [], drawn: string[] = [], telemetry: string[] = [];
  let rejectDraw: ((error: Error) => void) | undefined;
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
  replace("fetch", () => { throw new Error("ownership gate forbids provider/network calls"); });
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
  const until = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 32 && !predicate(); turn++) await advance(now + 25);
    assert(predicate(), "the actual runner must admit the controlled voice/ink event");
  };
  const tts = {
    speakSegment: (text: string, options: SpeakSegmentOptions) => new Promise<void>((resolve, reject) => {
      jobs.push({ options, resolve, reject, abandoned: false });
      if (browserStartup) { reject(new Error("provider did not start")); return; }
      const spoken = core.mathToSpeech(text);
      options.onTimings?.({ totalDuration: 2, charStartTimes: [...spoken].map((_, i) => i * 2 / spoken.length),
        charDurations: [...spoken].map(() => 2 / spoken.length) });
      options.onStart?.();
    }),
    getPlaybackPositionMs: () => 120, getPlaybackRate: () => 1,
    peekSegmentTimings: () => null, prefetchSegment: noop,
    abandonSpeaking: () => {
      const current = jobs.length - 1;
      abandons.push(current);
      if (jobs[current]) jobs[current]!.abandoned = true;
    },
    stop: noop,
  } as unknown as TTSClient;
  class BrowserVoice {
    setPlaybackRate() {} resume() {}
    stop() { browserJobs.at(-1)?.reject(new DOMException("owned browser stopped", "AbortError")); }
    pause() { browserJobs.at(-1)?.reject(new DOMException("owned browser paused", "AbortError")); }
    async speakSegment(_text: string, options: SpeakSegmentOptions) {
      browserAttempts++;
      if (!browserStartup) throw new Error("already-started speech cannot fall back");
      await new Promise<void>((resolve, reject) => {
        browserJobs.push({ options, resolve, reject, abandoned: false });
        options.onStart?.();
      });
    }
  }
  const compiled = ts.transpileModule(readFileSync(process.env.SEGMENT_SPEECH_OWNERSHIP_SOURCE ?? runnerPath, "utf8"), {
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
  const params = {
    sessionId: "offline-owned-speech", activeVerifiedDiagramRef: ref(null),
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
      if (deferFirstDraw && drawn.length === 1) await new Promise<void>((_resolve, reject) => { rejectDraw = reject; });
    },
  };
  const hook = mod.exports as unknown as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner");
  const runner = hook.useSegmentRunner(params as unknown as UseSegmentRunnerParams);
  return { runner, params, jobs, drawn, abandons, telemetry, until, flush, advanceBy: (ms: number) => advance(now + ms), browserAttempts: () => browserAttempts,
    failDraw: (error: Error) => { assert(rejectDraw); rejectDraw(error); },
    end: (index: number) => { const job = jobs[index]; assert(job); job.options.onEnd?.(); job.resolve(); },
    close: () => {
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

async function speechFailure(owner: "current" | "cancelled" | "superseded") {
  const h = mount();
  try {
    const old = segment("Old accepted voice.");
    const original = new Error("owned speech failed after onStart");
    const pending = h.runner.runSegment(old, 0, [old], 1).then(() => null, error => error as unknown);
    await h.until(() => h.jobs.length === 1);
    let successor: Promise<unknown> | undefined;
    if (owner === "cancelled") h.params.cancelRef.current = true;
    if (owner === "superseded") {
      h.params.turnGenerationRef.current = 2;
      const next = segment("New accepted voice.");
      successor = h.runner.runSegment(next, 0, [next], 2);
      await h.until(() => h.jobs.length === 2);
    }
    h.jobs[0]!.reject(original);
    await h.flush();
    let settled = false;
    void pending.then(() => { settled = true; });
    // A current voice failure is taught silently for the sentence's estimated length.
    for (let step = 0; owner === "current" && step < 400 && !settled; step++) await h.advanceBy(50);
    assert.equal(await pending, null, "a voice failure never reaches the caller: the beat is taught silently or stays quiet");
    assert.deepEqual(h.abandons, owner === "current" ? [0] : [], "late cleanup cannot abandon a shared successor provider");
    assert.equal(h.params.recordedSegmentsRef.current.length, owner === "current" ? 1 : 0,
      "the current beat is recorded as taught; a cancelled or superseded one records nothing");
    if (owner === "current") assert.equal(h.params.recordedSegmentsRef.current[0]!.audioBytes, null, "a silent beat saves no audio");
    if (successor) {
      assert.equal(h.jobs[1]!.abandoned, false);
      h.end(1); await successor;
      assert.equal(h.params.recordedSegmentsRef.current.length, 1, "the successor retains its real successful completion");
    }
    assert.equal(h.browserAttempts(), 0, "after-onStart failure does not change fallback policy");
    console.log(`actual speech failure/${owner}: owned cleanup`);
  } finally { h.close(); }
}

async function drawFailure(superseded: boolean) {
  const h = mount(true);
  try {
    const old = segment("Force equals mass times acceleration.", true);
    const original = new Error("asynchronous owned ink failed");
    const pending = h.runner.runSegment(old, 0, [old], 1).then(() => null, error => error as unknown);
    await h.until(() => h.jobs.length === 1 && h.drawn.length === 1);
    let successor: Promise<unknown> | undefined;
    if (superseded) {
      h.params.turnGenerationRef.current = 2;
      const next = segment("New voice while old ink returns.");
      successor = h.runner.runSegment(next, 0, [next], 2);
      await h.until(() => h.jobs.length === 2);
    }
    h.failDraw(original); await h.flush();
    if (superseded) assert.deepEqual(h.abandons, [], "obsolete async draw cannot abandon the successor's voice");
    else assert(h.abandons.includes(0), "current ink failure must still silence its owned speech");
    h.end(0);
    assert.equal(await pending, original, "the actual failed ink remains a rejected segment");
    if (successor) {
      assert.equal(h.jobs[1]!.abandoned, false);
      h.end(1); await successor;
      assert.equal(h.params.recordedSegmentsRef.current.length, 1);
    }
    assert.equal(h.browserAttempts(), 0);
    console.log(`actual draw failure/${superseded ? "superseded" : "current"}: owned cleanup`);
  } finally { h.close(); }
}

async function retiredIntroDraw() {
  const h = mount(true, true);
  try {
    const intro = { ...segment("An existing verified introduction.", true), verifiedDiagramIntro: true };
    const failure = new Error("retired intro executor rejected during restart join");
    const pending = h.runner.runSegment(intro, 0, [intro], 1, noop).then(() => null, error => error as unknown);
    await h.until(() => h.drawn.length === 1 && h.browserAttempts() === 1);
    h.params.isPausedRef.current = true;
    h.runner.pauseFallbackSpeech();
    await h.flush();
    h.runner.resumeFallbackSpeech(); // Synchronously retires the old intro draw.
    h.params.isPausedRef.current = false;
    await h.flush();
    assert.equal(h.params.turnGenerationRef.current, 1, "this replacement belongs to the same outer turn");
    h.failDraw(failure); await h.flush();
    assert(!h.telemetry.includes("segment-draw-failed"), "retired intro ink cannot claim the current draw's speech cleanup");
    assert.equal(await pending, failure, "the failed restart join still reaches its original caller");
    assert.equal(h.params.recordedSegmentsRef.current.length, 0);
    console.log("actual intro draw retired within same turn: generation-owned cleanup");
  } finally { h.close(); }
}

async function main() {
  let failures = 0;
  for (const owner of ["current", "cancelled", "superseded"] as const) {
    try { await speechFailure(owner); } catch (error) { failures++; console.error(error); }
  }
  for (const superseded of [false, true]) {
    try { await drawFailure(superseded); } catch (error) { failures++; console.error(error); }
  }
  try { await retiredIntroDraw(); } catch (error) { failures++; console.error(error); }
  assert.equal(failures, 0, "all actual runner cleanup must preserve media ownership");
}
let finished = false;
// A runner that never settles must not exit 0 with nothing printed.
process.on("beforeExit", () => { if (!finished) { console.error("gate never finished"); process.exitCode = 1; } });
main().then(() => { finished = true; }, error => { finished = true; console.error(error); process.exitCode = 1; });
