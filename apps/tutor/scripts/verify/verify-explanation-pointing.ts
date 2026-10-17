/** Real handwriting/cursor consumers on recorded launch speech; no providers. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { parseStoredSegmentCommands, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";
import { getBestWriteCharScheduleMs, type AudioTimings, type TTSClient } from "@heytutor/tutor-core";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import { drawSegmentInk, planSegmentInk } from "../../features/tutor-session/lib/turn/segmentInk";
import { drawLectureTimeline } from "../../lib/lecture-export/drawLectureTimeline";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { lecturePageCacheKey } from "../../lib/lecture-export/canExportLectureMp4";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import type { useBoardLayout as LayoutHook } from "../../features/tutor-session/hooks/useBoardLayout";
import type { useSegmentRunner as RunnerHook } from "../../features/tutor-session/hooks/turn/useSegmentRunner";
import type { useReplay as ReplayHook } from "../../features/tutor-session/hooks/useReplay";
import type { ExecuteCommandOptions, UseSegmentRunnerParams } from "../../features/tutor-session/hooks/turn/types";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import retained from "./fixtures/explanation-pointing/launch-beats.json";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: (fn: unknown) => fn, useEffect() {}, useState: (x: unknown) => [x, () => {}] };
function load<T>(relative: string): T {
  const file = path.join(app, relative);
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    // This gate supplies a virtual board; DOM viewport measurement has no role.
    if (specifier === "./useBoardViewport") return { useBoardViewport: () => ({ scale: 1, offsetX: 0, offsetY: 0 }) };
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(file), specifier) : specifier);
  }, mod, mod.exports);
  return mod.exports as T;
}
const executor = load<{ useCommandExecution: typeof CommandHook }>("features/tutor-session/hooks/useCommandExecution.ts").useCommandExecution;
const layoutHook = load<{ useBoardLayout: typeof LayoutHook }>("features/tutor-session/hooks/useBoardLayout.ts").useBoardLayout;
const runner = load<{ useSegmentRunner: typeof RunnerHook }>("features/tutor-session/hooks/turn/useSegmentRunner.ts").useSegmentRunner;
const replayHook = load<{ useReplay: typeof ReplayHook }>("features/tutor-session/hooks/useReplay.ts").useReplay;
type Beat = { narration: string; command: unknown; durationMs: number; timings: AudioTimings | null };
type Control = "pause" | "paused-stop" | "stop" | "rate" | "no-target" | "small-row" | "pending" | "page-turn" | "seek" | "late-timings" | "draw-failure" | "voice-failure" | "skip-draw" | "cancel-before" | "authored-gesture" | "authored-gesture-resume" | "authored-gesture-resume-write";
const results: unknown[] = [];

async function run(name: string, source: Beat, mode: "shared" | "export" | "live" | "fallback" = "shared", control?: Control) {
  const beat = structuredClone(source), commands = parseStoredSegmentCommands(beat.command);
  const clock = createVirtualWhiteboardClock(), exportClock = createVirtualWhiteboardClock(), board = mountTestWhiteboard();
  const penClock = mode === "export" ? exportClock : clock;
  board.setTimeSource(penClock.source);
  const cancel = ref(false), paused = ref(false), rate = ref(1.25), whiteboard = ref(board), fbd = ref(false);
  let mediaMs = 0, settled = false, failure: unknown, pauseDone = false, aligned = control !== "late-timings";
  let stoppedPose: { x: number; y: number }[] | undefined;
  const savedGlobals = new Map<string, PropertyDescriptor | undefined>(), realDateNow = Date.now;
  const timers = new Map<number, { at: number; run: () => void }>(); let timerId = 0;
  const replace = (key: string, value: unknown) => {
    savedGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace("window", globalThis); replace("performance", { now: clock.now });
  replace("setTimeout", (fn: () => void, ms = 0) => { const id = ++timerId; timers.set(id, { at: clock.now() + ms, run: fn }); return id; });
  replace("clearTimeout", (id: number) => timers.delete(id));
  replace("fetch", () => { throw Error("explanation gate forbids network/providers"); });
  Date.now = clock.now;
  const delay = async (ms: number) => { const end = penClock.now() + ms; while (!cancel.current && penClock.now() < end) await penClock.waitForAdvance(); };
  const layout = layoutHook({ whiteboardRef: whiteboard, cancelRef: cancel, fbdPhaseStartedRef: fbd, liveQuestionRef: ref("retained launch lesson") });
  const priorText = control === "small-row" ? "x" : "+v: behind, real; m < 0: inverted; |m| = 1: same size";
  const priorY = control === "page-turn" ? commands.find(c => c.type === "WRITE")!.params[1]! : 208;
  if (control !== "no-target" && control !== "pending") {
    await board.writeText(priorText, 90, priorY, 0, undefined, 32);
    layout.boardLayoutRef.current.rects.push({ x: 90, y: priorY, width: control === "small-row" ? 24 : 260, height: 32, text: priorText, workIndex: 7, workId: "w7" });
  }
  if (control === "page-turn") layout.boardLayoutRef.current.nextY = 710;
  if (control === "pending") layout.boardLayoutRef.current.rects.push({ x: 90, y: 274, width: 150, height: 32, text: "future answer", workIndex: 8, workId: "w8", pendingInk: true });
  const diagram: VerifiedDiagram = { id: "verified_scene", layout: control?.startsWith("authored-gesture") ? "standard" : "code_lesson", name: "owned", promptAddon: "",
    anchors: ["cell1", "cell3", "last"].map((id, i) => ({ id, labels: [id], x: 700 + i * 100, y: 340, width: 80, height: 40 })),
    commands: [], reveals: [], groups: [], deferredAnnotations: [{ entityId: "last", commands: [{ type: "LABEL", text: "unrevealed", params: [900, 340, 24] }] }] };
  if (control?.startsWith("authored-gesture-resume")) await board.flyCursorTo(740, 360, 0);
  const diagramBefore = structuredClone(diagram), activeDiagram = ref<VerifiedDiagram | null>(diagram);
  const clears: number[] = [], erase = board.eraseWorkInk;
  board.eraseWorkInk = async (...args) => { clears.push(mediaMs); await erase(...args); };
  const flights: { at: number; x: number; y: number }[] = [], glyphs: number[] = [], writes: ExecuteCommandOptions[] = [];
  const poses: { at: number; x: number; y: number }[] = [];
  let originalCount = 0, failedDrawOnce = false, fallbackPoints = 0;
  const fly = board.flyCursorTo;
  board.flyCursorTo = async (...args) => { flights.push({ at: mediaMs, x: args[0], y: args[1] }); await fly(...args); };
  const hook = executor({ whiteboardRef: whiteboard, cancelRef: cancel, activeVerifiedDiagramRef: activeDiagram,
    fbdPhaseStartedRef: fbd, fbdPhaseMarkedRef: ref(false), boardLayoutRef: layout.boardLayoutRef,
    inkPaceRef: ref("follow"), speedRef: rate, adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef,
    turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
    raceWithCancel: async p => p, resolveTextPlacement: layout.resolveTextPlacement, cancellableDelay: delay,
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout, nowMs: penClock.now });
  const execute = async (command: DrawCommand, options: ExecuteCommandOptions = {}) => {
    if (options.explanationPointing) fallbackPoints++;
    if (control === "draw-failure" && options.explanationPointing && !failedDrawOnce) {
      failedDrawOnce = true; throw Error("retained replay draw recovery fixture");
    }
    if (command.type === "WRITE") {
      writes.push(options);
      if (options.writeSchedule) {
        const charStart = options.writeSchedule.onCharacterStart;
        options = { ...options, writeSchedule: { ...options.writeSchedule, onCharacterStart: info => { glyphs.push(info.audioPositionMs); charStart?.(info); } } };
      }
    }
    await hook.executeCommandWithCancel(command, options);
  };
  const getTimings = () => aligned ? beat.timings : null;
  const speechClock = { narration: beat.narration, getTimings, totalSpeechMs: beat.durationMs, estimatedSpeechMs: beat.durationMs,
    getAudioPositionMs: () => mediaMs, getPlaybackRate: () => rate.current, isPaused: () => paused.current,
    nowMs: clock.now, isSpeechComplete: () => mediaMs >= beat.durationMs };
  let savedRows: UseSegmentRunnerParams["recordedSegmentsRef"]["current"] = [];
  let job: Promise<void>;
  const provider: TTSClient = {
      async speak() { throw Error("unused speech transport"); },
      async playAudio() { throw Error("unused audio transport"); },
      async prewarm() {}, pause() {}, resume() {}, stop() {},
      get isPlaying() { return mediaMs < beat.durationMs; },
      setPlaybackRate(value) { rate.current = value; },
      getPlaybackPositionMs: () => mediaMs, getPlaybackRate: () => rate.current,
      prefetchSegment() {}, peekSegmentTimings: getTimings, abandonSpeaking() {},
      async speakSegment(_text, options = {}) {
        if (control === "voice-failure") throw Error("retained replay TTS failure before audio");
        if (beat.timings) options.onTimings?.(beat.timings);
        options.onStart?.();
        while (!cancel.current && mediaMs < beat.durationMs) await clock.waitForAdvance();
        options.onEnd?.();
      },
  };
  if (mode === "live") {
    const saved = ref(savedRows);
    const controlHook = runner({ sessionId: "offline", activeVerifiedDiagramRef: activeDiagram,
      cancellableDelay: delay, ensureTTSClient: () => provider, executeCommandWithCancel: execute,
      raceWithCancel: async p => p, applyTurnPhase() {}, cancelRef: cancel, isPausedRef: paused,
      turnActiveRef: ref(true), turnGenerationRef: ref(1), turnTelemetryRef: ref(null),
      turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), recordedSegmentsRef: saved,
      narrationSinceEpochRef: ref(""), currentTraceIdRef: ref(null), setCurrentSegmentText() {},
      narrationDensityRef: ref(0), drawChainRef: ref(Promise.resolve()), reserveTextCommandPlacements: layout.reserveTextCommandPlacements });
    const segment = { narration: beat.narration, commands, command: null };
    job = controlHook.runSegment(segment, 0, [segment], 1).then(() => { savedRows = saved.current; });
  } else if (mode === "fallback") {
    const turn = { id: "fallback", orderIndex: 0, question: "Retained explanation", rawResponse: "", speedMultiplier: 1,
      traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
      segments: [{ id: "beat", orderIndex: 0, narration: beat.narration, spokenText: beat.narration,
        command: beat.command, timings: beat.timings, durationMs: beat.durationMs, audioUrl: null }] } as StoredTurn;
    const replayGenerationRef = ref(1), replayClock = ref<{ setPaused: (paused: boolean) => void } | null>(null);
    const consumer = replayHook({ whiteboardRef: whiteboard, cancelRef: cancel, speedRef: rate, isPausedRef: paused,
      replayAudioRef: ref(null), replayDrawClockRef: replayClock, replayAudioPreloadRef: ref(new Map()),
      storedTurnsRef: ref([turn]), activeVerifiedDiagramRef: activeDiagram, fbdPhaseStartedRef: fbd,
      replayGenerationRef, replayCueRef: ref(null), ttsClientRef: ref(provider), notesEpochsRef: layout.notesEpochsRef,
      narrationSinceEpochRef: layout.narrationSinceEpochRef, liveQuestionRef: ref("Retained explanation"), phaseRef: ref("idle"),
      isReplaying: true, isPaused: false, isDownloading: false, replayProgressMs: 0, boards: [], sessionId: "offline",
      setPhase() {}, setCurrentSegmentText() {}, setNarrationText() {}, setIsPaused() {}, setIsReplaying() {},
      setReplayProgressMs() {}, setReplayTotalMs() {}, setSettings() {}, setIsDownloading() {},
      cancellableDelay: delay, raceWithCancel: async p => p, executeCommandWithCancel: execute, executeCommand: execute,
      resetBoardLayout: layout.resetBoardLayout, finishLectureUi() {}, pauseTurn() {}, resumeTurn() {},
    });
    if (control === "cancel-before") cancel.current = true;
    job = consumer.playReplayCue(buildReplayTimeline([turn]).cues[0]!, control?.startsWith("authored-gesture-resume") ? 2_000 : 0, 1, control === "skip-draw", undefined, control?.startsWith("authored-gesture-resume") ? 1 : 0);
  } else if (mode === "export") {
    const turn = { id: "offline", orderIndex: 0, question: "Retained launch lesson", rawResponse: "", speedMultiplier: 1,
      traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
      segments: [{ id: "beat", orderIndex: 0, narration: beat.narration, spokenText: beat.narration,
        command: beat.command, timings: beat.timings, durationMs: beat.durationMs, audioUrl: null }] } as StoredTurn;
    job = drawLectureTimeline({ cues: buildReplayTimeline([turn]).cues, executeCommand: execute,
      getClockMs: () => mediaMs, waitForAdvance: clock.waitForAdvance, shouldCancel: () => cancel.current });
  } else {
    job = drawSegmentInk({ plan: planSegmentInk({ commands, hasNarration: true, verifiedDiagramIntro: false }),
      verifiedDiagramIntro: false, clock: speechClock, getDiagram: () => diagram, isCancelled: () => cancel.current,
      waitWhilePaused: async () => { while (paused.current && !cancel.current) await delay(16); return !cancel.current; },
      execute, commandOptions: () => ({ applyLayout: false, isCancelled: () => cancel.current,
        ...(control === "seek" ? { durationScale: 0 } : {}) }), beforeCommand: () => originalCount++ });
  }
  void job.then(() => { settled = true; }, error => { failure = error; settled = true; });
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  const tick = async (advanceAudio = true) => {
    clock.advance(16); if (advanceAudio && !paused.current) mediaMs += 16 * rate.current;
    for (const [id, timer] of [...timers]) if (timer.at <= clock.now()) { timers.delete(id); timer.run(); }
    exportClock.setNow(mediaMs); clock.pump(); exportClock.pump(); await flush();
    const cursor = board.getCursorLayer()!.getChildren()[0]!;
    poses.push({ at: mediaMs, x: cursor.x(), y: cursor.y() });
  };
  try {
    for (let wall = 0; !settled && wall < 30_000; wall += 16) {
      if (control === "late-timings" && mediaMs > 2_000) aligned = true;
      if (control === "rate" && mediaMs > 3_000) rate.current = 1.75;
      if (control === "stop" && !cancel.current && mediaMs > 2_100) {
        stoppedPose = board.getCursorLayer()!.getChildren().map(node => ({ x: node.x(), y: node.y() }));
        cancel.current = true;
      }
      if ((control === "pause" || control === "paused-stop") && !pauseDone && mediaMs > 2_100) {
        pauseDone = true; paused.current = true; if (mode !== "export") board.setPaused(true);
        const before = board.getCursorLayer()!.getChildren().map(node => ({ x: node.x(), y: node.y() }));
        const at = mediaMs;
        for (let i = 0; i < 50; i++) await tick();
        assert.equal(mediaMs, at, "pause cannot spend a speech cue");
        assert.deepEqual(board.getCursorLayer()!.getChildren().map(node => ({ x: node.x(), y: node.y() })), before, "paused pointing must not move the real pen");
        if (control === "paused-stop") {
          stoppedPose = before; cancel.current = true;
        } else {
          paused.current = false; if (mode !== "export") board.setPaused(false);
        }
      }
      await tick();
    }
    assert(settled, `${name}: bounded owned-clock completion`); if (failure) throw failure; await job;
    if (control === "draw-failure") assert(failedDrawOnce, "the actual replay consumer entered drawing failure recovery");
    assert.deepEqual(diagram, diagramBefore, `${name}: explanation cannot reveal labels or change verified geometry`);
    if (mode === "shared") assert.equal(originalCount, control === "stop" || control === "paused-stop" ? 1 : commands.length, `${name}: original resume command counts stay intact`);
    if (control === "no-target" || control === "pending" || control === "seek" || control === "skip-draw" || control === "cancel-before" || control === "voice-failure") {
      assert.equal(flights.length, 0, `${name}: suppressed or unheard speech, seek, and unavailable targets produce no transient motion`);
    } else if (control?.startsWith("authored-gesture-resume")) {
      assert.equal(fallbackPoints, 0, `${name}: a completed-prefix gesture still owns the resumed sentence`);
      if (control === "authored-gesture-resume") assert.equal(flights.length, 0, `${name}: an empty remainder retains the already-landed pen`);
      else assert.equal(writes.length, 1, `${name}: the original remaining WRITE still inks`);
    } else if (control === "authored-gesture") {
      assert(flights.length > 0, `${name}: the original gesture really visits its verified target`);
      assert.equal(fallbackPoints, 0, `${name}: authored gestures must never yield their explanation to unrelated last work`);
      assert(flights.every(flight => flight.x >= 400), `${name}: the pen stays with the authored figure target`);
    } else if (control === "page-turn") {
      assert(clears.length === 1 && clears[0]! < 1_000, "real replay layout clears the prior page before waiting for its next WRITE cue");
      assert.equal(flights.filter(f => f.at < 10_000 && f.y === priorY).length, 0, "a cleared page cannot be pointed at before the new row inks");
    } else {
      assert(flights.length > 0, `${name}: spoken explanation must dispatch a visible pointing beat`);
      if (!commands.some(c => c.type === "POINT")) assert(flights[0]!.x < 400, "runtime pointing stays on existing work, never an unrevealed figure anchor named last");
      const limit = commands.some(c => c.type === "WRITE") ? 10_000 : Math.min(beat.durationMs - 500, 8_000);
      const active = poses.filter(p => p.at > 100 && p.at < limit);
      let movedAt = active[0]?.at ?? 0, prior = active[0];
      let longest = 0;
      for (const point of active) {
        if (prior && Math.hypot(point.x - prior.x, point.y - prior.y) > .1) movedAt = point.at;
        longest = Math.max(longest, point.at - movedAt); prior = point;
      }
      assert(active.length > 20 && longest < 2_500, `${name}: actual pen cannot park for ${longest}ms during explanation`);
      assert(flights.length >= (control === "stop" || control === "paused-stop" ? 2 : 4), `${name}: explanation keeps pointing`);
      if (commands.some(c => c.type === "WRITE") && control !== "stop" && control !== "paused-stop") {
        assert(glyphs.length > 0, "original work really inks");
        const first = writes[0]!.writeSchedule!.charStartOffsetsMs[0]!;
        assert(Math.abs(glyphs[0]! - first) < 100, `${name}: leading tour preserves first glyph cue (${glyphs[0]} vs ${first})`);
        if (control !== "late-timings") {
          const original = getBestWriteCharScheduleMs(beat.narration, commands[0]!, beat.timings, beat.durationMs, 0)!;
          assert.deepEqual(writes[0]!.writeSchedule!.charStartOffsetsMs, original.offsetsMs, "every original exact WRITE offset survives unchanged");
        }
      }
    }
    if (control === "stop" || control === "paused-stop") {
      assert.deepEqual(board.getCursorLayer()!.getChildren().map(node => ({ x: node.x(), y: node.y() })), stoppedPose,
        "Stop cancels the active pen flight at its actual position, including while paused");
      const stopped = poses.at(-1)!;
      for (let i = 0; i < 60; i++) await tick();
      assert.deepEqual({ x: poses.at(-1)!.x, y: poses.at(-1)!.y }, { x: stopped.x, y: stopped.y }, "stopped owner cannot move a successor's pen");
      assert.equal(glyphs.length, 0, "Stop before cue cannot write the waiting formula");
    }
    if (mode === "live") {
      assert.equal(savedRows.length, 1, "real live runner persists one original narration row");
      assert.deepEqual(parseStoredSegmentCommands(savedRows[0]!.command), commands, "only original authored commands are persisted");
    }
    let lastActivityMs = 0, maxStaticVoicedMs = 0, previous = poses[0];
    for (const pose of poses) {
      if ((previous && Math.hypot(pose.x - previous.x, pose.y - previous.y) > .1) || glyphs.some(at => Math.abs(at - pose.at) <= 20)) lastActivityMs = pose.at;
      maxStaticVoicedMs = Math.max(maxStaticVoicedMs, pose.at - lastActivityMs); previous = pose;
    }
    if (!cancel.current) maxStaticVoicedMs = Math.max(maxStaticVoicedMs, beat.durationMs - lastActivityMs);
    if (control === "voice-failure" || control === "cancel-before") maxStaticVoicedMs = 0; // No voice began.
    if (!["no-target", "pending", "page-turn", "seek", "skip-draw", "cancel-before", "voice-failure", "authored-gesture", "authored-gesture-resume", "authored-gesture-resume-write"].includes(control ?? "")) {
      assert(maxStaticVoicedMs < 2_500, `${name}: whole voiced beat cannot park ink and cursor for ${maxStaticVoicedMs}ms`);
    }
    results.push({ name, mode, control: control ?? "none", flights: flights.length, firstGlyphMs: glyphs[0] ?? null, maxStaticVoicedMs });
  } finally {
    cancel.current = true; board.cancelAnimations(); unmountTestWhiteboard(board); timers.clear(); Date.now = realDateNow;
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}

async function main() {
  const formula = retained[0]!, emphasis = retained[1]!, code = retained[2]!, hinglish = retained[3]!;
  await run("recorded-L01", formula);
  await run("recorded-L01-export", formula, "export");
  await run("recorded-L01-export-pause", formula, "export", "pause");
  await run("recorded-L01-export-stop", formula, "export", "stop");
  await run("recorded-L10-tail", emphasis);
  await run("recorded-L10-export", emphasis, "export");
  for (const control of ["pause", "stop", "paused-stop", "rate", "late-timings", "page-turn"] as const) await run(`L01-${control}`, formula, "shared", control);
  const spoken = { ...emphasis, command: null };
  await run("narration-only-live", spoken, "live");
  await run("narration-only-missing-recording-consumer", spoken, "fallback");
  await run("narration-only-draw-recovery-consumer", spoken, "fallback", "draw-failure");
  await run("missing-recording-voice-failure", spoken, "fallback", "voice-failure");
  await run("missing-recording-skip-draw", spoken, "fallback", "skip-draw");
  await run("missing-recording-cancel-before", spoken, "fallback", "cancel-before");
  await run("missing-recording-pause", spoken, "fallback", "pause");
  await run("missing-recording-stop", spoken, "fallback", "stop");
  await run("narration-only-replay", spoken);
  await run("small-visible-work-row", spoken, "shared", "small-row");
  await run("narration-only-export", spoken, "export");
  for (const control of ["no-target", "pending", "seek"] as const) await run(control, spoken, "shared", control);
  await run("recorded-L20-explicit-POINT", code);
  await run("recorded-L21-Hinglish-POINT", hinglish, "export");
  for (const type of ["FOCUS", "POINT"] as const) {
    const authored: Beat = { narration: "cell1 is the ray. This explanation stays with the verified ray while an unrelated calculation remains on the left.",
      command: { commands: [{ type, text: "cell1", params: [], charPosition: 0, narrationBefore: "", semanticRef: { entityId: "cell1" } }] },
      durationMs: 12_000, timings: null };
    for (const mode of ["shared", "live", "fallback", "export"] as const) await run(`authored-${type}-${mode}`, authored, mode, "authored-gesture");
  }
  for (const type of ["FOCUS", "POINT"] as const) {
    const gesture: DrawCommand = { type, text: "cell1", params: [], charPosition: 0, narrationBefore: "", semanticRef: { entityId: "cell1" } };
    const narration = "cell1 is the ray. This explanation stays with the verified ray. Near the end we write y equals two.";
    for (const write of [false, true]) {
      const commands = write ? [gesture, { type: "WRITE" as const, text: "y = 2", params: [90, 274, 32], charPosition: 0, narrationBefore: narration }] : [gesture];
      await run(`resumed-authored-${type}${write ? "-write" : ""}`, { narration, command: { commands }, durationMs: 12_000, timings: null }, "fallback", write ? "authored-gesture-resume-write" : "authored-gesture-resume");
    }
  }
  assert(lecturePageCacheKey([]).endsWith("@video12"), "prior board/pitch/static explanation files cannot share the new cache identity");
  console.log("verify-explanation-pointing:", JSON.stringify({ scenarios: results.length, providers: 0, results }));
}
// The actual replay consumer adds seven clock-driven scenarios; keep assertions
// bounded without making this source/Whiteboard gate flaky on a busy CI host.
const watchdog = setTimeout(() => {
  console.error("explanation pointing gate exceeded its30s real-wall bound");
  process.exit(1);
}, 30_000);
void main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog); console.error(error); process.exitCode = 1;
});
