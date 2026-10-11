/** Saved page discovery uses the actual timeline and rendered player consumer. */
import assert from "node:assert/strict";
import { buildLecturePlayerTimeline } from "../../lib/replay/lecturePlayer";
import type { DrawCommand } from "@heytutor/drawing";
import { getSegmentCommands, isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import type { StoredTurn } from "../../lib/boards/boardsClient";
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
      if (name.startsWith("@/"))
        return requireApp(path.join(app, name.slice(2)));
      if (name.startsWith(".")) {
        const p = path.resolve(path.dirname(file), name);
        return p.startsWith(path.join(app, "features/tutor-session/hooks"))
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
  for (const [key, value] of Object.entries({
    Audio: AudioBoundary,
    window: {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      requestIdleCallback: (fn: () => void) => setTimeout(fn, 0),
      cancelIdleCallback: clearTimeout,
      requestAnimationFrame: (): number => 1,
      cancelAnimationFrame: () => {},
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
  const board = mountTestWhiteboard(undefined, async (text, x, y, fontSize) =>
    Array.from(text, (char, index) => ({
      char,
      x: x + index * 16,
      y,
      width: 16,
      fontSize,
      strokes: [],
    }))),
    mount = new Mount(), sceneMount = new Mount();
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
  } finally {
    api?.close();
    mount.close();
    sceneMount.close();
    unmountTestWhiteboard(board);
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
