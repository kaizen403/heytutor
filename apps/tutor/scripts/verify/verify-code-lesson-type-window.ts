/** Actual segment ink -> TYPE executor -> controller regression; no provider calls. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  CODE_TYPE_MAX_BLOCK_MS,
  CODE_TYPE_MS_PER_CHAR,
  getCommandSpeechWindow,
  mathToSpeech,
  validateCodeLessonPlan,
  type AudioTimings,
} from "@heytutor/tutor-core";
import type { DrawCommand } from "@heytutor/drawing";
import { CodeLessonController, codeTypingCharOffsetsMs } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import type * as SegmentInk from "../../features/tutor-session/lib/turn/segmentInk";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";
import { waitUntilDrawClock } from "../../lib/replay/replayAudio";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(path.join(app, "package.json"));
const canonicalInk = path.join(app, "features/tutor-session/lib/turn/segmentInk.ts");
const canonicalExecutor = path.join(app, "features/tutor-session/hooks/useCommandExecution.ts");
const ref = <T>(current: T) => ({ current });
function load(file: string, resolveFrom: string): unknown {
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", js)((id: string) => id === "react"
    ? { useRef: ref, useCallback: (fn: unknown) => fn }
    : requireApp(id.startsWith(".") ? path.resolve(path.dirname(resolveFrom), id) : id), loaded, loaded.exports);
  return loaded.exports;
}
const ink = load(process.env.CODE_TYPE_WINDOW_INK_SOURCE ?? canonicalInk, canonicalInk) as typeof SegmentInk;
const executor = (load(canonicalExecutor, canonicalExecutor) as { useCommandExecution: typeof CommandHook }).useCommandExecution;

// The exact D01 loop block has a 6.65s natural requested window. Its tag's
// final-clause speech anchor was late, so waiting for it stranded readable TYPE
// after the voice. The cue is synthetic and exact; the block is valid source.
const code = "    for index, value in enumerate(nums):\n        need = target - value";
const narration = "for each value, these lines keep its position and work out the partner it needs. at index zero, target minus two is seven.";
const command: DrawCommand = {
  type: "TYPE", text: code, params: [], charPosition: narration.length,
  narrationBefore: narration, semanticRef: { entityId: "s1b2" },
};
const validation = validateCodeLessonPlan({
  schemaVersion: "code-lesson/v1", question: "Explain Two Sum in Python.", title: "Two Sum", language: "python",
  sections: [{ id: "s1", title: "One scan", explanation: "Look up the complement before remembering this index.",
    blocks: [{ id: "s1b1", code: "def two_sum(nums, target):\n    seen = {}" }, { id: "s1b2", code },
      { id: "s1b3", code: "        if need in seen:\n            return [seen[need], index]\n        seen[value] = index\n    return []" }],
    typeAlongRanges: [{ startLine: 3, endLine: 8 }] }],
  diagramHint: { structure: "array", values: [2, 7, 11, 15], caption: "Find two values summing to9", steps: [
    { id: "input", values: [2, 7, 11, 15] },
    { id: "store", values: [2, 7, 11, 15], caption: "Store2 with index0" },
    { id: "match", values: [2, 7, 11, 15], caption: "7 needs2: return[0,1]" },
  ] },
});
assert(validation.plan && validation.issues.length === 0, `fixture must validate: ${JSON.stringify(validation.issues)}`);
assert.equal(code.length * CODE_TYPE_MS_PER_CHAR, 6_650, "D01-equivalent natural typing window remains6.65s");

function timings(totalMs: number, cueMs: number): AudioTimings {
  const spoken = mathToSpeech(narration.trim());
  const cue = spoken.indexOf("target minus two");
  assert(cue > 0, "fixture retains its late final-clause cue");
  const starts = [...spoken].map((_, i) => i < cue
    ? i * cueMs / cue / 1000
    : (cueMs + (i - cue) * (totalMs - cueMs) / (spoken.length - cue)) / 1000);
  return { charStartTimes: starts, charDurations: starts.map((start, i) => (starts[i + 1] ?? totalMs / 1000) - start), totalDuration: totalMs / 1000 };
}

type Case = "late" | "short" | "pause" | "cancel" | "partial" | "preceding" | "cap" | "late-alignment" | "wait-safety";
async function run(name: Case): Promise<void> {
  const code = name === "cap" ? [
    "    for index, value in enumerate(nums):",
    `        need = target - value  # ${"x".repeat(45)}`,
    ...Array.from({ length: 3 }, () => `        # ${"x".repeat(65)}`),
  ].join("\n") : command.text!;
  const naturalOffsets = codeTypingCharOffsetsMs(code, Math.min(code.length * CODE_TYPE_MS_PER_CHAR, CODE_TYPE_MAX_BLOCK_MS));
  const naturalSpanMs = naturalOffsets.at(-1)!;
  const selectedPlan = validateCodeLessonPlan({ ...validation.plan!, sections: validation.plan!.sections.map((section) => ({
    ...section, blocks: section.blocks.map((block) => block.id === "s1b2" ? { ...block, code } : block),
  })) });
  assert(selectedPlan.plan && !selectedPlan.issues.length, `${name}: synthetic source plan validates`);
  const controller = new CodeLessonController();
  controller.commit(selectedPlan.plan);
  // D01's late blocks come after a first block: the editor is already open.
  controller.revealBlockInstant("s1b1");
  const totalMs = name === "short" ? 2_000 : 8_000;
  const cueMs = name === "short" ? 1_252 : 6_252;
  const alignment = timings(totalMs, cueMs);
  const estimateMs = name === "late-alignment" ? 11_400 : totalMs;
  const alignmentAvailableAtMs = name === "late-alignment" ? 2_000 : 0;
  const authoredCue = getCommandSpeechWindow(narration, command, alignment);
  assert.equal(authoredCue.startMs, cueMs, `${name}: fixture must exercise the real late speech-window match`);
  let wall = 0, media = 0, paused = false, cancelled = false, settled = false, failure: unknown;
  let timerId = 0, typingStart: number | null = null, lastCharacterWall: number | null = null;
  let pauseSpent = false, pauseUntil = 0, pauseCount = 0, pauseMedia = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace("window", globalThis);
  replace("performance", { now: () => wall });
  replace("setTimeout", (fn: () => void, ms = 0) => {
    const id = ++timerId; timers.set(id, { at: wall + ms, run: fn }); return id;
  });
  replace("clearTimeout", (id: number) => timers.delete(id));
  replace("fetch", () => { throw Error("TYPE window gate forbids network/providers"); });
  const delay = (ms: number) => new Promise<void>((resolve) => {
    const id = ++timerId; timers.set(id, { at: wall + ms, run: resolve });
  });
  const revealed = () => controller.getState().revealedChars.s1b2 ?? 0;
  const landed: Array<{ index: number; wall: number; media: number }> = [];
  const cursorStates: Array<{ state: string; wall: number; media: number }> = [];
  const starts: Array<{ type: string; wall: number; media: number; options: ExecuteCommandOptions }> = [];
  const ends: Array<{ type: string; wall: number }> = [];
  const unsubscribe = controller.subscribe(() => {
    if (controller.getState().typingBlockId === "s1b2" && typingStart === null) typingStart = wall;
    for (let index = landed.length; index < revealed(); index++) landed.push({ index, wall, media });
    if (revealed() === code.length && lastCharacterWall === null) lastCharacterWall = wall;
  });
  const board = {
    getInkSettings: () => ({ inkColor: "white", pencilThickness: 2 }),
    setAnimationSpeed() {}, getDrawLayer: () => ({}),
    setCursorState: (state: string) => { cursorStates.push({ state, wall, media }); },
    flyCursorTo: async (_x: number, _y: number, ms: number) => { await delay(ms); },
    eraseRegion: async (_x: number, _y: number, _w: number, _h: number, ms: number) => { await delay(ms); },
  };
  const hook = executor({
    whiteboardRef: ref(board), cancelRef: ref(false), speedRef: ref(1), adaptiveFactorRef: ref(1),
    boardLayoutRef: ref({ rects: [] }), activeVerifiedDiagramRef: ref(null), turnTelemetryRef: ref(null),
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false), codeLessonControllerRef: ref(controller),
    forceSequentialWorkLayoutRef: ref(false), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    cancellableDelay: delay, forgetErasedTextRects() {}, resetBoardLayout() {},
    raceWithCancel: async <T,>(promise: Promise<T>) => promise,
    resolveTextPlacement: async () => ({ x: 0, y: 0 }), inkPaceRef: ref("follow"), nowMs: () => wall,
  } as never);
  const selected = { ...command, text: code, ...(name === "partial" ? { shownChars: 9 } : {}) };
  const commands = name === "preceding"
    ? [{ type: "PAUSE", params: [2_000], charPosition: 0, narrationBefore: "" } as DrawCommand, selected]
    : [selected];
  const job = ink.drawSegmentInk({
    plan: ink.planSegmentInk({ commands, verifiedDiagramIntro: false, hasNarration: true }),
    verifiedDiagramIntro: false, getDiagram: () => null, isCancelled: () => cancelled,
    waitWhilePaused: async () => { while (paused && !cancelled) await delay(16); return !cancelled; },
    commandOptions: (cmd) => ({ applyLayout: false, isCancelled: () => cancelled,
      ...(cmd.type === "PAUSE" ? { speechDurationMs: 2_000 } : {}) }),
    clock: { narration, getTimings: () => media < alignmentAvailableAtMs ? null : alignment,
      fallbackTimings: name === "late-alignment" ? timings(11_400, 8_910) : undefined,
      totalSpeechMs: estimateMs, estimatedSpeechMs: estimateMs,
      getAudioPositionMs: () => media, getPlaybackRate: () => 1, isPaused: () => paused, nowMs: () => wall,
      isSpeechComplete: () => media >= totalMs, canAdvanceAfterSpeech: () => !paused },
    execute: async (cmd, options) => {
      starts.push({ type: cmd.type, wall, media, options });
      await hook.executeCommandWithCancel(cmd, options);
      ends.push({ type: cmd.type, wall });
    },
  }).then(() => { settled = true; }, (error: unknown) => { failure = error; settled = true; });
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  try {
    await flush();
    while (!settled && wall < 35_000) {
      if (name === "cancel" && revealed() >= 12) cancelled = true;
      if (name === "pause" && !pauseSpent && revealed() >= 10) {
        pauseSpent = true; paused = true; pauseUntil = wall + 2_000; pauseCount = revealed(); pauseMedia = media;
      }
      if (paused && wall >= pauseUntil) {
        assert.equal(revealed(), pauseCount, "Pause freezes the actual TYPE prefix");
        assert.equal(media, pauseMedia, "Pause freezes media without spending speech");
        paused = false;
      }
      wall += 10;
      if (!paused) media = Math.min(media + 10, totalMs);
      for (const [id, timer] of [...timers]) if (timer.at <= wall) { timers.delete(id); timer.run(); }
      await flush();
    }
    assert(settled, `${name}: actual segment/TYPE consumers settle on the bounded platform clock`);
    if (failure) throw failure;
    await job;
    const typeStart = starts.find((x) => x.type === "TYPE");
    assert(typeStart, `${name}: real TYPE executor is reached`);
    console.log(JSON.stringify({ case: name, authoredCueMs: cueMs, speechMs: totalMs, estimateMs, alignmentAvailableAtMs,
      naturalRequestedMs: code.length * CODE_TYPE_MS_PER_CHAR,
      naturalSpanMs, typeDispatchMediaMs: typeStart.media, typingStartWallMs: typingStart,
      lastCharacterWallMs: lastCharacterWall, settledWallMs: wall, finalPrefix: revealed(),
      pauseWallMs: pauseSpent ? 2_000 : 0, cancelled, durationScale: typeStart.options.durationScale ?? 1,
      finalCursorState: cursorStates.at(-1)?.state ?? null }));
    assert.equal(typeStart.options.durationScale ?? 1, 1, `${name}: live TYPE is never an instant seek`);
    assert(typingStart !== null && landed.length > 0, `${name}: actual controller reveals a prefix`);
    assert(cursorStates.some((entry) => entry.state === "drawing"), `${name}: real TYPE activates its drawing cursor`);
    assert(!cursorStates.some((entry) => entry.state === "idle"), `${name}: TYPE does not hide its cursor while typing`);
    if (name !== "cancel") {
      assert.equal(cursorStates.at(-1)?.state, "thinking", `${name}: completed real TYPE host ends thinking`);
    }
    const pauseDuration = pauseSpent ? 2_000 : 0;
    const previousEnd = name === "preceding" ? ends.find((x) => x.type === "PAUSE")!.wall : 0;
    if (name === "late" || name === "pause" || name === "preceding") {
      assert(typeStart.wall >= previousEnd, "TYPE never crosses its preceding owned command");
      assert(typeStart.wall <= previousEnd + 1_400,
        `${name}: late TYPE must spend available speech instead of waiting for${cueMs}ms; dispatched${typeStart.wall}ms after prior${previousEnd}ms`);
    }
    if (name === "late-alignment") {
      assert(typeStart.wall <= alignmentAvailableAtMs + 200,
        `late-alignment: exact timings arrived at${alignmentAvailableAtMs}ms but stale estimate delayed TYPE to${typeStart.wall}ms`);
    }
    for (const landing of landed) {
      const activeElapsed = landing.wall - typingStart - (pauseSpent && landing.wall >= pauseUntil ? pauseDuration : 0);
      // An unavoidable short-voice tail crosses the existing media-to-wall
      // clock handoff, whose last controller poll is at most120ms old. The
      // fully voiced late regression remains within one10ms platform tick.
      const handoffAllowance = landing.media === totalMs && (name === "short" || name === "preceding" || name === "cap" || name === "late-alignment") ? 130 : 10;
      assert(activeElapsed >= naturalOffsets[landing.index]! - handoffAllowance && activeElapsed <= naturalOffsets[landing.index]! + 40,
        `${name}: character${landing.index} cadence changed: ${activeElapsed}ms vs natural${naturalOffsets[landing.index]}ms`);
    }
    if (name === "cancel") {
      assert(cancelled && revealed() >= 12 && revealed() < code.length, "Stop keeps the real partial TYPE prefix");
      const prefix = revealed(); wall += 1_000; await flush();
      assert.equal(revealed(), prefix, "cancelled TYPE cannot silently finish afterward");
    } else if (name === "partial") {
      assert.equal(revealed(), 9, "recorded partial TYPE reveals exactly its owned prefix");
    } else {
      assert.equal(revealed(), code.length, `${name}: every character lands`);
      assert(lastCharacterWall !== null && lastCharacterWall - typingStart - pauseDuration <= CODE_TYPE_MAX_BLOCK_MS + 40,
        `${name}: actual TYPE retains the24s block cap`);
      if (name === "short") {
        assert(lastCharacterWall > totalMs && wall <= naturalSpanMs + 1_000,
          `short speech retains a readable bounded tail, settled${wall}ms`);
      } else if (name === "cap") {
        assert(code.length * CODE_TYPE_MS_PER_CHAR > CODE_TYPE_MAX_BLOCK_MS, "cap fixture exceeds the uncapped natural request");
        assert(wall - typeStart.wall <= CODE_TYPE_MAX_BLOCK_MS + 1_000, "actual long TYPE joins within24s plus its bounded pen handoff");
      } else if (name === "late-alignment") {
        // The real8s alignment arrives at2s;2s+240ms approach+6.526s natural
        // cadence cannot fit wholly under the voice. Keep that unavoidable
        // readable tail rather than demanding impossible earlier knowledge.
        assert(lastCharacterWall <= totalMs + 900 && wall <= totalMs + 1_000,
          `late-alignment: readable tail must remain near speech end, last${lastCharacterWall}ms/join${wall}ms`);
      } else {
        assert(lastCharacterWall - pauseDuration <= totalMs + previousEnd + 450,
          `${name}: last code character must land near speech end at unchanged cadence; landed${lastCharacterWall - pauseDuration}ms against${totalMs}ms`);
      }
    }
  } finally {
    unsubscribe();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}

/** Actual public wait API: static/dynamic stalls, intentional Pause and Stop. */
async function waitSafetyGates(): Promise<void> {
  for (const name of ["static-stall", "dynamic-stall", "paused-stall", "cancel"] as const) {
    let wall = 0, paused = false, cancelled = false, settled = false, reads = 0, timerId = 0;
    const timers = new Map<number, { at: number; run: () => void }>();
    const priorTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
    Object.defineProperty(globalThis, "setTimeout", { configurable: true, writable: true,
      value: (run: () => void, ms = 0) => { const id = ++timerId; timers.set(id, { at: wall + ms, run }); return id; },
    });
    const dynamic = name !== "static-stall";
    const job = waitUntilDrawClock(() => 0, 2_400, {
      shouldCancel: () => cancelled, isPaused: () => paused, getPlaybackRate: () => 1, nowMs: () => wall,
      ...(dynamic ? { getTargetMs: () => { reads++; return 2_400; } } : {}),
    }).then(() => { settled = true; });
    try {
      while (!settled && wall < 15_000) {
        wall += 10;
        paused = name === "paused-stall" && wall <= 5_000;
        cancelled = name === "cancel" && wall >= 500;
        for (const [id, timer] of [...timers]) if (timer.at <= wall) { timers.delete(id); timer.run(); }
        for (let tick = 0; tick < 12; tick++) await Promise.resolve();
      }
      assert(settled, `${name}: actual public wait joins within its bound`);
      await job;
      const pauseMs = name === "paused-stall" ? 5_000 : 0;
      if (name === "cancel") {
        assert(wall >= 500 && wall <= 520, "Stop releases a stalled dynamic wait promptly");
      } else {
        assert(wall > 8_000 + pauseMs && wall <= 8_040 + pauseMs,
          `${name}: stall keeps the original8s active-wall bound, excluding only intentionalPause; joined${wall}ms`);
      }
      if (dynamic) assert(reads > 1, `${name}: the public dynamic target getter is polled`);
      console.log(JSON.stringify({ case: "wait-safety", control: name, wallMs: wall,
        stalledMediaMs: 0, dynamicTargetReads: reads, pausedWallMs: pauseMs, cancelled }));
    } finally {
      if (priorTimeout) Object.defineProperty(globalThis, "setTimeout", priorTimeout);
      else Reflect.deleteProperty(globalThis, "setTimeout");
    }
  }
}

async function main(): Promise<void> {
  const cases: Case[] = ["late", "short", "pause", "cancel", "partial", "preceding", "cap", "late-alignment", "wait-safety"];
  const selected = process.env.CODE_TYPE_WINDOW_CASE;
  assert(!selected || cases.includes(selected as Case), "unknown TYPE window case");
  const tested = selected ? [selected as Case] : cases;
  for (const name of tested) {
    if (name === "wait-safety") await waitSafetyGates(); else await run(name);
  }
  console.log(`verify-code-lesson-type-window: actual segment TYPE consumers hold for ${tested.join(", ")}`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
