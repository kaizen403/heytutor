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
function actualDraftCommit(sessionId: string, activeSessionIdRef = { current: sessionId }) {
  const filename = path.join(app, "features/tutor-session/hooks/useBoardSession.ts");
  const file = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let callback = "";
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "commitDraftBoard" && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0]!.getText(file);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert(callback, "extract the actual board commit callback, not a copied creation bridge");
  const js = ts.transpileModule(`module.exports = ${callback}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: undefined as unknown }, committedDraftRef = { current: null as string | null };
  let boards: unknown[] = [];
  const client = loadHook("lib/boards/boardsClient.ts", {}, {});
  new Function("module", "isDraft", "committedDraftRef", "sessionId", "createBoard", "setBoards", "activeSessionIdRef", "window", "boardPath", js)(
    mod, true, committedDraftRef, sessionId, client.createBoard,
    (set: (previous: unknown[]) => unknown[]) => { boards = set(boards); },
    activeSessionIdRef, { history: { state: { retained: true }, replaceState: () => {} } }, (id: string) => `/c/${id}`,
  );
  return mod.exports as () => Promise<boolean>;
}

async function slowDraftThenFreshHistory() {
  const locks = locksFixture();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const shell = handlerFixture(browserLessonTransport());
  shell.values.isDraft = true;
  shell.values.commitDraftBoard = actualDraftCommit("board");
  let handlerErrors = 0;
  shell.values.emitError = () => { handlerErrors++; };
  const created = defer<Response>(), freshHistory = defer<Response>();
  const requests: Array<{ url: string; method: string; signal?: AbortSignal | null }> = [];
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({ url: String(url), method, signal: init?.signal });
    return method === "POST" ? created.promise : freshHistory.promise;
  }) as typeof fetch;
  const clock = clockFixture();
  try {
    const handler = shell.render();
    const caller = actualAskCaller((question, options) => handler.handleQuestion(question, options));
    const input = inputFixture(caller.submit);
    input.type("Explain binary search with a sorted array");
    input.ask();
    await tick();
    assert.equal(requests.length, 1, "the actual draft callback creates one board before reading history");
    assert.equal(requests[0]!.method, "POST");
    assert.equal(locks.held.size, 1, "creation remains under the exclusive board claim");
    assert.equal(shell.bills, 0); assert.equal(shell.titles, 0);
    await clock.advance(11_600);
    created.resolve(Response.json({ board: { id: "board", title: "new board" } }));
    await tick();
    assert.equal(requests.length, 2, "successful creation is followed by exactly one fresh owned read");
    assert.equal(requests[1]!.method, "GET");
    assert.equal(requests[1]!.signal?.aborted, false);
    assert.equal(locks.held.size, 1, "the same claim survives the preparation/read boundary");
    assert.equal(shell.bills, 0); assert.equal(shell.titles, 0, "preparation cannot admit provider work");
    assert.equal(input.field().props.value, "Explain binary search with a sorted array");
    await clock.advance(800);
    freshHistory.resolve(response());
    await tick();
    assert.equal(shell.bills, 1,
      "two individually bounded valid draft-create/history stages must admit; the fresh read cannot inherit creation's spent deadline");
    assert.equal(shell.titles, 1);
    assert.equal(requests.filter(request => request.method === "POST").length, 1,
      "teaching reuses the committed draft and cannot create it twice");
    assert.equal(requests[1]!.signal?.aborted, false, "an 800ms fresh read remains live after an 11.6s valid creation");
    assert.equal(input.field().props.value, "", "only successful fresh validation clears the question");
    assert.equal(findElement(input.render(), element => element.props.role === "alert"), undefined);
    assert.equal(handlerErrors, 0);
    assert.equal(locks.held.size, 1, "admitted teaching retains the same exclusive claim");
    await clock.advance(60_000);
    assert.equal(locks.held.size, 1, "preparation/read deadlines never expire admitted teaching");
    shell.finish(); await tick();
    assert.equal(locks.held.size, 0);
    console.log("admission draft11.6s/read800ms: actual commit/owned read admit once under the same claim and preserve the question until validation");
  } finally { clock.restore(); }
}

async function failedPreparation(kind: "headers-deadline" | "body-deadline" | "rejected" | "cancel" | "supersede") {
  const locks = locksFixture();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const shell = handlerFixture(browserLessonTransport()), activeBoard = { current: "board" };
  shell.values.isDraft = true;
  shell.values.commitDraftBoard = actualDraftCommit("board", activeBoard);
  let handlerErrors = 0;
  shell.values.emitError = () => { handlerErrors++; };
  const created = defer<Response>(), body = defer<unknown>();
  const stalledBody = Response.json({ board: { id: "board", title: "new board" } });
  Object.defineProperty(stalledBody, "json", { value: () => kind === "rejected" ? Promise.reject(new Error("controlled creation body rejection")) : body.promise });
  const requests: Array<{ method: string; signal?: AbortSignal | null }> = [];
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({ method, signal: init?.signal });
    return method === "POST" ? created.promise : Promise.resolve(response());
  }) as typeof fetch;
  const clock = clockFixture();
  try {
    let settled = false;
    const handler = shell.render();
    const caller = actualAskCaller((question, options) => {
      const finished = handler.handleQuestion(question, options);
      void finished.then(() => { settled = true; });
      return finished;
    });
    const input = inputFixture(caller.submit);
    input.type("Keep the original draft question"); input.ask(); await tick();
    assert.equal(requests.length, 1); assert.equal(requests[0]!.method, "POST");
    assert.equal(locks.held.size, 1);
    if (kind === "body-deadline" || kind === "rejected") {
      created.resolve(stalledBody); await tick();
    }
    if (kind.endsWith("deadline")) {
      await clock.advance(11_999);
      assert.equal(settled, false, `${kind}: preparation owns its full bounded window`);
      assert.equal(locks.held.size, 1);
      await clock.advance(1);
    } else if (kind === "cancel") {
      shell.admission.cancel(shell.values.cancelRef as object); await tick();
    } else if (kind === "supersede") {
      activeBoard.current = "successor-board";
      shell.values.sessionId = "successor-board";
      (shell.values.turnGenerationRef as { current: number }).current++;
      shell.render();
      shell.admission.cancel(shell.values.cancelRef as object); await tick();
    }
    assert.equal(settled, true, `${kind}: failed preparation settles without provider work`);
    assert.equal(shell.admission.hasAttempt(shell.values.cancelRef as object), false);
    assert.equal(locks.held.size, 0, `${kind}: the held claim releases once`);
    assert.equal(requests.length, 1, `${kind}: fresh history never runs after failed preparation`);
    assert.equal(shell.bills, 0); assert.equal(shell.titles, 0); assert.equal(handlerErrors, 0);
    assert.equal(input.field().props.value, "Keep the original draft question");
    assert(findElement(input.render(), element => element.props.role === "alert"), `${kind}: caller failure remains visible and retryable`);
    if (kind === "body-deadline") body.resolve({ board: { id: "board", title: "new board" } });
    else if (kind !== "rejected") created.resolve(Response.json({ board: { id: "board", title: "new board" } }));
    await tick();
    assert.equal(requests.length, 1, `${kind}: a late POST/body cannot revive the read`);
    assert.equal(shell.bills, 0); assert.equal(shell.titles, 0); assert.equal(handlerErrors, 0);
    assert.equal(locks.held.size, 0);
    console.log(`admission preparation ${kind}: bounded settlement, retained question/notice, no late read/provider revival`);
  } finally { clock.restore(); }
}
async function freshReadDeadlineAfterPreparation() {
  const locks = locksFixture();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const shell = handlerFixture(browserLessonTransport());
  shell.values.isDraft = true; shell.values.commitDraftBoard = actualDraftCommit("board");
  const created = defer<Response>(), fresh = defer<Response>();
  const requests: Array<{ method: string; signal?: AbortSignal | null }> = [];
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET"; requests.push({ method, signal: init?.signal });
    return method === "POST" ? created.promise : fresh.promise;
  }) as typeof fetch;
  const clock = clockFixture();
  try {
    let settled = false;
    const handler = shell.render();
    const caller = actualAskCaller((question, options) => {
      const finished = handler.handleQuestion(question, options); void finished.then(() => { settled = true; }); return finished;
    });
    const input = inputFixture(caller.submit); input.type("Keep question during the fresh read"); input.ask(); await tick();
    await clock.advance(11_600); created.resolve(Response.json({ board: { id: "board", title: "new board" } })); await tick();
    assert.equal(requests.length, 2); assert.equal(requests[1]!.method, "GET");
    await clock.advance(11_999);
    assert.equal(settled, false, "fresh history receives its own full 12s window after preparation");
    assert.equal(requests[1]!.signal?.aborted, false); assert.equal(locks.held.size, 1);
    assert.equal(shell.bills, 0); assert.equal(shell.titles, 0);
    await clock.advance(1);
    assert.equal(settled, true); assert.equal(requests[1]!.signal?.aborted, true); assert.equal(locks.held.size, 0);
    assert.equal(input.field().props.value, "Keep question during the fresh read"); assert(findElement(input.render(), element => element.props.role === "alert"));
    fresh.resolve(response()); await tick();
    assert.equal(shell.bills, 0); assert.equal(shell.titles, 0, "late history cannot revive a failed second stage");
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
    console.log("admission fresh read after11.6s preparation: independent12s deadline, abort/notice, no late provider revival");
  } finally { clock.restore(); }
}
async function preparationRetainsExclusiveClaim() {
  const locks = locksFixture();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  const first = handlerFixture(browserLessonTransport()), other = handlerFixture(browserLessonTransport());
  for (const shell of [first, other]) { shell.values.isDraft = true; shell.values.commitDraftBoard = actualDraftCommit("board"); }
  const created = defer<Response>(), fresh = defer<Response>();
  const requests: string[] = [];
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => { const method = init?.method ?? "GET"; requests.push(method); return method === "POST" ? created.promise : fresh.promise; }) as typeof fetch;
  const clock = clockFixture();
  try {
    const firstHandler = first.render(), otherHandler = other.render();
    const input = inputFixture(actualAskCaller((question, options) => firstHandler.handleQuestion(question, options)).submit);
    input.type("One owned draft"); input.ask(); await tick(); input.ask(); await tick();
    assert.deepEqual(requests, ["POST"], "duplicate Ask cannot start another draft creation"); assert.equal(locks.requests, 1);
    const competing = inputFixture(actualAskCaller((question, options) => otherHandler.handleQuestion(question, options)).submit);
    competing.type("Competing draft"); competing.ask(); await tick();
    assert.deepEqual(requests, ["POST"]); assert.equal(locks.held.size, 1); assert.equal(locks.requests, 2);
    assert.equal(other.bills, 0); assert.equal(other.titles, 0); assert.equal(competing.field().props.value, "Competing draft");
    await clock.advance(11_600); created.resolve(Response.json({ board: { id: "board", title: "new board" } })); await tick();
    assert.deepEqual(requests, ["POST", "GET"]); assert.equal(locks.held.size, 1);
    competing.ask(); await tick();
    assert.deepEqual(requests, ["POST", "GET"], "read stage remains exclusively owned"); assert.equal(other.bills, 0); assert.equal(locks.held.size, 1);
    await clock.advance(800); fresh.resolve(response()); await tick();
    assert.equal(first.bills, 1); assert.equal(other.bills, 0); assert.equal(locks.held.size, 1);
    assert.equal(requests.filter(method => method === "POST").length, 1);
    first.finish(); await tick(); assert.equal(locks.held.size, 0);
    console.log("admission preparation/read exclusivity: duplicate and competing Ask stay quiet; one claim and one POST");
  } finally { clock.restore(); }
}

async function main() {
  await stalledRead("deadline");
  await stalledRead("deadline", "body");
  await stalledRead("deadline", "second-page");
  await stalledRead("cancel");
  await stalledRead("supersede");
  await slowDraftThenFreshHistory();
  for (const kind of ["headers-deadline", "body-deadline", "rejected", "cancel", "supersede"] as const) await failedPreparation(kind);
  await freshReadDeadlineAfterPreparation();
  await preparationRetainsExclusiveClaim();
  console.log("verify-lesson-admission-history: actual InputBar/handler/read/lock deadline and cancellation completed");
}
const watchdog = nativeSet(() => { console.error("admission history gate did not complete"); process.exit(1); }, 8_000);
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  nativeClear(watchdog); globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else delete (globalThis as { window?: unknown }).window;
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); else delete (globalThis as { navigator?: unknown }).navigator;
});
