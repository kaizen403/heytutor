/** Live POINT -> real command executor -> mounted Whiteboard, without providers. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { verifiedDiagramCommandToDrawCommand, type DrawCommand } from "@heytutor/drawing";
import { CODE_TYPE_MAX_BLOCK_MS, CODE_TYPE_MS_PER_CHAR, getBestWriteCharScheduleMs, getCommandSpeechWindow,
  getMockCodeLessonPlan, mathToSpeech, type AudioTimings } from "@heytutor/tutor-core";
import type * as SegmentInk from "../../features/tutor-session/lib/turn/segmentInk";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { CodeLessonController, codeTypingCharOffsetsMs } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(path.join(app, "package.json"));
const canonicalInk = path.join(app, "features/tutor-session/lib/turn/segmentInk.ts");
const canonicalExecutor = path.join(app, "features/tutor-session/hooks/useCommandExecution.ts");
const canonicalMarker = path.join(app, "features/tutor-session/lib/board/markerTour.ts");
const ref = <T>(current: T) => ({ current });
function load(file: string, resolveFrom: string): unknown {
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((id: string) => {
    if (id === "react") return { useRef: ref, useCallback: (fn: unknown) => fn };
    if (resolveFrom === canonicalExecutor && id === "../lib/board/markerTour" && process.env.POINT_DEADLINE_MARKER_SOURCE) {
      return load(process.env.POINT_DEADLINE_MARKER_SOURCE, canonicalMarker);
    }
    return requireApp(id.startsWith(".") ? path.resolve(path.dirname(resolveFrom), id) : id);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const ink = load(process.env.POINT_DEADLINE_INK_SOURCE ?? canonicalInk, canonicalInk) as typeof SegmentInk;
const executor = (load(process.env.POINT_DEADLINE_EXECUTOR_SOURCE ?? canonicalExecutor, canonicalExecutor) as {
  useCommandExecution: typeof CommandHook;
}).useCommandExecution;

// D01's actual quadratic-comparison narration, without its recorded audio.
// The controlled media duration equals its non-silent WAV's complete span.
const pointNarration = "we could try every pair of positions. on a long list, that can take quadratic time, because each value may need checking against many others.";
type Case = "fast" | "slow" | "pause" | "cancel" | "seek" | "clockless" | "dead-clock" |
  "late-alignment" | "rate-change" | "early-completion" | "next-work" | "next-type";
const receipts: unknown[] = [];

async function run(name: Case): Promise<void> {
  const narration = name === "next-type"
    ? "for each value, these lines keep its position and work out the partner it needs. at index zero, target minus two is seven."
    : pointNarration;
  const totalMediaMs = name === "next-type" ? 8_000 : 8_720;
  const spoken = mathToSpeech(narration);
  const typeCue = spoken.indexOf("target minus two");
  const alignment: AudioTimings = {
    charStartTimes: [...spoken].map((_, i) => name === "next-type"
      ? (i < typeCue ? i * 6_252 / typeCue : 6_252 + (i - typeCue) * (totalMediaMs - 6_252) / (spoken.length - typeCue)) / 1000
      : i * totalMediaMs / spoken.length / 1000),
    charDurations: [...spoken].map(() => totalMediaMs / spoken.length / 1000),
    totalDuration: totalMediaMs / 1000,
  };
  const question = "Explain Two Sum. Example: nums = [2, 7, 11, 15], target = 9.";
  const plan = getMockCodeLessonPlan(question);
  const walk = resolveDsaFrames(question, plan.diagramHint, plan);
  assert(walk && walk.frames.length > 0, "the source-grounded DSA fixture must compile normally");
  const diagram = walk.frames[0]!.presentation.diagram;
  assert.equal(diagram.layout, "code_lesson", "the real DSA compiler grants POINT at visible work rows");
  const codeController = new CodeLessonController();
  codeController.commit(plan); codeController.revealBlockInstant("s1b1");
  const block = plan.sections[0]!.blocks.find((item) => item.id === "s1b2");
  assert(block, "actual committed mock Two Sum plan must contain its loop block");
  const typeCommand: DrawCommand = { type: "TYPE", text: block.code, params: [], charPosition: narration.length,
    narrationBefore: narration, semanticRef: { entityId: block.id } };
  const naturalTypeMs = codeTypingCharOffsetsMs(block.code, Math.min(block.code.length * CODE_TYPE_MS_PER_CHAR, CODE_TYPE_MAX_BLOCK_MS)).at(-1)!;
  // The actual Whiteboard creates permanent fallback glyphs; only vector font
  // fetching and pixel painting are inert, like the other mounted board gates.
  const board = mountTestWhiteboard(undefined, async (text, x, y, fontSize) =>
    Array.from(text, (char, index) => ({ char, x: x + index * 16, y, width: 16, fontSize, strokes: [] })));
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  let rate = name === "slow" ? .5 : 1.25;
  let media = 0, paused = false, cancelled = false, settled = false, failure: unknown;
  let timerId = 0, endWall = 0, endMedia = 0, pauseSpent = false, audioEndWall: number | null = null;
  const actualMediaEnd = name === "early-completion" ? 4_000 : totalMediaMs;
  const timers = new Map<number, { at: number; run: () => void }>();
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const delay = (ms: number) => new Promise<void>((done) => {
    const id = ++timerId;
    timers.set(id, { at: clock.now() + ms, run: done });
  });
  const hook = executor({
    whiteboardRef: ref(board), cancelRef: ref(false), activeVerifiedDiagramRef: ref(diagram),
    fbdPhaseStartedRef: ref(false), fbdPhaseMarkedRef: ref(false),
    // A recorded visible work-row fixture, not a replacement POINT resolver.
    boardLayoutRef: ref({ rects: [{ x: 90, y: 142, width: 192, height: 32, text: "Input values", workId: "w1", workIndex: 1 }], nextY: 208 }),
    inkPaceRef: ref("follow"), speedRef: ref(rate), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(null), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async (promise) => promise,
    resolveTextPlacement: async (_command, x, y) => ({ x, y }),
    cancellableDelay: delay, forgetErasedTextRects() {}, resetBoardLayout() {}, nowMs: clock.source.now,
    ...(name === "next-type" ? { codeLessonControllerRef: ref(codeController) } : {}),
  });
  const flights: Array<{ wall: number; media: number; durationMs: number; x: number; y: number }> = [];
  let touring = false;
  const nativeFlight = board.flyCursorTo;
  board.flyCursorTo = async (...args) => {
    if (touring) flights.push({ wall: clock.now(), media, durationMs: args[2], x: args[0], y: args[1] });
    await nativeFlight(...args);
  };
  let optionsAtDispatch: ExecuteCommandOptions | undefined;
  const command: DrawCommand = { type: "POINT", text: "w1", params: [], charPosition: 0, narrationBefore: "" };
  const work: DrawCommand = { type: "WRITE", text: "quadratic time", params: [90, 208, 32],
    charPosition: narration.indexOf("quadratic time"), narrationBefore: narration.slice(0, narration.indexOf("quadratic time")) };
  let firstWorkGlyph: number | null = null;
  const unsubscribe = codeController.subscribe(() => {
    if (name === "next-type" && (codeController.getState().revealedChars[block.id] ?? 0) > 0) firstWorkGlyph ??= media;
  });
  try {
    for (const mark of diagram.commands) await hook.executeCommandWithCancel(verifiedDiagramCommandToDrawCommand(mark), {
      durationScale: 0, trustedDiagramGeometry: true, applyLayout: false,
    });
    await hook.executeCommandWithCancel({ type: "WRITE", text: "Input values", params: [90, 142, 32], charPosition: 0, narrationBefore: "" }, {
      durationScale: 0, applyLayout: false,
    });
    const permanentBefore = board.getDrawLayer()!.toJSON();
    assert(board.getDrawLayer()!.getChildren().length > 0, "the tour begins beside actual permanent work and verified figure ink");
    flights.length = 0;
    replace("window", globalThis); replace("performance", { now: clock.source.now });
    replace("setTimeout", (fn: () => void, ms = 0) => { const id = ++timerId; timers.set(id, { at: clock.now() + ms, run: fn }); return id; });
    replace("clearTimeout", (id: number) => timers.delete(id));
    replace("fetch", () => { throw Error("POINT gate forbids network/providers"); });
    const job = ink.drawSegmentInk({
      plan: ink.planSegmentInk({ commands: name === "next-work" ? [command, work] : name === "next-type" ? [command, typeCommand] : [command], verifiedDiagramIntro: false, hasNarration: true }),
      verifiedDiagramIntro: false, getDiagram: () => diagram, isCancelled: () => cancelled,
      waitWhilePaused: async () => !cancelled,
      commandOptions: () => ({ applyLayout: false, isCancelled: () => cancelled, ...(name === "seek" ? { durationScale: 0 } : {}) }),
      clock: { narration, getTimings: () => name === "clockless" || name === "late-alignment" && media < 2_000 ? null : alignment,
        // The real runner invokes runDraw(estimateSpeechMs), even when peeked
        // final alignment has already established a shorter media duration.
        totalSpeechMs: narration.length * 85, estimatedSpeechMs: narration.length * 85, msPerChar: 85,
        getAudioPositionMs: () => name === "dead-clock" ? 0 : media,
        getPlaybackRate: () => rate, isAudioActive: () => media < actualMediaEnd,
        isPaused: () => paused, nowMs: clock.source.now,
        // Optional completion is absent in this case: final late alignment
        // itself must bound the tour, not an onEnd callback masking a stale
        // duration getter. Ordinary live cases also exercise accepted onEnd.
        ...(name !== "late-alignment" ? { isSpeechComplete: () => name === "dead-clock" ? false : media >= actualMediaEnd } : {}),
        canAdvanceAfterSpeech: () => !paused },
      execute: async (next, options) => {
        if (next.type === "POINT") optionsAtDispatch = options;
        touring = next.type === "POINT";
        try {
          await hook.executeCommandWithCancel(next, name === "clockless"
            ? { ...options, getAudioPositionMs: undefined, spokenClock: undefined }
            : options);
        } finally { touring = false; }
      },
      trace: { writeCharStart: () => { firstWorkGlyph ??= media; } },
    }).then(() => { settled = true; endWall = clock.now(); endMedia = media; }, (error) => { failure = error; settled = true; });
    await flush();
    for (let wall = 0; !settled && wall < 50_000; wall += 16) {
      if (name === "cancel" && media >= 2_000 && !cancelled) { cancelled = true; board.cancelAnimations(); }
      // Pause during the first dwell, after the real flight completed. This
      // detects dispatch during pause rather than relying on Whiteboard's
      // independent paused-flight fence to mask a missing tour guard.
      if (name === "pause" && !pauseSpent && media >= 1_000) {
        pauseSpent = true; paused = true; board.setPaused(true);
        const pose = board.getCursorLayer()!.toJSON(), before = flights.length;
        for (let elapsed = 0; elapsed < 1_200; elapsed += 16) {
          clock.advance(16); clock.pump();
          for (const [id, timer] of [...timers]) if (timer.at <= clock.now()) { timers.delete(id); timer.run(); }
          await flush();
        }
        assert(!settled, "a paused POINT does not finish while its narration is paused");
        assert.equal(flights.length, before, "pause cannot dispatch new hops while the pen is held");
        assert.equal(board.getCursorLayer()!.toJSON(), pose, "actual paused Whiteboard cursor stays still");
        paused = false; board.setPaused(false);
      }
      if (name === "rate-change" && media >= 4_000) rate = .5;
      clock.advance(16); if (!paused) media = Math.min(actualMediaEnd, media + 16 * rate);
      if (media === actualMediaEnd && audioEndWall === null) audioEndWall = clock.now();
      for (const [id, timer] of [...timers]) if (timer.at <= clock.now()) { timers.delete(id); timer.run(); }
      clock.pump(); await flush();
    }
    assert(settled, `${name}: a missing/dead media clock cannot hang the draw queue`);
    if (failure) throw failure;
    if (name !== "next-work") assert.equal(board.getDrawLayer()!.toJSON(), permanentBefore, `${name}: POINT cannot change work or committed figure ink`);
    if (name === "seek") assert.equal(flights.length, 0, "a seek does not tour its recorded narration");
    else assert(flights.length > 0, `${name}: the real cursor must visit a resolved work row`);
    assert(flights.every((flight) => flight.durationMs > 0 && [118.8, 186, 253.2].some((x) => Math.abs(x - flight.x) < .01) && flight.y === 142),
      `${name}: every hop stays readable and visits only the actual visible row`);
    if (name === "cancel") assert(endWall < 3_000, "cancel joins the tour promptly and cannot revive later hops");
    if (name === "next-type") {
      const authoredCue = getCommandSpeechWindow(narration, typeCommand, alignment).startMs;
      assert.equal(authoredCue, 6_252, "actual TYPE speech-window consumer retains the late explanatory phrase");
      const expectedStartMs = Math.min(authoredCue, Math.max(totalMediaMs - naturalTypeMs, 0));
      console.log(JSON.stringify({ name, authoredCue, expectedStartMs, firstWorkGlyph, naturalTypeMs, providerCalls: 0 }));
      assert(firstWorkGlyph !== null && firstWorkGlyph - expectedStartMs <= 500,
        "POINT must yield the single pen to the following actual TYPE budget start+500ms");
      assert.equal(codeController.getState().revealedChars[block.id], block.code.length, "following TYPE retains every source character");
      receipts.push({ name, authoredCue, expectedStartMs, firstWorkGlyph, naturalTypeMs });
    } else if (name === "next-work") {
      const schedule = getBestWriteCharScheduleMs(narration, work, alignment, narration.length * 85, 0, 85);
      assert(schedule && schedule.offsetsMs[0]! > 0 && schedule.offsetsMs[0]! < totalMediaMs - 1_000,
        "the actual work cue must be inside the spoken sentence");
      console.log(JSON.stringify({ name, cueMs: schedule.offsetsMs[0], firstWorkGlyph, endWall, providerCalls: 0 }));
      assert(firstWorkGlyph !== null && firstWorkGlyph - schedule.offsetsMs[0]! <= 500,
        "POINT must yield the single pen to the following actual WRITE cue+500ms");
      receipts.push({ name, cueMs: schedule.offsetsMs[0], firstWorkGlyph, endWall });
    } else if (["fast", "slow", "pause", "late-alignment", "rate-change", "early-completion"].includes(name)) {
      // Before the actual end, the controlled clock's remaining media at its
      // current rate gives the exact expected end, including any prior rate
      // change. This is a deterministic fixture, not a hardware observation.
      const voiceEnd = audioEndWall ?? endWall + (actualMediaEnd - endMedia) / rate;
      const receipt = { name, rate, audioEndWall: voiceEnd, endWall, endMedia, tailMs: endWall - voiceEnd,
        speechBudgetMs: optionsAtDispatch?.speechDurationMs, speechShareMs: optionsAtDispatch?.speechShareMs,
        flights: flights.length, providerCalls: 0 };
      receipts.push(receipt); console.log(JSON.stringify(receipt));
      assert(endMedia >= actualMediaEnd - 350, `${name}: POINT must not park before the advancing segment's last spoken window`);
      assert(endWall - voiceEnd <= 700, `${name}: POINT must release the pen within700ms of actual speech completion (tail ${Math.round(endWall - voiceEnd)}ms)`);
    } else receipts.push({ name, rate, endWall, endMedia, flights: flights.length });
    assert(optionsAtDispatch, "actual segment ink must dispatch the POINT consumer");
    await job;
  } finally {
    cancelled = true; board.cancelAnimations();
    unsubscribe();
    unmountTestWhiteboard(board);
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}

async function main(): Promise<void> {
  const selected = process.env.POINT_DEADLINE_CASE;
  const cases = ["fast", "slow", "pause", "cancel", "seek", "clockless", "dead-clock",
    "late-alignment", "rate-change", "early-completion", "next-work", "next-type"] satisfies Case[];
  assert(!selected || cases.some((name) => name === selected), "POINT_DEADLINE_CASE must select a real consumer case");
  for (const name of cases) {
    if (!selected || selected === name) await run(name);
  }
  if (process.env.POINT_DEADLINE_RECEIPT) writeFileSync(process.env.POINT_DEADLINE_RECEIPT, JSON.stringify({ receipts, providerCalls: 0 }, null, 2) + "\n");
  console.log(`PASS POINT speech deadline: ${receipts.length} actual-consumer groups; providers0`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
