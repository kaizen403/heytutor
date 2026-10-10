/** Actual InputBar/caller/handler/admission/browser-lock/history client; platform and paid ports only are faked. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { LessonOwnershipTransport } from "../../features/tutor-session/lib/turn/lessonOwnership";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import type { HandleQuestionOptions } from "../../features/tutor-session/hooks/turn/types";
const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function defer<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function loadHook(
  file: string,
  overrides: Record<string, unknown>,
  react: unknown,
) {
  const filename = path.join(app, file);
  const sourceFile = file.endsWith("useQuestionHandler.ts")
    ? (process.env.ADMISSION_READ_HANDLER_SOURCE ?? filename)
    : file.endsWith("lessonOwnership.ts")
      ? (process.env.ADMISSION_READ_OWNERSHIP_SOURCE ?? filename)
      : file.endsWith("boardsClient.ts")
        ? (process.env.ADMISSION_READ_CLIENT_SOURCE ?? filename)
        : filename;
  const js = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const hookModule = { exports: {} as Record<string, unknown> };
  const requireLocal = (id: string) =>
    id === "react"
      ? react
      : id in overrides
        ? overrides[id]
        : requireApp(
            id.startsWith(".") ? path.resolve(path.dirname(filename), id) : id,
          );
  new Function("require", "module", "exports", js)(
    requireLocal,
    hookModule,
    hookModule.exports,
  );
  return hookModule.exports;
}
const { LessonAdmission, browserLessonTransport } = loadHook(
  "features/tutor-session/lib/turn/lessonOwnership.ts", {}, {},
) as typeof import("../../features/tutor-session/lib/turn/lessonOwnership");
function locksFixture() {
  const held = new Set<string>();
  let requests = 0;
  return {
    held,
    get requests() {
      return requests;
    },
    request: async (
      name: string,
      options: Record<string, unknown>,
      callback: (lock: unknown) => Promise<void>,
    ) => {
      requests++;
      if (options.ifAvailable && options.signal)
        throw new DOMException("signal plus ifAvailable", "NotSupportedError");
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        await callback({ name });
      } finally {
        held.delete(name);
      }
    },
    query: async () => ({
      held: [...held].map((name) => ({ name, mode: "exclusive" })),
      pending: [],
    }),
  };
}
function handlerFixture(transport: LessonOwnershipTransport, turnId = "local") {
  const admission = new LessonAdmission(transport);
  const registry = new LiveTurnSaveRegistry({
    transport: {
      checkpoint: async () => {
        throw Error("unexpected save");
      },
      close: async () => {
        throw Error("unexpected close");
      },
    },
    mintId: () => turnId,
    now: () => 1,
    isOnline: () => true,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  let titles = 0,
    bills = 0;
  const billing = defer<never>();
  const refs: Array<{ current: unknown }> = [];
  let cursor = 0;
  const effects: Array<() => void> = [];
  const frames: Array<() => void> = [];
  const react = {
    useRef: (value: unknown) =>
      refs[cursor++] ?? (refs[cursor - 1] = { current: value }),
    useCallback: (fn: unknown) => fn,
    useLayoutEffect: (fn: () => void) => fn(),
    useEffect: (fn: () => void) => {
      effects.push(fn);
    },
  };
  const drawing = requireApp("@heytutor/drawing");
  const overrides = {
    "@heytutor/drawing": {
      ...drawing,
      scheduleFrame: (fn: () => void) => {
        frames.push(fn);
        return frames.length;
      },
      cancelFrame: () => {},
    },
    "@/lib/boards/boardsClient": {
      ...loadHook("lib/boards/boardsClient.ts", {}, {}),
      requestBoardTitle: async () => {
        titles++;
        return null;
      },
      updateBoard: async () => null,
    },
    "@/lib/billing/billingClient": {
      ...requireApp("./lib/billing/billingClient"),
      beginTurn: async () => {
        bills++;
        await billing.promise;
        return {
          ok: false,
          status: 402,
          code: "insufficient_credit",
          remaining: null,
        };
      },
      rememberBillingFailure: () => {},
    },
    "../../lib/turn/lessonOwnership": { lessonAdmission: () => admission },
    "../../lib/turn/liveTurnSave": { liveTurnSave: () => registry },
  };
  const exports = loadHook(
    "features/tutor-session/hooks/turn/useQuestionHandler.ts",
    overrides,
    react,
  );
  const ref = <T>(current: T) => ({ current });
  const noop = () => {};
  const values: Record<string, unknown> = {
    sessionId: "board",
    boards: [{ id: "board", title: "new board" }],
    boardLoaded: true,
    isDraft: false,
    commitDraftBoard: undefined,
    whiteboardRef: ref({ getDrawLayer: () => ({}), setPaused: noop, clearSpotlight: noop }),
    phaseRef: ref("idle"),
    cancelRef: ref(false),
    turnActiveRef: ref(false),
    pendingSegmentCountRef: ref(0),
    turnGenerationRef: ref(1),
    isPausedRef: ref(false),
    conversationHistoryRef: ref([]),
    boardPageRef: ref(null),
    storedTurnsRef: ref([]),
    recordedSegmentsRef: ref([]),
    pendingQuestionRef: ref(null),
    boardLayoutRef: ref({ rects: [] }),
    activeVerifiedDiagramRef: ref(null),
    voicePreferencesRef: ref(null),
    pendingVoicePreferencesRef: ref(null),
    segmentChainRef: ref(Promise.resolve()),
    drawChainRef: ref(Promise.resolve()),
    turnStatsRef: ref({}),
    segmentPlanStatsRef: ref({}),
    speedRef: ref(1),
    ensureTTSClient: () => ({ unlockAudio: noop }),
    revokeUnreferencedReplayBlobUrls: noop,
  };
  const params = new Proxy(values, {
    get: (target, key: string) =>
      key in target
        ? target[key]
        : key.endsWith("Ref")
          ? (target[key] = ref(null))
          : noop,
  });
  const control = {
    finishLectureUi: () => {
      (values.turnActiveRef as { current: boolean }).current = false;
      (values.phaseRef as { current: string }).current = "idle";
    },
    enqueueSegment: noop,
    enqueueVerifiedIntro: noop,
    processResponseText: noop,
    offerPausedLessonResume: noop,
    clearPausedLesson: noop,
  };
  const render = () => {
    cursor = 0;
    return (
      exports.useQuestionHandler as (...args: unknown[]) => {
        handleQuestion: (q: string, o?: HandleQuestionOptions) => Promise<void>;
      }
    )(params, control);
  };
  return {
    render,
    params,
    values,
    admission,
    registry,
    control,
    frames,
    effects,
    get titles() {
      return titles;
    },
    get bills() {
      return bills;
    },
    finish: () => billing.resolve(undefined as never),
  };
}
type Element = { type: unknown; props: Record<string, unknown> };
function findElement(tree: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) { const found = findElement(child, predicate); if (found) return found; }
  } else if (tree && typeof tree === "object" && "props" in tree) {
    const element = tree as Element;
    if (predicate(element)) return element;
    return findElement(element.props.children, predicate);
  }
}
function actualAskCaller(handleQuestion: (q: string, o?: HandleQuestionOptions) => Promise<void>, storedTurnsCount = 0) {
  const filename = path.join(app, "features/tutor-session/TutorSessionShell.tsx");
  const file = ts.createSourceFile(filename, readFileSync(process.env.LESSON_CALLER_TEST_SOURCE ?? filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "submitQuestionAndDropMarks" && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0]!.getText(file);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert(callback, "extract the actual Ask caller, not a copied bridge");
  const js = ts.transpileModule(`module.exports = ${callback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: undefined as unknown };
  let nextQuestion = "";
  new Function("module", "handleQuestion", "ensureTTSClient", "marking", "storedTurnsCount", "startNextQuestion", js)(
    mod, handleQuestion, () => ({ unlockAudio() {} }), { disarm() {} }, storedTurnsCount, (q: string) => { nextQuestion = q; },
  );
  return { submit: mod.exports as (q: string) => void | Promise<boolean>, nextQuestion: () => nextQuestion };
}
function inputFixture(submit: (q: string) => void | Promise<boolean>) {
  const slots: unknown[] = []; let cursor = 0;
  const react = {
    useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? (value as (previous: unknown) => unknown)(slots[index]) : value; }]; },
    useRef: (initial: unknown) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useCallback: (fn: unknown) => fn,
    useEffect() {}, useLayoutEffect() {}, useSyncExternalStore: () => false,
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const hook = loadHook("features/tutor-session/components/InputBar.tsx", {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Highlighter: "icon", Settings: "icon" },
    "@/features/tutor-session/hooks/useVoiceInput": { useVoiceInput: () => ({ available: false }) },
    "@/features/tutor-session/components/FamiliarityPicker": { FamiliarityPicker: "picker" },
    "@/features/tutor-session/components/VoiceLevelBars": { VoiceLevelBars: "levels" },
    "@/components/ui/spinner": { Spinner: "spinner" },
    "@/lib/utils": { cn: () => "" },
  }, react);
  const render = () => { cursor = 0; return (hook.InputBar as (p: unknown) => Element)({ onSubmit: submit }); };
  const field = () => findElement(render(), (e) => e.type === "textarea")!;
  const type = (text: string) => (field().props.onChange as (e: unknown) => void)({ target: { value: text } });
  const ask = () => (findElement(render(), (e) => e.type === "form")!.props.onSubmit as (e: unknown) => void)({ preventDefault() {} });
  return { render, field, type, ask };
}

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
function clockFixture() {
  let now = 0, next = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  globalThis.setTimeout = ((run: () => void, ms = 0) => { const id = ++next; timers.set(id, { at: now + ms, run }); return id; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  return {
    async advance(ms: number) {
      now += ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= now);
        if (!due.length) break;
        for (const [id, timer] of due) { if (timers.delete(id)) timer.run(); }
        await tick();
      }
      await tick();
    },
    restore() { globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear; },
  };
}
function response(nextPage: number | null = null): Response {
  return new Response(JSON.stringify({ board: { id: "board", title: "new board" }, turns: [], nextPage }), { headers: { "content-type": "application/json" } });
}
async function stalledRead(kind: "deadline" | "cancel" | "supersede", port: "headers" | "body" | "second-page" = "headers") {
  const locks = locksFixture();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const shell = handlerFixture(browserLessonTransport());
  const late = defer<Response>();
  const body = defer<unknown>();
  const stalledBody = response();
  Object.defineProperty(stalledBody, "json", { value: () => body.promise });
  const requests: Array<{ url: string; signal?: AbortSignal | null }> = [];
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), signal: init?.signal });
    if (port === "second-page" && requests.length === 1) return Promise.resolve(response(1));
    if (requests.length === (port === "second-page" ? 2 : 1)) return port === "body" ? Promise.resolve(stalledBody) : late.promise;
    return Promise.resolve(response());
  }) as typeof fetch;
  const clock = clockFixture();
  try {
    let finished: Promise<void> | null = null, settled = false;
    let handler = shell.render();
    const caller = actualAskCaller((q, opts) => { finished = handler.handleQuestion(q, opts); void finished.then(() => { settled = true; }); return finished; });
    const input = inputFixture(caller.submit);
    input.type("Find acceleration"); input.ask(); await tick();
    const expectedReads = port === "second-page" ? 2 : 1;
    assert.equal(requests.length, expectedReads, "actual authenticated paginated board GET begins under the held claim");
    assert.equal(locks.held.size, 1);
    assert.equal(input.field().props.value, "Find acceleration");
    assert.equal(shell.bills, 0); assert.equal(shell.titles, 0);
    if (kind === "cancel") shell.admission.cancel(shell.values.cancelRef as object);
    if (kind === "supersede") {
      shell.values.sessionId = "successor-board";
      (shell.values.turnGenerationRef as { current: number }).current++;
      shell.render();
      shell.admission.cancel(shell.values.cancelRef as object);
    }
    if (kind === "deadline") await clock.advance(12_000);
    else await tick();
    assert(settled, `${kind}: stalled history must settle the admission receipt without a server response`);
    assert(!shell.admission.hasAttempt(shell.values.cancelRef as object), `${kind}: admission must permit retry`);
    assert.equal(locks.held.size, 0, `${kind}: browser claim releases before a late HTTP response`);
    assert.equal(requests[0]!.signal?.aborted, true, `${kind}: actual history fetch receives cancellation`);
    assert(findElement(input.render(), e => e.props.role === "alert"), `${kind}: InputBar returns visible retry feedback`);
    assert.equal(input.field().props.value, "Find acceleration");
    assert.equal(shell.bills, 0); assert.equal(shell.titles, 0);
    if (port === "body") body.resolve({ board: { id: "board", title: "new board" }, turns: [] });
    else late.resolve(response());
    await tick();
    assert.equal(shell.bills, 0, `${kind}: late history cannot start teaching/billing`);
    assert.equal(shell.titles, 0);
    if (kind === "supersede") shell.values.sessionId = "board";
    handler = shell.render();
    input.type("Retry acceleration"); input.ask(); await tick();
    assert.equal(input.field().props.value, "", `${kind}: successful fresh retry is admitted`);
    assert.equal(shell.bills, 1); assert.equal(shell.titles, 1);
    assert.equal(locks.held.size, 1, "validation deadline does not expire an admitted teaching claim");
    await clock.advance(60_000);
    assert.equal(locks.held.size, 1, "active teaching keeps ownership beyond the read deadline");
    shell.finish(); await tick();
    assert.equal(locks.held.size, 0, "finished teaching releases the claim");
    assert.equal(requests.length, expectedReads + 1, "retry uses one fresh authenticated read");
    for (const request of requests.slice(0, expectedReads)) assert.equal(request.signal?.aborted, true, "all stalled-history pages share cancellation");
    console.log(`admission history ${kind}/${port}: settled same-InputBar retry, released claim, ignored late response and held valid teaching`);
  } finally { clock.restore(); }
}
async function main() {
  await stalledRead("deadline");
  await stalledRead("deadline", "body");
  await stalledRead("deadline", "second-page");
  await stalledRead("cancel");
  await stalledRead("supersede");
  console.log("verify-lesson-admission-history: actual InputBar/handler/read/lock deadline and cancellation completed");
}
const watchdog = nativeSet(() => { console.error("admission history gate did not complete"); process.exit(1); }, 8_000);
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  nativeClear(watchdog); globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete (globalThis as { window?: unknown }).window;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete (globalThis as { navigator?: unknown }).navigator;
});
