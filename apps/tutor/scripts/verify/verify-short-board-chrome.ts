/** Actual Shell and player render; service/data hooks and unrelated children are controlled. */
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
import type { TutorSessionShellProps } from "../../features/tutor-session/TutorSessionShell";
import type { StoredTurn } from "../../lib/boards/boardsClient";
const appRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(
  new URL("../../package.json", import.meta.url),
);
const barFile = path.join(
  appRoot,
  "features/tutor-session/components/LecturePlayerBar.tsx",
);
function load(
  file: string,
  source: string,
  react?: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)(
    (specifier: string) => {
      if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
      if (specifier === "react" && react) return react;
      if (specifier.startsWith("@/"))
        return requireApp(path.join(appRoot, specifier.slice(2)));
      if (specifier.startsWith("."))
        return requireApp(path.resolve(path.dirname(file), specifier));
      return requireApp(specifier);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const bar = load(barFile, process.env.SHORT_BAR_SOURCE ?? barFile)
  .LecturePlayerBar as ComponentType<LecturePlayerBarProps>;
class ShellMount {
  slots: unknown[] = [];
  cursor = 0;
  react = {
    ...React,
    useState: <T>(initial: T | (() => T)) => {
      const index = this.cursor++;
      if (!(index in this.slots))
        this.slots[index] =
          typeof initial === "function" ? (initial as () => T)() : initial;
      return [
        this.slots[index] as T,
        (value: T | ((previous: T) => T)) => {
          this.slots[index] =
            typeof value === "function"
              ? (value as (previous: T) => T)(this.slots[index] as T)
              : value;
        },
      ] as const;
    },
    useRef: <T>(initial: T) =>
      this.react.useState(() => ({ current: initial }))[0],
    useMemo: <T>(make: () => T) => make(),
    useCallback: <T>(fn: T) => fn,
    useEffect: () => {},
    useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  };
}
function renderShell(
  options: {
    reviewing?: boolean;
    veryShort?: boolean;
    short?: boolean;
    keyboardInset?: number;
    mobile: boolean;
    coarse?: boolean;
    recorded?: boolean;
    playerActive?: boolean;
    fullscreen?: boolean;
    saveFailed?: boolean;
    codeOnly?: boolean;
    pausedOffer?: boolean;
    downloadError?: boolean;
    rewind?: boolean;
  },
  mount?: ShellMount,
): string | React.ReactElement {
  const noop = () => {};
  const leaf = () => null;
  const turns: StoredTurn[] =
    options.recorded === false
      ? []
      : [
          {
            id: "recorded-turn",
            orderIndex: 0,
            question: "A recorded lesson",
            rawResponse: "",
            speedMultiplier: 1.25,
            traceId: null,
            sceneDocument: null,
            sceneEngineVersion: null,
            validationReport: null,
            visualStatus: "text_only",
            sceneArtifacts: null,
            status: "complete",
            segments: [
              {
                id: "recorded-segment",
                orderIndex: 0,
                narration: "The lesson is complete.",
                spokenText: "The lesson is complete.",
                command: null,
                audioUrl: "local-recorded.wav",
                durationMs: 10000,
                timings: null,
              },
            ],
          },
        ];
  const store = createLecturePlayerStore({
    status: "ended",
    active: true,
    positionMs: 10000,
    durationMs: 10000,
    loadedMs: 10000,
    rate: 1.25,
  });
  const overrides: Record<string, unknown> = {
    "next/navigation": { useRouter: () => ({ push: noop }) },
    "@/features/app-shell/AppShell": {
      AppShell: ({
        children,
        sidebarCollapsed,
      }: {
        children?: React.ReactNode;
        sidebarCollapsed?: boolean;
      }) =>
        createElement(
          "section",
          { "data-sidebar-collapsed": String(sidebarCollapsed) },
          children,
        ),
    },
    "@/features/app-shell/useAccountMe": {
      useAccountMe: () => null,
      toShellProfile: () => undefined,
    },
    "@/lib/client/useMediaQuery": {
      useIsMobile: () => options.mobile,
      useIsCompactNav: () => options.mobile,
      useMediaQuery: (query: string) =>
        query.includes("300px")
          ? options.veryShort === true
          : query.includes("max-height")
            ? options.short === true
            : options.coarse === true,
    },
    "@/lib/client/useVisualViewportInset": {
      useVisualViewportInset: () => options.keyboardInset ?? 0,
    },
    "@/lib/client/useLockWindowScrollOnFocus": {
      useLockWindowScrollOnFocus: noop,
    },
    "./components/SettingsDrawer": {
      ...requireApp(path.join(appRoot, "lib/account/lessonSettings.ts")),
      SettingsDrawer: leaf,
    },
    "./lib/code-lesson/codeLessonController": {
      CodeLessonController: class {
        getActivePlan() {
          return options.codeOnly ? {} : null;
        }
      },
    },
    "./hooks/useCancelControl": { useCancelControl: () => ({}) },
    "./hooks/useBoardLayout": {
      useBoardLayout: () => ({
        boardContainerRef: { current: null },
        boardViewport: { scale: 0.2, offsetX: 0, offsetY: 0, measured: true },
        boardLayoutRef: { current: {} },
        notesEpochsRef: { current: [] },
        narrationSinceEpochRef: { current: [] },
      }),
    },
    "./hooks/useAdaptiveDrawSpeed": { useAdaptiveDrawSpeed: noop },
    "./hooks/useCommandExecution": { useCommandExecution: () => ({}) },
    "./hooks/useBoardSession": {
      useBoardSession: () => ({
        boards: [{ id: "recorded-board", title: "Saved lesson", preview: "" }],
        boardLoaded: true,
        storedTurnsRef: { current: turns },
        storedTurnsCount: turns.length,
        inputInteracted: true,
        saveStatus: options.saveFailed
          ? { kind: "failed", message: "Try again" }
          : { kind: "saved" },
        retrySave: noop,
        hasLiveTurn: false,
      }),
    },
    "./hooks/useTurnLifecycle": {
      useTurnLifecycle: () => ({
        pausedLessonOffer: options.pausedOffer === true,
      }),
    },
    "./hooks/useNotesChat": { useNotesChat: () => ({ messages: [] }) },
    "./hooks/useReplay": {
      useReplay: () => ({
        replayLecture: () => false,
        handleReplaySpeedChange: noop,
      }),
    },
    "./hooks/useLectureRewind": {
      useLectureRewind: () => ({ rewindActive: options.rewind === true }),
    },
    "./hooks/useLectureExport": {
      useLectureExport: () => ({
        downloadState: options.downloadError
          ? { kind: "error", file: "video", message: "Try the download again" }
          : { kind: "idle" },
        lectureFileType: "mp4",
      }),
    },
    "./hooks/useLecturePlayer": {
      useLecturePlayer: () => ({
        store,
        reviewingStoredPage: options.reviewing === true,
        active: options.playerActive === true,
        controls: {
          play: noop,
          pause: noop,
          toggle: noop,
          seek: noop,
          skip: noop,
          setRate: noop,
        },
        view: {},
        close: noop,
        halt: noop,
      }),
    },
    "./hooks/useBoardMarking": {
      useBoardMarking: () => ({ armed: false, marks: [] }),
    },
    "./hooks/useLecturePageHalt": { useLecturePageHalt: noop },
    "./hooks/useBoardFullscreen": {
      useBoardFullscreen: () => ({
        active: options.fullscreen === true,
        toggle: noop,
      }),
      useSessionChromeHidden: () => false,
    },
  };
  const shellFile = path.join(
    appRoot,
    "features/tutor-session/TutorSessionShell.tsx",
  );
  // Replace unrelated child components, never the subject transport or shell.
  const source = ts.createSourceFile(
    shellFile,
    readFileSync(shellFile, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const specifier = statement.moduleSpecifier.text;
    if (
      Object.hasOwn(overrides, specifier) ||
      !/(\/components\/|\/CanvasLanding$|\/LandingPixelField$|\/OutOfCreditsDialog$|\/ui\/)/.test(
        specifier,
      )
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    overrides[specifier] = Object.fromEntries(
      bindings.elements
        .filter((binding) => !binding.isTypeOnly)
        .map((binding) => [
          binding.propertyName?.text ?? binding.name.text,
          leaf,
        ]),
    );
  }
  overrides["./components/CodeLessonPanel"] = {
    CodeLessonPanel: () =>
      createElement("div", { "data-actual-panel-boundary": true }),
  };
  overrides["./components/BoardErrorBanner"] = load(
    path.join(
      appRoot,
      "features/tutor-session/components/BoardErrorBanner.tsx",
    ),
    path.join(
      appRoot,
      "features/tutor-session/components/BoardErrorBanner.tsx",
    ),
  );
  overrides["./components/LecturePlayerBar"] = { LecturePlayerBar: bar };
  overrides["./components/SessionBoardCanvas"] = {
    SessionBoardCanvas: ({
      showPlayerBar,
      saveFailure,
    }: {
      showPlayerBar: boolean;
      saveFailure?: { message: string; onRetrySave: () => void } | null;
    }) =>
      createElement("i", {
        "data-canvas-player-bar": String(showPlayerBar),
        "data-save-failure": saveFailure?.message,
        "data-banner-retry": String(
          typeof saveFailure?.onRetrySave === "function",
        ),
      }),
  };
  overrides["./components/SessionHeader"] = {
    SessionHeader: ({
      chromeInert,
      chromeHidden,
      saveStatus,
      onRetrySave,
    }: {
      chromeInert: boolean;
      chromeHidden: boolean;
      saveStatus?: { kind: string };
      onRetrySave?: () => void;
    }) =>
      createElement("header", {
        "data-header-inert": String(chromeInert),
        "data-header-hidden": String(chromeHidden),
        "data-save-status": saveStatus?.kind,
        "data-header-retry": String(typeof onRetrySave === "function"),
      }),
  };
  overrides["./components/SessionInputChrome"] = {
    SessionInputChrome: () =>
      createElement("textarea", { defaultValue: "Retained composer" }),
  };
  const shell = load(
    shellFile,
    process.env.SHORT_SHELL_SOURCE ?? shellFile,
    mount?.react,
    overrides,
  ).TutorSessionShell as ComponentType<TutorSessionShellProps>;
  if (mount) {
    mount.cursor = 0;
    return (shell as (props: TutorSessionShellProps) => React.ReactElement)({
      sessionId: "recorded-board",
    });
  }
  return renderToStaticMarkup(
    createElement(shell, { sessionId: "recorded-board" }),
  );
}

function shellMarkup(options: Parameters<typeof renderShell>[0]): string {
  return renderShell(options) as string;
}
function find(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean,
): React.ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!React.isValidElement<Record<string, unknown>>(node)) return null;
  if (predicate(node)) return node;
  return (
    find(node.props.children as React.ReactNode, predicate) ??
    find(node.props.auxiliaryControls as React.ReactNode, predicate)
  );
}

const short = shellMarkup({
  mobile: true,
  coarse: true,
  short: true,
  veryShort: true,
});
assert.match(
  short,
  /data-short-board-chrome="true"/,
  "actual short-screen shell selects compact chrome",
);
assert.match(
  short,
  /data-compact-transport/,
  "actual player shares one compact control row",
);
assert.match(short, /aria-label="Board controls"/);
assert.match(short, /aria-label="Question composer"/);
assert.match(
  short,
  /data-short-header[^>]*inert=""[^>]*aria-hidden="true"[^>]*display:none/,
  "closed header remains mounted and cannot steal input",
);
assert.match(
  short,
  /<footer[^>]*inert=""[^>]*aria-hidden="true"[^>]*display:none/,
  "closed composer remains mounted outside layout",
);
assert.match(short, /<textarea>Retained composer<\/textarea>/);
assert.match(
  short,
  /data-sidebar-collapsed="true"/,
  "regular landscape gives rail width back to paper",
);
console.log(
  "PASS actual compact Shell/transport retain mounted composer and header with named toggles in one row",
);
const regular = shellMarkup({ mobile: false, short: false });
assert.ok(
  !regular.includes("data-compact-transport"),
  "desktop retains ordinary transport",
);
assert.ok(!regular.includes('data-short-board-chrome="true"'));
assert.match(regular, /data-sidebar-collapsed="false"/);
const keyboard = shellMarkup({
  mobile: true,
  coarse: true,
  short: false,
  keyboardInset: 250,
});
assert.ok(
  !keyboard.includes('data-short-board-chrome="true"'),
  "portrait visual keyboard shrink is not a short regular viewport",
);
const failure = shellMarkup({
  mobile: true,
  coarse: true,
  short: true,
  saveFailed: true,
});
assert.match(
  failure,
  /data-save-failure="Try again"[^>]*data-banner-retry="true"/,
  "short chrome keeps the actual save recovery boundary",
);
assert.match(failure, /<textarea>Retained composer<\/textarea>/);
const fullscreen = shellMarkup({
  mobile: true,
  coarse: true,
  short: true,
  fullscreen: true,
});
assert.ok(
  !fullscreen.includes('data-short-board-chrome="true"'),
  "existing fullscreen owns its own chrome",
);
console.log(
  "PASS desktop, portrait keyboard, fullscreen and save-error ownership fences",
);

assert.match(
  short,
  /data-board-scroll="true"[^>]*role="region"[^>]*aria-label="Whiteboard. Scroll to read all saved work."[^>]*tabindex="0"/,
  "very short regular viewport has named keyboard/touch scroll region at readable width",
);
const pageReview = shellMarkup({ mobile: false, reviewing: true });
assert.match(
  pageReview,
  /data-canvas-player-bar="false"/,
  "saved page transport must not cover stored answer ink",
);
assert.match(pageReview, /data-board-deck[^>]*width:100%/);
console.log(
  "PASS actual stored-page review docks transport and very-short paper has an accessible scroll viewport",
);

const panFailure = shellMarkup({
  mobile: true,
  coarse: true,
  short: true,
  veryShort: true,
  saveFailed: true,
});
assert.match(
  panFailure,
  /role="alert"/,
  "actual failure consumer remains outside scaled paper",
);
assert.match(panFailure, /Fixture save|Try again/);
assert.ok(
  !panFailure.includes('data-save-failure="Try again"'),
  "scroll paper does not own natural-scale retry banner",
);
const mounted = new ShellMount();
const mountOptions = {
  mobile: true,
  coarse: true,
  short: true,
  veryShort: true,
  codeOnly: true,
};
let mountedTree = renderShell(mountOptions, mounted) as React.ReactElement;
const codeToggle = find(
  mountedTree,
  (node) => node.type === "button" && node.props["aria-label"] === "Code panel",
);
assert.ok(
  codeToggle,
  "actual DSA consumer has a named short-screen editor toggle",
);
const panelClosed = find(
  mountedTree,
  (node) => node.props["data-short-code-panel"] === "true",
);
assert.equal((panelClosed?.props.style as React.CSSProperties).display, "none");
(codeToggle.props.onClick as (event: { currentTarget: unknown }) => void)({ currentTarget: {} });
mountedTree = renderShell(mountOptions, mounted) as React.ReactElement;
const panelOpened = find(
  mountedTree,
  (node) => node.props["data-short-code-panel"] === "true",
);
assert.equal(
  (panelOpened?.props.style as React.CSSProperties).display,
  "block",
);
assert.equal(
  panelOpened?.props.inert,
  undefined,
  "actual presentation toggle exposes the retained editor",
);
const composerToggle = find(
  mountedTree,
  (node) =>
    node.type === "button" && node.props["aria-label"] === "Question composer",
);
(composerToggle?.props.onClick as (event: { currentTarget: unknown }) => void)({ currentTarget: {} });
mountedTree = renderShell(mountOptions, mounted) as React.ReactElement;
const panelAfter = find(
  mountedTree,
  (node) => node.props["data-short-code-panel"] === "true",
);
assert.equal(
  (panelAfter?.props.style as React.CSSProperties).display,
  "none",
  "only one overlay uses the short paper at a time",
);
const scrollPane = find(
  mountedTree,
  (node) => node.props["data-board-scroll"] === "true",
);
assert.ok(scrollPane);
const moves: Array<{ left?: number; top?: number }> = [];
const pane = {
  clientHeight: 152,
  scrollHeight: 350,
  scrollBy: (move: { left?: number; top?: number }) => moves.push(move),
  scrollTo: (move: { left?: number; top?: number }) => moves.push(move),
};
let prevented = 0,
  stopped = 0;
const keyboardEvent = (key: string, target: unknown = pane) => ({
  key,
  target,
  currentTarget: pane,
  preventDefault: () => prevented++,
  stopPropagation: () => stopped++,
});
const keyHandler = scrollPane.props.onKeyDown as (
  event: ReturnType<typeof keyboardEvent>,
) => void;
keyHandler(keyboardEvent("ArrowDown"));
keyHandler(keyboardEvent("End"));
keyHandler(keyboardEvent("ArrowDown", {}));
assert.deepEqual(
  moves,
  [{ left: 0, top: 40 }, { top: 350 }],
  "mounted actual paper handles keyboard pan and End without hijacking descendant inputs",
);
assert.equal(prevented, 2);
assert.equal(stopped, 2);
console.log(
  "PASS mounted actual short editor toggles, natural-scale failure consumer and keyboard pan ownership",
);

// The real viewport hook owns scale; DOM measurement and React state are the
// controlled boundaries. Width mode is used only inside the scroll region.
const globals = new Map<string, PropertyDescriptor | undefined>();
let value = { scale: 0.1, offsetX: 0, offsetY: 0, measured: false };
let effectMounted = false;
let cleanup: (() => void) | undefined;
const deck = {
  getBoundingClientRect: () => ({ height: 44 }),
  querySelector: () => null,
  style: { removeProperty() {} },
};
const container = {
  getBoundingClientRect: () => ({ width: 378, height: 206 }),
  querySelector: () => deck,
};
for (const [key, boundary] of Object.entries({
  window: {
    innerWidth: 390,
    innerHeight: 220,
    visualViewport: {
      offsetTop: 0,
      height: 220,
      addEventListener() {},
      removeEventListener() {},
    },
    matchMedia: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
    setTimeout: () => 0,
    clearTimeout() {},
  },
  requestAnimationFrame: (): number => 0,
  cancelAnimationFrame: () => {},
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
})) {
  globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {
    value: boundary,
    configurable: true,
  });
}
try {
  const viewportFile = path.join(
    appRoot,
    "features/tutor-session/hooks/useBoardViewport.ts",
  );
  const viewport = load(
    viewportFile,
    process.env.SHORT_VIEWPORT_SOURCE ?? viewportFile,
    {
      useState: () => [
        value,
        (next: typeof value) => {
          value = next;
        },
      ],
      useEffect: (effect: () => () => void) => {
        if (!effectMounted) {
          effectMounted = true;
          cleanup = effect();
        }
      },
    },
  ).useBoardViewport as (
    ref: { current: unknown },
    mode: "readable-scroll",
  ) => typeof value;
  viewport({ current: container }, "readable-scroll");
  const fitted = viewport({ current: container }, "readable-scroll");
  assert.ok(
    Math.abs(fitted.scale - 0.5) < 1e-6,
    "actual very-short scroll view preserves portrait-readable paper width",
  );
  assert.ok(
    fitted.scale * 700 > 142,
    "full recorded sheet is scrollable instead of compressed into remaining height",
  );
  console.log(
    "PASS actual readable-scroll viewport keeps readable stored-paper scale in a bounded scroll region",
  );
} finally {
  cleanup?.();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
}
