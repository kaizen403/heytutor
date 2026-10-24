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
    useRef: <T,>(initial: T) => {
      const slot = this.slots[this.cursor] ?? (this.slots[this.cursor] = {});
      this.cursor++;
      if (!("value" in slot)) slot.value = { current: initial };
      return slot.value as { current: T };
    },
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

export function viewportFixture(width: number, height: number, deckHeight: number, mode: "fit" | "fixed" | "readable-scroll" = "fit", panelHeight = 0, minimumVisibleFontSize?: number | null) {
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
    (ref: { current: unknown }, mode: "fit" | "fixed" | "readable-scroll", minimumVisibleFontSize?: number | null) => BoardViewport;
  const ref = { current: container };
  const read = () => mount.render(() => hook(ref, mode, minimumVisibleFontSize));
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
    fontSize(size: number | null) { minimumVisibleFontSize = size; return read(); },
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
  if (process.env.PHONE_BOARD_READABILITY_ONLY && !name.startsWith("phone-readability-")) return;
  groups++;
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}:`, error instanceof Error ? error.message : error); }
}


const liveCaption = "we want the largest sum from one continuous stretch of these values. in this example, the stretch beginning at 4 is worth watching.";
const rewindCaption = "Earlier: the running sum was negative, so restart this continuous stretch at four.";
const recordedCaption = "Recorded: compare the middle value with the target, then discard the impossible half.";
let lastShellTree: React.ReactElement | null = null;
let lastShellViewportMode: string | undefined;
export const phoneViewportScales: number[] = [];
export let phoneShellReading: import("../../features/tutor-session/hooks/useBoardReading").BoardReadingInput | undefined;
export let phoneShellMinimum: number | null | undefined;
export function phoneShellTree() { return lastShellTree; }
class ShellMount {
  slots: unknown[] = []; cursor = 0;
  layoutEffects: Array<() => void> = [];
  constructor(private subtitles: boolean) {}
  runLayoutEffects() { for (const effect of this.layoutEffects.splice(0)) effect(); }
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
    useEffect: () => {},
    // Layout effects run after each commit when their deps change, as React does.
    useLayoutEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const slot = this.react.useState(() => ({ deps: undefined as readonly unknown[] | undefined, cleanup: undefined as void | (() => void) }))[0];
      if (deps && slot.deps && deps.length === slot.deps.length && deps.every((value, index) => Object.is(value, slot.deps![index]))) return;
      slot.deps = deps;
      this.layoutEffects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); });
    },
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
const canvas = load(canvasFile, process.env.CAPTION_CANVAS_SOURCE ?? canvasFile, {
  ...React,
  // This is a mounted-session fixture: read the code controller's client
  // snapshot rather than React's empty server-render snapshot.
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}, {
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
type ShellOptions = {
  mobile: boolean; coarse?: boolean; width?: number; height?: number; phase?: "idle" | "planning" | "thinking" | "speaking" | "drawing"; paused?: boolean; subtitles?: boolean; recorded?: boolean; playerActive?: boolean; playerPlaying?: boolean; playerRevealed?: boolean;
  fullscreen?: boolean; saveFailed?: boolean; codeOnly?: boolean; variant?: TutorSessionShellProps["variant"]; viewportScale?: number;
  pausedOffer?: boolean; downloadError?: boolean; rewind?: boolean; text?: string; playerText?: string;
  scrollable?: boolean; minimumVisibleFontSize?: number | null; rewindPlaying?: boolean;
};
type ShellStep = { text?: string; phase?: NonNullable<ShellOptions["phase"]>; paused?: boolean; voiceDegraded?: boolean };
export function shellMarkup(options: ShellOptions) {
  return shellSession(options).step({ text: options.text ?? liveCaption, phase: options.phase ?? "speaking", paused: options.paused === true });
}
/** One mounted shell driven through several states, so session-long state is kept. */
export function shellSession(options: ShellOptions) {
  const mount = new ShellMount(options.subtitles ?? true);
  const setters: { text?: (value: string) => void; phase?: (value: string) => void; paused?: (value: boolean) => void; voiceDegraded?: (value: boolean) => void } = {};
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
    "./hooks/useBoardLayout": { useBoardLayout: (input: { viewportMode?: string; minimumVisibleFontSize?: number | null }) => { lastShellViewportMode = input.viewportMode; phoneShellMinimum = input.minimumVisibleFontSize; return ({ boardContainerRef: { current: null }, boardViewport: { scale: options.viewportScale ?? 0.2, offsetX: 0, offsetY: 0, measured: true, scrollable: options.scrollable }, boardLayoutRef: { current: {} }, notesEpochsRef: { current: [] }, narrationSinceEpochRef: { current: [] } }); } },
    "./hooks/useBoardReading": { useBoardReading: (input: import("../../features/tutor-session/hooks/useBoardReading").BoardReadingInput) => { phoneShellReading = input; if (Object.hasOwn(options, "minimumVisibleFontSize")) input.onMinimumFontSize(options.minimumVisibleFontSize ?? null); } },
    "./hooks/useAdaptiveDrawSpeed": { useAdaptiveDrawSpeed: noop },
    "./hooks/useCommandExecution": { useCommandExecution: () => ({}) },
    "./hooks/useBoardSession": { useBoardSession: (input: { setCurrentSegmentText: (value: string) => void }) => { setters.text = input.setCurrentSegmentText; return ({ boards: [{ id: "recorded-board", title: "Saved lesson", preview: "" }], boardLoaded: true, storedTurnsRef: { current: turns }, storedTurnsCount: turns.length, inputInteracted: true, saveStatus: options.saveFailed ? { kind: "failed", message: "Try again" } : { kind: "saved" }, retrySave: noop, hasLiveTurn: false }); } },
    "./hooks/useTurnLifecycle": { useTurnLifecycle: (input: { setPhase: (value: string) => void; setIsPaused: (value: boolean) => void; onVoiceDegraded: (value: boolean) => void }) => { setters.phase = input.setPhase; setters.paused = input.setIsPaused; setters.voiceDegraded = input.onVoiceDegraded; return { pausedLessonOffer: options.pausedOffer === true }; } },
    "./hooks/useNotesChat": { useNotesChat: () => ({ messages: [] }) },
    "./hooks/useReplay": { useReplay: () => ({ replayLecture: () => false, handleReplaySpeedChange: noop }) },
    "./hooks/useLectureRewind": { useLectureRewind: () => ({ rewindActive: options.rewind === true, rewindPlaying: options.rewindPlaying === true, rewindSegmentText: rewindCaption, rewindBoardRef: { current: null }, rewindCursorState: "hidden" }) },
    "./hooks/useLectureExport": { useLectureExport: () => ({ downloadState: options.downloadError ? { kind: "error", file: "video", message: "Try the download again" } : { kind: "idle" }, lectureFileType: "mp4" }) },
    "./hooks/useLecturePlayer": { useLecturePlayer: () => ({ store, active: options.playerActive === true, revealed: options.playerRevealed !== false, playerBoardRef: { current: null }, controls: { play: noop, pause: noop, toggle: noop, seek: noop, skip: noop, setRate: noop }, view: { active: options.playerActive === true, revealed: options.playerRevealed !== false, cursorState: "hidden", segmentText: options.playerText ?? recordedCaption }, playing: options.playerPlaying === true, close: noop, halt: noop }) },
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
  const render = () => { mount.cursor = 0; return (shell as (props: TutorSessionShellProps) => React.ReactElement)({ sessionId: "recorded-board", variant: options.variant }); };
  render();
  mount.runLayoutEffects();
  const step = (next: ShellStep) => {
    if (next.text !== undefined) setters.text?.(next.text);
    if (next.phase !== undefined) setters.phase?.(next.phase);
    if (next.paused !== undefined) setters.paused?.(next.paused);
    if (next.voiceDegraded !== undefined) setters.voiceDegraded?.(next.voiceDegraded);
    // A state set during render (React's derived state pattern) renders again.
    let previous: unknown[];
    let renders = 0;
    do { previous = [...mount.slots]; lastShellTree = render(); renders++; }
    while (renders < 5 && (previous.length !== mount.slots.length || previous.some((value, index) => !Object.is(value, mount.slots[index]))));
    mount.runLayoutEffects();
    return renderToStaticMarkup(lastShellTree);
  };
  return { step };
}

/** The deck height the docked caption region reserves in rendered markup. */
function reservedHeight(html: string): number {
  const tag = html.match(/<div[^>]*aria-label="Current narration"[^>]*>/)?.[0];
  return tag && /class="[^"]*\bh-20\b/.test(tag) ? 80 : 0;
}
function findCaptionRegion(node: React.ReactNode): React.ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) { for (const child of node) { const result = findCaptionRegion(child); if (result) return result; } return null; }
  if (!React.isValidElement<Record<string, unknown>>(node)) return null;
  if (node.props["aria-label"] === "Current narration") return node;
  return findCaptionRegion(node.props.children as React.ReactNode);
}
const silentSentence = "When the voice is unavailable the student reads this whole sentence on the board, so the caption must carry every word through to its final word, including this ending marker zeta.";
const nextSilentSentence = "The next silent sentence starts with these opening words, and the student must see them first rather than from wherever the last sentence was scrolled.";

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
check("tablet-landscape", () => {
  for (const [width, height] of [[1024, 768], [1180, 820]] as const) {
    for (const fullscreen of [false, true]) {
      for (const eligibility of [{ subtitles: true }, { subtitles: false, codeOnly: true }]) {
        const options = { mobile: false, coarse: true, width, height, fullscreen, recorded: false, ...eligibility };
        const caption = captionLocation(shellMarkup(options), "we want the largest sum");
        assert.ok(caption && !caption.inDeck && caption.inPaper,
          `landscape tablet ${width}×${height}, fullscreen=${fullscreen}, subtitles=${eligibility.subtitles}: captions stay on paper rather than a phone dock`);
        for (const phase of ["idle", "planning", "speaking"] as const) {
          const html = shellMarkup({ ...options, phase });
          assert.doesNotMatch(html, /<div[^>]*aria-label="Current narration"[^>]*class="[^"]*\bh-20\b/,
            "a coarse pointer alone cannot reserve an 80 px caption deck on a tablet");
        }
      }
    }
  }
});
check("actual-viewport-budget", () => {
  withViewport(390, 600, 80, f => {
    const fitted = f.read(); near(fitted.scale, 370 / 1200);
    assert.ok(fitted.scale * 700 + 20 + 80 <= 600, "readable caption budget fits outside paper");
    near(f.resize({ deckHeight: 80 }, "deck").scale, fitted.scale);
    const rotate = f.resize({ width: 844, height: 300 });
    near(rotate.scale, (300 - 80 - 32) / 700);
  });
  // Subtitles off: the first silent sentence reserves the dock, and the voice
  // coming back, going idle and the next turn keep it, so the board refits at
  // most once (at the first failure) and never flaps.
  for (const dimensions of [{ mobile: false, width: 844, height: 390, coarse: true }, { mobile: true, width: 390, height: 600 }]) {
    const session = shellSession({ ...dimensions, subtitles: false, recorded: false });
    const sequence: Array<{ label: string; step: ShellStep }> = [
      { label: "spoken", step: { text: liveCaption, phase: "speaking", voiceDegraded: false } },
      { label: "notice on", step: { text: silentSentence, voiceDegraded: true } },
      { label: "voice back", step: { text: nextSilentSentence, voiceDegraded: false } },
      { label: "idle", step: { text: "", phase: "idle" } },
      { label: "next turn planning", step: { phase: "planning" } },
      { label: "next turn speaking", step: { text: liveCaption, phase: "speaking" } },
    ];
    const heights = sequence.map(({ step }) => reservedHeight(session.step(step)));
    withViewport(dimensions.width, dimensions.height, heights[1]!, f => {
      const initial = f.read();
      sequence.slice(1).forEach(({ label }, index) => {
        const next = f.resize({ deckHeight: heights[index + 1]! }, "deck");
        assert.ok(Math.abs(next.scale - initial.scale) < 0.00001, `${dimensions.width}x${dimensions.height} ${label}: board scale ${next.scale} stays ${initial.scale} after the first notice`);
      });
    });
    assert.deepEqual(heights, [0, 80, 80, 80, 80, 80],
      `${dimensions.width}x${dimensions.height}: subtitles off reserve nothing until a silent sentence, then keep 80 px for the session`);
  }
  withViewport(390, 206, 124, f => { near(f.read().scale, 16 / 19); assert.ok(f.read().scale * 700 > 206 - 124, "tiny paper remains readable and scrollable above caption/control deck"); }, "readable-scroll");
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
  for (const state of [
    { phase: "idle" as const, text: "" },
    { phase: "speaking" as const, text: "" },
    { phase: "idle" as const, playerActive: true, playerText: "" },
  ]) {
    shellMarkup({ mobile: true, recorded: false, ...state });
    const empty = find(lastShellTree);
    assert.ok(empty, "silent captions and End retain the reserved slot");
    const onKeyDown = empty.props.onKeyDown as typeof keyDown;
    for (const key of [" ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
      let stopped = 0, prevented = 0;
      onKeyDown?.({ key, stopPropagation: () => { stopped++; }, preventDefault: () => { prevented++; } });
      assert.equal(stopped, 0, "a formerly focused empty caption must release media shortcuts");
      assert.equal(prevented, 0);
    }
    assert.equal(empty.props.inert, true, "an empty reservation cannot retain keyboard focus");
    assert.equal(empty.props.tabIndex, undefined);
  }
});

check("session-caption-reservation", () => {
  const states = [
    { phase: "idle" as const, text: "" },
    { phase: "planning" as const, text: "" },
    { phase: "thinking" as const, text: "" },
    { phase: "speaking" as const },
    { phase: "speaking" as const, text: "" },
    { phase: "idle" as const },
    { phase: "idle" as const, playerActive: true, playerRevealed: false },
    { phase: "idle" as const, playerActive: true, playerText: "" },
  ];
  for (const fullscreen of [false, true]) {
    for (const eligibility of [{ subtitles: true }, { subtitles: false, codeOnly: true }]) {
      for (const dimensions of [{ mobile: true, width: 390, height: 844 }, { mobile: false, width: 844, height: 390, coarse: true }]) {
        const heights = states.map(state => reservedHeight(shellMarkup({ ...dimensions, ...eligibility, ...state, fullscreen, recorded: false })));
        assert.deepEqual(heights, states.map(() => 80), "caption space stays reserved through idle, planning, speech, silent cues, Stop and player End");
        withViewport(dimensions.width, dimensions.height, heights[0]!, f => {
          const initial = f.read();
          for (const deckHeight of heights) {
            const next = f.resize({ deckHeight }, "deck");
            near(next.scale, initial.scale); near(next.offsetX, initial.offsetX); near(next.offsetY, initial.offsetY);
          }
        });
        if ("codeOnly" in eligibility && eligibility.codeOnly) {
          const f = viewportFixture(dimensions.width, dimensions.height, heights[0]!, "fit", 300);
          try {
            const initial = f.read(), panelHeight = f.panelStyle.get("--board-panel-max-height");
            for (const deckHeight of heights) {
              near(f.resize({ deckHeight }, "deck").scale, initial.scale);
              assert.equal(f.panelStyle.get("--board-panel-max-height"), panelHeight,
                "silent captions and End keep the code panel's height budget");
            }
          } finally { f.close(); }
        }
      }
    }
  }
  const empty = shellMarkup({ mobile: true, phase: "idle", text: "", recorded: false });
  const tag = empty.match(/<div[^>]*aria-label="Current narration"[^>]*>/)?.[0];
  assert.ok(tag?.includes('aria-hidden="true"'), "empty reservation is hidden from assistive technology");
  assert.ok(!tag?.includes('tabindex="0"'), "empty reservation is not a keyboard stop");
  assert.equal(reservedHeight(shellMarkup({ mobile: true, subtitles: false, codeOnly: false, recorded: false })), 0,
    "disabled ordinary subtitles do not reserve unused caption space");
  assert.equal(reservedHeight(shellMarkup({ mobile: false, width: 1440, height: 900, coarse: false, recorded: false })), 0,
    "desktop caption remains its existing overlay");
});


// Actual source consumers; only DOM measurements and unrelated services are controlled.
check("phone-readability-role-floor", () => {
  for (const [width, height] of [[320, 568], [390, 600], [667, 300], [844, 390]]) {
    const f = viewportFixture(width!, height!, 80, "readable-scroll", 180);
    try {
      const initial = f.read(); near(initial.scale, 16 / 19);
      phoneViewportScales.push(initial.scale);
      for (const font of [46, 32, 27, 24, 19]) assert.ok(font * initial.scale >= 16 - 1e-8, `${font}px role at${width}x${height}`);
      near(f.resize({ height: height! - 160, keyboardInset: 160 }).scale, initial.scale);
      near(f.resize({ deckHeight: 124 }, "deck").scale, initial.scale);
      near(f.visualResize({ height: height!, keyboardInset: 0 }).scale, initial.scale);
      near(f.resize({ width: 844, height: 390 }).scale, 16 / 19);
    } finally { f.close(); }
  }
  withViewport(1440, 900, 0, f => near(f.read().scale, 1408 / 1200), "readable-scroll");
  withViewport(390, 600, 124, f => near(f.read().scale, 1), "fixed");
});

check("phone-readability-shell-pan", () => {
  const find = (node: React.ReactNode, predicate: (props: Record<string, unknown>) => boolean): React.ReactElement<Record<string, unknown>> | null => {
    if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return null; }
    if (!React.isValidElement<Record<string, unknown>>(node)) return null;
    return predicate(node.props) ? node : find(node.props.children as React.ReactNode, predicate);
  };
  for (const [width, height] of [[320, 568], [390, 844], [667, 300], [844, 390]]) for (const fullscreen of [false, true]) {
    const fixture = viewportFixture(width!, height!, 80, "readable-scroll");
    let actualScale: number;
    try { actualScale = fixture.read().scale; } finally { fixture.close(); }
    const html = shellMarkup({ mobile: width! < 768, width, height, coarse: true, fullscreen, recorded: false, viewportScale: actualScale });
    assert.ok(html.includes(`transform:scale(${actualScale})`), "actual canvas applies the measured viewport outside canonical ink");
    assert.ok(html.includes("width:1200px;height:700px"), "actual canvas retains1200x700 geometry");
    assert.equal(lastShellViewportMode, "readable-scroll", `${width}x${height},fullscreen=${fullscreen}: real shell enables readable paper`);
    const region = find(lastShellTree, props => props["data-board-scroll"] === "true");
    assert.ok(region); assert.equal(region.props.role, "region"); assert.equal(region.props.tabIndex, 0);
    const style = region.props.style as React.CSSProperties;
    assert.equal(style.overflowX, "auto"); assert.equal(style.overflowY, "auto");
    assert.ok(!find(region.props.children as React.ReactNode, props => Object.hasOwn(props, "data-board-deck")), "deck stays outside pan");
    assert.match(html, /data-board-deck[^>]*width:100%/, "transport stays at viewport width");
    const keyDown = region.props.onKeyDown as (event: Record<string, unknown>) => void;
    for (const [key, left, top] of [["ArrowRight", 40, 0], ["ArrowLeft", -40, 0], ["ArrowDown", 0, 40], ["ArrowUp", 0, -40]] as const) {
      let movement: unknown, stopped = 0, prevented = 0;
      const pane = { clientHeight: 200, scrollHeight: 600, scrollBy: (value: unknown) => { movement = value; } };
      keyDown({ key, target: pane, currentTarget: pane, stopPropagation: () => { stopped++; }, preventDefault: () => { prevented++; } });
      assert.deepEqual(movement, { left, top }); assert.equal(stopped, 1); assert.equal(prevented, 1);
    }
  }
  for (const [width, height] of [[768, 1024], [1024, 768], [1440, 900]]) {
    shellMarkup({ mobile: false, width, height, coarse: width === 768, recorded: false });
    assert.equal(lastShellViewportMode, "fit", `${width}x${height}: tablet/desktop fit unchanged`);
  }
  shellMarkup({ mobile: true, width: 390, height: 844, coarse: true, variant: "headless", recorded: false });
  assert.equal(lastShellViewportMode, "fixed", "captures retain canonical1200x700 scale");
});

check("silent-caption-whole", () => {
  // A silently taught sentence is read, not heard: the caption shows all of it.
  const sentence = silentSentence;
  assert.ok(sentence.length > 140, "the fixture sentence is longer than the live subtitle limit");
  const silent = renderToStaticMarkup(createElement(bubble as ComponentType<{ text: string; visible: boolean; placement?: string; notice?: string | null }>, { text: sentence, visible: true, placement: "below", notice: "Voice unavailable, showing the words" }));
  assert.match(silent, /ending marker zeta/, "the silent caption keeps the end of the sentence");
  assert.doesNotMatch(silent, /…/, "the silent caption is never cut at an ellipsis");
  const spoken = renderToStaticMarkup(createElement(bubble as ComponentType<{ text: string; visible: boolean; placement?: string }>, { text: sentence, visible: true, placement: "below" }));
  assert.match(spoken, /…/, "a spoken caption keeps the live subtitle limit");
});
check("caption-scroll-resets", () => {
  // A long silent sentence is scrolled by touch; the next one opens at its first word.
  for (const subtitles of [false, true]) {
    const session = shellSession({ mobile: true, subtitles, recorded: false });
    session.step({ text: silentSentence, phase: "speaking", voiceDegraded: !subtitles });
    const region = findCaptionRegion(lastShellTree);
    assert.ok(region, "the docked caption region is rendered");
    const ref = region.props.ref as { current: unknown } | undefined;
    assert.ok(ref && typeof ref === "object" && "current" in ref, "the docked caption region carries a ref");
    const element = { scrollTop: 0 };
    ref.current = element;
    element.scrollTop = 96;
    session.step({ phase: "drawing" });
    assert.equal(element.scrollTop, 96, `subtitles=${subtitles}: a rerender of the same sentence keeps the student's place`);
    session.step({ text: nextSilentSentence });
    assert.equal(element.scrollTop, 0, `subtitles=${subtitles}: a new sentence opens at its first word, not halfway down`);
  }
});
const required = ["phone-readability-role-floor", "phone-readability-shell-pan", "session-caption-reservation", "live-and-pause", "rewind-source", "player-play-and-pause", "eligibility-and-stop", "landscape-and-laptop", "tablet-landscape", "actual-viewport-budget", "focused-caption-keys", "silent-caption-whole", "caption-scroll-resets"];
assert.ok(!process.env.CAPTION_DOCK_CASE || required.includes(process.env.CAPTION_DOCK_CASE), "unknown caption gate case");
assert.ok(groups > 0, "at least one caption group ran");
assert.equal(failures.length, 0, `${failures.length}/${groups} caption groups failed: ${failures.join(", ")}`);
console.log(`Mobile caption dock: ${groups} actual consumer groups GREEN`);
