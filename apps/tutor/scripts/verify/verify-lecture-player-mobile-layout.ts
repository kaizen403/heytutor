/**
 * Exercise the rendered transport and the actual viewport hook. Browser layout
 * measurements and React reconciliation are the only controlled boundaries.
 * The literal fits below come from a 1200×700 sheet plus its documented bezel,
 * with a separate natural-height transport, rather than the hook's formula.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Children, createElement, isValidElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createLecturePlayerStore } from "../../lib/replay/lecturePlayer";
import type { LecturePlayerBarProps } from "../../features/tutor-session/components/LecturePlayerBar";
import type { BoardViewport } from "../../features/tutor-session/types";
import type { TutorSessionShellProps } from "../../features/tutor-session/TutorSessionShell";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { CodeLessonController } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import type { CodeLessonPanelProps, CodeLessonPanelVariant } from "../../features/tutor-session/components/CodeLessonPanel";
import type { BoardErrorBanner, SaveFailureBanner, SaveFailureBannerProps } from "../../features/tutor-session/components/BoardErrorBanner";

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

function viewportFixture(width: number, height: number, deckHeight: number, mode: "fit" | "fixed" = "fit", panelHeight = 0) {
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
  const hook = load(viewportFile, process.env.LECTURE_PLAYER_VIEWPORT_SOURCE ?? viewportFile, mount.react).useBoardViewport as
    (ref: { current: unknown }, mode: "fit" | "fixed") => BoardViewport;
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
function withViewport(width: number, height: number, deck: number, run: (fixture: ReturnType<typeof viewportFixture>) => void, mode: "fit" | "fixed" = "fit") {
  const fixture = viewportFixture(width, height, deck, mode);
  try { run(fixture); } finally { fixture.close(); }
}
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.00001, `expected ${expected}, received ${actual}`);
const failures: string[] = [];
let groups = 0;
function check(name: string, run: () => void) {
  if (process.env.MOBILE_LAYOUT_FOCUS && !name.includes(process.env.MOBILE_LAYOUT_FOCUS)) return;
  groups++;
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}:`, error instanceof Error ? error.message : error); }
}

const bar = load(barFile, process.env.LECTURE_PLAYER_BAR_SOURCE ?? barFile).LecturePlayerBar as ComponentType<LecturePlayerBarProps>;
function markup(placement?: "overlay" | "below", unavailable = false) {
  const store = createLecturePlayerStore({
    status: unavailable ? "unavailable" : "ended", active: true,
    positionMs: 10000, durationMs: unavailable ? 0 : 10000, loadedMs: 10000, rate: 1.25,
  });
  return renderToStaticMarkup(createElement(bar, {
    store, placement, fullscreen: { active: false, toggle() {} },
    controls: { play() {}, pause() {}, toggle() {}, seek() {}, skip() {}, setRate() {} },
  }));
}
function stripClass(html: string) {
  const tag = html.match(/<div\b[^>]*role="group"[^>]*aria-label="Lecture player"[^>]*>/)?.[0];
  assert.ok(tag, "finished lecture renders its accessible transport group");
  const classes = tag.match(/class="([^"]*)"/)?.[1];
  assert.ok(classes, "transport has a layout class");
  return classes.split(/\s+/);
}
check("actual DSA below-panel consumes the measured cap and board overlay keeps its dimensions", () => {
  const panelFile = path.join(appRoot, "features/tutor-session/components/CodeLessonPanel.tsx");
  const panel = load(panelFile, process.env.LECTURE_PLAYER_PANEL_SOURCE ?? panelFile).CodeLessonPanel as ComponentType<CodeLessonPanelProps & { variant?: CodeLessonPanelVariant }>;
  const controller = new CodeLessonController();
  controller.commit(getMockCodeLessonPlan("Explain binary search."));
  controller.revealPanel();
  const below = renderToStaticMarkup(createElement(panel, { controller, variant: "below" }));
  assert.match(below, /data-board-code-panel="below"/);
  assert.match(below, /height:var\(--board-panel-height, min\(42vh, 340px, var\(--board-panel-max-height, 340px\)\)\)/, "actual editor height participates in the viewport's bounded budget");
  const board = renderToStaticMarkup(createElement(panel, { controller, variant: "board" }));
  assert.match(board, /data-board-code-panel="board"/);
  assert.ok(!board.includes("--board-panel-max-height"), "desktop board-coordinate panel is unchanged");
});
check("below-board transport participates in flow and has no board-covering gradient", () => {
  const html = markup("below");
  const classes = stripClass(html);
  assert.ok(classes.includes("relative"), "below-board transport takes natural flow height");
  assert.ok(!classes.includes("absolute"), "below-board transport must reserve its own space");
  assert.ok(!html.includes("bg-gradient-to-t") && !html.includes("h-[108px]"), "below-board strip cannot darken the permanent ink");
  assert.match(html, /aria-label="Replay"/);
  assert.match(html, /aria-label="Lecture timeline"/);
  assert.match(html, /aria-label="Playback speed, 1\.25×"/);
  assert.match(html, /aria-label="Full screen"/);
});
check("desktop default retains its existing overlay and unavailable player takes no height", () => {
  const html = markup();
  assert.ok(stripClass(html).includes("absolute"));
  assert.ok(html.includes("bg-gradient-to-t"));
  assert.equal(markup("below", true), "");
});

/**
 * Render the actual shell with real React SSR. Data/media/session hooks are
 * controlled boundaries; shell decisions and the rendered LecturePlayerBar
 * remain production code. In particular, no reconstructed deck JSX or source
 * string assertions stand in for the consumer that chooses its width.
 */
function shellMarkup(options: {
  mobile: boolean; coarse?: boolean; recorded?: boolean; playerActive?: boolean;
  fullscreen?: boolean; saveFailed?: boolean; codeOnly?: boolean;
  pausedOffer?: boolean; downloadError?: boolean; rewind?: boolean;
  retrySave?: () => void; captureSaveRetry?: (retry: () => void) => void;
}) {
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
  const store = createLecturePlayerStore({ status: "ended", active: true, positionMs: 10000, durationMs: 10000, loadedMs: 10000, rate: 1.25 });
  const overrides: Record<string, unknown> = {
    "next/navigation": { useRouter: () => ({ push: noop }) },
    "@/features/app-shell/AppShell": { AppShell: children },
    "@/features/app-shell/useAccountMe": { useAccountMe: () => null, toShellProfile: () => undefined },
    "@/lib/client/useMediaQuery": { useIsMobile: () => options.mobile, useIsCompactNav: () => options.mobile, useMediaQuery: () => options.coarse === true },
    "@/lib/client/useVisualViewportInset": { useVisualViewportInset: () => 0 },
    "@/lib/client/useLockWindowScrollOnFocus": { useLockWindowScrollOnFocus: noop },
    "./components/SettingsDrawer": { ...requireApp(path.join(appRoot, "lib/account/lessonSettings.ts")), SettingsDrawer: leaf },
    "./lib/code-lesson/codeLessonController": { CodeLessonController: class { getActivePlan() { return options.codeOnly ? {} : null; } } },
    "./hooks/useCancelControl": { useCancelControl: () => ({}) },
    "./hooks/useBoardLayout": { useBoardLayout: () => ({ boardContainerRef: { current: null }, boardViewport: { scale: 0.2, offsetX: 0, offsetY: 0, measured: true }, boardLayoutRef: { current: {} }, notesEpochsRef: { current: [] }, narrationSinceEpochRef: { current: [] } }) },
    "./hooks/useAdaptiveDrawSpeed": { useAdaptiveDrawSpeed: noop },
    "./hooks/useCommandExecution": { useCommandExecution: () => ({}) },
    "./hooks/useBoardSession": { useBoardSession: () => ({ boards: [{ id: "recorded-board", title: "Saved lesson", preview: "" }], boardLoaded: true, storedTurnsRef: { current: turns }, storedTurnsCount: turns.length, inputInteracted: true, saveStatus: options.saveFailed ? { kind: "failed", message: "Try again" } : { kind: "saved" }, retrySave: options.retrySave ?? noop, hasLiveTurn: false }) },
    "./hooks/useTurnLifecycle": { useTurnLifecycle: () => ({ pausedLessonOffer: options.pausedOffer === true }) },
    "./hooks/useNotesChat": { useNotesChat: () => ({ messages: [] }) },
    "./hooks/useReplay": { useReplay: () => ({ replayLecture: () => false, handleReplaySpeedChange: noop }) },
    "./hooks/useLectureRewind": { useLectureRewind: () => ({ rewindActive: options.rewind === true }) },
    "./hooks/useLectureExport": { useLectureExport: () => ({ downloadState: options.downloadError ? { kind: "error", file: "video", message: "Try the download again" } : { kind: "idle" }, lectureFileType: "mp4" }) },
    "./hooks/useLecturePlayer": { useLecturePlayer: () => ({ store, active: options.playerActive === true, controls: { play: noop, pause: noop, toggle: noop, seek: noop, skip: noop, setRate: noop }, view: {}, close: noop, halt: noop }) },
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
  const bannerFile = path.join(appRoot, "features/tutor-session/components/BoardErrorBanner.tsx");
  const banners = load(bannerFile, bannerFile);
  const saveBanner = banners.SaveFailureBanner as typeof SaveFailureBanner;
  const errorBanner = banners.BoardErrorBanner as typeof BoardErrorBanner;
  overrides["./components/BoardErrorBanner"] = {
    ...banners,
    SaveFailureBanner: (props: SaveFailureBannerProps) => {
      // Resolve the actual two banner components, retaining the real button
      // tree and its handler rather than substituting a recovery marker.
      const alert = errorBanner(saveBanner(props).props);
      const retry = Children.toArray(alert.props.children).find((child) =>
        isValidElement<{ children?: unknown; onClick?: () => void }>(child) &&
        child.type === "button" && child.props.children === "Try again",
      );
      assert.ok(isValidElement<{ onClick: () => void }>(retry), "actual save banner renders its retry button");
      options.captureSaveRetry?.(retry.props.onClick);
      return alert;
    },
  };
  overrides["./components/LecturePlayerBar"] = { LecturePlayerBar: bar };
  overrides["./components/SessionBoardCanvas"] = { SessionBoardCanvas: ({ showPlayerBar, saveFailure }: { showPlayerBar: boolean; saveFailure?: { message: string; onRetrySave: () => void } | null }) => createElement("i", {
    "data-canvas-player-bar": String(showPlayerBar),
    "data-save-failure": saveFailure?.message,
    "data-banner-retry": String(typeof saveFailure?.onRetrySave === "function"),
  }) };
  overrides["./components/SessionHeader"] = { SessionHeader: ({ chromeInert, chromeHidden, saveStatus, onRetrySave }: { chromeInert: boolean; chromeHidden: boolean; saveStatus?: { kind: string }; onRetrySave?: () => void }) => createElement("header", {
    "data-header-inert": String(chromeInert), "data-header-hidden": String(chromeHidden),
    "data-save-status": saveStatus?.kind, "data-header-retry": String(typeof onRetrySave === "function"),
  }) };
  overrides["./components/SessionInputChrome"] = { SessionInputChrome: () => createElement("textarea", { defaultValue: "Retained composer" }) };
  const shell = load(shellFile, process.env.LECTURE_PLAYER_SHELL_SOURCE ?? shellFile, undefined, overrides).TutorSessionShell as ComponentType<TutorSessionShellProps>;
  return renderToStaticMarkup(createElement(shell, { sessionId: "recorded-board" }));
}
function shellWidths(html: string) {
  const stage = html.match(/<div\b[^>]*class="[^"]*\bwb-stage\b[^>]*>/)?.[0];
  const deck = html.match(/<div\b[^>]*\bdata-board-deck(?:="[^"]*")?[^>]*>/)?.[0];
  assert.ok(stage && deck, "actual shell renders its measured stage and persistent deck");
  return { fullStage: /class="[^"]*\bw-full\b/.test(stage), fullDeck: /style="[^"]*width:100%/.test(deck) };
}
check("actual shell gives finished phone and coarse landscape transport the whole container width", () => {
  for (const options of [{ mobile: true }, { mobile: false, coarse: true }, { mobile: true, recorded: false, playerActive: true }]) {
    const html = shellMarkup(options);
    assert.deepEqual(shellWidths(html), { fullStage: true, fullDeck: true }, "both stage and dock must follow the container when fitted paper is narrow");
    assert.ok(stripClass(html).includes("relative"));
    assert.match(html, /data-canvas-player-bar="false"/, "the paper cannot also render a duplicate transport");
  }
});
check("actual shell preserves desktop width and gives phone decks their natural container width without a finished dock", () => {
  for (const options of [{ mobile: false }, { mobile: false, recorded: false, codeOnly: true }, { mobile: true, recorded: false }, { mobile: true, recorded: false, codeOnly: true }]) {
    const html = shellMarkup(options);
    assert.deepEqual(shellWidths(html), { fullStage: options.mobile, fullDeck: options.mobile });
    assert.equal(html.includes('data-board-scroll="true"'), options.mobile, "phone ink pans independently of the natural-width deck; desktop keeps its fit");
    assert.ok(!html.includes('aria-label="Lecture player"'), "there is no docked transport in this state");
  }
});
check("actual fullscreen shell leaves a save failure recoverable and keeps the composer mounted", () => {
  const finished = shellMarkup({ mobile: true, fullscreen: true });
  assert.match(finished, /data-header-inert="true"/);
  assert.match(finished, /<footer[^>]*inert=""[^>]*aria-hidden="true"/);
  assert.match(finished, /<textarea>Retained composer<\/textarea>/);
  let retries = 0;
  let retrySave: (() => void) | undefined;
  const failed = shellMarkup({ mobile: true, fullscreen: true, saveFailed: true,
    retrySave: () => { retries++; }, captureSaveRetry: (retry) => { retrySave = retry; } });
  assert.match(failed, /data-header-inert="false"/);
  assert.match(failed, /data-header-hidden="false"/, "the student can see the failed-save header");
  assert.match(failed, /data-save-status="failed"[^>]*data-header-retry="true"/, "the header retains the save retry action");
  assert.match(failed, /role="alert"/, "the actual save recovery banner remains outside the scaled phone paper");
  assert.match(failed, /<button[^>]*type="button"[^>]*>Try again<\/button>/);
  assert.ok(!failed.includes('data-save-failure="Try again"'), "the scaled canvas does not own the phone recovery banner");
  assert.ok(retrySave, "the actual save recovery button retains its handler");
  retrySave();
  assert.equal(retries, 1, "the actual button calls the session's save retry once");
  assert.match(failed, /<footer[^>]*data-hidden="true"[^>]*inert=""[^>]*aria-hidden="true"/, "save failure alone must not uncover the composer over the dock");
  assert.match(failed, /<textarea>Retained composer<\/textarea>/);
  for (const pin of [{ pausedOffer: true }, { downloadError: true }, { rewind: true }]) {
    const interaction = shellMarkup({ mobile: true, fullscreen: true, ...pin });
    assert.match(interaction, /data-header-inert="false"/);
    assert.match(interaction, /data-header-hidden="false"/);
    assert.ok(!interaction.match(/<footer[^>]*(?:inert=""|data-hidden="true")/), "other interactions retain visible, accessible composer and header");
    assert.match(interaction, /<textarea>Retained composer<\/textarea>/);
  }
});
check("desktop fit without transport remains unchanged", () => withViewport(1200, 600, 0, (f) => {
  const result = f.read();
  near(result.scale, 0.8114285714);
  assert.equal(result.measured, true);
  assert.deepEqual([result.offsetX, result.offsetY], [0, 0]);
}));
check("short portrait reserves the transport outside the fixed 1200x700 paper", () => withViewport(390, 220, 68, (f) => {
  near(f.read().scale, 0.1885714286);
}));
check("landscape reserves transport and desktop bezel without clipping the paper", () => withViewport(844, 390, 68, (f) => {
  near(f.read().scale, 0.4142857143);
}));
check("stable empty deck is observed and refits when completed controls appear", () => withViewport(844, 390, 0, (f) => {
  near(f.read().scale, 0.5114285714);
  assert.ok(f.observed.has(f.deck), "observe the stable deck, not only its unchanged parent");
  near(f.resize({ deckHeight: 68 }, "deck").scale, 0.4142857143);
}));
check("keyboard-shrunken box preserves scale across dock appearance and removal", () => withViewport(390, 450, 82, (f) => {
  const accepted = f.read().scale;
  near(f.resize({ height: 200, keyboardInset: 250 }).scale, accepted);
  near(f.resize({ deckHeight: 0 }, "deck").scale, accepted);
  near(f.resize({ deckHeight: 82 }, "deck").scale, accepted);
  near(f.resize({ keyboardInset: 0 }).scale, 0.14);
  near(f.resize({ height: 450 }).scale, accepted);
}));
check("visualViewport-only keyboard close refits a dock changed under the lock", () => withViewport(844, 390, 0, (f) => {
  const accepted = f.read().scale;
  near(accepted, 0.5114285714);
  near(f.resize({ height: 250, keyboardInset: 140 }).scale, accepted);
  near(f.resize({ deckHeight: 82 }, "deck").scale, accepted);
  // The window and natural-size dock stay put; only the visual viewport
  // delivers keyboard close. The restored 390px column leaves 276px paper.
  const closed = f.visualResize({ height: 390, keyboardInset: 0 });
  near(closed.scale, 0.3942857143);
  assert.notEqual(closed.scale, accepted, "keyboard close must apply the dock's actual post-keyboard fit without observer delivery");
  assert.equal(f.visualResizeListenerCount, 1);
}));
check("keyboard lock holds when the deck shrinks more than the keyboard inset", () => withViewport(390, 450, 300, (f) => {
  const accepted = f.read().scale;
  near(accepted, 0.1857142857);
  near(f.resize({ height: 350, keyboardInset: 100 }).scale, accepted);
  // Removing 300px of deck after a 100px keyboard drop increases the usable
  // height. A later negative-height-only lock cannot preserve this fit.
  near(f.resize({ deckHeight: 0 }, "deck").scale, accepted);
  near(f.resize({ height: 450, keyboardInset: 0 }).scale, 0.3083333333);
}));
check("DSA panel and dock retain paper and fit their actual phone container", () => {
  for (const [width, height, panel] of [[390, 588, 340], [375, 411, 280.125]] as const) {
    const f = viewportFixture(width, height, 82, "fit", panel);
    try {
      const result = f.read();
      const paperHeight = result.scale * 700;
      assert.ok(paperHeight >= Math.min((width - 20) / 1200 * 700, (height - 20) * 0.45) - 0.01, "paper retains its width-fit height or45% of its available column height");
      assert.ok(paperHeight + 20 + f.deck.getBoundingClientRect().height <= height + 0.01, "the real capped panel and transport fit below the paper");
      assert.ok(f.panel!.getBoundingClientRect().height >= 80, "code remains a scrollable visible editor, not a collapsed panel");
    } finally { f.close(); }
  }
});
check("DSA cap follows the shell phone breakpoint through667px landscape", () => {
  const f = viewportFixture(667, 300, 82, "fit", 157.5);
  try {
    const result = f.read();
    assert.ok(f.panelStyle.has("--board-panel-max-height"), "641-767px below-panel must not use its uncapped fallback");
    assert.ok(result.scale * 700 >= (300 - 32) * 0.45 - 0.01);
    assert.ok(result.scale * 700 + 32 + f.deck.getBoundingClientRect().height <= 300.01);
  } finally { f.close(); }
});
check("DSA reveal and finished dock cannot bypass a genuine keyboard height drop", () => {
  const f = viewportFixture(390, 450, 0, "fit", 340);
  try {
    const accepted = f.read().scale;

    near(f.resize({ height: 180, keyboardInset: 270 }).scale, accepted);
    near(f.resize({ deckHeight: 82 }, "deck").scale, accepted);
    assert.equal(f.panelStyle.get("--board-panel-display"), "none", "panel defers when keyboard leaves no usable editor room, without changing paper scale");
    f.resize({ height: 450, keyboardInset: 0 });
    assert.ok(f.panel!.getBoundingClientRect().height + f.read().scale * 700 + 82 + 12 + 20 <= 450.01);
    const rotated = f.resize({ width: 844, height: 390 });
    assert.ok(rotated.measured && rotated.scale !== accepted, "a real rotation still refits");
  } finally { f.close(); }
});
check("first DSA panel reveal with keyboard already open receives a bounded budget", () => {
  const f = viewportFixture(390, 450, 82, "fit", 340);
  try {
    f.box.panelShown = false;
    const accepted = f.read().scale;
    near(f.resize({ height: 200, keyboardInset: 250 }).scale, accepted);
    near(f.resize({ panelShown: true }, "deck").scale, accepted);
    assert.ok(f.panelStyle.has("--board-panel-max-height"), "new panel cannot use its uncapped fallback while keyboard lock returns");
    assert.equal(f.panelStyle.get("--board-panel-display"), "none");
    f.resize({ height: 450, keyboardInset: 0 });
    assert.equal(f.panelStyle.get("--board-panel-display"), "flex", "keyboard close restores code without remounting the controller");
    assert.ok(f.panel!.getBoundingClientRect().height >= 80);
  } finally { f.close(); }
});
check("keyboard lock releases on an actual width rotation", () => withViewport(390, 450, 82, (f) => {
  const accepted = f.read().scale;
  near(f.resize({ height: 200, keyboardInset: 250 }).scale, accepted);
  const rotated = f.resize({ width: 844, height: 390, keyboardInset: 150 });
  near(rotated.scale, 0.3942857143);
  assert.notEqual(rotated.scale, accepted);
}));
check("keyboard-only resize and tiny URL-bar jitter preserve lecture scale", () => withViewport(844, 390, 68, (f) => {
  const initial = f.read().scale;
  near(f.resize({ height: 386 }).scale, initial);
  near(f.resize({ height: 290, keyboardInset: 150 }).scale, initial);
}));
check("width-limited deck appearance cannot disguise a later keyboard-only height drop", () => withViewport(390, 600, 0, (f) => {
  near(f.read().scale, 0.3083333333);
  near(f.resize({ deckHeight: 68 }, "deck").scale, 0.3083333333);
  near(f.resize({ height: 220, keyboardInset: 380 }).scale, 0.3083333333);
  near(f.resize({ width: 844, height: 390, keyboardInset: 0 }).scale, 0.4142857143);
}));
check("phone rotation accepts the new width and sheet fit", () => withViewport(390, 844, 68, (f) => {
  near(f.read().scale, 0.3083333333);
  near(f.resize({ width: 844, height: 390 }).scale, 0.4142857143);
}));
check("fixed board mode does not install adaptive observers", () => withViewport(390, 220, 68, (f) => {
  assert.deepEqual(f.read(), { scale: 1, offsetX: 0, offsetY: 0, measured: true });
  assert.equal(f.observed.size, 0);
  assert.equal(f.mediaListenerCount, 0);
  assert.equal(f.visualResizeListenerCount, 0);
}, "fixed"));
check("unmount disconnects both deck resize and media listeners", () => withViewport(844, 390, 68, (f) => {
  const initial = f.read();
  f.unmount();
  assert.equal(f.disconnected, true);
  assert.equal(f.observed.size, 0);
  assert.equal(f.mediaListenerCount, 0);
  assert.equal(f.visualResizeListenerCount, 0);
  assert.deepEqual(f.resize({ deckHeight: 112 }, "deck"), initial);
  assert.deepEqual(f.visualResize({ height: 490 }), initial, "unmounted viewport ignores later visual resize events");
}));
assert.ok(groups > 0, "at least one actual consumer group ran");
assert.equal(failures.length, 0, `${failures.length}/${groups} mobile layout groups failed: ${failures.join(", ")}`);
console.log(`Lecture player mobile layout: ${groups} groups GREEN`);
