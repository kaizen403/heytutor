/** Actual caption consumers and mounted viewport; provider/media and DOM measurements are controlled boundaries. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ComponentType } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createLecturePlayerStore } from "../../lib/replay/lecturePlayer";
import type { LecturePlayerBarProps } from "../../features/tutor-session/components/LecturePlayerBar";
import type { BoardViewport } from "../../features/tutor-session/types";
import type { TutorSessionShellProps } from "../../features/tutor-session/TutorSessionShell";
import type { StoredTurn } from "../../lib/boards/boardsClient";
Object.defineProperty(globalThis, "React", { value: React, configurable: true });
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const barFile = path.join(appRoot, "features/tutor-session/components/LecturePlayerBar.tsx");
const viewportFile = path.join(appRoot, "features/tutor-session/hooks/useBoardViewport.ts");
function load(file: string, source: string, react?: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
    if (specifier.endsWith("/sessionCaption") && process.env.CAPTION_SELECTOR_SOURCE) {
      return load(path.join(appRoot, "features/tutor-session/lib/board/sessionCaption.ts"), process.env.CAPTION_SELECTOR_SOURCE);
    }
    if (specifier === "react" && react) return react;
    if (specifier.startsWith("@/")) return requireApp(path.join(appRoot, specifier.slice(2)));
    if (specifier.startsWith(".")) return requireApp(path.resolve(path.dirname(file), specifier));
    return requireApp(specifier);
  }, mod, mod.exports);
  return mod.exports;
}

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
class HookMount {
  slots: Slot[] = [];
  cursor = 0;
  dirty = true;
  effects: Array<() => void> = [];
  react = {
    useState: <T,>(initial: T) => {
      const slot = this.slots[this.cursor] ?? (this.slots[this.cursor] = {});
      this.cursor++;
      if (!("value" in slot)) slot.value = initial;
      return [slot.value as T, (value: T) => {
        if (!Object.is(slot.value, value)) { slot.value = value; this.dirty = true; }
      }] as const;
    },
    useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
      const slot = this.slots[this.cursor] ?? (this.slots[this.cursor] = {});
      this.cursor++;
      if (slot.deps && deps.length === slot.deps.length && deps.every((value, index) => Object.is(value, slot.deps![index]))) return;
      slot.deps = deps;
      this.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() ?? undefined; });
    },
  };
  render<T>(run: () => T): T {
    let value!: T;
    for (let renders = 0; renders < 10; renders++) {
      this.cursor = 0;
      this.dirty = false;
      value = run();
      for (const effect of this.effects.splice(0)) effect();
      if (!this.dirty) return value;
    }
    throw new Error("viewport did not settle");
  }
  unmount() { for (const slot of this.slots) slot.cleanup?.(); }
}

function viewportFixture(width: number, height: number, deckHeight: number, mode: "fit" | "fixed" | "readable-scroll" = "fit", panelHeight = 0) {
  const mount = new HookMount();
  const box = { width, height, deckHeight, keyboardInset: 0, panelShown: panelHeight > 0 };
  const panelStyle = new Map<string, string>();
  const panel = panelHeight > 0 ? {
    getBoundingClientRect: () => ({ height: panelStyle.get("--board-panel-display") === "none" ? 0 : Math.min(panelHeight, Number.parseFloat(panelStyle.get("--board-panel-max-height") ?? "Infinity")) }),
  } : null;
  const deck = {
    style: { setProperty: (key: string, value: string) => panelStyle.set(key, value), removeProperty: (key: string) => panelStyle.delete(key) },
    querySelector: (selector: string) => selector === '[data-board-code-panel="below"]' && box.panelShown ? panel : null,
    getBoundingClientRect: () => ({ height: box.deckHeight + (panel && box.panelShown && panelStyle.get("--board-panel-display") !== "none" ? panel.getBoundingClientRect().height + 12 : 0) }),
  };
  const container = {
    getBoundingClientRect: () => ({ width: box.width, height: box.height }),
    querySelector: (selector: string) => selector === "[data-board-deck]" ? deck : null,
  };
  let disconnected = false;
  const observed = new Set<unknown>();
  let observerCallback = () => {};
  const mediaListeners = new Set<() => void>();
  const visualListeners = new Map<string, Set<() => void>>();
  const media = {
    get matches() { return box.width <= 640; },
    addEventListener: (_event: string, callback: () => void) => mediaListeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => mediaListeners.delete(callback),
  };
  let nextFrame = 1;
  const frames = new Map<number, () => void>();
  const flushFrames = () => {
    for (let count = 0; frames.size > 0 && count < 40; count++) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    }
    assert.equal(frames.size, 0, "viewport frame scheduling must settle");
  };
  const original = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: {
      innerWidth: width, innerHeight: height,
      visualViewport: {
        offsetTop: 0,
        get height() { return height - box.keyboardInset; },
        addEventListener: (event: string, callback: () => void) => {
          const listeners = visualListeners.get(event) ?? new Set<() => void>();
          listeners.add(callback);
          visualListeners.set(event, listeners);
        },
        removeEventListener: (event: string, callback: () => void) => visualListeners.get(event)?.delete(callback),
      },
      matchMedia: (query: string) => query.includes("767px") ? { ...media, get matches() { return box.width <= 767; } } : media,
      setTimeout: () => 0, clearTimeout: () => {},
    },
    requestAnimationFrame: (callback: () => void): number => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    getComputedStyle: () => ({ marginTop: "12px", display: panelStyle.get("--board-panel-display") ?? "flex" }),
    ResizeObserver: class {
      constructor(callback: () => void) { observerCallback = callback; }
      observe(element: unknown) { observed.add(element); }
      disconnect() { disconnected = true; observed.clear(); }
    },
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const hook = load(viewportFile, process.env.CAPTION_VIEWPORT_SOURCE ?? viewportFile, mount.react).useBoardViewport as
    (ref: { current: unknown }, mode: "fit" | "fixed" | "readable-scroll") => BoardViewport;
  const ref = { current: container };
  const read = () => mount.render(() => hook(ref, mode));
  const resize = (patch: Partial<typeof box>, target: "container" | "deck" = "container") => {
    Object.assign(box, patch);
    if (observed.has(target === "deck" ? deck : container)) observerCallback();
    flushFrames();
    return read();
  };
  // Deliver the visual viewport event independently: no ResizeObserver
  // callback may rescue a missing keyboard-close listener in this case.
  const visualResize = (patch: Partial<typeof box>) => {
    Object.assign(box, patch);
    for (const callback of [...(visualListeners.get("resize") ?? [])]) callback();
    flushFrames();
    return read();
  };
  return {
    box, deck, panel, panelStyle, container, observed, read, resize, visualResize,
    get disconnected() { return disconnected; },
    get mediaListenerCount() { return mediaListeners.size; },
    get visualResizeListenerCount() { return visualListeners.get("resize")?.size ?? 0; },
    unmount: () => mount.unmount(),
    close() {
      mount.unmount();
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
function withViewport(width: number, height: number, deck: number, run: (fixture: ReturnType<typeof viewportFixture>) => void, mode: "fit" | "fixed" | "readable-scroll" = "fit") {
  const fixture = viewportFixture(width, height, deck, mode);
  try { run(fixture); } finally { fixture.close(); }
}
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.00001, `expected ${expected}, received ${actual}`);
const failures: string[] = [];
let groups = 0;
function check(name: string, run: () => void) {
  if (process.env.CAPTION_DOCK_CASE && name !== process.env.CAPTION_DOCK_CASE) return;
  groups++;
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}:`, error instanceof Error ? error.message : error); }
}


const liveCaption = "we want the largest sum from one continuous stretch of these values. in this example, the stretch beginning at 4 is worth watching.";
const rewindCaption = "Earlier: the running sum was negative, so restart this continuous stretch at four.";
const recordedCaption = "Recorded: compare the middle value with the target, then discard the impossible half.";
let lastShellTree: React.ReactElement | null = null;
class ShellMount {
  slots: unknown[] = []; cursor = 0;
  constructor(private subtitles: boolean) {}
  react = { ...React,
    useState: <T,>(initial: T | (() => T)) => {
      const index = this.cursor++;
      if (!(index in this.slots)) {
        const value = typeof initial === "function" ? (initial as () => T)() : initial;
        this.slots[index] = value && typeof value === "object" && "subtitlesEnabled" in value ? { ...value, subtitlesEnabled: this.subtitles } : value;
      }
      return [this.slots[index] as T, (value: T | ((previous: T) => T)) => { this.slots[index] = typeof value === "function" ? (value as (previous: T) => T)(this.slots[index] as T) : value; }] as const;
    },
    useRef: <T,>(initial: T) => this.react.useState(() => ({ current: initial }))[0],
    useMemo: <T,>(make: () => T) => make(), useCallback: <T,>(fn: T) => fn,
    useEffect: () => {}, useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  };
}
function mediaHooks(width: number, height: number, coarse: boolean) {
  const matches = (query: string) => query.split(",").some(arm => arm.split(/\s+and\s+/i).every(raw => {
    const clause = raw.trim(), dimension = /^\((min|max)-(width|height):\s*([0-9.]+)px\)$/.exec(clause);
    if (dimension) { const value = dimension[2] === "width" ? width : height; return dimension[1] === "max" ? value <= Number(dimension[3]) : value >= Number(dimension[3]); }
    if (clause === "(pointer: coarse)") return coarse;
    throw Error(`Unsupported actual media query ${clause}`);
  }));
  const file = path.join(appRoot, "lib/client/useMediaQuery.ts");
  return load(file, file, { useCallback: <T,>(fn: T) => fn, useSyncExternalStore: (_subscribe: unknown, read: () => boolean) => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: (query: string) => ({ matches: matches(query) }) } });
    try { return read(); } finally { if (prior) Object.defineProperty(globalThis, "window", prior); else Reflect.deleteProperty(globalThis, "window"); }
  } });
}
const bar = load(barFile, barFile).LecturePlayerBar as ComponentType<LecturePlayerBarProps>;
const bubbleFile = path.join(appRoot, "features/tutor-session/components/ResponseBubble.tsx");
const bubble = load(bubbleFile, process.env.CAPTION_BUBBLE_SOURCE ?? bubbleFile).ResponseBubble as ComponentType;
const canvasFile = path.join(appRoot, "features/tutor-session/components/SessionBoardCanvas.tsx");
const canvas = load(canvasFile, process.env.CAPTION_CANVAS_SOURCE ?? canvasFile, undefined, {
  "./WhiteboardLoader": { Whiteboard: () => null },
  "./BoardMarkingLayer": { BoardMarkingLayer: () => null },
  "./DiagramLabelInspector": { DiagramLabelInspector: () => null },
  "@/features/tutor-session/components/ResponseBubble": { ResponseBubble: bubble },
}).SessionBoardCanvas as ComponentType;
function captionLocation(html: string, text: string) {
  // Inspect rendered markup ancestry. No shell/deck JSX is reconstructed here.
  const stack: Array<{ tag: string; attrs: string }> = [];
  for (const token of html.matchAll(/<\/?([a-z][a-z0-9-]*)\b[^>]*>|[^<]+/gi)) {
    const value = token[0], tag = token[1];
    if (!tag) { if (value.includes(text)) return { inDeck: stack.some(node => /\bdata-board-deck\b/.test(node.attrs)), inPaper: stack.some(node => /\bwb-surface\b/.test(node.attrs)), ancestors: [...stack] }; continue; }
    if (value.startsWith("</")) { const index = stack.map(node => node.tag).lastIndexOf(tag); if (index >= 0) stack.length = index; }
    else if (!/^(?:input|img|br|hr|meta|link|source|canvas)$/i.test(tag) && !value.endsWith("/>")) stack.push({ tag, attrs: value });
  }
  return null;
}
function shellMarkup(options: {
  mobile: boolean; coarse?: boolean; width?: number; height?: number; phase?: "idle" | "speaking" | "drawing"; paused?: boolean; subtitles?: boolean; recorded?: boolean; playerActive?: boolean; playerPlaying?: boolean; playerRevealed?: boolean;
  fullscreen?: boolean; saveFailed?: boolean; codeOnly?: boolean;
  pausedOffer?: boolean; downloadError?: boolean; rewind?: boolean;
}) {
  const mount = new ShellMount(options.subtitles ?? true);
  const setters: { text?: (value: string) => void; phase?: (value: string) => void; paused?: (value: boolean) => void } = {};
  const noop = () => {};
  const leaf = () => null;
  const children = ({ children }: { children?: import("react").ReactNode }) => children;
  const turns: StoredTurn[] = options.recorded === false ? [] : [{
    id: "recorded-turn", orderIndex: 0, question: "A recorded lesson", rawResponse: "", speedMultiplier: 1.25,
    traceId: null, sceneDocument: null, sceneEngineVersion: null, validationReport: null,
    visualStatus: "text_only", sceneArtifacts: null, status: "complete",
    segments: [{ id: "recorded-segment", orderIndex: 0, narration: "The lesson is complete.", spokenText: "The lesson is complete.",
      command: null, audioUrl: "local-recorded.wav", durationMs: 10000, timings: null }],
  }];
  const store = createLecturePlayerStore({ status: options.playerPlaying ? "playing" : "paused", active: options.playerActive === true, positionMs: 1000, durationMs: 10000, loadedMs: 10000, rate: 1.25 });
  const overrides: Record<string, unknown> = {
    "next/navigation": { useRouter: () => ({ push: noop }) },
    "@/features/app-shell/AppShell": { AppShell: children },
    "@/features/app-shell/useAccountMe": { useAccountMe: () => null, toShellProfile: () => undefined },
    "@/lib/client/useMediaQuery": mediaHooks(options.width ?? (options.mobile ? 390 : 1440), options.height ?? 844, options.coarse ?? options.mobile),
    "@/lib/client/useVisualViewportInset": { useVisualViewportInset: () => 0 },
    "@/lib/client/useLockWindowScrollOnFocus": { useLockWindowScrollOnFocus: noop },
    "./components/SettingsDrawer": { ...requireApp(path.join(appRoot, "lib/account/lessonSettings.ts")), SettingsDrawer: leaf },
    "@/features/tutor-session/components/SettingsDrawer": { ...requireApp(path.join(appRoot, "features/tutor-session/components/SettingsDrawer.tsx")), SettingsDrawer: leaf },
    "./lib/code-lesson/codeLessonController": { CodeLessonController: class { getActivePlan() { return options.codeOnly ? {} : null; } } },
    "./hooks/useCancelControl": { useCancelControl: () => ({}) },
    "./hooks/useBoardLayout": { useBoardLayout: () => ({ boardContainerRef: { current: null }, boardViewport: { scale: 0.2, offsetX: 0, offsetY: 0, measured: true }, boardLayoutRef: { current: {} }, notesEpochsRef: { current: [] }, narrationSinceEpochRef: { current: [] } }) },
    "./hooks/useAdaptiveDrawSpeed": { useAdaptiveDrawSpeed: noop },
    "./hooks/useCommandExecution": { useCommandExecution: () => ({}) },
    "./hooks/useBoardSession": { useBoardSession: (input: { setCurrentSegmentText: (value: string) => void }) => { setters.text = input.setCurrentSegmentText; return ({ boards: [{ id: "recorded-board", title: "Saved lesson", preview: "" }], boardLoaded: true, storedTurnsRef: { current: turns }, storedTurnsCount: turns.length, inputInteracted: true, saveStatus: options.saveFailed ? { kind: "failed", message: "Try again" } : { kind: "saved" }, retrySave: noop, hasLiveTurn: false }); } },
    "./hooks/useTurnLifecycle": { useTurnLifecycle: (input: { setPhase: (value: string) => void; setIsPaused: (value: boolean) => void }) => { setters.phase = input.setPhase; setters.paused = input.setIsPaused; return { pausedLessonOffer: options.pausedOffer === true }; } },
    "./hooks/useNotesChat": { useNotesChat: () => ({ messages: [] }) },
    "./hooks/useReplay": { useReplay: () => ({ replayLecture: () => false, handleReplaySpeedChange: noop }) },
    "./hooks/useLectureRewind": { useLectureRewind: () => ({ rewindActive: options.rewind === true, rewindSegmentText: rewindCaption, rewindBoardRef: { current: null }, rewindCursorState: "hidden" }) },
    "./hooks/useLectureExport": { useLectureExport: () => ({ downloadState: options.downloadError ? { kind: "error", file: "video", message: "Try the download again" } : { kind: "idle" }, lectureFileType: "mp4" }) },
    "./hooks/useLecturePlayer": { useLecturePlayer: () => ({ store, active: options.playerActive === true, controls: { play: noop, pause: noop, toggle: noop, seek: noop, skip: noop, setRate: noop }, view: { active: options.playerActive === true, revealed: options.playerRevealed !== false, cursorState: "hidden", segmentText: recordedCaption }, playing: options.playerPlaying === true, close: noop, halt: noop }) },
    "./hooks/useBoardMarking": { useBoardMarking: () => ({ armed: false, marks: [] }) },
    "./hooks/useLecturePageHalt": { useLecturePageHalt: noop },
    "./hooks/useBoardFullscreen": { useBoardFullscreen: () => ({ active: options.fullscreen === true, toggle: noop }), useSessionChromeHidden: () => false },
  };
  const shellFile = path.join(appRoot, "features/tutor-session/TutorSessionShell.tsx");
  // Replace unrelated child components, never the subject transport or shell.
  const source = ts.createSourceFile(shellFile, readFileSync(shellFile, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (Object.hasOwn(overrides, specifier) || !/(\/components\/|\/CanvasLanding$|\/LandingPixelField$|\/OutOfCreditsDialog$|\/ui\/)/.test(specifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    overrides[specifier] = Object.fromEntries(bindings.elements.filter((binding) => !binding.isTypeOnly).map((binding) => [binding.propertyName?.text ?? binding.name.text, leaf]));
  }
  overrides["./components/LecturePlayerBar"] = { LecturePlayerBar: bar };
  overrides["./components/SessionBoardCanvas"] = { SessionBoardCanvas: canvas };
  overrides["@/features/tutor-session/components/ResponseBubble"] = { ResponseBubble: bubble };
  overrides["./components/ResponseBubble"] = { ResponseBubble: bubble };
  overrides["./components/SessionHeader"] = { SessionHeader: ({ chromeInert, chromeHidden, saveStatus, onRetrySave }: { chromeInert: boolean; chromeHidden: boolean; saveStatus?: { kind: string }; onRetrySave?: () => void }) => createElement("header", {
    "data-header-inert": String(chromeInert), "data-header-hidden": String(chromeHidden),
    "data-save-status": saveStatus?.kind, "data-header-retry": String(typeof onRetrySave === "function"),
  }) };
  overrides["./components/SessionInputChrome"] = { SessionInputChrome: () => createElement("textarea", { defaultValue: "Retained composer" }) };
  const shell = load(shellFile, process.env.CAPTION_SHELL_SOURCE ?? shellFile, mount.react, overrides).TutorSessionShell as ComponentType<TutorSessionShellProps>;
  const render = () => { mount.cursor = 0; return (shell as (props: TutorSessionShellProps) => React.ReactElement)({ sessionId: "recorded-board" }); };
  render();
  setters.text?.(liveCaption); setters.phase?.(options.phase ?? "speaking"); setters.paused?.(options.paused === true);
  lastShellTree = render();
  const html = renderToStaticMarkup(lastShellTree);
  return html;
}

check("live-and-pause", () => {
  for (const phase of ["speaking", "drawing"] as const) for (const paused of [false, true]) {
    const html = shellMarkup({ mobile: true, recorded: false, phase, paused });
    const caption = captionLocation(html, "we want the largest sum");
    assert.ok(caption, "active live/Pause caption stays visible");
    assert.equal(caption.inDeck, true, "phone live caption must be owned by the measured deck");
    assert.equal(caption.inPaper, false, "caption cannot cover the paper");
    assert.ok(!html.includes(recordedCaption) && !html.includes(rewindCaption));
  }
});
check("rewind-source", () => {
  const html = shellMarkup({ mobile: true, recorded: false, rewind: true });
  const caption = captionLocation(html, rewindCaption);
  assert.ok(caption && caption.inDeck && !caption.inPaper, "rewind keeps its own readable caption outside paper");
  assert.ok(!html.includes(liveCaption), "current live narration cannot replace the viewed rewind caption");
});
check("player-play-and-pause", () => {
  for (const playerPlaying of [true, false]) {
    const html = shellMarkup({ mobile: true, playerActive: true, playerPlaying, phase: "idle", rewind: true });
    const caption = captionLocation(html, recordedCaption);
    assert.ok(caption && caption.inDeck && !caption.inPaper, "revealed Play/Pause player caption remains outside paper");
    assert.ok(!html.includes(liveCaption) && !html.includes(rewindCaption), "player caption has display ownership");
  }
  const hidden = shellMarkup({ mobile: true, playerActive: true, playerRevealed: false, phase: "idle" });
  assert.equal(captionLocation(hidden, recordedCaption), null, "unrevealed player does not announce a stale sentence");
});
check("eligibility-and-stop", () => {
  const disabled = shellMarkup({ mobile: true, recorded: false, subtitles: false });
  assert.equal(captionLocation(disabled, "we want the largest sum"), null, "ordinary disabled subtitles remain disabled");
  const code = shellMarkup({ mobile: true, recorded: false, subtitles: false, codeOnly: true });
  assert.ok(captionLocation(code, "we want the largest sum")?.inDeck, "code lesson captions remain readable even when ordinary subtitles are off");
  const stopped = shellMarkup({ mobile: true, recorded: false, phase: "idle" });
  assert.equal(captionLocation(stopped, "we want the largest sum"), null, "Stop/idle does not leave the active teaching caption up");
});
check("landscape-and-laptop", () => {
  for (const [width, height] of [[390, 220], [844, 390]] as const) {
    const html = shellMarkup({ mobile: width < 768, width, height, coarse: true, recorded: false });
    assert.ok(captionLocation(html, "we want the largest sum")?.inDeck, "short coarse caption uses measured deck");
  }
  const html = shellMarkup({ mobile: false, width: 1440, height: 900, coarse: false, recorded: false });
  const caption = captionLocation(html, "we want the largest sum");
  assert.ok(caption && !caption.inDeck && caption.inPaper, "laptop retains existing paper overlay");
});
check("actual-viewport-budget", () => {
  withViewport(390, 600, 80, f => {
    const fitted = f.read(); near(fitted.scale, 370 / 1200);
    assert.ok(fitted.scale * 700 + 20 + 80 <= 600, "readable caption budget fits outside paper");
    near(f.resize({ deckHeight: 80 }, "deck").scale, fitted.scale);
    const rotate = f.resize({ width: 844, height: 300 });
    near(rotate.scale, (300 - 80 - 32) / 700);
  });
  withViewport(390, 206, 124, f => { near(f.read().scale, .5); assert.ok(f.read().scale * 700 > 206 - 124, "tiny paper remains readable and scrollable above caption/control deck"); }, "readable-scroll");
});

check("focused-caption-keys", () => {
  shellMarkup({ mobile: true, playerActive: true, playerPlaying: false, phase: "idle" });
  const find = (node: React.ReactNode): React.ReactElement<Record<string, unknown>> | null => {
    if (Array.isArray(node)) { for (const child of node) { const result = find(child); if (result) return result; } return null; }
    if (!React.isValidElement<Record<string, unknown>>(node)) return null;
    if (node.props["aria-label"] === "Current narration") return node;
    return find(node.props.children as React.ReactNode);
  };
  const region = find(lastShellTree);
  assert.ok(region, "actual shell exposes the accessible caption region");
  assert.equal(region.props.tabIndex, 0, "caption can receive native keyboard scrolling");
  const keyDown = region.props.onKeyDown as ((event: { key: string; stopPropagation: () => void; preventDefault: () => void }) => void) | undefined;
  assert.equal(typeof keyDown, "function", "actual caption owns its focused scrolling keys");
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", " "]) {
    let stopped = 0, prevented = 0;
    keyDown!({ key, stopPropagation: () => { stopped++; }, preventDefault: () => { prevented++; } });
    assert.equal(stopped, 1, `${key} cannot reach global media shortcuts`);
    assert.equal(prevented, 0, `${key} keeps native scrolling default`);
  }
  for (const key of ["Escape", "a"]) {
    let stopped = 0;
    keyDown!({ key, stopPropagation: () => { stopped++; }, preventDefault: () => { throw Error("unrelated key default changed"); } });
    assert.equal(stopped, 0, `${key} still reaches its existing owner`);
  }
});
const required = ["live-and-pause", "rewind-source", "player-play-and-pause", "eligibility-and-stop", "landscape-and-laptop", "actual-viewport-budget", "focused-caption-keys"];
assert.ok(!process.env.CAPTION_DOCK_CASE || required.includes(process.env.CAPTION_DOCK_CASE), "unknown caption gate case");
assert.ok(groups > 0, "at least one caption group ran");
assert.equal(failures.length, 0, `${failures.length}/${groups} caption groups failed: ${failures.join(", ")}`);
console.log(`Mobile caption dock: ${groups} actual consumer groups GREEN`);
