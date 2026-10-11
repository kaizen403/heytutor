/** Spoken work and verified focus share one real Whiteboard pen. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { linePath, resolveVerifiedDiagramFocusTargets, type DrawCommand } from "@heytutor/drawing";
import { getBestWriteCharScheduleMs, getFocusTargetSchedule, mathToSpeech, type AudioTimings } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import type * as SegmentInk from "../../features/tutor-session/lib/turn/segmentInk";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import retained from "./fixtures/focus-writing/m09.json";

const canonicalInk = fileURLToPath(new URL("../../features/tutor-session/lib/turn/segmentInk.ts", import.meta.url));
const canonicalExecutor = fileURLToPath(new URL("../../features/tutor-session/hooks/useCommandExecution.ts", import.meta.url));
const canonicalFocus = fileURLToPath(new URL("../../features/tutor-session/lib/board/scheduledFocus.ts", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: (fn: unknown) => fn, useEffect: () => {}, useState: (value: unknown) => [value, () => {}] };
function load(file: string, resolveFrom = file): unknown {
  const code = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((specifier: string) => {
    if (specifier === "react") return react;
    if (resolveFrom === canonicalExecutor && specifier === "../lib/board/scheduledFocus" && process.env.FOCUS_WRITE_SCHEDULED_SOURCE) {
      return load(process.env.FOCUS_WRITE_SCHEDULED_SOURCE, canonicalFocus);
    }
    return requireApp(specifier.startsWith(".") ? path.resolve(path.dirname(resolveFrom), specifier) : specifier);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const ink = load(process.env.FOCUS_WRITE_INK_SOURCE ?? canonicalInk, canonicalInk) as typeof SegmentInk;
const executor = (load(process.env.FOCUS_WRITE_EXECUTOR_SOURCE ?? canonicalExecutor, canonicalExecutor) as { useCommandExecution: typeof CommandHook }).useCommandExecution;

function timings(narration: string): AudioTimings {
  const spoken = mathToSpeech(narration);
  return { charStartTimes: [...spoken].map((_, i) => i * .09), charDurations: [...spoken].map(() => .09), totalDuration: spoken.length * .09 };
}
type Beat = { narration: string; commands: DrawCommand[]; timings: AudioTimings | null; durationMs: number; initialTimings?: AudioTimings; timingsArriveAtMs?: number; timingsArriveDuringPause?: boolean; pauseAtMs?: number; opensSentence?: boolean; cancelAtMs?: number; executorClock?: "stalled" | "absent" };
type Event = { kind: string; type?: string; at: number; command?: DrawCommand; options?: ExecuteCommandOptions };
const receipts: unknown[] = [];

async function run(name: string, beat: Beat, control?: "cancel" | "pause") {
  const compiled = compileSceneDocument(retained.sceneDocument as SceneDocument);
  assert(compiled.ok && compiled.renderScene, "original verified geometry must compile unchanged");
  const diagram = buildVerifiedDiagramPresentation(retained.sceneDocument as SceneDocument, compiled.renderScene).diagram;
  // This is a post-intro row: labels have already been revealed.
  diagram.deferredAnnotations = [];
  const board = mountTestWhiteboard(), clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const tracedPaths: string[] = [], nativeAnnotation = board.drawAnnotation;
  const annotations: { kind: string; path: string; durationMs: number; strokeWidth?: number; transient?: boolean; completed: boolean; turnCancelledAtDispatch: boolean }[] = [];
  board.drawAnnotation = async (...args) => {
    tracedPaths.push(args[1]);
    const annotation = { kind: args[0], path: args[1], durationMs: args[2], strokeWidth: args[3]?.strokeWidth, transient: args[3]?.transient, completed: false, turnCancelledAtDispatch: cancelled };
    annotations.push(annotation);
    let interrupted = false;
    const shouldCancel = args[3]?.shouldCancel;
    await nativeAnnotation(args[0], args[1], args[2], { ...args[3], shouldCancel: () => {
      const cancel = shouldCancel?.() ?? false;
      interrupted ||= cancel;
      return cancel;
    } });
    annotation.completed = !interrupted;
  };
  const saved = new Map<string, PropertyDescriptor | undefined>(), realTimeout = setTimeout;
  const timers = new Map<number, { at: number; run: () => void }>();
  let timerId = 0, cancelled = false, paused = false, pauseSpent = false, mediaMs = 0;
  const replace = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace("window", globalThis); replace("performance", { now: clock.source.now });
  replace("setTimeout", (fn: () => void, ms = 0) => { const id = ++timerId; timers.set(id, { at: clock.now() + ms, run: fn }); return id; });
  replace("clearTimeout", (id: number) => timers.delete(id));
  replace("fetch", () => { throw Error("focus gate forbids network/providers"); });
  const rate = 1.25, audio = () => mediaMs, events: Event[] = [];
  let active = 0, simultaneousPens = false, beforeCount = 0, timingReads = 0, finalTimingsReceived = false, settled = false, failure: unknown;
  const hook = executor({
    whiteboardRef: ref(board), cancelRef: ref(false), activeVerifiedDiagramRef: ref(diagram),
    fbdPhaseStartedRef: ref(false), fbdPhaseMarkedRef: ref(false), boardLayoutRef: ref({ rects: [], nextY: 100 }),
    inkPaceRef: ref("follow"), speedRef: ref(rate), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(null), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async (p) => p, resolveTextPlacement: async (_c, x, y) => ({ x, y }),
    cancellableDelay: async () => {}, forgetErasedTextRects() {}, resetBoardLayout() {}, nowMs: clock.source.now,
  });
  const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); await new Promise<void>((done) => realTimeout(done, 0)); };
  const job = ink.drawSegmentInk({
    plan: ink.planSegmentInk({ commands: beat.commands, verifiedDiagramIntro: false, hasNarration: true }),
    verifiedDiagramIntro: false, getDiagram: () => diagram, isCancelled: () => cancelled,
    opensSentence: beat.opensSentence,
    waitWhilePaused: async () => !cancelled, beforeCommand: () => beforeCount++,
    commandOptions: () => ({ applyLayout: false, isCancelled: () => cancelled }),
    clock: { narration: beat.narration, getTimings: () => beat.timingsArriveDuringPause
      ? finalTimingsReceived ? beat.timings : beat.initialTimings ?? beat.timings
      : beat.timingsArriveAtMs !== undefined
      ? mediaMs < beat.timingsArriveAtMs ? beat.initialTimings ?? beat.timings : beat.timings
      : timingReads++ === 0 ? beat.initialTimings ?? beat.timings : beat.timings, totalSpeechMs: beat.durationMs,
      estimatedSpeechMs: beat.durationMs, msPerChar: 90, getAudioPositionMs: audio,
      getPlaybackRate: () => rate, isAudioActive: () => audio() < beat.durationMs,
      isPaused: () => paused, nowMs: clock.source.now, isSpeechComplete: () => audio() >= beat.durationMs },
    execute: async (command, options) => {
      events.push({ kind: "start", type: command.type, at: audio(), command, options });
      if (active++) simultaneousPens = true;
      try { await hook.executeCommandWithCancel(command, beat.executorClock
        ? { ...options, getAudioPositionMs: beat.executorClock === "stalled" ? () => 0 : undefined }
        : options); }
      finally { active--; events.push({ kind: "end", type: command.type, at: audio() }); }
    },
    trace: { writeCharStart: () => events.push({ kind: "glyph", at: audio(), command: events.findLast((e) => e.kind === "start" && e.type === "WRITE")?.command }) },
  }).then(() => { settled = true; }, (error) => { failure = error; settled = true; });
  try {
    for (let wall = 0; !settled && wall < 25_000; wall += 16) {
      if (control === "cancel" && mediaMs > (beat.cancelAtMs ?? 2_800)) cancelled = true;
      if (control === "pause" && !pauseSpent && mediaMs > (beat.pauseAtMs ?? Math.min(2_500, beat.durationMs / 3))) {
        pauseSpent = true; paused = true; board.setPaused(true);
        const before = mediaMs;
        const annotationsBefore = annotations.length;
        for (let elapsed = 0; elapsed < 500; elapsed += 16) {
          if (beat.timingsArriveDuringPause && elapsed >= 250) finalTimingsReceived = true;
          clock.advance(16); clock.pump(); await flush();
        }
        assert.equal(mediaMs, before, "paused media does not spend the work cue");
        assert.equal(annotations.length, annotationsBefore, "fresh alignment during pause cannot redraw catch-up paths until resume");
        paused = false; board.setPaused(false);
      }
      clock.advance(16); if (!paused) mediaMs += 16 * rate;
      for (const [id, timer] of [...timers]) if (timer.at <= clock.now()) { timers.delete(id); timer.run(); }
      clock.pump(); await flush();
    }
    assert(settled, `${name}: actual consumers join within a bounded clock`); if (failure) throw failure;
    assert(!simultaneousPens, `${name}: FOCUS and WRITE never race one pen`);
    const started = events.filter((e) => e.kind === "start");
    if (control === "cancel") {
      assert(!started.some((e) => e.type === "WRITE"), "cancelled focus may not dispatch later work");
      assert(!annotations.some(annotation => annotation.turnCancelledAtDispatch), "turn cancellation cannot finish transient paths as deadline catch-up");
    } else {
      assert.equal(beforeCount, beat.commands.length, `${name}: original resume command counts stay intact`);
      assert.equal(started.length, beat.commands.length, `${name}: no command is split or dropped`);
      for (const entry of started.filter((e) => e.type === "WRITE" && beat.opensSentence !== false)) {
        const index = beat.commands.filter((c) => c.type === "WRITE").indexOf(entry.command!);
        const schedule = getBestWriteCharScheduleMs(beat.narration, entry.command!, beat.timings, beat.durationMs, index, 90)!;
        assert(entry.at - schedule.offsetsMs[0]! <= 500, `${name}: verified focus cannot hold work beyond cue+500 ms`);
        const firstGlyph = events.find((e) => e.kind === "glyph" && e.command === entry.command);
        assert(firstGlyph && firstGlyph.at - schedule.offsetsMs[0]! <= 500, `${name}: actual Whiteboard glyph starts by the spoken work cue+500 ms`);
      }
      if (beat.commands.some((command) => command.type === "WRITE")) {
        assert(events.some((e) => e.kind === "glyph"), `${name}: real Whiteboard writes visible glyphs`);
      }
      const focus = started.find((e) => e.type === "FOCUS")!;
      const requested = resolveVerifiedDiagramFocusTargets(focus.command!, diagram);
      assert.deepEqual(focus.options!.focusSchedule!.targets.map((t) => t.id).sort(), requested.map((t) => t.id).sort(), `${name}: every requested verified target remains scheduled`);
      for (const target of requested) {
        const marks = diagram.commands.filter((command) => command.semanticRef?.entityId === target.id && command.type === "DRAW_LINE" && command.params.length === 4);
        assert(marks.length > 0, "retained fixture target owns compiled straight strokes");
        for (const mark of marks) {
          const path = linePath(mark.params[0]!, mark.params[1]!, mark.params[2]!, mark.params[3]!);
          assert(tracedPaths.includes(path), `${name}: actual executor traces all of ${target.id}'s committed geometry`);
          assert(annotations.some(annotation => annotation.path === path && annotation.completed), `${name}: each committed path completes in the real Whiteboard, not merely an interrupted dispatch`);
        }
      }
      assert(annotations.filter((annotation) => annotation.kind === "underline")
        .every((annotation) => annotation.strokeWidth === 1.25 && annotation.transient === true), "deadline keeps the same transient trace style");
      if (name.startsWith("close-")) {
        assert(annotations.find(annotation => annotation.kind === "underline")?.completed,
          "a known close window leaves time for the first full transient trace instead of collapsing the whole gesture to catch-up");
      }
      assert.equal(focus.command, beat.commands.find((c) => c.type === "FOCUS"), `${name}: authored focus ownership/style is unchanged`);
      if (name === "close-pulse") assert(annotations.some((annotation) => annotation.kind === "circle_around" && annotation.completed), "bounded pulse completes its original gesture");
      if (name === "standalone" || name === "resume-tail" || name.startsWith("clock-")) {
        assert.deepEqual(focus.options!.focusSchedule, getFocusTargetSchedule({
          narration: beat.narration, command: focus.command!, targets: requested,
          timings: beat.timings, msPerChar: 90,
        }), "standalone and resumed-tail focus retain their full existing window and style");
        assert.equal(focus.options!.focusDeadlineMs, undefined, "no new cue deadline changes stored resume order");
        assert.deepEqual(started.map((entry) => entry.command), beat.commands, "stored tail command order remains intact");
      }
      if (name.startsWith("future")) assert.equal(started[0]!.type, "WRITE", "future combined gesture yields before the first work row");
      else if (name !== "resume-tail") assert.equal(started[0]!.type, "FOCUS", "already-due focus keeps its spoken order");
    }
    receipts.push({ name, beforeCount, simultaneousPens, annotations, commands: started.map((e) => ({ type: e.type, at: e.at, firstGlyphAt: events.find((glyph) => glyph.kind === "glyph" && glyph.command === e.command)?.at, deadlineMs: e.options?.focusDeadlineMs, targets: e.options?.focusSchedule?.targets })), providerCalls: 0 });
    await job;
  } finally {
    cancelled = true; board.cancelAnimations();
    for (let i = 0; i < 3; i++) { clock.advance(16); clock.pump(); await flush(); }
    unmountTestWhiteboard(board);
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}

async function main() {
  const original: Beat = { narration: retained.narration, commands: retained.commands as DrawCommand[], timings: retained.timings, durationMs: retained.durationMs };
  const slowInitial = { charStartTimes: original.timings!.charStartTimes.map((t) => t * 2), charDurations: original.timings!.charDurations.map((t) => t * 2), totalDuration: original.timings!.totalDuration * 2 };
  const lateWorkInitial = { ...original.timings!, charStartTimes: original.timings!.charStartTimes.map(t => t < 2.6 ? t : t * 2), totalDuration: original.timings!.totalDuration * 2 };
  const narration = "The modulus is shown first. Now write x equals three. Finally the real component is shown. Now write y equals four.";
  const draw = (text: string, y: number): DrawCommand => ({ type: "WRITE", text, params: [90, y, 27], charPosition: 1, narrationBefore: narration });
  const focus: DrawCommand = { type: "FOCUS", params: [], text: "modulus_segment,real_leg|spotlight", charPosition: 0, narrationBefore: narration };
  const aligned = timings(narration), future: Beat = { narration, commands: [focus, draw("x = 3", 142), draw("y = 4", 208)], timings: aligned, durationMs: Math.round(aligned.totalDuration * 1000) };
  const closeNarration = "The axes. x equals three.", closeTimings = timings(closeNarration);
  const close: Beat = { narration: closeNarration, timings: closeTimings, durationMs: Math.round(closeTimings.totalDuration * 1000), commands: [
    { type: "FOCUS", params: [], text: "axes|spotlight", charPosition: 0, narrationBefore: closeNarration },
    { type: "WRITE", text: "x = 3", params: [90, 142, 27], charPosition: 1, narrationBefore: closeNarration },
  ] };
  // A separate controlled narration uses the exact committed M09 geometry.
  const compiled = compileSceneDocument(retained.sceneDocument as SceneDocument);
  assert(compiled.ok && compiled.renderScene);
  const diagram = buildVerifiedDiagramPresentation(retained.sceneDocument as SceneDocument, compiled.renderScene).diagram;
  const schedule = getFocusTargetSchedule({ narration, command: focus, targets: resolveVerifiedDiagramFocusTargets(focus, diagram), timings: aligned, msPerChar: 90 });
  const firstWork = getBestWriteCharScheduleMs(narration, future.commands[1]!, aligned, future.durationMs, 0, 90)!.offsetsMs[0]!;
  assert(schedule.targets[0]!.startMs < firstWork && schedule.targets[1]!.startMs > firstWork + 1_000, "controlled focus straddles the first WRITE cue");
  const selected = process.env.FOCUS_WRITE_CASE;
  const pulse: Beat = { ...close, commands: [{ ...close.commands[0]!, text: "axes|pulse" }, close.commands[1]!] };
  const standalone = { ...original, commands: original.commands.filter((c) => c.type === "FOCUS") };
  for (const [name, beat, control] of [["original", original], ["future", future], ["future-estimated", { ...future, timings: null }], ["late-alignment", { ...original, initialTimings: slowInitial }], ["during-focus-alignment", { ...original, initialTimings: slowInitial, timingsArriveAtMs: 900 }], ["during-focus-trace", { ...original, initialTimings: lateWorkInitial, timingsArriveAtMs: 2900 }], ["during-trace-paused-alignment", { ...original, initialTimings: lateWorkInitial, timingsArriveDuringPause: true, pauseAtMs: 3200 }, "pause"], ["during-trace-cancelled", { ...original, initialTimings: lateWorkInitial, timingsArriveAtMs: 2900, cancelAtMs: 3000 }, "cancel"], ["close-multi-path", close], ["close-pulse", pulse], ["close-paused", close, "pause"], ["standalone", standalone], ["clock-stalled", { ...standalone, executorClock: "stalled" }], ["clock-absent", { ...standalone, executorClock: "absent" }], ["resume-tail", { ...original, opensSentence: false }], ["paused", original, "pause"], ["cancelled", original, "cancel"]] as const) {
    if (!selected || selected === name) await run(name, beat, control);
  }
  if (process.env.FOCUS_WRITE_RECEIPT) writeFileSync(process.env.FOCUS_WRITE_RECEIPT, JSON.stringify(receipts, null, 2) + "\n");
  console.log(`verify-focus-write-order: ${receipts.length} actual ink/executor/Whiteboard groups passed; providers 0`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
