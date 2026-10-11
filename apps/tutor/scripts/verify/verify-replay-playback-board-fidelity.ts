/**
 * The actual Replay consumer must finish the same engine figure as live and
 * clear a finished page before starting an independent question. React
 * reconciliation and the voice provider are inert; scene admission, replay
 * scheduling, command execution and native Konva ink use production code.
 * The native board harness simulates pixel paint, so this gate checks ink
 * paths, page ownership and async ordering rather than screenshot pixels.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import {
  getSegmentCommands,
  isStoredCommandTrustedGeometry,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  verifiedDiagramCommandToDrawCommand,
  type DrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import type { UseReplayParams } from "../../features/tutor-session/hooks/useReplay";
import type { ExecuteCommandOptions } from "../../features/tutor-session/hooks/turn/types";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

const hooksDir = fileURLToPath(new URL("../../features/tutor-session/hooks/", import.meta.url));
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const react = {
  useRef: ref, useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(),
  useEffect() {}, useLayoutEffect() {},
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, () => {}],
};
// The transpiled hook bodies are untyped; their real dependencies stay loaded.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookResult = Record<string, any>;
const modules = new Map<string, HookResult>();
function hook(file: string): HookResult {
  if (modules.has(file)) return modules.get(file)!;
  const source = file === path.join(hooksDir, "useReplay.ts")
    ? process.env.REPLAY_PLAYBACK_SOURCE ?? file : file;
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as HookResult };
  modules.set(file, mod.exports);
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return react;
    if (specifier.startsWith("@/")) return requireApp(path.resolve(appRoot, specifier.slice(2)));
    if (specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), specifier);
      return target.startsWith(hooksDir) ? hook(`${target}.ts`) : requireApp(target);
    }
    return requireApp(specifier);
  }, mod, mod.exports);
  return mod.exports;
}

function documentFor(vertical: boolean): SceneDocument {
  const question = vertical ? "A rod has length L. Show the vertical span." : "A segment has length L. Show the horizontal span.";
  const ids = ["a", "b", "edge", "length"];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-grounded measured span" },
    source: { question, nonMetric: true, representationTier: "qualitative_verified" }, quantities: [],
    entities: [
      { id: "a", kind: "point", role: "span start" }, { id: "b", kind: "point", role: "span end" },
      { id: "edge", kind: "segment", role: "measured edge" },
      { id: "length", kind: "dimension", role: "distance", label: "L" },
    ],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: vertical ? { x: 0, y: 4 } : { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_edge", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["edge"] },
      { id: "make_length", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["length"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Here is the segment." }],
    teachingTimeline: [],
  };
}

const work = (text: string, y = 100): DrawCommand => ({
  type: "WRITE", text, params: [36, y, 30], charPosition: 0, narrationBefore: "",
});
type Fixture = { turn: StoredTurn; diagram: VerifiedDiagram; commands: DrawCommand[]; withheld: string[] };
async function fixture(vertical = false, status: StoredTurn["status"] = "complete"): Promise<Fixture> {
  const document = documentFor(vertical);
  const question = String(document.source.question);
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  const withheld = (presentation.diagram.deferredAnnotations?.flatMap((entry) => entry.commands) ?? [])
    .map((command) => command.semanticRef?.primitiveId ?? command.text ?? command.type);
  assert(withheld.length >= 4 && withheld.some((id) => id.includes("label")), "fixture withholds a measurement bar, two witnesses and label");
  const row = work(vertical ? "vertical page" : "horizontal page");
  const saved = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: document, visualStatus: "validated",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true,
      diagramResultStatus: "ready", turnPlan: {
        schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [],
        qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
      },
    },
    // No FOCUS names length: only turn completion can reveal its measurement.
    segments: [...presentation.introSegments, { narration: "The final row.", command: row, verifiedDiagramIntro: false }].map((segment, orderIndex) => ({
      orderIndex, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: segment.verifiedDiagramIntro === true }),
    })),
  });
  assert(saved.ok, saved.ok ? "" : saved.error);
  const turn: StoredTurn = {
    ...saved.value, id: vertical ? "vertical-turn" : "horizontal-turn", orderIndex: vertical ? 1 : 0,
    question, status, kind: "lesson", rawResponse: "", speedMultiplier: 1, traceId: null,
    segments: saved.value.segments.map((segment) => ({
      ...segment, id: `${vertical ? "v" : "h"}-${segment.orderIndex}`, audioUrl: null, durationMs: 1, timings: null,
      command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), {
        trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command),
      }),
    })),
  };
  return {
    turn: JSON.parse(JSON.stringify(turn)), diagram: presentation.diagram, withheld,
    // Full compiled commands, independent of replay's intro/completion policy.
    commands: [...presentation.diagram.commands.map(verifiedDiagramCommandToDrawCommand), row],
  };
}

function ink(board: WhiteboardHandle): string[] {
  const layer = board.getDrawLayer();
  assert(layer);
  return layer.getChildren().map((node) => {
    const object = node.toObject();
    const attrs = Object.fromEntries(Object.entries(object.attrs).filter(([key, value]) =>
      !key.startsWith("ht") && key !== "id" && !(key === "dash" && Array.isArray(value) && value.length === 0),
    ).sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify({ className: object.className, attrs });
  }).sort();
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)); };
function barrier() {
  let resolve = () => {};
  return { promise: new Promise<void>((done) => { resolve = done; }), release: () => resolve() };
}
type Event = { kind: "command" | "clear" | "sync" | "reset"; label: string; ink?: string[] };
type HarnessOptions = {
  holdFinalSpeech?: boolean;
  holdFinalInk?: boolean;
  onCommand?: (command: DrawCommand, index: number) => void;
  onClear?: (index: number) => Promise<void>;
};
function harness(turns: StoredTurn[], options: HarnessOptions = {}) {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const pump = setInterval(() => { clock.advance(1000); clock.pump(); }, 1);
  const whiteboardRef = ref<WhiteboardHandle | null>(board);
  const cancelRef = ref(false);
  const replayGenerationRef = ref(0);
  const activeVerifiedDiagramRef = ref<VerifiedDiagram | null>(null);
  const fbdPhaseStartedRef = ref(false);
  const liveQuestionRef = ref(turns[0]!.question);
  const events: Event[] = [];
  let observe = false;
  let clearCount = 0;
  const nativeClear = board.clearBoard.bind(board);
  board.clearBoard = async () => {
    if (observe) events.push({ kind: "clear", label: String(++clearCount), ink: ink(board) });
    await nativeClear();
    if (observe) await options.onClear?.(clearCount);
  };
  const layout = hook(path.join(hooksDir, "useBoardLayout.ts")).useBoardLayout({ whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef });
  const resetBoardLayout = (keepHeading?: boolean, sequential?: boolean) => {
    if (observe) events.push({ kind: "reset", label: "layout" });
    layout.resetBoardLayout(keepHeading, sequential);
  };
  const executor = hook(path.join(hooksDir, "useCommandExecution.ts")).useCommandExecution({
    whiteboardRef, cancelRef, speedRef: ref(1000), boardLayoutRef: layout.boardLayoutRef,
    forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef, fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef,
    activeVerifiedDiagramRef, turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef,
    narrationSinceEpochRef: layout.narrationSinceEpochRef, cancellableDelay: async () => {},
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout,
    resolveTextPlacement: layout.resolveTextPlacement, raceWithCancel: async <T>(promise: Promise<T>) => promise,
    inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.source.now,
  });
  const speech = barrier();
  const draw = barrier();
  let speechReached = false;
  let drawReached = false;
  let commandCount = 0;
  const execute = async (command: DrawCommand, drawOptions?: ExecuteCommandOptions) => {
    if (observe) {
      options.onCommand?.(command, ++commandCount);
      if (options.holdFinalInk && command.type === "WRITE") {
        drawReached = true;
        await draw.promise;
      }
      if (drawOptions?.isCancelled?.()) return;
      events.push({ kind: "command", label: command.semanticRef?.primitiveId ?? command.text ?? command.type });
    }
    await executor.executeCommand(command, { ...drawOptions, durationScale: 0 });
  };
  const params: UseReplayParams = {
    whiteboardRef, cancelRef, speedRef: ref(1000), isPausedRef: ref(false), replayAudioRef: ref(null),
    replayDrawClockRef: ref(null), replayAudioPreloadRef: ref(new Map()), storedTurnsRef: ref(turns),
    activeVerifiedDiagramRef, fbdPhaseStartedRef, replayGenerationRef, replayCueRef: ref(null),
    // Only the voice-provider boundary is fake. Starting and settling speech
    // are separate signals, preserving playReplayCue's real Promise ordering.
    ttsClientRef: ref({ unlockAudio() {}, setMuted() {}, setPlaybackRate() {},
      async speakSegment(text: string, speakOptions?: { onStart?: () => void }) {
        speakOptions?.onStart?.();
        if (options.holdFinalSpeech && text === "The final row.") {
          speechReached = true;
          await speech.promise;
        }
      },
    } as unknown as NonNullable<UseReplayParams["ttsClientRef"]["current"]>),
    notesEpochsRef: layout.notesEpochsRef, narrationSinceEpochRef: layout.narrationSinceEpochRef, liveQuestionRef,
    phaseRef: ref("idle"), isReplaying: false, isPaused: false, isDownloading: false, replayProgressMs: 0,
    boards: [], sessionId: "replay-playback-fidelity", setPhase() {}, setCurrentSegmentText() {}, setNarrationText() {},
    setIsPaused() {}, setIsReplaying() {}, setReplayProgressMs() {}, setReplayTotalMs() {}, setSettings() {}, setIsDownloading() {},
    cancellableDelay: async () => {}, raceWithCancel: async <T>(promise: Promise<T>) => promise,
    executeCommandWithCancel: execute, executeCommand: execute, resetBoardLayout,
    setActiveVerifiedDiagram(diagram) { if (observe) events.push({ kind: "sync", label: diagram?.name ?? "none" }); },
    finishLectureUi() {}, pauseTurn() {}, resumeTurn() {},
  };
  const replay = hook(path.join(hooksDir, "useReplay.ts")).useReplay(params) as {
    playReplayFrom: (startMs: number) => Promise<void>;
    renderBoardAtTime: (timeMs: number, cues: ReturnType<typeof buildReplayTimeline>["cues"], generation: number) => Promise<void>;
  };
  return {
    board, events, params, replay, speech, draw, cancelRef, replayGenerationRef,
    reached: () => ({ speech: speechReached, draw: drawReached }),
    async oracle(commands: DrawCommand[]) {
      observe = false;
      await nativeClear();
      resetBoardLayout(false, false);
      for (const command of commands) await execute(command, { trustedDiagramGeometry: true, applyLayout: false });
      const expected = ink(board);
      await nativeClear();
      resetBoardLayout(false, false);
      observe = true;
      return expected;
    },
    async play(mode: "forward" | "seek", timeMs = Number.MAX_SAFE_INTEGER) {
      observe = true;
      if (mode === "forward") await replay.playReplayFrom(0);
      else {
        replayGenerationRef.current++;
        await replay.renderBoardAtTime(timeMs, buildReplayTimeline(turns).cues, replayGenerationRef.current);
      }
    },
    close() { speech.release(); draw.release(); clearInterval(pump); unmountTestWhiteboard(board); },
  };
}

async function completed(mode: "forward" | "seek") {
  const f = await fixture();
  const h = harness([f.turn]);
  try {
    const expected = await h.oracle(f.commands);
    await h.play(mode);
    assert.deepEqual(ink(h.board), expected, `${mode}: actual Replay consumer leaves every compiled figure mark and captured row`);
    const commands = h.events.filter((event) => event.kind === "command").map((event) => event.label);
    for (const id of f.withheld) assert.equal(commands.filter((label) => label === id).length, 1, `${mode}: ${id} appears exactly once`);
    assert(commands.indexOf(f.withheld[0]!) > commands.indexOf("horizontal page"), `${mode}: final marks follow the last narrated row`);
  } finally { h.close(); }
}

async function independentPages(mode: "forward" | "seek") {
  const first = await fixture();
  const last = await fixture(true);
  const h = harness([first.turn, last.turn]);
  try {
    const firstExpected = await h.oracle(first.commands);
    const lastExpected = await h.oracle(last.commands);
    assert.notDeepEqual(firstExpected, lastExpected, "page fixtures have distinguishable ink");
    await h.play(mode);
    const clears = h.events.filter((event) => event.kind === "clear");
    assert.equal(clears.length, 2, `${mode}: clear once at start and once before the independent page`);
    assert.deepEqual(clears[1]!.ink, firstExpected, `${mode}: old page completes before it is cleared`);
    assert.deepEqual(ink(h.board), lastExpected, `${mode}: final page excludes every old figure and work row`);
    const crossing = h.events.findIndex((event) => event === clears[1]);
    assert.equal(h.events[crossing + 1]?.kind, "reset", `${mode}: clear settles before layout reset`);
    assert.equal(h.events[crossing + 2]?.kind, "sync", `${mode}: page is reset before committing its new diagram`);
  } finally { h.close(); }
}

async function incomplete(mode: "forward" | "seek", status: "stopped" | "live") {
  const f = await fixture(false, status);
  const h = harness([f.turn]);
  try {
    const expected = await h.oracle(f.commands);
    await h.play(mode);
    assert.notDeepEqual(ink(h.board), expected, `${mode}/${status}: unfinished lesson keeps its partial reveal`);
    assert(h.events.every((event) => event.kind !== "command" || !f.withheld.includes(event.label)), `${mode}/${status}: no final marks invented`);
    assert(h.events.some((event) => event.label === "horizontal page"), `${mode}/${status}: recorded work still replays`);
  } finally { h.close(); }
}

async function continuation(mode: "forward" | "seek", kind: "doubt" | "resume", openingStatus: "complete" | "stopped", compatible = true) {
  const opening = await fixture(false, openingStatus);
  const row = work("continued page", 160);
  const saved = await canonicalizeTurnSceneMetadata({
    question: kind === "doubt" ? "Explain this row again." : opening.turn.question,
    sceneDocument: null, visualStatus: "text_only", sceneArtifacts: boardContinuationArtifacts(compatible ? opening.turn.question : "Another lesson"),
    segments: [{ orderIndex: 0, narration: "Continue on this page.", spokenText: "Continue on this page.", command: serializeSegmentCommands([row]) }],
  });
  assert(saved.ok, saved.ok ? "" : saved.error);
  const turn: StoredTurn = {
    ...opening.turn, ...saved.value, id: "continuation", orderIndex: 1, kind, status: "complete",
    segments: saved.value.segments.map((segment) => ({
      ...segment, id: "continued", audioUrl: null, durationMs: 1, timings: null,
      command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), {
        trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command),
      }),
    })),
  };
  const h = harness([opening.turn, JSON.parse(JSON.stringify(turn))]);
  try {
    const completes = openingStatus === "complete" || (kind === "resume" && compatible);
    const expected = await h.oracle([...opening.commands, row]);
    await h.play(mode);
    assert.equal(h.events.filter((event) => event.kind === "clear").length, 1, `${mode}/${kind}: same-page continuation must preserve the board`);
    assert.equal(h.events.filter((event) => event.kind === "sync").length, 1, `${mode}/${kind}: continuation keeps its original verified diagram`);
    assert(h.events.some((event) => event.label === "horizontal page") && h.events.some((event) => event.label === "continued page"), `${mode}/${kind}: both work rows stay on the page`);
    if (completes) assert.deepEqual(ink(h.board), expected, `${mode}/${kind}: completed page has the full original figure`);
    else {
      assert.notDeepEqual(ink(h.board), expected, `${mode}/${kind}: no unearned completion`);
      assert(h.events.every((event) => event.kind !== "command" || !opening.withheld.includes(event.label)), `${mode}/${kind}: withheld figure stays withheld`);
    }
  } finally { h.close(); }
}

async function finalBarriers(first: "speech" | "ink") {
  const f = await fixture();
  const h = harness([f.turn], { holdFinalSpeech: true, holdFinalInk: true });
  let job: Promise<void> | undefined;
  try {
    const expected = await h.oracle(f.commands);
    let settled = false;
    job = h.play("forward").then(() => { settled = true; });
    for (let attempt = 0; attempt < 100 && !(h.reached().speech && h.reached().draw); attempt++) await flush();
    assert.deepEqual(h.reached(), { speech: true, draw: true }, "last cue reaches both real async boundaries");
    assert(!settled && h.events.every((event) => !f.withheld.includes(event.label)), "completion waits for both last-cue speech and ink");
    if (first === "speech") h.speech.release();
    else h.draw.release();
    await flush();
    assert(!settled && h.events.every((event) => !f.withheld.includes(event.label)), `${first} finishing cannot complete the other queue still in flight`);
    h.speech.release();
    h.draw.release();
    await job;
    assert.deepEqual(ink(h.board), expected, "final completion follows both settled queues");
  } finally { h.speech.release(); h.draw.release(); await job; h.close(); }
}

async function cancellation(mode: "forward" | "seek", cause: "cancel" | "generation") {
  const f = await fixture();
  const h: ReturnType<typeof harness> = harness([f.turn], { onCommand(command) {
    if (command.type !== "WRITE") return;
    if (cause === "cancel") h.cancelRef.current = true;
    else h.replayGenerationRef.current++;
  } });
  try {
    await h.play(mode);
    assert(h.events.every((event) => event.kind !== "command" || !f.withheld.includes(event.label)), `${mode}/${cause}: no late final ink after ownership changes`);
  } finally { h.close(); }
}

async function boundaryRace(mode: "forward" | "seek") {
  const first = await fixture();
  const last = await fixture(true);
  const held = barrier();
  let started = false;
  const h = harness([first.turn, last.turn], { async onClear(index) {
    if (index !== 2) return;
    started = true;
    await held.promise;
  } });
  let job: Promise<void> | undefined;
  try {
    job = h.play(mode);
    for (let attempt = 0; attempt < 100 && !started; attempt++) await flush();
    assert(started, `${mode}: second page reaches async clear`);
    assert.equal(h.events.filter((event) => event.kind === "sync").length, 1, `${mode}: new diagram must await page clear`);
    assert(!h.events.some((event) => event.label === "vertical page"), `${mode}: new-page work cannot race its clear`);
    h.replayGenerationRef.current++;
    held.release();
    await job;
    assert.equal(h.events.filter((event) => event.kind === "sync").length, 1, `${mode}: cancelled clear cannot commit the new diagram`);
    assert.equal(h.events.filter((event) => event.kind === "reset").length, 1, `${mode}: cancelled clear cannot reset a successor's layout`);
    assert.equal(ink(h.board).length, 0, `${mode}: old playback adds no late marks after clear`);
  } finally { held.release(); await job; h.close(); }
}

async function partialSeek(resume: boolean) {
  const f = await fixture();
  // findCueAtTime leaves a 1ms guard before a lecture's end. Use a real clip
  // scale here so the midpoint remains inside the last cue after clamping.
  f.turn.segments.at(-1)!.durationMs = 1000;
  const h = harness([f.turn]);
  try {
    const expected = await h.oracle(f.commands);
    const lastCue = buildReplayTimeline([f.turn]).cues.at(-1)!;
    const midway = lastCue.startMs + lastCue.durationMs / 2;
    if (resume) {
      await h.replay.playReplayFrom(midway);
      assert.deepEqual(ink(h.board), expected, "mid-cue replay lands the complete final figure after the remaining voice and ink");
      assert.equal(h.events.filter((event) => event.label === "horizontal page").length, 1, "mid-cue catch-up does not redraw its already completed row");
    } else {
      await h.play("seek", midway);
      assert.notDeepEqual(ink(h.board), expected, "partial seek cannot finish a complete turn whose last cue has not ended");
      assert(h.events.every((event) => !f.withheld.includes(event.label)), "partial seek withholds final figure marks until turn end");
    }
  } finally { h.close(); }
}

async function main() {
  // Case selection keeps mutation controls small and independently runnable.
  const selected = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
  let passed = 0;
  const run = async (name: string, test: () => Promise<void>) => {
    if (selected && selected !== name) return;
    await test(); passed++;
    console.log(`replay playback board fidelity: ${name} ok`);
  };
  for (const mode of ["forward", "seek"] as const) {
    await run(`${mode}-complete`, () => completed(mode));
    await run(`${mode}-pages`, () => independentPages(mode));
    for (const status of ["stopped", "live"] as const) await run(`${mode}-${status}`, () => incomplete(mode, status));
    await run(`${mode}-doubt-complete`, () => continuation(mode, "doubt", "complete"));
    await run(`${mode}-doubt-stopped`, () => continuation(mode, "doubt", "stopped"));
    await run(`${mode}-resume`, () => continuation(mode, "resume", "stopped"));
    await run(`${mode}-wrong-resume`, () => continuation(mode, "resume", "stopped", false));
    for (const cause of ["cancel", "generation"] as const) await run(`${mode}-${cause}`, () => cancellation(mode, cause));
    await run(`${mode}-clear-race`, () => boundaryRace(mode));
  }
  for (const first of ["speech", "ink"] as const) await run(`final-barriers-${first}`, () => finalBarriers(first));
  await run("seek-partial", () => partialSeek(false));
  await run("seek-tail-playback", () => partialSeek(true));
  assert(passed > 0, `unknown case: ${selected}`);
  console.log(`verify-replay-playback-board-fidelity: ${passed} groups passed`);
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
