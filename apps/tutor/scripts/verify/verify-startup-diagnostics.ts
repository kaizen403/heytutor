import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { DrawCommand, TutorSegment } from "@heytutor/drawing";
import type { SpeakSegmentOptions, TTSClient } from "@heytutor/tutor-core";
import type { SpeechStartupStatus, UseSegmentRunnerParams, UseTurnLifecycleParams } from "../../features/tutor-session/hooks/turn/types";
import { StreamingSpeechClient } from "../../../../packages/tutor-core/src/tts/streamingSpeechClient";

const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const core = { ...requireApp("@heytutor/tutor-core") };
const effects: Array<() => unknown> = [];
const react = { useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => unknown) => { effects.push(fn); }, useState: (value: unknown) => [value, () => {}] };
const modules = new Map<string, Record<string, unknown>>();
function loadHook(file: string): Record<string, unknown> {
  if (modules.has(file)) return modules.get(file)!;
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    if (specifier === "@heytutor/tutor-core") return core;
    if (specifier === "./useSegmentRunner") return loadHook(path.resolve(path.dirname(file), `${specifier}.ts`));
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  }, loaded, loaded.exports);
  modules.set(file, loaded.exports);
  return loaded.exports;
}
const hooks = path.resolve(import.meta.dirname, "../../features/tutor-session/hooks/turn");
const runSegmentHook = loadHook(path.join(hooks, "useSegmentRunner.ts")).useSegmentRunner as typeof import("../../features/tutor-session/hooks/turn/useSegmentRunner").useSegmentRunner;
const runTurnControlHook = loadHook(path.join(hooks, "useTurnControl.ts")).useTurnControl as typeof import("../../features/tutor-session/hooks/turn/useTurnControl").useTurnControl;
const ref = <T,>(current: T) => ({ current });

let now = 67_000;
let sequence = 0;
const timers = new Map<number, { at: number; run: () => void }>();
const listeners = new Map<string, (event: unknown) => void>();
const saved = new Map<string, PropertyDescriptor | undefined>();
function replace(key: string, value: unknown) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const setTimer = (run: () => void, delay = 0) => {
  const id = ++sequence; timers.set(id, { at: now + delay, run }); return id;
};
replace("performance", { now: () => now });
replace("setTimeout", setTimer);
replace("clearTimeout", (id: number) => timers.delete(id));
replace("window", { setTimeout: setTimer, clearTimeout: (id: number) => timers.delete(id),
  addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
  removeEventListener: (name: string) => listeners.delete(name) });
class Element { isContentEditable = false; constructor(private button = false) {} closest() { return this.button ? this : null; } }
replace("HTMLElement", Element);
replace("HTMLInputElement", class extends Element {});
replace("HTMLTextAreaElement", class extends Element {});
core.SpeechSynthesisTTSClient = class {
  setPlaybackRate() {} getPlaybackRate() { return 1; } pause() {} resume() {} stop() {}
  async speakSegment() { throw new Error("offline browser recovery failed"); }
};
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const advance = async (target: number) => {
  await flush();
  while (true) {
    const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!due) break;
    now = due[1].at; timers.delete(due[0]); due[1].run(); await flush();
  }
  now = target; await flush();
};
type Event = { name: string; atMs: number; [key: string]: unknown };
const events: Event[] = [];
const record = (name: string, data: Record<string, unknown> = {}) => events.push({ name, atMs: now, ...data });
type Job = { options: SpeakSegmentOptions; resolve: () => void; startedAt: number | null };
const jobs: Job[] = [];
let current: Job | null = null;
let unlocks = 0;
let resumes = 0;
let abandonments = 0;
const tts: TTSClient = {
  speak: async () => {}, speakSegment: (_text, options = {}) => new Promise<void>((resolve) => {
    current = { options, resolve, startedAt: null }; jobs.push(current);
  }), prewarm: async () => {}, playAudio: async () => {},
  unlockAudio: () => { unlocks++; }, pause: () => {}, resume: () => { resumes++; }, stop: () => {},
  abandonSpeaking: () => { abandonments++; },
  get isPlaying() { return current != null && current.startedAt !== null; },
  getAudioContextState: () => "suspended",
  getPlaybackPositionMs: () => current?.startedAt == null ? null : now - current.startedAt,
  setPlaybackRate: () => {}, getPlaybackRate: () => 1,
};
let status: SpeechStartupStatus | null = null;
const statuses: Array<SpeechStartupStatus | null> = [];
const params: UseSegmentRunnerParams = {
  sessionId: "offline", activeVerifiedDiagramRef: ref(null), cancelRef: ref(false), isPausedRef: ref(false),
  turnActiveRef: ref(true), turnGenerationRef: ref(1), turnTelemetryRef: ref({
    mark: record, span: () => ({ end: () => {} }),
  } as unknown as NonNullable<UseSegmentRunnerParams["turnTelemetryRef"]["current"]>),
  turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), recordedSegmentsRef: ref([]), narrationSinceEpochRef: ref(""),
  currentTraceIdRef: ref(null), narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()),
  setCurrentSegmentText: () => {}, ensureTTSClient: () => tts,
  cancellableDelay: (ms) => new Promise<void>((resolve) => setTimer(resolve, ms)),
  raceWithCancel: async <T,>(promise: Promise<T>) => {
    const generation = params.turnGenerationRef.current;
    return new Promise<T | undefined>((resolve, reject) => {
      let id: number;
      const check = () => {
        if (params.cancelRef.current || generation !== params.turnGenerationRef.current) resolve(undefined);
        else id = setTimer(check, 25);
      };
      id = setTimer(check, 25);
      promise.then((value) => { timers.delete(id); resolve(value); }, (error) => { timers.delete(id); reject(error); });
    });
  },
  reserveTextCommandPlacements: async (command) => [command],
  executeCommandWithCancel: async (command: DrawCommand) => { record("ink", { text: command.text }); },
  applyTurnPhase: (phase) => record("phase", { phase }),
  onSpeechStartupStatus: (next) => { status = next; statuses.push(next); },
};
const segment: TutorSegment = { narration: "The force equals mass times acceleration.", command: {
  type: "WRITE", text: "F = ma", params: [80, 150], charPosition: 0, narrationBefore: "",
} };
const blocked = { reason: "context-suspended", audioContextState: "suspended" } as const;
const getStatus = () => status as SpeechStartupStatus | null;
const start = (job: Job) => { job.startedAt = now; job.options.onStart?.(); };
const finish = (job: Job) => { job.options.onEnd?.(); job.resolve(); };

async function main() {
try {
  const runner = runSegmentHook(params);
  const river = runner.runSegment(segment, 0, [segment], 1);
  await flush();
  assert.equal(jobs.length, 1);
  await advance(67_410);
  params.isPausedRef.current = true;
  runner.pauseFallbackSpeech();
  await advance(68_480);
  jobs[0]!.options.onAudioReady?.();
  jobs[0]!.options.onPlaybackBlocked?.(blocked);
  jobs[0]!.options.onStart?.();
  assert.equal(getStatus(), null, "provider blockage during an intentional pause must not offer audio enable");
  await advance(170_000);
  assert.equal(abandonments, 0, "paused startup must not consume the recovery deadline");
  assert(!events.some((event) => event.name === "ink"), "late media and rejected start cannot trigger handwriting while paused");
  params.isPausedRef.current = false;
  runner.resumeFallbackSpeech();
  start(jobs[0]!);
  setTimer(() => finish(jobs[0]!), 1_000);
  await advance(175_000);
  await river;
  assert(events.some((event) => event.name === "ink" && event.atMs >= 170_000));
  assert(events.some((event) => event.name === "tts-startup-accepted" && event.accepted === false && event.paused === true));
  assert(events.some((event) => event.name === "tts-startup-accepted" && event.accepted === true && event.audio_context_state === "suspended"));

  const recovery = runner.runSegment({ narration: "Another sentence.", command: null }, 1, [], 1);
  const recoveryOutcome = recovery.then(() => null, (error: unknown) => error);
  await flush();
  const recoveryJob = jobs.at(-1)!;
  recoveryJob.options.onPlaybackBlocked?.(blocked);
  const enable = getStatus()!.enableAudio;
  params.isPausedRef.current = true; runner.pauseFallbackSpeech();
  enable(); assert.equal(unlocks, 0); assert.equal(resumes, 0);
  params.isPausedRef.current = false; runner.resumeFallbackSpeech();
  enable(); assert.equal(unlocks, 1); assert.equal(resumes, 1);
  await advance(now + 7_000);
  assert(await recoveryOutcome instanceof Error);
  assert.equal(getStatus(), null, "recovery completion must retire the audio enable action");
  enable(); assert.equal(unlocks, 1, "an abandoned primary must never be resurrected by an old tap");
  recoveryJob.options.onPlaybackBlocked?.(blocked); recoveryJob.options.onStart?.();
  assert.equal(getStatus(), null);

  const predecessor = runner.runSegment({ narration: "Old owner.", command: null }, 2, [], 1);
  await flush();
  const oldJob = jobs.at(-1)!;
  oldJob.options.onPlaybackBlocked?.(blocked);
  const oldEnable = getStatus()!.enableAudio;
  params.turnGenerationRef.current = 2;
  const successor = runner.runSegment({ narration: "New owner.", command: null }, 0, [], 2);
  await flush();
  const newJob = jobs.at(-1)!;
  newJob.options.onPlaybackBlocked?.(blocked);
  oldJob.options.onPlaybackBlocked?.(null); oldEnable();
  await advance(now + 50);
  await predecessor;
  assert.equal(getStatus()!.turnGeneration, 2, "stale callbacks and old cleanup cannot clear a successor's startup status");
  assert.equal(unlocks, 1);
  start(newJob); finish(newJob); await advance(now + 100); await successor;
  assert.equal(getStatus(), null, "accepted startup and completion clear the matching blocked status");

  effects.length = 0;
  const controls = { ...params, sessionId: "offline", phase: "thinking", phaseRef: ref("thinking"),
    isReplaying: false, boardLoaded: false, ttsClientRef: ref(tts), whiteboardRef: ref({ setPaused: () => {} }),
    replayDrawClockRef: ref(null), replayAudioRef: ref(null), rewoundRef: ref(false), stopTurnRef: ref(null),
    setIsPaused: () => {}, setPhase: () => {}, setNarrationText: () => {}, setInputInteracted: () => {},
    boardShowsStoppedReplayRef: ref(false), boardLayoutRef: ref(null), boardPageRef: ref(null),
    autoSubmitDoneRef: ref(null), pendingQuestionRef: ref(null), conversationHistoryRef: ref([]), liveQuestionRef: ref(""),
    pendingSegmentCountRef: ref(1), collectedSegmentsRef: ref([]), activeVerifiedDiagramRef: ref(null),
  } as unknown as UseTurnLifecycleParams;
  const control = runTurnControlHook(controls, ref(async () => {}));
  for (const effect of effects) effect();
  for (const source of ["control", "keyboard", "doubt-composer", "marking", "rewind"] as const) {
    control.pauseTurn(source);
    assert.equal(events.at(-1)!.source, source);
    assert.equal(events.at(-1)!.phase, "thinking");
    control.resumeTurn();
  }
  control.pauseTurn();
  assert.equal(events.at(-1)!.source, "control");
  controls.rewoundRef!.current = true; const beforeResume = resumes;
  control.resumeTurn(); assert.equal(controls.isPausedRef.current, true); assert.equal(resumes, beforeResume);
  controls.rewoundRef!.current = false; control.resumeTurn();
  const keydown = listeners.get("keydown")!;
  keydown({ key: " ", target: new Element(), preventDefault() {} });
  assert.equal(events.at(-1)!.source, "keyboard");
  control.resumeTurn();
  const eventCount = events.length;
  keydown({ key: " ", target: new Element(true), preventDefault() { throw new Error("native button activation must not be intercepted"); } });
  assert.equal(events.length, eventCount);
  for (const event of events.filter((event) => event.name.startsWith("tts-startup") || event.name === "turn-paused")) {
    assert(!("text" in event) && !("question" in event) && !("narration" in event), "startup diagnostics must not contain student content");
  }
  assert(statuses.some((entry) => entry?.blocked.reason === "context-suspended"));
  await verifyNativeRunnerSeam();
  console.log("verified pause sources, strict startup acceptance, pause-aware late-media timing, owned audio enable, and stale generation cleanup");
} finally {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });

async function verifyNativeRunnerSeam() {
  class Context {
    state = "running"; currentTime = 0; destination = {};
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, start() {}, stop() {}, onended: null }; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
  }
  class NativeAudio {
    static clips: NativeAudio[] = [];
    static permitted = false;
    playbackRate = 1; preservesPitch = true; muted = false; volume = 1;
    onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror = null;
    startedAt: number | null = null;
    plays = 0;
    constructor(public src = "") { if (src.startsWith("blob:")) NativeAudio.clips.push(this); }
    get currentTime() { return this.startedAt === null ? 0 : (now - this.startedAt) / 1000; }
    async play() {
      this.plays++;
      if (!this.src.startsWith("blob:")) return;
      if (!NativeAudio.permitted) throw new DOMException("offline native gesture required", "NotAllowedError");
      this.startedAt = now; this.onplaying?.();
    }
    pause() {} removeAttribute() { this.src = ""; } load() {}
  }
  replace("AudioContext", Context); replace("Audio", NativeAudio);
  replace("location", { protocol: "http:", host: "localhost:3000", origin: "http://localhost:3000" });
  replace("fetch", async (url: unknown) => {
    if (String(url).includes("ws-ticket")) return Response.json({});
    assert(String(url).includes("/api/tts/stream"), "only offline provider stubs may run");
    return new Response(`${JSON.stringify({ audio_base64: Buffer.from([73, 68, 51, 1]).toString("base64") })}\n`);
  });
  for (const mode of ["tap", "expire", "stop"] as const) {
    NativeAudio.permitted = false;
    const provider = new StreamingSpeechClient();
    await provider.prewarm();
    let startup: SpeechStartupStatus | null = null;
    const getStartup = () => startup as SpeechStartupStatus | null;
    const ink: number[] = [];
    const nativeParams: UseSegmentRunnerParams = { ...params,
      turnGenerationRef: ref(1), cancelRef: ref(false), isPausedRef: ref(false), turnActiveRef: ref(true),
      recordedSegmentsRef: ref([]), narrationSinceEpochRef: ref(""), drawChainRef: ref(Promise.resolve()),
      ensureTTSClient: () => provider,
      onSpeechStartupStatus: (next) => { startup = next; },
      executeCommandWithCancel: async () => { ink.push(now); },
      raceWithCancel: async <T,>(promise: Promise<T>) => {
        const generation = nativeParams.turnGenerationRef.current;
        return new Promise<T | undefined>((resolve, reject) => {
          let id: number;
          const check = () => {
            if (nativeParams.cancelRef.current || generation !== nativeParams.turnGenerationRef.current) resolve(undefined);
            else id = setTimer(check, 25);
          };
          id = setTimer(check, 25);
          promise.then((value) => { timers.delete(id); resolve(value); }, (error) => { timers.delete(id); reject(error); });
        });
      },
    };
    const runner = runSegmentHook(nativeParams);
    const count = NativeAudio.clips.length;
    const origin = now;
    const run = runner.runSegment(segment, 0, [segment], 1);
    const outcome = run.then(() => null, (error: unknown) => error);
    await advance(now + 100);
    assert.equal(NativeAudio.clips.length, count + 1);
    const clip = NativeAudio.clips.at(-1)!;
    const enable = getStartup()!.enableAudio;
    assert.equal(getStartup()!.blocked.reason, "not-allowed", "the actual provider must publish a retained, actionable startup status");
    assert.equal(ink.length, 0, "blocked native audio must not begin handwriting");
    await advance(now + 100);
    assert(getStartup(), "a synchronous failure must not batch the actual startup UI back to null");
    if (mode === "tap") {
      nativeParams.isPausedRef.current = true; runner.pauseFallbackSpeech(); provider.pause();
      enable(); await advance(now + 10_000);
      assert.equal(clip.plays, 1, "an audio-enable action must not unpause intentional silence");
      assert(getStartup(), "an intentional pause holds the existing startup recovery allowance");
      assert.equal(ink.length, 0);
      nativeParams.isPausedRef.current = false; runner.resumeFallbackSpeech(); provider.resume();
      await flush();
      assert.equal(clip.plays, 2);
      assert(getStartup(), "explicit Resume may still need a user gesture and must keep the same current clip");
    }
    const playsBeforeTap = clip.plays;
    enable(); await flush();
    assert.equal(clip.plays, playsBeforeTap + 1, "the explicit tap must retry the SAME native clip, not enqueue another sentence");
    assert.equal(NativeAudio.clips.length, count + 1);
    assert(getStartup(), "repeat NotAllowedError must retain the still-actionable clip");
    assert.equal(ink.length, 0);
    if (mode === "tap") {
      NativeAudio.permitted = true;
      const acceptedAt = now;
      enable(); await flush();
      assert.equal(clip.plays, playsBeforeTap + 2);
      assert.equal(getStartup(), null, "actual accepted native playback must clear the audio enable action");
      await advance(now + 1_000);
      clip.onended?.(); await advance(now + 200);
      assert.equal(await outcome, null);
      assert(ink.length > 0 && ink.every((at) => at >= acceptedAt));
    } else if (mode === "expire") {
      await advance(origin + 6_550);
      assert(await outcome instanceof Error);
      assert.equal(getStartup(), null, "the EXISTING active-time deadline must retire blocked native playback");
      assert.equal(clip.src, "", "expiry must unload the owned native clip");
      const plays = clip.plays; enable(); await flush(); assert.equal(clip.plays, plays);
      assert.equal(ink.length, 0);
    } else {
      nativeParams.cancelRef.current = true;
      nativeParams.turnGenerationRef.current++;
      provider.stop(); runner.stopFallbackSpeech();
      const plays = clip.plays; enable(); await advance(now + 100);
      assert.equal(await outcome, null);
      assert.equal(getStartup(), null);
      assert.equal(clip.plays, plays, "a captured action cannot restart a cancelled native clip");
      assert.equal(clip.src, ""); assert.equal(ink.length, 0);
    }
    provider.stop();
  }
  console.log("verified real provider → runner retains the native gate through rejection, retries the same clip on tap, and retires it on accepted start, deadline, or Stop");
}
