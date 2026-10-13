/** Saved page discovery uses the actual timeline and rendered player consumer. */
import assert from "node:assert/strict";
import { buildLecturePlayerTimeline } from "../../lib/replay/lecturePlayer";
import type { DrawCommand } from "@heytutor/drawing";
import Konva from "konva";
import { captureCommandInk, textToStrokePaths, textToStrokePathsSync, getSegmentCommands, isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
const turn: StoredTurn = {
  id: "pages",
  orderIndex: 0,
  kind: "lesson",
  status: "complete",
  persistedStatus: "complete",
  question: "A recorded lesson",
  rawResponse: "",
  speedMultiplier: 1,
  traceId: null,
  sceneDocument: null,
  sceneEngineVersion: null,
  validationReport: null,
  visualStatus: "text_only",
  sceneArtifacts: null,
  segments: (
    [
      { type: "WRITE", params: [90, 64, 46], text: "Given" },
      { type: "WRITE", params: [90, 130, 32], text: "Work" },
      { type: "WRITE", params: [90, 526, 32], text: "Answer = 8" },
      { type: "EMPHASIZE", params: [], text: "last" },
    ] satisfies Array<Pick<DrawCommand, "type" | "params" | "text">>
  ).map((command, orderIndex) => ({
    id: `s${orderIndex}`,
    orderIndex,
    narration: "Recorded words",
    spokenText: "Recorded words",
    durationMs: 1000,
    audioUrl: "/stored/audio",
    timings: null,
    command:
      orderIndex === 3
        ? {
            commands: [
              { ...command, charPosition: 0, narrationBefore: "" },
              {
                type: "WRITE",
                params: [90, 142, 32],
                text: "Check = 8",
                charPosition: 0,
                narrationBefore: "",
              },
            ],
          }
        : { ...command, charPosition: 0, narrationBefore: "" },
  })),
};
const timeline = buildLecturePlayerTimeline([turn]);
const pages = (
  timeline as unknown as {
    workPages?: Array<{
      index: number;
      endCueIndex: number;
      endCommandCount: number;
      endMs: number;
    }>;
  }
).workPages;
assert.ok(
  pages && pages.length === 2,
  "actual saved timeline must expose both recorded work pages at lesson end",
);
assert.equal(
  pages[0]!.endCueIndex,
  3,
  "answer-page end includes its recorded emphasis before the later work erase",
);
assert.equal(pages[0]!.endCommandCount, 1);
assert.equal(pages[1]!.endCueIndex, 3);
console.log(
  "PASS recorded answer and final check pages are discoverable without invented ink",
);

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import * as React from "react";
import {
  mountTestWhiteboard,
  unmountTestWhiteboard,
} from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import type { LecturePlayerApi } from "../../features/tutor-session/hooks/useLecturePlayer";
import type { LecturePlayerBarProps } from "../../features/tutor-session/components/LecturePlayerBar";
const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
function recordedWriter() {
  const source = process.env.WORK_PAGE_WRITER_SOURCE;
  if (!source) return textToStrokePaths;
  const file = path.resolve(app, "../../packages/drawing/src/handwriting/handwriting.ts");
  const code = ts.transpileModule(readFileSync(source, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const mod = { exports: {} as { textToStrokePaths?: typeof textToStrokePaths } };
  new Function("require", "module", "exports", code)(createRequire(file), mod, mod.exports);
  assert.ok(mod.exports.textToStrokePaths);
  return mod.exports.textToStrokePaths;
}

const executedCommands: DrawCommand[] = [];
type Slot = {
  value?: unknown;
  deps?: readonly unknown[];
  cleanup?: () => void;
};
class Mount {
  slots: Slot[] = [];
  cursor = 0;
  pending: Array<() => void> = [];
  slot() {
    return this.slots[this.cursor] ?? (this.slots[this.cursor] = {});
  }
  react = {
    ...React,
    useRef: <T>(v: T) => {
      const s = this.slot();
      this.cursor++;
      if (!("value" in s)) s.value = { current: v };
      return s.value as { current: T };
    },
    useState: <T>(v: T | (() => T)) => {
      const s = this.slot();
      this.cursor++;
      if (!("value" in s))
        s.value = typeof v === "function" ? (v as () => T)() : v;
      return [
        s.value as T,
        (next: T | ((old: T) => T)) => {
          s.value =
            typeof next === "function"
              ? (next as (old: T) => T)(s.value as T)
              : next;
        },
      ] as const;
    },
    useMemo: <T>(fn: () => T, deps: readonly unknown[]) => {
      const s = this.slot();
      this.cursor++;
      if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
        s.deps = deps;
        s.value = fn();
      }
      return s.value as T;
    },
    useCallback: <T>(fn: T, deps: readonly unknown[]) =>
      this.react.useMemo(() => fn, deps),
    useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => {
      const s = this.slot();
      this.cursor++;
      if (!s.deps || !deps || deps.some((v, i) => !Object.is(v, s.deps![i]))) {
        s.deps = deps;
        this.pending.push(() => {
          s.cleanup?.();
          s.cleanup = fn() ?? undefined;
        });
      }
    },
    useLayoutEffect: (
      fn: () => void | (() => void),
      deps?: readonly unknown[],
    ) => this.react.useEffect(fn, deps),
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  };
  render<T>(fn: () => T) {
    this.cursor = 0;
    const v = fn();
    for (const e of this.pending.splice(0)) e();
    return v;
  }
  close() {
    for (const s of this.slots) s.cleanup?.();
  }
}
function load(
  file: string,
  mount: Mount,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const source = file.endsWith("useLecturePlayer.ts")
    ? (process.env.WORK_PAGE_HOOK_SOURCE ?? file)
    : file.endsWith("LecturePlayerBar.tsx")
      ? (process.env.WORK_PAGE_BAR_SOURCE ?? file)
      : file.endsWith("useCommandExecution.ts")
        ? (process.env.WORK_PAGE_EXECUTOR_SOURCE ?? file)
        : file.endsWith("useBoardLayout.ts")
          ? (process.env.WORK_PAGE_LAYOUT_SOURCE ?? file)
      : file.endsWith("lectureWorkPages.ts")
        ? (process.env.WORK_PAGE_INDEX_SOURCE ?? file)
        : file.endsWith("lecturePlayer.ts")
          ? (process.env.WORK_PAGE_TIMELINE_SOURCE ?? file)
          : file;
  const code = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", "MessageChannel", code)(
    (name: string) => {
      if (name in overrides) return overrides[name];
      if (name === "react") return mount.react;
      if (name === "@/lib/replay/lecturePlayer")
        return load(path.join(app, "lib/replay/lecturePlayer.ts"), mount, overrides);
      if (name.startsWith("@/"))
        return requireApp(path.join(app, name.slice(2)));
      if (name.startsWith(".")) {
        const p = path.resolve(path.dirname(file), name);
        return p.startsWith(path.join(app, "features/tutor-session/hooks")) || p.endsWith("lectureWorkPages")
          ? load(`${p}.ts`, mount, overrides)
          : requireApp(p);
      }
      return requireApp(name);
    },
    mod,
    mod.exports,
    class {
      port1 = { onmessage: null as null | (() => void) };
      port2 = {
        postMessage: () => setImmediate(() => this.port1.onmessage?.()),
      };
    },
  );
  if (file.endsWith("useCommandExecution.ts")) {
    const actual = mod.exports.useCommandExecution as (params: unknown) => {
      executeCommand: (command: DrawCommand, ...options: unknown[]) => Promise<void>;
    };
    mod.exports.useCommandExecution = (params: unknown) => {
      const value = actual(params);
      return { ...value, executeCommand: (command: DrawCommand, ...options: unknown[]) => {
        executedCommands.push(structuredClone(command));
        return value.executeCommand(command, ...options);
      } };
    };
  }
  return mod.exports;
}
class AudioBoundary extends EventTarget {
  static all: AudioBoundary[] = [];
  currentTime = 0;
  duration = 20;
  paused = true;
  ended = false;
  seeking = false;
  playbackRate = 1;
  muted = false;
  src = "";
  preload = "";
  preservesPitch = true;
  playCalls = 0;
  constructor() {
    super();
    AudioBoundary.all.push(this);
  }
  load() {}
  removeAttribute() {
    this.src = "";
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  play() {
    this.playCalls++;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }
}
const capturedLongRow = "This captured row keeps every original word on its recorded line";
async function figureFixture(): Promise<StoredTurn> {
  const question = "Show a source-grounded segment between two endpoints.";
  const ids = ["a", "b", "edge"];
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "declared qualitative segment fixture" },
    source: { question, nonMetric: true, representationTier: "qualitative_verified" },
    quantities: [],
    entities: [{ id: "a", kind: "point", role: "start" }, { id: "b", kind: "point", role: "end" }, { id: "edge", kind: "segment", role: "segment" }],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_edge", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["edge"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Here is the segment." }], teachingTimeline: [],
  };
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene);
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  const saved = await canonicalizeTurnSceneMetadata({
    question, sceneDocument: document, visualStatus: "validated",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: "qualitative_verified", nonMetric: true, diagramResultStatus: "ready", turnPlan: {
      schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
    } },
    segments: [
      ...presentation.introSegments.map((segment) => ({ narration: segment.narration, spokenText: segment.narration, command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: segment.verifiedDiagramIntro === true }) })),
      ...turn.segments.map((segment, index) => ({ narration: segment.narration, spokenText: segment.spokenText,
        command: index === 1 ? { type: "WRITE", params: [90, 130, 32], text: capturedLongRow, charPosition: 0, narrationBefore: "" } : segment.command })),
    ].map((segment, orderIndex) => ({ ...segment, orderIndex })),
  });
  assert.ok(saved.ok, saved.ok ? "" : saved.error);
  return { ...turn, ...saved.value, id: "verified-pages", question,
    segments: saved.value.segments.map((segment) => ({ ...segment, id: `verified-${segment.orderIndex}`,
      command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) }),
      audioUrl: "/stored/audio", durationMs: 1000, timings: null })) };
}
async function main() {
  const original = new Map<string, PropertyDescriptor | undefined>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const advanceFrame = async () => {
    const pending = [...frames];
    frames.clear();
    for (const [, callback] of pending) callback(performance.now());
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  for (const [key, value] of Object.entries({
    Audio: AudioBoundary,
    window: {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      requestIdleCallback: (fn: () => void) => setTimeout(fn, 0),
      cancelIdleCallback: clearTimeout,
      requestAnimationFrame: (callback: FrameRequestCallback): number => {
        const id = ++nextFrame;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id: number) => { frames.delete(id); },
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
      documentElement: { style: {} },
    },
    requestAnimationFrame: (): number => 1,
    cancelAnimationFrame: () => {},
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  // The actual Whiteboard fallback-glyph path makes permanent text and its
  // placement observable; only the font/path lookup is inert.
  let board = mountTestWhiteboard(undefined, async (text, x, y, fontSize) =>
    Array.from(text, (char, index) => ({
      char,
      x: x + index * 16,
      y,
      width: 16,
      fontSize,
      strokes: [],
    })));
  const mount = new Mount(), sceneMount = new Mount(), eraseMount = new Mount();
  const boardRows = () => {
    const rows = new Map<number, Array<{ x: number; text: string }>>();
    for (const node of board.getDrawLayer()!.getChildren()) {
      if (node.getClassName() !== "Text") continue;
      const row = rows.get(node.y()) ?? [];
      row.push({ x: node.x(), text: String(node.getAttrs().text) });
      rows.set(node.y(), row);
    }
    return [...rows].sort(([a], [b]) => a - b).map(([y, glyphs]) => ({
      x: Math.min(...glyphs.map((glyph) => glyph.x)),
      y,
      text: glyphs.sort((a, b) => a.x - b.x).map((glyph) => glyph.text).join(""),
    }));
  };
  const extraMounts: Mount[] = [];
  const extraBoards: typeof board[] = [];
  let api: LecturePlayerApi | undefined;
  const wait = async (predicate: () => boolean) => {
    const end = Date.now() + 5000;
    while (!predicate()) {
      assert.ok(Date.now() < end, "actual player consumer settled");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  try {
    const originalCommands = JSON.stringify(turn);
    const mod = load(
      path.join(app, "features/tutor-session/hooks/useLecturePlayer.ts"),
      mount,
      {
        "./useBoardViewport": {
          useBoardViewport: () => ({
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            measured: true,
          }),
        },
        "@/lib/replay/lecturePlayerAudio": {
          lecturePlayerTrackKey: () => "synthetic-pages",
          getLecturePlayerTrack: async (_key: unknown, make: () => unknown) =>
            make(),
          buildLecturePlayerTrack: async () => ({ url: "local:recorded" }),
        },
      },
    );
    const runnerHooks = mod as unknown as {
      useLecturePlayer: typeof import("../../features/tutor-session/hooks/useLecturePlayer").useLecturePlayer;
    };
    api = mount.render(() =>
      runnerHooks.useLecturePlayer({
        sessionId: "pages",
        storedTurnsRef: { current: [turn] },
        storedTurnsCount: 1,
        available: true,
        rate: 1,
        onRateChange: () => {},
        enableKeyboard: false,
      }),
    );
    api.playerBoardRef.current = board;
    await wait(() => api!.store.getSnapshot().status === "ready");
    const barMount = new Mount();
    const bar = load(
      path.join(app, "features/tutor-session/components/LecturePlayerBar.tsx"),
      barMount,
      { "@/lib/client/useMediaQuery": { useMediaQuery: () => false } },
    ) as unknown as {
      LecturePlayerBar: (props: LecturePlayerBarProps) => React.ReactNode;
    };
    const tree = barMount.render(() =>
      bar.LecturePlayerBar({
        store: api!.store,
        controls: api!.controls,
        placement: "below",
      }),
    );
    function find(
      node: React.ReactNode,
    ): React.ReactElement<{
      "aria-label"?: string;
      onChange?: (event: { currentTarget: { value: string } }) => void;
    }> | null {
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = find(item);
          if (found) return found;
        }
        return null;
      }
      if (
        !React.isValidElement<{
          children?: React.ReactNode;
          "aria-label"?: string;
        }>(node)
      )
        return null;
      if (
        node.type === "select" &&
        node.props["aria-label"] === "Saved work page"
      )
        return node as ReturnType<typeof find>;
      return find(node.props.children);
    }
    const picker = find(tree);
    assert.ok(
      picker,
      "actual rendered bar exposes a named keyboard/touch saved-page selector",
    );
    picker.props.onChange!({ currentTarget: { value: "0" } });
    await wait(
      () =>
        api!.store.getSnapshot().status === "paused" &&
        api!.store.getSnapshot().reviewPageIndex === 0,
    );
    const first = board
      .getDrawLayer()!
      .getChildren()
      .map((node) => node.toObject());
    assert.ok(first.length > 0, "actual executor paints stored answer page");
    assert.ok(executedCommands.some(command => command.text === "Answer = 8"), "actual consumer executes the stored answer before its page erase");
    assert.ok(!executedCommands.some(command => command.text === "Check = 8"), "command-boundary inspection must not execute the later same-cue page erase");
    assert.deepEqual(boardRows(), [
      { x: 90, y: 64, text: "Given" },
      { x: 90, y: 130, text: "Work" },
      { x: 90, y: 526, text: "Answer = 8" },
    ], "actual permanent answer-page glyphs retain their recorded coordinates");
    assert.ok(board.getDrawLayer()!.getChildren().filter((node) =>
      node.getClassName() === "Text" && node.y() === 64,
    ).every((node) => node.getAttrs().fontSize === 46),
    "recorded heading glyph size is not re-fitted to the ordinary work-row role");
    assert.equal(
      AudioBoundary.all.at(-1)!.playCalls,
      0,
      "saved-page inspection must never start audio",
    );
    assert.equal(
      api.store.getSnapshot().positionMs,
      3999,
      "saved answer page stops before the later erase",
    );
    const frozen = JSON.stringify(first);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      JSON.stringify(
        board
          .getDrawLayer()!
          .getChildren()
          .map((node) => node.toObject()),
      ),
      frozen,
      "stored frame remains stationary",
    );
    picker.props.onChange!({ currentTarget: { value: "1" } });
    await wait(
      () =>
        api!.store.getSnapshot().status === "paused" &&
        api!.store.getSnapshot().reviewPageIndex === 1,
    );
    const last = JSON.stringify(
      board
        .getDrawLayer()!
        .getChildren()
        .map((node) => node.toObject()),
    );
    assert.notEqual(
      last,
      frozen,
      "later check page changes actual permanent ink",
    );
    assert.deepEqual(boardRows(), [
      { x: 90, y: 142, text: "Check = 8" },
    ], "actual second-page whole-work erase removes the earlier heading, work and answer");
    const secondPageWork = board.getDrawLayer()!.getChildren().filter((node) => node.getAttrs().htInk === "work");
    assert.equal(secondPageWork.length, "Check = 8".length, "second-page permanent work contains exactly its new glyphs, without old answer or emphasis paths");
    assert.ok(secondPageWork.every((node) => node.getClassName() === "Text"));
    assert.equal(
      JSON.stringify(turn),
      originalCommands,
      "read-only review cannot modify even in-memory saved commands",
    );
    api.controls.reviewPage?.(-1);
    assert.equal(
      api.store.getSnapshot().reviewPageIndex,
      1,
      "invalid page cannot replace current frame",
    );
    api.controls.reviewPage?.(0);
    api.controls.reviewPage?.(1);
    await wait(
      () =>
        api!.store.getSnapshot().reviewPageIndex === 1 &&
        api!.store.getSnapshot().status === "paused",
    );
    assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "Check = 8" }],
      "rapid superseded page requests leave only the latest permanent work page");
    api.controls.play();
    await wait(() => api!.store.getSnapshot().status === "playing");
    assert.equal(
      api.store.getSnapshot().reviewPageIndex,
      null,
      "Play leaves stored-page review for the ordinary timeline",
    );
    api.controls.pause();
    api.controls.seek(timeline.totalMs);
    await wait(() => api!.store.getSnapshot().status === "ended");
    assert.equal(api.store.getSnapshot().reviewPageIndex, null,
      "ordinary End leaves stored-page inspection");
    assert.deepEqual(boardRows(), [
      { x: 90, y: 64, text: "Given" },
      { x: 90, y: 130, text: "Work" },
      { x: 90, y: 196, text: "Answer = 8" },
      { x: 90, y: 262, text: "Check = 8" },
    ], "ordinary End retains its existing sequential-placement board");
    assert.ok(board.getDrawLayer()!.getChildren().filter((node) =>
      node.getClassName() === "Text" && node.y() === 64,
    ).every((node) => node.getAttrs().fontSize === 32),
    "ordinary End retains its existing work-row presentation fitting");
    api.controls.reviewPage?.(0);
    await wait(
      () =>
        api!.store.getSnapshot().reviewPageIndex === 0 &&
        api!.store.getSnapshot().status === "paused",
    );
    api.close();
    assert.equal(api.store.getSnapshot().active, false);
    assert.equal(
      api.store.getSnapshot().reviewPageIndex,
      null,
      "closing stored-page review releases the docked answer-page state",
    );
    console.log(
      "PASS actual bar → player → executor stored-page selection, complete marks, paused audio, final return and Play transition",
    );
    mount.close();
    // A headset/media-key play changes the native element directly, bypassing
    // the bar's controls. It must leave the frozen page and rebuild the normal
    // timeline at that page's boundary before voice and ink advance together.
    const mediaTurn: StoredTurn = { ...turn, id: "media-key-pages", segments: [
      ...turn.segments.slice(0, 3),
      { ...turn.segments[3]!, command: { type: "WRITE", params: [90, 142, 32], text: "Check = 8", charPosition: 0, narrationBefore: "" } },
      { ...turn.segments[3]!, id: "media-after", orderIndex: 4, durationMs: 5000, command: { type: "WRITE", params: [90, 208, 32], text: "After = 8", charPosition: 0, narrationBefore: "" } },
    ] };
    mediaTurn.segments = mediaTurn.segments.map(segment => ({ ...segment,
      command: captureCommandInk(structuredClone(segment.command as DrawCommand), board.getInkSettings()),
    }));
    const mediaOriginal = JSON.stringify(mediaTurn);
    const mediaTimeline = buildLecturePlayerTimeline([mediaTurn]);
    const mediaMount = new Mount();
    extraMounts.push(mediaMount);
    const mediaHooks = load(path.join(app, "features/tutor-session/hooks/useLecturePlayer.ts"), mediaMount, {
      "./useBoardViewport": { useBoardViewport: () => ({ scale: 1, offsetX: 0, offsetY: 0, measured: true }) },
      "@/lib/replay/lecturePlayerAudio": { lecturePlayerTrackKey: () => "media-key-pages", getLecturePlayerTrack: async (_key: unknown, make: () => unknown) => make(), buildLecturePlayerTrack: async () => ({ url: "local:media-keys" }) },
    }) as unknown as { useLecturePlayer: typeof import("../../features/tutor-session/hooks/useLecturePlayer").useLecturePlayer };
    const mediaProps = { sessionId: "media-key-pages", storedTurnsRef: { current: [mediaTurn] }, storedTurnsCount: 1, available: true, rate: 1, onRateChange: () => {}, enableKeyboard: false };
    const renderMedia = () => mediaHooks.useLecturePlayer(mediaProps);
    const mediaPlayer = mediaMount.render(renderMedia);
    mediaPlayer.playerBoardRef.current = board;
    await wait(() => mediaPlayer.store.getSnapshot().status === "ready");
    mediaPlayer.controls.reviewPage?.(0);
    await wait(() => mediaPlayer.store.getSnapshot().status === "paused" && mediaPlayer.store.getSnapshot().reviewPageIndex === 0);
    assert.deepEqual(boardRows(), [
      { x: 90, y: 64, text: "Given" }, { x: 90, y: 130, text: "Work" }, { x: 90, y: 526, text: "Answer = 8" },
    ]);
    mediaMount.render(renderMedia); // Install the actual active player's frame loop.
    const mediaAudio = AudioBoundary.all.at(-1)!;
    mediaAudio.duration = mediaTimeline.totalMs / 1000;
    const pageBoundary = mediaTimeline.workPages[0]!.endMs - 1;
    await mediaAudio.play();
    await wait(() => mediaPlayer.store.getSnapshot().status === "playing");
    assert.equal(mediaPlayer.store.getSnapshot().reviewPageIndex, null,
      "native media-key play must leave frozen recorded-page review");
    assert.equal(mediaPlayer.store.getSnapshot().positionMs, pageBoundary,
      "native media-key play resumes from the reviewed page's end");
    assert.equal(mediaAudio.currentTime, pageBoundary / 1000);
    assert.ok(!boardRows().some(row => row.y === 526),
      "media-key resume rebuilds the ordinary timeline instead of retaining recorded-page placement");
    mediaAudio.currentTime = 4.75;
    await advanceFrame();
    assert.ok(mediaPlayer.store.getSnapshot().positionMs >= 4750,
      "actual native media clock advances the player after leaving page review");
    const writingDeadline = Date.now() + 5000;
    while (!boardRows().some(row => row.text.startsWith("Check"))) {
      assert.ok(Date.now() < writingDeadline, "native clock drives real future work after media-key resume");
      mediaAudio.currentTime = Math.min(mediaAudio.currentTime + 0.05, 7.5);
      await advanceFrame();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(boardRows().some(row => row.text.startsWith("Check")),
      "future work is no longer held by the frozen page draw loop");
    mediaAudio.pause();
    assert.equal(mediaPlayer.store.getSnapshot().status, "paused", "native pause still pauses the resumed player");
    const pausedAt = mediaPlayer.store.getSnapshot().positionMs;
    mediaAudio.currentTime = 4.9;
    await advanceFrame();
    assert.equal(mediaPlayer.store.getSnapshot().positionMs, pausedAt, "paused native media cannot advance the player clock");
    mediaPlayer.controls.reviewPage?.(0);
    assert.equal(mediaPlayer.store.getSnapshot().status, "seeking");
    await mediaAudio.play();
    await wait(() => mediaPlayer.store.getSnapshot().status !== "seeking");
    assert.equal(mediaPlayer.store.getSnapshot().reviewPageIndex, null,
      "native play during page reconstruction must queue synchronized playback instead of leaving a frozen page");
    assert.equal(mediaPlayer.store.getSnapshot().status, "playing");
    mediaAudio.pause();
    const ordinaryPosition = mediaPlayer.store.getSnapshot().positionMs;
    await mediaAudio.play();
    assert.equal(mediaPlayer.store.getSnapshot().status, "playing");
    assert.equal(mediaPlayer.store.getSnapshot().positionMs, ordinaryPosition,
      "ordinary native play keeps its existing position when no page is under review");
    mediaPlayer.controls.reviewPage?.(0);
    await mediaAudio.play();
    mediaPlayer.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(mediaPlayer.store.getSnapshot().active, false,
      "close supersedes a queued native review-resume before its reconstruction can publish");
    const closedStatus = mediaPlayer.store.getSnapshot().status;
    await mediaAudio.play();
    assert.equal(mediaPlayer.store.getSnapshot().active, false, "late native play cannot revive a closed player");
    assert.equal(mediaPlayer.store.getSnapshot().status, closedStatus, "late native play cannot change closed-player status");
    assert.equal(JSON.stringify(mediaTurn), mediaOriginal, "native resume cannot mutate stored work commands");
    mediaMount.close();
    console.log("PASS native media-key play leaves page review, resumes synchronized ink/audio, pauses and cannot revive a closed player");
    const figureTurn = await figureFixture();
    const figureTimeline = buildLecturePlayerTimeline([figureTurn]);
    const figureHooks = load(path.join(app, "features/tutor-session/hooks/useLecturePlayer.ts"), sceneMount, {
      "./useBoardViewport": { useBoardViewport: () => ({ scale: 1, offsetX: 0, offsetY: 0, measured: true }) },
      "@/lib/replay/lecturePlayerAudio": { lecturePlayerTrackKey: () => "verified-pages", getLecturePlayerTrack: async (_key: unknown, make: () => unknown) => make(), buildLecturePlayerTrack: async () => ({ url: "local:verified" }) },
    }) as unknown as { useLecturePlayer: typeof import("../../features/tutor-session/hooks/useLecturePlayer").useLecturePlayer };
    api = sceneMount.render(() => figureHooks.useLecturePlayer({ sessionId: "verified-pages", storedTurnsRef: { current: [figureTurn] }, storedTurnsCount: 1, available: true, rate: 1, onRateChange: () => {}, enableKeyboard: false }));
    api.playerBoardRef.current = board;
    await wait(() => api!.store.getSnapshot().status === "ready");
    const sceneInk = () => board.getDrawLayer()!.getChildren().filter((node) => node.getAttrs().htInk === "scene").map((node) => JSON.stringify(node.toObject())).sort();
    api.controls.reviewPage?.(0);
    await wait(() => api!.store.getSnapshot().status === "paused" && api!.store.getSnapshot().reviewPageIndex === 0);
    const figure = sceneInk();
    assert.ok(figure.length > 0, "actual canonical source-checked compiled figure reaches the permanent board");
    assert.deepEqual(boardRows(), [
      { x: 90, y: 64, text: "Given" },
      { x: 90, y: 130, text: capturedLongRow },
      { x: 90, y: 526, text: "Answer = 8" },
    ], "already captured long WRITE remains one original recorded row beside a verified figure");
    api.controls.reviewPage?.(1);
    await wait(() => api!.store.getSnapshot().status === "paused" && api!.store.getSnapshot().reviewPageIndex === 1);
    assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "Check = 8" }], "verified figure page still erases previous answer glyphs");
    assert.deepEqual(sceneInk(), figure, "recorded work-page erase preserves all compiled figure geometry and style");
    api.controls.seek(figureTimeline.totalMs);
    await wait(() => api!.store.getSnapshot().status === "ended");
    assert.deepEqual(sceneInk(), figure, "ordinary End preserves the same compiled figure geometry and style");
    console.log("PASS canonical verified permanent figure unchanged across recorded page erase and ordinary End");
    sceneMount.close();
    const correctionCommands: DrawCommand[] = [
      { type: "WRITE", params: [90, 142, 32], text: "Answer = 9", charPosition: 0, narrationBefore: "" },
      { type: "EMPHASIZE", params: [], text: "last", charPosition: 0, narrationBefore: "" },
      { type: "ERASE", params: [70, 126, 320, 100], charPosition: 0, narrationBefore: "" },
      { type: "WRITE", params: [90, 142, 32], text: "Answer = 8", charPosition: 0, narrationBefore: "" },
    ];
    const correctionTurn: StoredTurn = { ...turn, id: "erase-correction", segments: correctionCommands.map((command, orderIndex) => ({
      id: `erase-${orderIndex}`, orderIndex, narration: "Recorded correction", spokenText: "Recorded correction", durationMs: 1000, audioUrl: "/stored/audio", timings: null, command: serializeSegmentCommands([command]),
    })) };
    const correctionSnapshot = JSON.stringify(correctionTurn);
    const eraseHooks = load(path.join(app, "features/tutor-session/hooks/useLecturePlayer.ts"), eraseMount, {
      "./useBoardViewport": { useBoardViewport: () => ({ scale: 1, offsetX: 0, offsetY: 0, measured: true }) },
      "@/lib/replay/lecturePlayerAudio": { lecturePlayerTrackKey: () => "erase-correction", getLecturePlayerTrack: async (_key: unknown, make: () => unknown) => make(), buildLecturePlayerTrack: async () => ({ url: "local:erase-correction" }) },
    }) as unknown as { useLecturePlayer: typeof import("../../features/tutor-session/hooks/useLecturePlayer").useLecturePlayer };
    api = eraseMount.render(() => eraseHooks.useLecturePlayer({ sessionId: "erase-correction", storedTurnsRef: { current: [correctionTurn] }, storedTurnsCount: 1, available: true, rate: 1, onRateChange: () => {}, enableKeyboard: false }));
    api.playerBoardRef.current = board;
    await wait(() => api!.store.getSnapshot().status === "ready");
    api.controls.reviewPage?.(0);
    await wait(() => api!.store.getSnapshot().status === "paused" && api!.store.getSnapshot().reviewPageIndex === 0);
    assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "Answer = 8" }],
      "actual recorded erase/correction must expose its corrected ink, never a blank first page");
    assert.equal(api.store.getSnapshot().workPages?.length, 1,
      "an executed recorded erase releases its occupied row instead of inventing a page break");
    assert.equal(JSON.stringify(correctionTurn), correctionSnapshot);
    console.log("PASS actual recorded ERASE correction retains one nonblank immutable work page");
    eraseMount.close();
    const command = (type: DrawCommand["type"], params: number[], text?: string): DrawCommand =>
      ({ type, params, text, charPosition: 0, narrationBefore: "" });
    const stored = (id: string, entries: Array<DrawCommand | { command: DrawCommand; trusted: boolean }>, base: StoredTurn = turn): StoredTurn => ({
      ...base, id, segments: entries.map((entry, orderIndex) => {
        const c = captureCommandInk(structuredClone("command" in entry ? entry.command : entry), board.getInkSettings());
        return { id: `${id}-${orderIndex}`, orderIndex, narration: "Recorded work", spokenText: "Recorded work", durationMs: 1000, audioUrl: "/stored/audio", timings: null,
          command: serializeSegmentCommands([c], { trustedDiagramGeometry: "command" in entry && entry.trusted }) };
      }),
    });
    const reviewCase = async (id: string, turns: StoredTurn[], check: (player: LecturePlayerApi, totalMs: number) => Promise<void>) => {
      const state = new Mount(); extraMounts.push(state);
      const untouched = JSON.stringify(turns);
      const hooks = load(path.join(app, "features/tutor-session/hooks/useLecturePlayer.ts"), state, {
        "./useBoardViewport": { useBoardViewport: () => ({ scale: 1, offsetX: 0, offsetY: 0, measured: true }) },
        "@/lib/replay/lecturePlayerAudio": { lecturePlayerTrackKey: () => id, getLecturePlayerTrack: async (_key: unknown, make: () => unknown) => make(), buildLecturePlayerTrack: async () => ({ url: `local:${id}` }) },
      }) as unknown as { useLecturePlayer: typeof import("../../features/tutor-session/hooks/useLecturePlayer").useLecturePlayer };
      api = state.render(() => hooks.useLecturePlayer({ sessionId: id, storedTurnsRef: { current: turns }, storedTurnsCount: turns.length, available: true, rate: 1, onRateChange: () => {}, enableKeyboard: false }));
      api.playerBoardRef.current = board;
      await wait(() => api!.store.getSnapshot().status === "ready");
      await check(api, api.store.getSnapshot().durationMs);
      assert.equal(JSON.stringify(turns), untouched, `${id} leaves recorded commands immutable`);
      api.close(); state.close();
    };
    const review = async (player: LecturePlayerApi, index: number) => {
      const speechStarts = AudioBoundary.all.reduce((sum, audio) => sum + audio.playCalls, 0);
      player.controls.reviewPage?.(index);
      await wait(() => player.store.getSnapshot().status === "paused" && player.store.getSnapshot().reviewPageIndex === index);
      assert.equal(AudioBoundary.all.reduce((sum, audio) => sum + audio.playCalls, 0), speechStarts, "recorded page selection never starts speech");
    };
    const end = async (player: LecturePlayerApi, ms: number) => {
      player.controls.seek(ms); await wait(() => player.store.getSnapshot().status === "ended");
      assert.equal(player.store.getSnapshot().reviewPageIndex, null);
    };
    const ink = () => board.getDrawLayer()!.getChildren().map((node) => node.toObject());
    // Partial glyph erase must not become a synthetic whole-column wipe.
    await reviewCase("partial-glyph", [stored("partial-glyph", [command("WRITE", [90, 64, 32], "ABCD"), command("ERASE", [90, 64, 16, 47])])], async (player, ms) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 1);
      await review(player, 0);
      assert.deepEqual(boardRows(), [{ x: 106, y: 64, text: "BCD" }], "only the actually intersecting glyph is erased");
      const partial = ink(); await end(player, ms); assert.deepEqual(ink(), partial, "partial erase review equals the ordinary End's actual remaining ink");
    });
    for (const [id, erase] of [
      ["missed-erase", [1000, 900, 100, 100]],
      ["boundary-touch", [70, 16, 20, 47]],
    ] as const) {
      await reviewCase(id, [stored(id, [command("WRITE", [90, 64, 32], "ABCD"), command("ERASE", [...erase]), command("WRITE", [90, 64, 32], "New")])], async (player) => {
        assert.equal(player.store.getSnapshot().workPages?.length, 2, `${id} cannot forget an untouched occupied row`);
        await review(player, 0); assert.deepEqual(boardRows(), [{ x: 90, y: 64, text: "ABCD" }]);
        await review(player, 1); assert.deepEqual(boardRows(), [{ x: 90, y: 64, text: "New" }]);
      });
    }
    await reviewCase("erase-all-tail", [stored("erase-all-tail", [command("WRITE", [90, 64, 32], "ABCD"), command("EMPHASIZE", [], "last"), command("ERASE", [0, 0, 1200, 700])])], async (player, ms) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 0, "fully erased tail has no blank work page");
      await end(player, ms); assert.deepEqual(ink(), [], "original full erase still removes all glyphs and decoration at End");
    });
    console.log("PASS actual partial, missed, strict-edge and full-tail ERASE preserve renderer ink and valid pages");

    const intro = figureTurn.segments.filter((segment) => isStoredCommandTrustedGeometry(segment.command));
    const withIntro = (id: string, entries: Array<DrawCommand | { command: DrawCommand; trusted: boolean }>, base = figureTurn): StoredTurn => {
      const value = stored(id, entries, base);
      return { ...value, segments: [...intro, ...value.segments].map((segment, orderIndex) => ({ ...segment, orderIndex })) };
    };
    const oldRow = command("WRITE", [90, 142, 32], "Old");
    const newRow = command("WRITE", [90, 142, 32], "New");
    const eraseRow = command("ERASE", [70, 126, 320, 100]);
    await reviewCase("figure-blocked-erase", [withIntro("figure-blocked-erase", [oldRow, eraseRow, newRow])], async (player) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 2, "untrusted ERASE blocked by installed authority cannot forget a row");
      await review(player, 0); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "Old" }]);
      const figureNodes = board.getDrawLayer()!.getChildren().filter(node => node.getAttrs().htInk === "scene").map(node => node.toObject());
      await review(player, 1); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "New" }]);
      assert.deepEqual(board.getDrawLayer()!.getChildren().filter(node => node.getAttrs().htInk === "scene").map(node => node.toObject()), figureNodes);
    });
    await reviewCase("figure-trusted-erase", [withIntro("figure-trusted-erase", [oldRow, { command: eraseRow, trusted: true }, newRow])], async (player, ms) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 1);
      await review(player, 0); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "New" }]);
      assert.ok(board.getDrawLayer()!.getChildren().some(node => node.getAttrs().htInk === "scene"));
      await end(player, ms); assert.ok(board.getDrawLayer()!.getChildren().some(node => node.getAttrs().htInk === "scene"));
    });
    // The same compiled intro can occur in a legacy recording with no installed
    // metadata. It starts fbd clipping while leaving the authority guard null.
    const legacy = { ...figureTurn, sceneDocument: null, sceneArtifacts: null, visualStatus: "text_only" as const };
    await reviewCase("legacy-trusted-clip", [withIntro("legacy-trusted-clip", [command("WRITE", [395, 142, 32], "A"), { command: command("ERASE", [90, 126, 400, 100]), trusted: true }, command("WRITE", [395, 142, 32], "B")], legacy)], async (player) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 2, "effective clipped bounds leave the edge row occupied");
      await review(player, 0); assert.deepEqual(boardRows(), [{ x: 395, y: 142, text: "A" }]);
      await review(player, 1); assert.deepEqual(boardRows(), [{ x: 395, y: 142, text: "B" }]);
    });
    const continued = { ...figureTurn, kind: "resume" as const, sceneArtifacts: { ...figureTurn.sceneArtifacts as object, ...boardContinuationArtifacts(figureTurn.question) } };
    await reviewCase("first-continued", [withIntro("first-continued", [oldRow, eraseRow, newRow], continued)], async (player) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 1, "first continued turn has no installed diagram owner");
      await review(player, 0); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "New" }]);
    });
    await reviewCase("continued-retains-owner", [withIntro("opening", [oldRow]), stored("continued", [eraseRow, newRow], { ...turn, sceneArtifacts: boardContinuationArtifacts(figureTurn.question), kind: "resume" })], async (player) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 2, "continued metadata cannot drop the prior installed owner");
      await review(player, 0); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "Old" }]);
      await review(player, 1); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "New" }]);
    });
    const codeQuestion = "Explain binary search. nums = [2, 5, 8, 12, 16, 23, 38], target = 16.";
    const codeTurn = { ...turn, question: codeQuestion, sceneArtifacts: { codeLesson: getMockCodeLessonPlan(codeQuestion) } };
    await reviewCase("code-installed-owner", [stored("code-installed-owner", [oldRow, eraseRow, newRow], codeTurn)], async (player) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 2, "actual compiled code frames install authority with no sceneDocument");
      await review(player, 0); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "Old" }]);
      await review(player, 1); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "New" }]);
    });
    console.log("PASS actual installed authority, trusted clip, standalone/retained continuation and compiled code frames govern ERASE");

    // The fallback oracle above declares its inert glyph lookup. This group
    // uses the real writer and real Konva nodes, with only pixel painting inert.
    const fallbackBoard = board;
    extraBoards.push(fallbackBoard);
    board = mountTestWhiteboard(undefined, recordedWriter());
    for (const text of ["-", "/", "xy", "क", "🙂", "x² + 1"]) {
      for (const markerThickness of [0.6, 1, 1.6]) {
        const settings = { ...board.getInkSettings(), markerThickness };
        await board.clearBoard(0);
        await board.writeText(text, 90, 64, 0, undefined, 32, undefined, settings);
        const beforeNodes = board.getDrawLayer()!.getChildren().filter(node => node.getAttrs().htInk);
        assert.ok(beforeNodes.length > 0, `${text} has actual permanent glyph nodes`);
        const first = beforeNodes[0]!.getClientRect();
        const erase = { x: first.x + first.width / 2 - 0.25, y: first.y + first.height / 2 - 0.25, width: 0.5, height: 0.5 };
        await board.eraseRegion(erase.x, erase.y, erase.width, erase.height, 0);
        const expected = ink();
        const write = { ...command("WRITE", [90, 64, 32], text), inkSettings: settings };
        const id = `real-node-${text}-${markerThickness}`;
        await reviewCase(id, [stored(id, [write, command("ERASE", [erase.x, erase.y, erase.width, erase.height])])], async (player, ms) => {
          assert.equal(player.store.getSnapshot().workPages?.length, expected.length ? 1 : 0,
            `${text}/${markerThickness} page visibility follows actual individual-node erasure`);
          if (expected.length) {
            await review(player, 0);
            assert.deepEqual(ink(), expected, `${text}/${markerThickness} retains only actual surviving nodes`);
          }
          await end(player, ms);
          assert.deepEqual(ink(), expected, `${text}/${markerThickness} leaves ordinary End ink unchanged`);
        });
      }
    }
    await board.clearBoard(0);
    await board.writeText("-\u00a0-", 90, 64, 0, undefined, 32);
    const visiblePaths = board.getDrawLayer()!.getChildren().filter(node => node.getClassName() === "Path");
    assert.equal(visiblePaths.length, 2, "two real dash paths surround a whitespace fallback node");
    const eraseCommands = visiblePaths.map(node => {
      const rect = node.getClientRect();
      return command("ERASE", [rect.x + rect.width / 2 - 0.25, rect.y + rect.height / 2 - 0.25, 0.5, 0.5]);
    });
    for (const erase of eraseCommands) await board.eraseRegion(...erase.params.slice(0, 4) as [number, number, number, number], 0);
    const whitespaceOnly = ink();
    assert.equal(whitespaceOnly.length, 1, "an actual nonbreaking-space fallback Text node survives both dash erases");
    assert.ok(whitespaceOnly.every(node => node.className === "Text" && !String(node.attrs.text).trim()), "only non-ink whitespace survives");
    await reviewCase("whitespace-survivor", [stored("whitespace-survivor", [command("WRITE", [90, 64, 32], "-\u00a0-"), ...eraseCommands])], async (player, ms) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 0, "whitespace-only tail does not publish a blank work page");
      await end(player, ms); assert.deepEqual(ink(), whitespaceOnly);
    });
    // Warm a neighboring fractional coordinate before the actual recorded row.
    // The old rounded async cache returned different ink than the sync index.
    await board.clearBoard(0);
    await board.writeText("Given", 90, 64, 0, undefined, 32);
    const expectedHeading = ink();
    await board.clearBoard(0);
    await board.writeText("-", 90.2, 142, 0, undefined, 32);
    await board.clearBoard(0);
    const exactStroke = textToStrokePathsSync("-", 90.4, 142, 32)[0]!.strokes[0]!;
    const exactNode = new Konva.Path({ data: exactStroke.pathData, stroke: "#1B2A4A", strokeWidth: exactStroke.width,
      fillEnabled: false, lineCap: "round", lineJoin: "round", shadowForStrokeEnabled: false, hitStrokeWidth: 0 });
    const exactRect = exactNode.getClientRect(); exactNode.destroy();
    const cacheErase = command("ERASE", [exactRect.x + exactRect.width - 0.1, exactRect.y + exactRect.height / 2 - 0.05, 0.05, 0.1]);
    await reviewCase("fractional-cache-key", [stored("fractional-cache-key", [command("WRITE", [90, 64, 32], "Given"), command("WRITE", [90.4, 142, 32], "-"), cacheErase])], async (player) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 1);
      await review(player, 0);
      assert.deepEqual(ink(), expectedHeading, "fractional recorded coordinates must not reuse a neighboring cached stroke and hide surviving ink");
    });
    console.log("PASS real single/multi-stroke, fallback/Devanagari/math glyph erasure, whitespace, fractional cache identity and captured pen thickness match actual node visibility");

    const realBoard = board;
    const resetTurns = [withIntro("owned-opening", [oldRow]), stored("new-independent", [oldRow, eraseRow, newRow])];
    board = fallbackBoard;
    await reviewCase("new-independent-owner-reset", resetTurns, async (player) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 2, "new independent opening resets old verified authority");
      await review(player, 1); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "New" }]);
    });
    // A no-cue turn never installs its metadata. The continued turn still uses
    // the preceding actual opening and its verified owner.
    await reviewCase("no-cue-does-not-reset", [withIntro("owned-opening", [oldRow]), { ...turn, id: "empty", segments: [] }, stored("continued", [eraseRow, newRow], { ...turn, kind: "resume", sceneArtifacts: boardContinuationArtifacts(figureTurn.question) })], async (player) => {
      assert.equal(player.store.getSnapshot().workPages?.length, 2);
      await review(player, 1); assert.deepEqual(boardRows(), [{ x: 90, y: 142, text: "New" }]);
    });
    console.log("PASS independent and no-cue turn transitions preserve the actual replay authority owner");
    board = realBoard;


  } finally {
    api?.close();
    mount.close();
    sceneMount.close();
    eraseMount.close();
    for (const state of extraMounts) state.close();
    unmountTestWhiteboard(board);
    for (const extra of extraBoards) unmountTestWhiteboard(extra);
    for (const [key, value] of original) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
