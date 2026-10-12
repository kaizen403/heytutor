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
// Transitive TSX leaves loaded by tsx use the repository's classic JSX mode.
// The subjects themselves are compiled with automatic JSX by load().
Object.defineProperty(globalThis, "React", {
  value: React,
  configurable: true,
});
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
  effects: Array<{ run: () => unknown; deps?: readonly unknown[] }> = [];
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
    useEffect: (effect: () => unknown, deps?: readonly unknown[]) => {
      this.effects.push({ run: effect, deps });
    },
    useLayoutEffect: () => {},
    useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  };
}
// Evaluate the actual hook's CSS query, including every width/height clause.
// Unknown clauses fail setup rather than being treated as a matching posture.
function mediaQueryMatches(query: string, width: number, height: number, coarse: boolean): boolean {
  return query.split(",").some(arm => arm.split(/\s+and\s+/i).every(raw => {
    const clause = raw.trim();
    const dimension = /^\((min|max)-(width|height):\s*([0-9.]+)px\)$/.exec(clause);
    if (dimension) {
      const actual = dimension[2] === "width" ? width : height;
      return dimension[1] === "max" ? actual <= Number(dimension[3]) : actual >= Number(dimension[3]);
    }
    if (clause === "(pointer: coarse)") return coarse;
    throw Error(`Unsupported actual media clause: ${clause}`);
  }));
}
function renderShell(
  options: {
    reviewing?: boolean;
    navigation?: boolean;
    actualLanding?: boolean;
    width?: number;
    height?: number;
    mediaResults?: Array<{ query: string; matches: boolean }>;
    livePhase?: "speaking" | "drawing";
    onStop?: () => void;
    inputInteracted?: boolean;
    boardTitle?: string;
    onNewBoard?: () => void;
    onSelectBoard?: (id: string) => void;
    boardContainerRef?: { current: unknown };
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
  const width = options.width ?? (options.mobile ? 390 : options.short ? 844 : 1440);
  const height = options.height ?? (options.veryShort ? 220 : options.short ? 390 : 844);
  const mediaFile = path.join(appRoot, "lib/client/useMediaQuery.ts");
  const mediaHooks = load(mediaFile, mediaFile, {
    useCallback: <T>(fn: T) => fn,
    useSyncExternalStore: (_subscribe: unknown, read: () => boolean) => {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: { matchMedia: (query: string) => {
          const matches = mediaQueryMatches(query, width, height, options.coarse === true);
          options.mediaResults?.push({ query, matches });
          return { matches, addEventListener() {}, removeEventListener() {} };
        } },
      });
      try { return read(); } finally {
        if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
        else Reflect.deleteProperty(globalThis, "window");
      }
    },
  });
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
    "@/lib/client/useMediaQuery": mediaHooks,
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
        boardContainerRef: options.boardContainerRef ?? { current: null },
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
        boards: [
          {
            id: "recorded-board",
            title: options.boardTitle ?? "Saved lesson",
            preview: "",
          },
          {
            id: "older-board",
            title: "Older lesson",
            preview: "Stored lesson",
          },
        ],
        boardLoaded: true,
        storedTurnsRef: { current: turns },
        storedTurnsCount: turns.length,
        inputInteracted: options.inputInteracted ?? true,
        createNewBoard: options.onNewBoard ?? noop,
        switchBoard: options.onSelectBoard ?? noop,
        saveStatus: options.saveFailed
          ? { kind: "failed", message: "Try again" }
          : { kind: "saved" },
        retrySave: noop,
        hasLiveTurn: false,
      }),
    },
    "./hooks/useTurnLifecycle": {
      useTurnLifecycle: (params: { setPhase: (phase: string) => void }) => {
        if (options.livePhase) params.setPhase(options.livePhase);
        return { pausedLessonOffer: options.pausedOffer === true,
          stopTurn: options.onStop ?? noop };
      },
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
  if (options.navigation) {
    // Render the actual navigation consumers. Only the Sheet portal, service
    // hooks and React reconciliation are controlled; no replacement drawer
    // or reconstructed navigation handlers stand in for BoardHistory.
    const historyFile = path.join(
      appRoot,
      "features/tutor-session/components/BoardHistory.tsx",
    );
    const historyMount = new ShellMount();
    const passthrough = ({ children }: { children?: React.ReactNode }) =>
      children;
    const historyModule = load(
      historyFile,
      process.env.SHORT_HISTORY_SOURCE ?? historyFile,
      historyMount.react,
      {
        "next/link": { default: passthrough },
        "next/navigation": { usePathname: () => "/c/recorded-board" },
        "next-auth/react": {
          signOut: () => {
            throw new Error("sign out is outside the navigation gate");
          },
        },
        "@/components/ui/sheet": {
          Sheet: passthrough,
          SheetContent: passthrough,
          SheetTitle: passthrough,
        },
        "@/lib/billing/useEntitlement": {
          useEntitlement: () => ({ entitlement: null }),
        },
      },
    );
    const actualHistory = historyModule.BoardHistory as (
      props: Record<string, unknown>,
    ) => React.ReactElement<Record<string, unknown>>;
    const boardHistory = (props: Record<string, unknown>) => {
      historyMount.cursor = 0;
      const tree = actualHistory(props);
      if (props.variant === "drawer" && !props.open) return null;
      const content = find(
        tree,
        (node) =>
          typeof node.type === "function" &&
          node.type.name === "BoardHistoryContent",
      );
      assert.ok(
        content,
        "actual BoardHistory supplies its own content consumer",
      );
      const contentTree = (
        content.type as (props: Record<string, unknown>) => React.ReactElement
      )(content.props);
      return createElement(
        "section",
        {
          "data-actual-board-history": String(props.variant ?? "sidebar"),
          "data-actual-sidebar-collapsed": String(props.collapsed),
          "data-actual-history-width": (
            tree.props.style as React.CSSProperties | undefined
          )?.width,
        },
        contentTree,
      );
    };
    const appFile = path.join(appRoot, "features/app-shell/AppShell.tsx");
    const appMount = new ShellMount();
    const app = load(
      appFile,
      process.env.SHORT_APP_SHELL_SOURCE ?? appFile,
      appMount.react,
      {
        "next/navigation": { useRouter: () => ({ push: noop }) },
        "@/features/tutor-session/components/BoardHistory": {
          ...historyModule,
          BoardHistory: boardHistory,
        },
      },
    ).AppShell as ComponentType<Record<string, unknown>>;
    overrides["@/features/app-shell/AppShell"] = {
      AppShell: (props: Record<string, unknown>) => {
        appMount.cursor = 0;
        return (app as (props: Record<string, unknown>) => React.ReactNode)(
          props,
        );
      },
    };
    const headerFile = path.join(
      appRoot,
      "features/tutor-session/components/SessionHeader.tsx",
    );
    overrides["./components/SessionHeader"] = load(
      headerFile,
      headerFile,
      undefined,
      {
        "@/features/tutor-session/components/LessonActions": {
          LessonActions: leaf,
        },
        "@/features/tutor-session/components/SaveStatusChip": {
          SaveStatusChip: leaf,
        },
      },
    );
    const settingsFile = path.join(
      appRoot,
      "features/tutor-session/components/SettingsDrawer.tsx",
    );
    overrides["@/features/tutor-session/components/SettingsDrawer"] = load(
      settingsFile,
      process.env.SHORT_SETTINGS_SOURCE ?? settingsFile,
      undefined,
      {
        "@/components/ui/sheet": {
          Sheet: passthrough,
          SheetContent: passthrough,
          SheetHeader: passthrough,
          SheetTitle: passthrough,
          SheetDescription: passthrough,
        },
      },
    );
  }
  if (options.actualLanding) {
    // Execute the actual landing consumer, retaining its actual InputBar
    // element. Native coverage mounts the InputBar and tests its touch/submit
    // path; this gate checks the real form's containing scroll boundary.
    const landingFile = path.join(
      appRoot,
      "features/tutor-session/components/CanvasLanding.tsx",
    );
    const landingMount = new ShellMount();
    const landingModule = load(landingFile, landingFile, landingMount.react, {
      "@/lib/client/useMediaQuery": { useIsMobile: () => options.mobile },
    });
    const actualLanding = landingModule.CanvasLanding as (
      props: Record<string, unknown>,
    ) => React.ReactNode;
    overrides["@/features/tutor-session/components/CanvasLanding"] = {
      ...landingModule,
      CanvasLanding: (props: Record<string, unknown>) => {
        landingMount.cursor = 0;
        return actualLanding(props);
      },
      CanvasLandingDoodles: leaf,
    };
  }
  const shell = load(
    shellFile,
    process.env.SHORT_SHELL_SOURCE ?? shellFile,
    mount?.react,
    overrides,
  ).TutorSessionShell as ComponentType<TutorSessionShellProps>;
  if (mount) {
    mount.cursor = 0;
    mount.effects = [];
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

function expandNavigation(node: React.ReactNode): React.ReactNode {
  if (Array.isArray(node)) return node.map(expandNavigation);
  if (!React.isValidElement<Record<string, unknown>>(node)) return node;
  // The actual transport's auxiliary buttons are part of the Shell tree;
  // its media subscription is exercised by the existing transport gate.
  if (
    typeof node.type === "function" &&
    node.type.name !== "LecturePlayerBar" &&
    node.type.name !== "SettingsDrawer" &&
    node.type.name !== "InputBar"
  ) {
    return expandNavigation(
      (node.type as (props: Record<string, unknown>) => React.ReactNode)(
        node.props,
      ),
    );
  }
  return React.cloneElement(
    node,
    undefined,
    expandNavigation(node.props.children as React.ReactNode),
    expandNavigation(node.props.auxiliaryControls as React.ReactNode),
  );
}
function ancestorsOf(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean,
  ancestors: React.ReactElement<Record<string, unknown>>[] = [],
): React.ReactElement<Record<string, unknown>>[] | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = ancestorsOf(child, predicate, ancestors);
      if (found) return found;
    }
    return null;
  }
  if (!React.isValidElement<Record<string, unknown>>(node)) return null;
  const next = [...ancestors, node];
  if (predicate(node)) return next;
  return ancestorsOf(node.props.children as React.ReactNode, predicate, next);
}
function visibleControl(tree: React.ReactNode, label: string, width: number) {
  const ancestry = ancestorsOf(
    tree,
    (node) => node.type === "button" && node.props["aria-label"] === label,
  );
  assert.ok(ancestry, `actual consumer renders ${label}`);
  assert.ok(
    ancestry.every((node) => {
      const classes = String(node.props.className ?? "").split(/\s+/);
      return (
        !node.props.inert &&
        !node.props["aria-hidden"] &&
        (node.props.style as React.CSSProperties | undefined)?.display !==
          "none" &&
        !classes.includes("invisible") &&
        !classes.includes("pointer-events-none") &&
        !(width >= 768 && classes.includes("md:hidden"))
      );
    }),
    `${label} must escape every hidden, inert and pointer-disabled ancestor at ${width}px`,
  );
  return ancestry.at(-1)!;
}
function textContent(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  return React.isValidElement<Record<string, unknown>>(node)
    ? textContent(node.props.children as React.ReactNode)
    : "";
}
function clickControl(node: React.ReactElement<Record<string, unknown>>) {
  assert.notEqual(node.props.disabled, true, "actual control is enabled");
  (node.props.onClick as (event: { currentTarget: unknown }) => void)({
    currentTarget: {},
  });
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
(codeToggle.props.onClick as (event: { currentTarget: unknown }) => void)({
  currentTarget: {},
});
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
(composerToggle?.props.onClick as (event: { currentTarget: unknown }) => void)({
  currentTarget: {},
});
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
    matchMedia: (query: string) => ({
      matches: mediaQueryMatches(query, 390, 220, true),
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

const navigationFailures: string[] = [];
function navigationCheck(name: string, run: () => void) {
  if (process.env.SHORT_NAV_CASE && process.env.SHORT_NAV_CASE !== name) return;
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    navigationFailures.push(name);
    console.error(
      `FAIL ${name}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
navigationCheck("covered-board-controls", () => {
  for (const boardTitle of ["New board", "Lesson that did not save"]) {
    const state = new ShellMount();
    const options = {
      navigation: true,
      mobile: true,
      width: 390,
      short: true,
      veryShort: true,
      recorded: false,
      inputInteracted: false,
      boardTitle,
    };
    let tree = expandNavigation(renderShell(options, state));
    clickControl(visibleControl(tree, "Board controls", 390));
    tree = expandNavigation(renderShell(options, state));
    clickControl(visibleControl(tree, "Open navigation", 390));
    const shellTree = renderShell(options, state) as React.ReactElement<
      Record<string, unknown>
    >;
    assert.equal(
      shellTree.props.mobileNavOpen,
      true,
      "covered board's actual header opens AppShell's drawer",
    );
    tree = expandNavigation(shellTree);
    assert.ok(
      find(
        tree,
        (node) => node.props["data-actual-board-history"] === "drawer",
      ),
      "real BoardHistory renders its open drawer content",
    );
    assert.ok(
      !find(
        tree,
        (node) =>
          node.type === "button" &&
          node.props["aria-label"] === "Question composer",
      ),
      "landing owns its mounted composer, not a phantom footer toggle",
    );
  }
});
navigationCheck("compact-tablet-history", () => {
  for (const width of [768, 844, 1023]) {
    for (const collapsedPreference of [false, true]) {
      const state = new ShellMount();
      let created = 0;
      const selected: string[] = [];
      const desktopOptions = {
        navigation: true,
        mobile: false,
        width: 1440,
        short: false,
        onNewBoard: () => created++,
        onSelectBoard: (id: string) => selected.push(id),
      };
      if (collapsedPreference) {
        const desktop = expandNavigation(renderShell(desktopOptions, state));
        clickControl(visibleControl(desktop, "Collapse sidebar", 1440));
      }
      const options = { ...desktopOptions, width, short: true };
      let shellTree = renderShell(options, state) as React.ReactElement<
        Record<string, unknown>
      >;
      assert.equal(
        shellTree.props.sidebarCollapsed,
        true,
        "compact layout folds the rail without changing the underlying choice",
      );
      let tree = expandNavigation(shellTree);
      clickControl(visibleControl(tree, "Board controls", width));
      tree = expandNavigation(renderShell(options, state));
      clickControl(visibleControl(tree, "Open navigation", width));
      shellTree = renderShell(options, state) as React.ReactElement<
        Record<string, unknown>
      >;
      assert.equal(
        shellTree.props.mobileNavOpen,
        true,
        "actual compact-tablet header opens the actual AppShell drawer",
      );
      tree = expandNavigation(shellTree);
      const header = find(tree, (node) =>
        Object.hasOwn(node.props, "data-short-header"),
      );
      assert.equal(
        header?.props.inert,
        true,
        "header cannot obscure or compete with the open history drawer",
      );
      assert.equal(
        (header?.props.style as React.CSSProperties).display,
        "none",
      );
      const drawer = find(
        tree,
        (node) => node.props["data-actual-board-history"] === "drawer",
      );
      assert.ok(drawer, "actual AppShell invokes the actual drawer consumer");
      const newBoard = find(
        drawer,
        (node) =>
          node.type === "button" && textContent(node).trim() === "New board",
      );
      assert.ok(newBoard);
      clickControl(newBoard);
      assert.equal(
        created,
        1,
        "actual BoardHistory New forwards the service-boundary action exactly once",
      );
      shellTree = renderShell(options, state) as React.ReactElement<
        Record<string, unknown>
      >;
      assert.equal(
        shellTree.props.mobileNavOpen,
        false,
        "actual BoardHistory New closes the drawer",
      );
      tree = expandNavigation(shellTree);
      clickControl(visibleControl(tree, "Open navigation", width));
      tree = expandNavigation(renderShell(options, state));
      const reopened = find(
        tree,
        (node) => node.props["data-actual-board-history"] === "drawer",
      );
      const older = find(
        reopened,
        (node) =>
          node.type === "button" && textContent(node).includes("Older lesson"),
      );
      assert.ok(older);
      clickControl(older);
      assert.deepEqual(
        selected,
        ["older-board"],
        "actual history selection preserves the chosen board id",
      );
      assert.equal(
        (
          renderShell(options, state) as React.ReactElement<
            Record<string, unknown>
          >
        ).props.mobileNavOpen,
        false,
        "select closes the actual drawer",
      );
      assert.equal(
        (
          renderShell(desktopOptions, state) as React.ReactElement<
            Record<string, unknown>
          >
        ).props.sidebarCollapsed,
        collapsedPreference,
        "returning to desktop restores the student's existing collapsed choice",
      );
    }
  }
});
navigationCheck("compact-modal-focus", () => {
  const frameDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "requestAnimationFrame",
  );
  const cancelDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "cancelAnimationFrame",
  );
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => frames.delete(id),
  });
  const state = new ShellMount();
  let previousDeps: readonly unknown[] | undefined;
  let cleanupFocus: (() => void) | undefined;
  let focused = 0;
  let originalToggleDetached = false;
  const trigger = {
    focus() {
      focused++;
    },
    closest() {
      if (originalToggleDetached) return null;
      return {
        querySelector() {
          return {
            querySelector() {
              return {
                focus() {
                  focused++;
                },
              };
            },
          };
        },
      };
    },
  };
  const stableContainer = { current: null as unknown };
  const options = {
    navigation: true,
    mobile: false,
    width: 844,
    short: true,
    boardContainerRef: stableContainer,
  };
  const render = () => {
    const tree = renderShell(options, state) as React.ReactElement<
      Record<string, unknown>
    >;
    const effect = state.effects.find((effect) =>
      effect.run.toString().includes("[data-short-header]"),
    );
    assert.ok(effect, "actual compact focus effect is mounted");
    if (
      !previousDeps ||
      effect.deps?.length !== previousDeps.length ||
      effect.deps?.some(
        (value, index) => !Object.is(value, previousDeps?.[index]),
      )
    ) {
      cleanupFocus?.();
      const cleanup = effect.run();
      cleanupFocus =
        typeof cleanup === "function" ? (cleanup as () => void) : undefined;
      previousDeps = effect.deps?.slice();
    }
    return tree;
  };
  const paint = () => {
    for (const [id, callback] of frames) {
      frames.delete(id);
      callback(0);
    }
  };
  try {
    let tree = expandNavigation(render());
    const toggle = visibleControl(tree, "Board controls", 844);
    (toggle.props.onClick as (event: unknown) => void)({
      currentTarget: trigger,
    });
    tree = expandNavigation(render());
    assert.equal(frames.size, 1);
    paint();
    assert.equal(focused, 1);
    clickControl(visibleControl(tree, "Open navigation", 844));
    let shell = render();
    assert.equal(
      frames.size,
      0,
      "pending header focus is cancelled while history owns focus",
    );
    // Invoke actual Shell callbacks supplied to the actual AppShell consumer.
    (shell.props.onMobileNavOpenChange as (open: boolean) => void)(false);
    (shell.props.onOpenLessonSettings as () => void)();
    shell = render();
    assert.equal(
      frames.size,
      0,
      "settings handoff must not refocus the underlying header",
    );
    assert.equal(focused, 1);
    const settings = find(
      shell,
      (node) =>
        Object.hasOwn(node.props, "settings") &&
        typeof node.props.onOpenChange === "function",
    );
    assert.ok(settings);
    assert.equal(settings.props.open, true);
    (settings.props.onOpenChange as (open: boolean) => void)(false);
    shell = render();
    assert.equal(
      frames.size,
      1,
      "closing settings reruns the actual focus effect",
    );
    paint();
    assert.equal(
      focused,
      2,
      "settings close restores the visible compact header target",
    );
    const container = find(
      shell,
      (node) =>
        Boolean(node.props.ref) &&
        String(node.props.className).includes(
          "flex-1 items-center justify-center",
        ),
    );
    assert.ok(container, "actual board container owns a stable mounted ref");
    let targetHidden = false;
    let targetInert = false;
    const target = {
      isConnected: true,
      getClientRects: () => (targetHidden ? [] : [{}]),
      closest: () => (targetInert ? {} : null),
      focus() {
        focused++;
      },
    };
    (container.props.ref as { current: unknown }).current = {
      closest: () => ({
        querySelector: (selector: string) =>
          selector === "[data-short-header]"
            ? { querySelector: () => target }
            : target,
      }),
    };
    const closedSettings = find(
      shell,
      (node) =>
        Object.hasOwn(node.props, "settings") &&
        typeof node.props.onOpenChange === "function",
    );
    assert.ok(closedSettings);
    const actualDrawerTree = (
      closedSettings.type as (
        props: Record<string, unknown>,
      ) => React.ReactElement
    )(closedSettings.props);
    const content = find(
      actualDrawerTree,
      (node) => node.props.side === "right",
    );
    assert.ok(
      content,
      "actual SettingsDrawer renders the actual SheetContent boundary",
    );
    assert.equal(
      typeof content.props.onCloseAutoFocus,
      "function",
      "actual SettingsDrawer forwards compact close focus ownership",
    );
    let prevented = 0;
    (content.props.onCloseAutoFocus as (event: unknown) => void)({
      preventDefault() {
        prevented++;
      },
    });
    assert.equal(prevented, 1);
    assert.equal(focused, 3);
    target.isConnected = false;
    (content.props.onCloseAutoFocus as (event: unknown) => void)({
      preventDefault() {
        prevented++;
      },
    });
    assert.equal(
      prevented,
      1,
      "missing trigger preserves Radix default close restoration",
    );
    assert.equal(focused, 3);
    target.isConnected = true;
    targetHidden = true;
    (content.props.onCloseAutoFocus as (event: unknown) => void)({
      preventDefault() {
        prevented++;
      },
    });
    targetHidden = false;
    targetInert = true;
    (content.props.onCloseAutoFocus as (event: unknown) => void)({
      preventDefault() {
        prevented++;
      },
    });
    assert.equal(
      prevented,
      1,
      "hidden or inert trigger preserves default restoration",
    );
    assert.equal(focused, 3);
    targetInert = false;
    originalToggleDetached = true;
    (shell.props.onMobileNavOpenChange as (open: boolean) => void)(true);
    render();
    (shell.props.onMobileNavOpenChange as (open: boolean) => void)(false);
    render();
    paint();
    assert.equal(
      focused,
      4,
      "new/switch keeps a stable root after the old row trigger disappears",
    );
    const desktop = renderShell(
      { navigation: true, mobile: false, width: 1440 },
      new ShellMount(),
    );
    const desktopSettings = find(
      desktop,
      (node) =>
        Object.hasOwn(node.props, "settings") &&
        typeof node.props.onOpenChange === "function",
    );
    assert.ok(desktopSettings);
    assert.equal(
      desktopSettings.props.onCloseAutoFocus,
      undefined,
      "ordinary desktop retains default Radix restoration",
    );
  } finally {
    cleanupFocus?.();
    if (frameDescriptor)
      Object.defineProperty(
        globalThis,
        "requestAnimationFrame",
        frameDescriptor,
      );
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    if (cancelDescriptor)
      Object.defineProperty(
        globalThis,
        "cancelAnimationFrame",
        cancelDescriptor,
      );
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  }
});
navigationCheck("compact-empty-landing-scroll", () => {
  for (const posture of [
    { mobile: true, width: 390, short: true, veryShort: true, compact: true },
    { mobile: true, width: 390, short: false, compact: false },
    { mobile: false, width: 1440, short: false, compact: false },
    { mobile: true, width: 390, short: true, fullscreen: true, compact: false },
  ]) {
    const tree = expandNavigation(
      renderShell(
        {
          ...posture,
          actualLanding: true,
          recorded: false,
          inputInteracted: false,
          boardTitle: "New board",
        },
        new ShellMount(),
      ),
    );
    const form = find(
      tree,
      (node) => node.type === "section" &&
        String(node.props.className).includes("ac-landing"),
    );
    assert.ok(form, "actual CanvasLanding is executed");
    const input = find(
      form,
      (node) => typeof node.type === "function" &&
        node.type.name === "InputBar",
    );
    assert.ok(input, "actual landing retains the actual InputBar consumer");
    assert.equal(input.props.placeholder, "Ask a question or paste a photo");
    assert.equal(typeof input.props.onSubmit, "function");
    const ancestry = ancestorsOf(tree, (node) => node === form);
    assert.ok(ancestry);
    const pane = ancestry.find((node) =>
      String(node.props.className).includes("glass-deep"),
    );
    assert.ok(pane, "actual form lives in Shell's landing pane");
    if (posture.compact) {
      assert.match(String(pane.props.className), /overflow-y-auto/,
        "compact actual landing must scroll to its form actions");
      assert.equal(pane.props.role, "region");
      assert.equal(pane.props["aria-label"], "New lesson");
      assert.equal(pane.props.tabIndex, 0);
    } else {
      assert.match(String(pane.props.className), /overflow-hidden/,
        "ordinary portrait, desktop and fullscreen keep existing landing");
      assert.equal(pane.props.role, undefined);
      assert.equal(pane.props.tabIndex, undefined);
    }
  }
});
navigationCheck("compact-composer-keyboard", () => {
  for (const [width, height, inset] of [
    [390, 220, 0],
    [390, 220, 80],
    [667, 375, 150],
    [844, 390, 180],
  ] as const) {
    const state = new ShellMount();
    const options = {
      mobile: width < 768,
      coarse: true,
      width,
      short: true,
      veryShort: height <= 300,
      keyboardInset: inset,
    };
    let tree = renderShell(options, state);
    const toggle = find(tree as React.ReactNode, (node) =>
      node.props["aria-label"] === "Question composer",
    );
    assert.ok(toggle);
    clickControl(toggle);
    tree = renderShell(options, state);
    const footer = find(tree as React.ReactNode, (node) =>
      node.type === "footer" && node.props["data-short-composer"] === "true",
    );
    assert.ok(footer, "actual compact composer remains mounted");
    assert.equal(footer.props.inert, undefined);
    const style = footer.props.style as React.CSSProperties;
    assert.equal(style.display, "block");
    assert.equal(style.overflowY, "auto");
    const visibleBottom = height - inset;
    const composerBottom = height - Number(style.bottom);
    assert.equal(
      visibleBottom - composerBottom,
      52,
      "composer sits above the visible compact transport and its gap",
    );
    const consumedHeight = Number(
      String(style.maxHeight).match(/^calc\(100% - ([0-9]+)px\)$/)?.[1],
    );
    assert.ok(Number.isFinite(consumedHeight));
    const maxHeight = height - consumedHeight;
    assert.ok(maxHeight > 0 && composerBottom - maxHeight >= 4,
      "the actual scrollable composer height cannot extend above its viewport");
  }
  const portrait = find(
    renderShell({ mobile: true, keyboardInset: 250 }, new ShellMount()) as React.ReactNode,
    (node) => node.type === "footer",
  );
  assert.ok(portrait);
  assert.equal((portrait.props.style as React.CSSProperties).bottom, undefined);
  assert.equal((portrait.props.style as React.CSSProperties).paddingTop, 4);
  const immersive = find(
    renderShell({ mobile: true, short: true, fullscreen: true, keyboardInset: 250 }, new ShellMount()) as React.ReactNode,
    (node) => node.type === "footer",
  );
  assert.ok(immersive);
  assert.equal((immersive.props.style as React.CSSProperties).bottom, 256,
    "existing fullscreen keyboard authority is unchanged");
});
navigationCheck("short-media-query-width-boundaries", () => {
  for (const [width, height, compact, scroll] of [
    [390, 220, true, true], [631, 300, true, true],
    [667, 375, true, false], [844, 390, true, false],
    [1023, 300, true, true], [1024, 220, false, false],
    [1440, 220, false, false], [1440, 390, false, false],
    [390, 844, false, false],
  ] as const) {
    const mediaResults: Array<{ query: string; matches: boolean }> = [];
    const markup = shellMarkup({mobile: width < 768, width, height, coarse: true, mediaResults});
    const heightQueries = mediaResults.filter(result => /\(max-height:/.test(result.query));
    assert.equal(heightQueries.length, 2, "actual Shell subscribes to both height postures");
    for (const result of heightQueries) {
      const bound = Number(/\(max-height:\s*([0-9.]+)px\)/.exec(result.query)?.[1]);
      assert.equal(result.matches, width <= 1023 && height <= bound,
        `both actual height query snapshots exclude desktop widths: ${result.query} at ${width}x${height}`);
    }
    assert.equal(markup.includes('data-short-board-chrome="true"'), compact,
      `actual media hook must constrain compact mode at ${width}x${height}`);
    assert.equal(markup.includes('data-board-scroll="true"'), scroll,
      `actual media hook must constrain readable scroll at ${width}x${height}`);
  }
});
navigationCheck("short-live-without-player-scroll-and-stop", () => {
  for (const livePhase of ["speaking", "drawing"] as const) {
    let stopped = 0;
    const mounted = new ShellMount();
    const options = {mobile: true, width: 390, height: 220, coarse: true,
      recorded: false, navigation: true, livePhase, onStop: () => stopped++};
    renderShell(options, mounted);
    let tree = expandNavigation(renderShell(options, mounted));
    const stage = find(tree, node => String(node.props.className).split(/\s+/).includes("wb-stage"));
    assert.ok(stage);
    assert.match(String(stage.props.className), /\bw-full\b/,
      "live no-player stage must stay within the available phone width");
    assert.match(String(stage.props.className), /\bmin-w-0\b/,
      "live no-player stage must shrink instead of centering an oversized sheet");
    assert.equal(find(tree, node => node.props["data-compact-transport"] != null), null,
      "this is the live/no-audio path, not a docked recorded player");
    const pane = find(tree, node => node.props["data-board-scroll"] === "true");
    assert.ok(pane);assert.equal(pane.props.tabIndex, 0);
    const calls: unknown[] = [], current = {clientHeight: 142, scrollHeight: 370,
      scrollBy: (value: unknown) => calls.push(value), scrollTo: (value: unknown) => calls.push(value)};
    const key = pane.props.onKeyDown as (event: unknown) => void;
    key({key:"ArrowRight", target:current, currentTarget:current, preventDefault() {}, stopPropagation() {}});
    assert.deepEqual(calls, [{left:40,top:0}], "actual live region can pan toward right-side stored geometry");
    const toggle = find(tree, node => node.props["aria-label"] === "Board controls");
    assert.ok(toggle);clickControl(toggle);
    tree = expandNavigation(renderShell(options, mounted));
    const stop = visibleControl(tree, "Stop teaching", 390);
    clickControl(stop);assert.equal(stopped, 1, "actual compact header Stop invokes the current live consumer");
  }
});
assert.equal(
  navigationFailures.length,
  0,
  `navigation consumer failures: ${navigationFailures.join(", ")}`,
);
