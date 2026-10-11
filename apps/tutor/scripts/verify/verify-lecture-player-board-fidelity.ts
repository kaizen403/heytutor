/**
 * Drive the finished-lecture hook, including its seek catch-up and frame loop,
 * against actual Konva ink. Only React reconciliation and the media/browser
 * boundaries are deterministic; scene validation, layout, drawing, completion
 * and page ownership are production code.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { getSegmentCommands, serializeSegmentCommands, verifiedDiagramCommandToDrawCommand } from "@heytutor/drawing";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import type { LecturePlayerApi, UseLecturePlayerParams } from "../../features/tutor-session/hooks/useLecturePlayer";
// Load the optional code-panel renderer before installing the media-only DOM.
import "../../lib/code-render/renderCodeToCanvas";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const hooksDir = path.join(appRoot, "features/tutor-session/hooks");
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const ref = <T>(current: T) => ({ current });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
type Cleanup = () => void;
interface Slot { value?: unknown; deps?: readonly unknown[]; cleanup?: Cleanup }

/** State, stable refs, dependency effects, subscriptions and unmount cleanup. */
class HookMount {
  slots: Slot[] = [];
  cursor = 0;
  dirty = true;
  pendingEffects: Array<() => void> = [];
  react = {
    useRef: <T,>(value: T) => this.memo(() => ref(value), []),
    useMemo: <T,>(make: () => T, deps: readonly unknown[]) => this.memo(make, deps),
    useCallback: <T,>(value: T, deps: readonly unknown[]) => this.memo(() => value, deps),
    useState: <T,>(initial: T | (() => T)) => {
      const slot = this.nextSlot();
      if (!("value" in slot)) slot.value = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slot.value as T, (next: T | ((old: T) => T)) => {
        const value = typeof next === "function" ? (next as (old: T) => T)(slot.value as T) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; this.dirty = true; }
      }] as const;
    },
    useEffect: (effect: () => unknown, deps?: readonly unknown[]) => this.effect(effect, deps),
    useLayoutEffect: (effect: () => unknown, deps?: readonly unknown[]) => this.effect(effect, deps),
    useSyncExternalStore: (subscribe: (listener: () => void) => Cleanup, snapshot: () => unknown) => {
      this.effect(() => subscribe(() => { this.dirty = true; }), [subscribe]);
      return snapshot();
    },
  };
  private nextSlot(): Slot {
    const index = this.cursor++;
    return this.slots[index] ?? (this.slots[index] = {});
  }
  private changed(slot: Slot, deps?: readonly unknown[]) {
    return !deps || !slot.deps || deps.length !== slot.deps.length || deps.some((value, index) => !Object.is(value, slot.deps![index]));
  }
  private memo<T>(make: () => T, deps: readonly unknown[]): T {
    const slot = this.nextSlot();
    if (this.changed(slot, deps)) { slot.value = make(); slot.deps = deps; }
    return slot.value as T;
  }
  private effect(effect: () => unknown, deps?: readonly unknown[]) {
    const slot = this.nextSlot();
    if (!this.changed(slot, deps)) return;
    slot.deps = deps;
    this.pendingEffects.push(() => {
      slot.cleanup?.();
      const cleanup = effect();
      slot.cleanup = typeof cleanup === "function" ? cleanup as Cleanup : undefined;
    });
  }
  render<T>(make: () => T): T {
    this.cursor = 0;
    this.dirty = false;
    const value = make();
    for (const effect of this.pendingEffects.splice(0)) effect();
    return value;
  }
  unmount() { for (const slot of this.slots) slot.cleanup?.(); }
}

class RecordedAudio extends EventTarget {
  static instances: RecordedAudio[] = [];
  currentTime = 0;
  duration = 1;
  playbackRate = 1;
  paused = true;
  ended = false;
  seeking = false;
  preload = "";
  preservesPitch = true;
  muted = false;
  src = "";
  constructor() { super(); RecordedAudio.instances.push(this); }
  play() { this.paused = false; this.ended = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  load() {}
  removeAttribute() { this.src = ""; }
  advance(ms: number) {
    if (this.paused) return;
    this.currentTime = Math.min(this.currentTime + ms * this.playbackRate / 1000, this.duration);
    if (this.currentTime >= this.duration) {
      this.ended = true;
      this.paused = true;
      this.dispatchEvent(new Event("ended"));
    }
  }
}

const frames = new Map<number, FrameRequestCallback>();
const idle = new Map<number, () => void>();
let nextHandle = 1;
let wallMs = 0;
const fakeWindow = Object.assign(new EventTarget(), {
  devicePixelRatio: 1,
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame(callback: FrameRequestCallback) { const id = nextHandle++; frames.set(id, callback); return id; },
  cancelAnimationFrame(id: number) { frames.delete(id); },
  requestIdleCallback(callback: () => void) { const id = nextHandle++; idle.set(id, callback); return id; },
  cancelIdleCallback(id: number) { idle.delete(id); },
});
const fakeDocument = Object.assign(new EventTarget(), { hidden: false, activeElement: null, querySelector: () => null });
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();
function installGlobals() {
  for (const [key, value] of Object.entries({
    window: fakeWindow, document: fakeDocument, Audio: RecordedAudio,
    performance: { now: () => wallMs },
    // Preserve the hook's macrotask boundary without retaining Node ports.
    MessageChannel: class {
      port1 = { onmessage: null as (() => void) | null };
      port2 = { postMessage: () => setImmediate(() => this.port1.onmessage?.()) };
    },
  })) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
}
function restoreGlobals() {
  for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HookModule = Record<string, any>;
function hookLoader(mount: HookMount) {
  const cache = new Map<string, HookModule>();
  function load(file: string): HookModule {
    if (cache.has(file)) return cache.get(file)!;
    const source = file === path.join(hooksDir, "useLecturePlayer.ts") ? process.env.LECTURE_PLAYER_FIDELITY_SOURCE ?? file : file;
    const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const mod = { exports: {} as HookModule };
    cache.set(file, mod.exports);
    new Function("require", "module", "exports", compiled)((specifier: string) => {
      if (specifier === "react") return mount.react;
      if (specifier === "@/lib/replay/lecturePlayerAudio") return {
        lecturePlayerTrackKey: () => "local-fixture", getLecturePlayerTrack: async (_key: string, make: () => Promise<unknown>) => make(),
        buildLecturePlayerTrack: async () => ({ url: "blob:local-fixture" }),
      };
      if (specifier.startsWith("@/")) return requireApp(path.join(appRoot, specifier.slice(2)));
      if (specifier.startsWith(".")) {
        const target = path.resolve(path.dirname(file), specifier);
        return target.startsWith(hooksDir + path.sep) ? load(target + ".ts") : requireApp(target);
      }
      return requireApp(specifier);
    }, mod, mod.exports);
    return mod.exports;
  }
  return load;
}

function ink(board: WhiteboardHandle): string[] {
  return board.getDrawLayer()!.getChildren().map((node) => {
    const object = node.toObject();
    const attrs = Object.fromEntries(Object.entries(object.attrs)
      .filter(([key, value]) => !key.startsWith("ht") && key !== "id" && !(key === "dash" && Array.isArray(value) && value.length === 0))
      .sort(([a], [b]) => a.localeCompare(b)));
    return JSON.stringify({ className: object.className, attrs });
  }).sort();
}

async function fixture(vertical: boolean): Promise<StoredTurn> {
  const question = vertical ? "A rod has length L. Show the vertical span." : "A segment has length L. Show the horizontal span.";
  const ids = ["a", "b", "edge", "length"];
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-grounded measured span" },
    source: { question, nonMetric: true, representationTier: "qualitative_verified" }, quantities: [],
    entities: [
      { id: "a", kind: "point", role: "span start" }, { id: "b", kind: "point", role: "span end" },
      { id: "edge", kind: "segment", role: "measured edge" }, { id: "length", kind: "dimension", role: "distance", label: "L" },
    ],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: vertical ? { x: 0, y: 4 } : { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_edge", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["edge"] },
      { id: "make_length", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["length"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Here is the segment." }], teachingTimeline: [],
  };
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene);
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  assert(presentation.diagram.deferredAnnotations?.some((entry) => entry.commands.some((command) => command.type === "LABEL")),
    "fixture withholds an unspoken verified measurement label");
  const saved = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: document, visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready", turnPlan: {
      schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
    } },
    segments: [...presentation.introSegments, { narration: "The segment is shown.", command: null }].map((segment, orderIndex) => ({
      orderIndex, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: segment.verifiedDiagramIntro === true }),
    })),
  });
  assert(saved.ok, saved.ok ? "" : saved.error);
  return JSON.parse(JSON.stringify({
    ...saved.value, id: vertical ? "vertical-page" : "horizontal-page", orderIndex: vertical ? 1 : 0,
    status: "complete", kind: "lesson", question, rawResponse: "", speedMultiplier: 1, traceId: null,
    segments: saved.value.segments.map((segment) => ({ ...segment, id: `s${segment.orderIndex}`, audioUrl: "local-fixture.mp3", durationMs: 100, timings: null })),
  })) as StoredTurn;
}

/** Oracle draws the compiler's full command set, independently of replay scheduling. */
async function compiledInk(turn: StoredTurn): Promise<string[]> {
  const document = turn.sceneDocument as SceneDocument;
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene);
  const diagram = buildVerifiedDiagramPresentation(document, compiled.renderScene).diagram;
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const mount = new HookMount();
  const load = hookLoader(mount);
  const whiteboardRef = ref(board), cancelRef = ref(false), fbdPhaseStartedRef = ref(true);
  const layout = load(path.join(hooksDir, "useBoardLayout.ts")).useBoardLayout({ whiteboardRef, cancelRef, fbdPhaseStartedRef, liveQuestionRef: ref(turn.question), viewportMode: "fixed" });
  const executor = load(path.join(hooksDir, "useCommandExecution.ts")).useCommandExecution({
    whiteboardRef, cancelRef, speedRef: ref(1), boardLayoutRef: layout.boardLayoutRef,
    forceSequentialWorkLayoutRef: layout.forceSequentialWorkLayoutRef, fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef,
    activeVerifiedDiagramRef: ref(diagram), turnTelemetryRef: ref(null), notesEpochsRef: layout.notesEpochsRef,
    narrationSinceEpochRef: layout.narrationSinceEpochRef, cancellableDelay: async () => {},
    forgetErasedTextRects: layout.forgetErasedTextRects, resetBoardLayout: layout.resetBoardLayout, resolveTextPlacement: layout.resolveTextPlacement,
    raceWithCancel: async <T,>(promise: Promise<T>) => promise, inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1), nowMs: clock.now,
  });
  try {
    for (const command of diagram.commands) {
      let done = false;
      const drawing = executor.executeCommand(verifiedDiagramCommandToDrawCommand(command), { durationScale: 0, trustedDiagramGeometry: true, applyLayout: false }) as Promise<void>;
      void drawing.finally(() => { done = true; });
      for (let step = 0; !done && step < 100; step++) { clock.advance(1000); clock.pump(); await flush(); }
      assert(done, "compiler oracle finishes its ink");
      await drawing;
    }
    return ink(board);
  } finally { unmountTestWhiteboard(board); }
}

function player(turns: StoredTurn[], available = true) {
  const board = mountTestWhiteboard();
  const mount = new HookMount();
  const useLecturePlayer = hookLoader(mount)(path.join(hooksDir, "useLecturePlayer.ts")).useLecturePlayer as (params: UseLecturePlayerParams) => LecturePlayerApi;
  const params: UseLecturePlayerParams = { sessionId: "local-board", storedTurnsRef: ref(turns), storedTurnsCount: turns.length, available, rate: 1, onRateChange() {}, enableKeyboard: false };
  let api = mount.render(() => useLecturePlayer(params));
  api.playerBoardRef.current = board;
  const audio = RecordedAudio.instances.at(-1)!;
  audio.duration = api.store.getSnapshot().durationMs / 1000;
  const render = () => { if (mount.dirty) api = mount.render(() => useLecturePlayer(params)); };
  const step = async (advanceAudio = false) => {
    render();
    for (const [id, callback] of [...idle]) { idle.delete(id); callback(); }
    wallMs += 50;
    if (advanceAudio) audio.advance(50);
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(wallMs);
    await flush();
    render();
  };
  const until = async (condition: () => boolean, reason: string, advanceAudio = false) => {
    for (let count = 0; count < 2500; count++) { await step(advanceAudio); if (condition()) return; }
    assert.fail(`${reason}; status=${api.store.getSnapshot().status}; nodes=${ink(board).length}`);
  };
  return {
    board, params, get api() { return api; }, audio, step, until,
    async ready() { await until(() => api.store.getSnapshot().status === (available ? "ready" : "unavailable"), "player loads local recorded track"); },
    async seek(ms: number) { api.controls.seek(ms); await until(() => !["loading", "seeking"].includes(api.store.getSnapshot().status), "seek completes"); },
    destroy() { api.close(); mount.unmount(); unmountTestWhiteboard(board); frames.clear(); idle.clear(); },
  };
}

async function verifyLecturePlayerBoardFidelity() {
  installGlobals();
  try {
    const horizontal = await fixture(false), vertical = await fixture(true);
    const horizontalInk = await compiledInk(horizontal), verticalInk = await compiledInk(vertical);
    assert.notDeepEqual(horizontalInk, verticalInk, "independent-page fixtures have distinct compiled geometry");

    // The target cue is narration-only: all intro cues are catch-up, so this
    // catches loss of the completion call in the seek fast path (~line 533).
    const seek = player([horizontal]);
    try {
      await seek.ready();
      await seek.seek(seek.api.store.getSnapshot().durationMs);
      assert.deepEqual(ink(seek.board), horizontalInk, "end seek has every compiled final figure mark");
      assert.equal(seek.api.store.getSnapshot().status, "ended");
      console.log("✓ finished player end seek retains all final figure marks");
    } finally { seek.destroy(); }

    // Normal play exercises onCueStart/syncTurn and drawReplayDiagramTimeline
    // (~lines 381/588), including asynchronous reset before next-page ink.
    const playback = player([horizontal, vertical]);
    let releasePageClear = () => {};
    let clearingNextPage = false;
    let clearCount = 0;
    const nextPageBarrier = new Promise<void>((resolve) => { releasePageClear = resolve; });
    const nativeClear = playback.board.clearBoard.bind(playback.board);
    playback.board.clearBoard = async (...args) => {
      if (++clearCount === 2) { clearingNextPage = true; await nextPageBarrier; }
      return nativeClear(...args);
    };
    try {
      await playback.ready();
      assert(playback.api.playFromStart());
      await playback.until(() => clearingNextPage, "independent-page reset reaches held clear", true);
      assert.deepEqual(ink(playback.board), horizontalInk, "opening page finishes before reset begins");
      for (let index = 0; index < 20; index++) await playback.step(true);
      assert.deepEqual(ink(playback.board), horizontalInk, "next-page ink waits for async clear to finish");
      releasePageClear();
      await playback.until(() => playback.api.store.getSnapshot().status === "ended" && JSON.stringify(ink(playback.board)) === JSON.stringify(verticalInk), "playback final independent page equals compiled board", true);
      assert.deepEqual(ink(playback.board), verticalInk, "independent question removes prior-page geometry");
      const secondChapter = playback.api.store.getSnapshot().chapters[1]!;
      await playback.seek(secondChapter.startMs);
      assert(ink(playback.board).length < verticalInk.length, "chapter start does not borrow its final labels from the future");
      playback.api.controls.pause();
      await playback.seek(playback.api.store.getSnapshot().durationMs);
      assert.deepEqual(ink(playback.board), verticalInk, "chapter seek still reaches the same complete board");
      playback.api.controls.play();
      await playback.until(() => playback.api.store.getSnapshot().status === "playing", "restart from ended begins playback");
      assert.notDeepEqual(ink(playback.board), verticalInk, "restart clears finished page before replay ink");
      console.log("✓ play, chapter seek, end seek and restart reset independent pages");
    } finally { releasePageClear(); playback.destroy(); }

    const doubt: StoredTurn = { ...horizontal, id: "continued-doubt", orderIndex: 1, kind: "doubt", question: "Why?", sceneDocument: null, visualStatus: "text_only",
      sceneArtifacts: boardContinuationArtifacts(horizontal.question), segments: [{ ...horizontal.segments.at(-1)!, id: "doubt-speech", narration: "The same page explains it.", command: null }] };
    const continued = player([horizontal, doubt]);
    try {
      await continued.ready();
      continued.api.playFromStart();
      await continued.until(() => continued.api.store.getSnapshot().status === "ended" && JSON.stringify(ink(continued.board)) === JSON.stringify(horizontalInk), "doubt preserves finished figure on opening page", true);
      await continued.seek(continued.api.store.getSnapshot().durationMs);
      assert.deepEqual(ink(continued.board), horizontalInk, "continued page retains all opening-page marks after seek");
      console.log("✓ continued-page playback and end seek preserve the original figure");
    } finally { continued.destroy(); }

    const stopped = player([{ ...horizontal, status: "stopped" }]);
    try {
      await stopped.ready();
      await stopped.seek(stopped.api.store.getSnapshot().durationMs);
      assert(ink(stopped.board).length > 0 && ink(stopped.board).length < horizontalInk.length, "stopped lesson has saved intro ink but cannot acquire unspoken completion marks");
      console.log("✓ stopped lesson does not invent final figure marks");
    } finally { stopped.destroy(); }

    const invalid = player([{ ...horizontal, sceneDocument: { schemaVersion: "invalid" }, visualStatus: "retry_required" }]);
    try {
      await invalid.ready();
      await invalid.seek(invalid.api.store.getSnapshot().durationMs);
      assert.equal(ink(invalid.board).length, 0, "invalid scene cannot render saved trusted figure or its final marks");
      console.log("✓ invalid persisted scene cannot bypass figure authority");
    } finally { invalid.destroy(); }

    const unavailable = player([horizontal], false);
    try {
      await unavailable.ready();
      assert.equal(unavailable.api.playFromStart(), false, "live/unavailable board refuses finished-player takeover");
      unavailable.api.controls.seek(100);
      await unavailable.step();
      assert.equal(ink(unavailable.board).length, 0);
      assert.equal(unavailable.api.store.getSnapshot().active, false);
      console.log("✓ unavailable/live board refuses playback and seek");
    } finally { unavailable.destroy(); }

    const cancelled = player([horizontal]);
    try {
      await cancelled.ready();
      cancelled.api.controls.seek(cancelled.api.store.getSnapshot().durationMs);
      cancelled.api.close();
      const afterClose = ink(cancelled.board);
      for (let index = 0; index < 20; index++) await cancelled.step(true);
      assert.deepEqual(ink(cancelled.board), afterClose, "late seek cannot complete figure after close takes ownership");
      assert.equal(cancelled.api.store.getSnapshot().active, false);
      console.log("✓ close cancels late seek and final diagram completion");
    } finally { cancelled.destroy(); }
    console.log("lecture player board fidelity: 7 consumer groups passed");
  } finally { restoreGlobals(); }
}

void verifyLecturePlayerBoardFidelity().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
