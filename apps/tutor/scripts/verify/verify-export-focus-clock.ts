/** Export media time, not host timers, must release the real FOCUS executor. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { compileSceneDocument, validateSceneDocument } from "@heytutor/scene-engine";
import { serializeSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import { createVirtualWhiteboardClock } from "@heytutor/whiteboard";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { drainExportTail, pumpExportClock } from "../../lib/lecture-export/lectureExportTail";
import { waitUntilDrawClock } from "../../lib/replay/replayAudio";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import type { useCommandExecution } from "../../features/tutor-session/hooks/useCommandExecution";
import type { useBoardLayout } from "../../features/tutor-session/hooks/useBoardLayout";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import retained from "./fixtures/youtube-pen/q15.json";

const app = path.resolve(import.meta.dirname, "../.."), requireApp = createRequire(path.join(app, "package.json"));
const ref = <T>(current: T) => ({ current });
const react = { useRef: ref, useCallback: <T>(fn: T) => fn, useMemo: <T>(fn: () => T) => fn(),
  useEffect() {}, useLayoutEffect() {}, useState: (v: unknown) => [typeof v === "function" ? v() : v, () => {}] };
function hook(file: string): Record<string, unknown> {
  const mod = { exports: {} as Record<string, unknown> };
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function("require", "module", "exports", code)((name: string) => {
    if (name === "react") return react;
    if (name.startsWith("@/")) return requireApp(path.join(app, name.slice(2)));
    if (name.startsWith(".")) {
      const resolved = path.resolve(path.dirname(file), name);
      return resolved.startsWith(path.join(app, "features/tutor-session/hooks")) ? hook(`${resolved}.ts`) : requireApp(resolved);
    }
    return requireApp(name);
  }, mod, mod.exports);
  return mod.exports;
}
const layoutHook = hook(path.join(app, "features/tutor-session/hooks/useBoardLayout.ts")).useBoardLayout as typeof useBoardLayout;
const executionHook = hook(path.join(app, "features/tutor-session/hooks/useCommandExecution.ts")).useCommandExecution as typeof useCommandExecution;

async function run(cancelAtMs?: number) {
  const document = validateSceneDocument(retained.sceneDocument).document;
  assert(document);
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene);
  const diagram = buildVerifiedDiagramPresentation(document, compiled.renderScene).diagram;
  diagram.deferredAnnotations = [];
  const clock = createVirtualWhiteboardClock(), board = mountTestWhiteboard();
  board.setTimeSource(clock.source);
  const cancel = ref(false), started: Array<{ type: string; atMs: number }> = [], traces: number[] = [];
  const layout = layoutHook({ whiteboardRef: ref(board), cancelRef: cancel,
    fbdPhaseStartedRef: ref(true), liveQuestionRef: ref(document.source.question), viewportMode: "fixed" });
  const executor = executionHook({ whiteboardRef: ref(board), cancelRef: cancel, speedRef: ref(1),
    boardLayoutRef: layout.boardLayoutRef, forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef,
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(true), activeVerifiedDiagramRef: ref(diagram),
    turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef,
    cancellableDelay: async (ms) => { const end = clock.now() + ms; while (!cancel.current && clock.now() < end) await clock.waitForAdvance(); },
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout,
    resolveTextPlacement: layout.resolveTextPlacement, raceWithCancel: async <T>(job: Promise<T>) => job,
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.now,
  });
  const nativeAnnotation = board.drawAnnotation;
  board.drawAnnotation = async (...args) => { traces.push(clock.now()); await nativeAnnotation(...args); };
  const focus: DrawCommand = { type: "FOCUS", text: "monkey_start", params: [], charPosition: 0, narrationBefore: "" };
  const write: DrawCommand = { type: "WRITE", text: "d = 40 m", params: [90, 142, 27], charPosition: 0, narrationBefore: "" };
  const rows = [
    { narration: "First consider the launch and the branch. Then look at the monkey.", commands: [focus], durationMs: 8_000 },
    { narration: "d equals forty meters.", commands: [write], durationMs: 2_000 },
  ];
  const turn: StoredTurn = { id: "export-focus-clock", orderIndex: 0, question: document.source.question, rawResponse: "",
    speedMultiplier: 1, traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null,
    visualStatus: "text_only", sceneArtifacts: null, segments: rows.map((row, orderIndex) => ({
      id: `row-${orderIndex}`, orderIndex, narration: row.narration, spokenText: row.narration,
      command: serializeSegmentCommands(row.commands), audioUrl: null, durationMs: row.durationMs, timings: null,
    })) };
  const timeline = buildReplayTimeline([turn]);
  const saved = new Map<string, PropertyDescriptor | undefined>(), hostTimers: Array<() => void> = [];
  const replace = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  let settled = false, failure: unknown;
  try {
    // The encoder may pump thousands of media frames without a host task.
    // Freeze that external boundary; keep all real board/executor code running.
    replace("setTimeout", (callback: () => void) => { hostTimers.push(callback); return hostTimers.length; });
    replace("clearTimeout", () => {});
    replace("performance", { now: clock.now });
    replace("window", globalThis);
    const job = drawReplayDiagramTimeline({ cues: timeline.cues, getClockMs: clock.now,
      waitForAdvance: clock.waitForAdvance, shouldCancel: () => cancel.current,
      getTurn: () => undefined, getDiagram: () => diagram,
      executeCommand: async (command, options) => {
        started.push({ type: command.type, atMs: clock.now() });
        await executor.executeCommand(command, options);
      },
    }).then(() => { settled = true; }, (error: unknown) => { failure = error; settled = true; });
    for (let ms = 0; ms <= timeline.totalMs && !settled; ms += 50) {
      cancel.current ||= cancelAtMs !== undefined && ms >= cancelAtMs;
      clock.setNow(ms); await pumpExportClock(clock);
    }
    const tail = await drainExportTail({ clock, drawPromise: job, shouldCancel: () => cancel.current,
      startMs: timeline.totalMs, stepMs: 50, limitMs: 8_000, yieldToHost: async () => {} });
    console.log(JSON.stringify({ settled, tailSettled: tail.settled, hostTimers: hostTimers.length, started, traces }));
    assert.equal(failure, undefined);
    assert.equal(tail.settled, true, "virtual FOCUS waits must finish before the encoder exhausts its tail while host timers are frozen");
    assert.equal(hostTimers.length, 0, "a virtual FOCUS never needs a host timer to wake");
    if (cancelAtMs !== undefined) {
      assert.deepEqual(started.map((entry) => entry.type), ["FOCUS"], "cancelled virtual waits cannot release following work");
      assert.equal(traces.length, 0, "cancellation before the word cannot begin its trace");
      assert.equal(board.getDrawLayer()!.getChildren().length, 0);
    } else {
      assert.ok(traces.some((ms) => ms < 8_000), "real verified-geometry tracing starts inside its spoken cue");
      assert.ok(started.some((entry) => entry.type === "WRITE" && entry.atMs < 10_000), "the following recorded work row is not stranded behind a host timer");
      assert.ok(board.getDrawLayer()!.getChildren().length > 0, "the actual following WRITE leaves committed ink");
    }
  } finally {
    cancel.current = true;
    for (const callback of hostTimers.splice(0)) callback();
    for (let i = 0; i < 40; i++) { clock.pump(); await Promise.resolve(); }
    unmountTestWhiteboard(board);
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
async function main() {
  await run();
  await run(2_000);
  const clock = createVirtualWhiteboardClock();
  let paused = true, target = 7_000, finished = false;
  const wait = waitUntilDrawClock(clock.now, target, { waitForAdvance: clock.waitForAdvance,
    isPaused: () => paused, getTargetMs: () => target }).then(() => { finished = true; });
  clock.setNow(1_000); target = 500;
  await pumpExportClock(clock);
  assert.equal(finished, false, "a refreshed deadline cannot spend paused media time");
  paused = false;
  await pumpExportClock(clock); await wait;
  assert.equal(finished, true, "resume releases a revised cue already reached by media time");
  console.log("verify-export-focus-clock: real executor/Whiteboard virtual FOCUS, following ink, frozen host timers, cancel, pause and refreshed targets");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
