/** Saved page discovery uses the actual timeline and rendered player consumer. */
import assert from "node:assert/strict";
import { buildLecturePlayerTimeline } from "../../lib/replay/lecturePlayer";
import type { DrawCommand } from "@heytutor/drawing";
import type { StoredTurn } from "../../lib/boards/boardsClient";
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
      { type: "WRITE", params: [90, 64, 32], text: "Given" },
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
  const board = mountTestWhiteboard(),
    mount = new Mount();
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
    api.controls.play();
    await wait(() => api!.store.getSnapshot().status === "playing");
    assert.equal(
      api.store.getSnapshot().reviewPageIndex,
      null,
      "Play leaves stored-page review for the ordinary timeline",
    );
    api.controls.pause();
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
  } finally {
    api?.close();
    mount.close();
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
