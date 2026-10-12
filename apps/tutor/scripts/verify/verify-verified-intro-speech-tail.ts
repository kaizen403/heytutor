/** Real executor/Whiteboard: a completed intro voice cannot leave a long silent figure tail. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { compileSceneDocument } from "@heytutor/scene-engine";
import type { DrawCommand } from "@heytutor/drawing";
import { drawSegmentInk, planSegmentInk } from "../../features/tutor-session/lib/turn/segmentInk";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import { runWhiteboardVerifier } from "../../../../packages/whiteboard/scripts/runWhiteboardVerifier";
import { probabilityIntroFixture as fixture } from "./fixtures/probabilityIntro";

const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const hooks = path.join(app, "features/tutor-session/hooks");
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: <T>(fn: T) => fn, useMemo: <T>(fn: () => T) => fn(), useEffect() {}, useLayoutEffect() {}, useState: <T>(value: T) => [value, () => {}] };
function hook<T>(file: string): T {
  const mod = { exports: {} };
  const source = file.endsWith("useCommandExecution.ts") ? process.env.INTRO_TAIL_EXECUTOR_SOURCE ?? file
    : file.endsWith("segmentInk.ts") ? process.env.INTRO_TAIL_INK_SOURCE ?? file : file;
  const code = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return react;
    if (name.startsWith("@/")) return requireApp(path.join(app, name.slice(2)));
    if (name.startsWith(".")) {
      const resolved = path.resolve(path.dirname(file), name);
      return resolved.startsWith(hooks) ? hook(`${resolved}.ts`) : requireApp(resolved);
    }
    return requireApp(name);
  }, mod, mod.exports);
  return mod.exports as T;
}
function ink(board: ReturnType<typeof mountTestWhiteboard>): string[] {
  return board.getDrawLayer()!.getChildren().map(node => {
    const { className, attrs } = node.toObject();
    return JSON.stringify({ className, attrs: Object.fromEntries(Object.entries(attrs)
      .filter(([key, value]) => !key.startsWith("ht") && key !== "id" && !(key === "dash" && Array.isArray(value) && value.length === 0))
      .sort(([a], [b]) => a.localeCompare(b))) });
  }).sort();
}
type Mode = "complete" | "ongoing" | "no-signal" | "pause" | "cancel" | "failure" | "work";
async function renderBeat(mode: Mode = "complete") {
  const compiled = compileSceneDocument(structuredClone(fixture.document));
  assert(compiled.ok && compiled.renderScene, "the retained figure must independently compile and validate");
  const presentation = buildVerifiedDiagramPresentation(fixture.document, compiled.renderScene);
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source);
  const oldTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!;
  const oldClear = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout")!;
  const timers = new Map<number, { atMs: number; callback: () => void }>();
  let timerId = 0;
  Object.defineProperty(globalThis, "setTimeout", { configurable: true, value: (callback: () => void, delay = 0) => {
    const id = ++timerId; timers.set(id, { atMs: clock.now() + delay, callback }); return id;
  } });
  Object.defineProperty(globalThis, "clearTimeout", { configurable: true, value: (id: number) => timers.delete(id) });
  const cancelRef = ref(false); const fbdStarted = ref(false);
  const transaction = board.beginDrawTransaction();
  let paused = false; let pausedMs = 0; let pauseVerified = false;
  const layout = hook<typeof import("../../features/tutor-session/hooks/useBoardLayout")>(path.join(hooks, "useBoardLayout.ts")).useBoardLayout({
    whiteboardRef: ref(board), cancelRef, fbdPhaseStartedRef: fbdStarted, liveQuestionRef: ref("") });
  const executor = hook<typeof import("../../features/tutor-session/hooks/useCommandExecution")>(path.join(hooks, "useCommandExecution.ts")).useCommandExecution({
    whiteboardRef: ref(board), cancelRef, speedRef: ref(1.25), boardLayoutRef: layout.boardLayoutRef,
    forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef, fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: fbdStarted,
    activeVerifiedDiagramRef: ref(presentation.diagram), turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef,
    narrationSinceEpochRef: layout.narrationSinceEpochRef, cancellableDelay: async () => {},
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout,
    resolveTextPlacement: layout.resolveTextPlacement, raceWithCancel: async <T>(value: Promise<T>) => value,
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.source.now,
  });
  const speechEndMs = Math.ceil(fixture.timings.totalDuration * 1000 / 1.25);
  const executed: Array<{ primitiveId: string | undefined; atMs: number; durationScale: number | undefined }> = [];
  let completed = false; let failure: unknown;
  const inkModule = process.env.INTRO_TAIL_INK_SOURCE
    ? hook<typeof import("../../features/tutor-session/lib/turn/segmentInk")>(path.join(app, "features/tutor-session/lib/turn/segmentInk.ts"))
    : { drawSegmentInk, planSegmentInk };
  const commands: DrawCommand[] = mode === "work" ? [{ type: "WRITE", text: "x=2", params: [90, 208], charPosition: 0, narrationBefore: "x equals two" }] : structuredClone(fixture.commands);
  const verifiedIntro = mode !== "work";
  const drawing = inkModule.drawSegmentInk({
    plan: inkModule.planSegmentInk({ commands, hasNarration: true, verifiedDiagramIntro: verifiedIntro }),
    verifiedDiagramIntro: verifiedIntro,
    clock: { narration: mode === "work" ? "x equals two" : fixture.narration, getTimings: () => mode === "work" ? null : fixture.timings,
      totalSpeechMs: fixture.timings.totalDuration * 1000, estimatedSpeechMs: fixture.timings.totalDuration * 1000,
      getAudioPositionMs: () => Math.min((clock.now() - pausedMs) * 1.25, fixture.timings.totalDuration * 1000 + 40),
      getPlaybackRate: () => 1.25, isSpeechComplete: mode === "no-signal" ? undefined : () => mode === "work" || mode !== "ongoing" && clock.now() >= speechEndMs,
      isPaused: () => paused, nowMs: clock.now },
    getDiagram: () => presentation.diagram, isCancelled: () => cancelRef.current, waitWhilePaused: async () => {
      while (paused && !cancelRef.current) await clock.waitForAdvance();
      return !cancelRef.current;
    },
    commandOptions: () => ({ trustedDiagramGeometry: verifiedIntro, applyLayout: false, isCancelled: () => cancelRef.current }),
    execute: async (command: DrawCommand, options) => {
      executed.push({ primitiveId: command.semanticRef?.primitiveId, atMs: clock.now(), durationScale: options.durationScale });
      await executor.executeCommand(command, options);
    },
  }).then(() => { completed = true; }, error => { completed = true; failure = error; });
  try {
    for (let step = 0; step < 2500 && !completed; step++) {
      clock.advance(16);
      if (["pause", "cancel", "failure"].includes(mode) && clock.now() === 3760) {
        paused = true; board.setPaused(true);
      }
      if (mode === "pause" && clock.now() === 6512) {
        assert(executed.every(row => row.atMs < 3760), "no tail command executes during intentional pause after speech end");
        pauseVerified = true; pausedMs = 6512 - 3760; paused = false; board.setPaused(false);
      }
      if (["cancel", "failure"].includes(mode) && clock.now() === 3808) {
        // The live runner's failure finally says complete, but speechAborted
        // makes its draw cancellation true. The transaction owner rolls back.
        cancelRef.current = true; board.cancelAnimations();
      }
      clock.pump();
      for (const [id, timer] of [...timers]) if (timer.atMs <= clock.now()) { timers.delete(id); timer.callback(); }
      for (let count = 0; count < 30; count++) await Promise.resolve();
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert(completed, "the real intro must complete within its bounded timeline"); await drawing;
    assert.equal(failure, undefined, "all retained verified commands execute successfully");
    if (["cancel", "failure"].includes(mode)) {
      assert(executed.length < fixture.expectedPrimitiveIds.length, "an aborted intro cannot silently complete the full figure");
      assert(executed.every(row => row.durationScale !== 0), "speech failure/Stop must not fast-forward remaining geometry");
      board.abortDrawTransaction(transaction); board.finishAbortedDrawTransaction(transaction);
      assert.deepEqual(ink(board), [], "the failed intro owner removes all speculative marks rather than committing a fragment");
    } else {
      if (mode !== "work") assert.deepEqual(executed.map(row => row.primitiveId), fixture.expectedPrimitiveIds, "every retained mark and label executes in its original reveal order");
      board.commitDrawTransaction(transaction);
    }
    assert(executed.filter(row => row.atMs < speechEndMs).every(row => row.durationScale !== 0), "verified marks cannot catch up before speech ends");
    return { speechEndMs, completeMs: clock.now(), tailMs: clock.now() - speechEndMs - pausedMs, executed, ink: ink(board), pauseVerified };
  } finally {
    unmountTestWhiteboard(board);
    Object.defineProperty(globalThis, "setTimeout", oldTimeout);
    Object.defineProperty(globalThis, "clearTimeout", oldClear);
  }
}
async function main() {
  const beat = await renderBeat();
  assert(beat.tailMs < 3000, "remaining verified marks must not leave a >3s silent tail after successful intro speech");
  const animated = await renderBeat("ongoing");
  assert(animated.tailMs > 3000 && animated.executed.every(row => row.durationScale !== 0), "unfinished speech preserves each normal command budget");
  assert.equal(createHash("sha256").update(JSON.stringify(beat.ink)).digest("hex"), createHash("sha256").update(JSON.stringify(animated.ink)).digest("hex"), "catch-up preserves every permanent shape, label glyph, position and style from the normally animated beat");
  const noSignal = await renderBeat("no-signal");
  assert(noSignal.tailMs > 3000 && noSignal.executed.every(row => row.durationScale !== 0), "absent completion knowledge cannot fast-forward a figure");
  assert.deepEqual(noSignal.ink, animated.ink);
  const paused = await renderBeat("pause");
  assert(paused.pauseVerified && paused.tailMs < 3000, "intentional pause holds the tail, then catch-up remains bounded after Resume");
  assert.deepEqual(paused.ink, animated.ink);
  await renderBeat("cancel"); await renderBeat("failure");
  const work = await renderBeat("work");
  assert.equal(work.executed.length, 1);
  assert(work.executed.every(row => row.durationScale !== 0) && work.ink.length > 0, "ordinary WRITE keeps its spoken schedule even when speech is already complete");
  console.log(`verify-verified-intro-speech-tail: 7 groups passed; 26 marks/93 nodes retained, tail ${animated.tailMs}ms -> ${beat.tailMs}ms`);
}
runWhiteboardVerifier(main);
