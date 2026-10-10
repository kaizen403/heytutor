/** Real admission, browser adapter and question-handler seams; only platform/HTTP boundaries are faked. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import {
  LessonAdmission,
  browserLessonTransport,
  type LessonOwnershipTransport,
  type LessonClaim,
} from "../../features/tutor-session/lib/turn/lessonOwnership";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import type { HandleQuestionOptions } from "../../features/tutor-session/hooks/turn/types";
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const defer = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
function loadHook(
  file: string,
  overrides: Record<string, unknown>,
  react: unknown,
) {
  const filename = path.join(app, file);
  const sourceFile = file.endsWith("useQuestionHandler.ts")
    ? (process.env.LESSON_HANDLER_TEST_SOURCE ?? filename)
    : file.endsWith("useTurnControl.ts")
      ? (process.env.LESSON_CONTROL_TEST_SOURCE ?? filename)
    : filename;
  const js = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
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
async function nativeAndLifetime() {
  const locks = locksFixture();
  Object.defineProperty(globalThis, "navigator", {
    value: { locks },
    configurable: true,
  });
  const transport = browserLessonTransport();
  const admission = new LessonAdmission(transport);
  const owner = {},
    other = {};
  const running = defer<void>();
  let starts = 0;
  const first = admission.start(owner, "board", {
    current: () => true,
    validate: async () => true,
    run: async () => {
      starts++;
      await running.promise;
    },
  });
  assert(
    await first.admitted,
    "native adapter obeys Web Locks ifAvailable contract",
  );
  assert.equal(
    await admission.probe("board"),
    "active",
    "held claim remains active during unlimited pauses",
  );
  const duplicate = admission.start(owner, "board", {
    current: () => true,
    validate: async () => true,
    run: async () => {
      starts++;
    },
  });
  const competing = admission.start(other, "board", {
    current: () => true,
    validate: async () => true,
    run: async () => {
      starts++;
    },
  });
  assert.equal(await duplicate.admitted, false);
  assert.equal(await competing.admitted, false);
  assert.equal(starts, 1);
  assert.equal(
    locks.requests,
    2,
    "local duplicate never requests another claim",
  );
  running.resolve();
  await first.finished;
  await tick();
  assert.equal(await admission.probe("board"), "inactive");
  const delayed = defer<LessonClaim>();
  let releases = 0;
  let dispatched = 0;
  const late = new LessonAdmission({
    acquire: () => delayed.promise,
    probe: async () => "inactive",
  });
  const receipt = late.start(owner, "board", {
    current: () => true,
    validate: async () => true,
    run: async () => {
      dispatched++;
    },
  });
  late.cancel(owner);
  delayed.resolve({
    release: () => {
      releases++;
    },
  });
  assert.equal(await receipt.admitted, false);
  await receipt.finished;
  assert.equal(dispatched, 0);
  assert.equal(releases, 1, "late cancelled claim releases once");
  const aborted = new AbortController();
  aborted.abort();
  const before = locks.requests;
  assert.equal(await transport.acquire("board", aborted.signal), "busy");
  assert.equal(
    locks.requests,
    before,
    "already cancelled acquisition does not touch platform",
  );
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
  });
  assert.equal(await browserLessonTransport().probe("board"), "unknown");
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
    bills = 0,
    reads = 0;
  let fetched: StoredTurn[] | null = [];
  let freshRead: Promise<StoredTurn[] | null> | null = null;
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
      ...requireApp("./lib/boards/boardsClient"),
      fetchBoardDetail: async () => {
        reads++;
        const rows = freshRead ? await freshRead : fetched;
        return rows === null ? null : { turns: rows };
      },
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
    setFreshRead: (pending: Promise<StoredTurn[] | null>) => {
      freshRead = pending;
    },
    get titles() {
      return titles;
    },
    get bills() {
      return bills;
    },
    get reads() {
      return reads;
    },
    setFetched: (turns: StoredTurn[] | null) => {
      fetched = turns;
    },
    finish: () => billing.resolve(undefined as never),
  };
}
async function actualHandlerAdmissions() {
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true,
  });
  let acquisitions = 0;
  let releases = 0;
  const acquired = defer<LessonClaim>();
  const shell = handlerFixture({
    acquire: () => {
      acquisitions++;
      return acquired.promise;
    },
    probe: async () => "inactive",
  });
  const handler = shell.render();
  let admitted: boolean | undefined;
  const running = handler.handleQuestion("Find acceleration", {
    onAdmission: (v) => {
      admitted = v;
    },
  });
  await tick();
  assert.equal(shell.titles, 0);
  assert.equal(shell.bills, 0, "pending claim precedes every paid seam");
  await handler.handleQuestion("duplicate");
  assert.equal(acquisitions, 1);
  acquired.resolve({
    release: () => {
      releases++;
    },
  });
  await tick();
  assert.equal(admitted, true);
  assert.equal(shell.reads, 1);
  assert.equal(shell.titles, 1);
  assert.equal(shell.bills, 1);
  shell.finish();
  await running;
  assert.equal(
    releases,
    1,
    "outer finally releases claim on pre-teaching failure",
  );
  for (const options of [
    undefined,
    { doubt: { question: "Why?", title: "Why?", lessonQuestion: "lesson" } },
    {
      resume: {
        boardId: "board",
        reason: "stop",
        lessonQuestion: "lesson",
        parentTraceId: "p",
        parentTurnId: "p",
        turnPlan: null,
        solverProjection: null,
        scene: null,
        figureDrawn: false,
        codeLesson: false,
      },
    },
  ] as Array<HandleQuestionOptions | undefined>) {
    const busy = handlerFixture({
      acquire: async () => "busy",
      probe: async () => "active",
    });
    await busy.render().handleQuestion("question", options);
    assert.equal(busy.titles, 0);
    assert.equal(busy.bills, 0);
    assert.equal(
      busy.reads,
      0,
      "competing Ask/doubt/Continue denied before provider and HTTP history",
    );
  }
  const unavailable = handlerFixture({
    acquire: async () => ({ release: () => {} }),
    probe: async () => "inactive",
  });
  unavailable.setFetched(null);
  await unavailable.render().handleQuestion("question");
  assert.equal(unavailable.bills, 0);
  assert.equal(unavailable.titles, 0, "unknown saved state is conservative");
  for (const previousHistory of [false, true]) {
    const draft = handlerFixture({
      acquire: async () => ({ release: () => {} }),
      probe: async () => "inactive",
    });
    draft.values.isDraft = true;
    draft.values.commitDraftBoard = async () => false;
    draft.setFetched(null);
    draft.finish();
    if (previousHistory)
      draft.registry.observeBoard("board", [
        { id: "known", orderIndex: 0 } as StoredTurn,
      ]);
    await draft.render().handleQuestion("draft without authenticated history");
    assert.equal(draft.titles, 0);
    assert.equal(
      draft.bills,
      0,
      "draft flag cannot convert unavailable history into empty owned history",
    );
  }
  const draft = handlerFixture({
    acquire: async () => ({ release: () => {} }),
    probe: async () => "inactive",
  });
  draft.values.isDraft = true;
  let committed = false;
  draft.values.commitDraftBoard = async () => {
    if (committed) return false;
    committed = true;
    draft.setFetched([]);
    return true;
  };
  draft.setFetched(null);
  draft.finish();
  await draft.render().handleQuestion("first draft lesson");
  assert.equal(committed, true);
  assert.equal(draft.reads, 1);
  assert.equal(
    draft.bills,
    1,
    "owned draft commit and successful empty-history read admit first lesson",
  );
  const queued = handlerFixture({
    acquire: async () => "busy",
    probe: async () => "active",
  });
  queued.values.boardLoaded = false;
  await queued.render().handleQuestion("queued Ask");
  assert.equal(queued.bills, 0);
  queued.values.boardLoaded = true;
  queued.render();
  for (const effect of queued.effects.splice(0)) effect();
  for (const frame of queued.frames.splice(0)) frame();
  await tick();
  assert.equal(queued.bills, 0);
  assert.equal(
    queued.titles,
    0,
    "actual ready queued flush passes held admission",
  );
}
async function staleIntegratedAdmissions() {
  const ref = <T>(current: T) => ({ current });
  const react = {
    useRef: (current: unknown) => ({ current }),
    useCallback: (fn: unknown) => fn,
    useLayoutEffect: (fn: () => void) => fn(),
    useEffect: () => {},
    useState: (value: unknown) => [value, () => {}],
  };
  const mountControl = (
    shell: ReturnType<typeof handlerFixture>,
    handler: ReturnType<ReturnType<typeof handlerFixture>["render"]>,
  ) => {
    shell.values.phase = "idle";
    shell.values.isReplaying = false;
    shell.values.enableKeyboardControls = false;
    shell.values.isReplayingRef = ref(false);
    shell.values.boardShowsStoppedReplayRef = ref(false);
    shell.values.replayGenerationRef = ref(0);
    shell.values.replayAudioPreloadRef = ref(new Map());
    shell.values.collectedSegmentsRef = ref([]);
    const hook = loadHook(
      "features/tutor-session/hooks/turn/useTurnControl.ts",
      {
        "./useSegmentRunner": {
          useSegmentRunner: () => ({
            runSegment: async () => {},
            pauseFallbackSpeech() {},
            resumeFallbackSpeech() {},
            stopFallbackSpeech() {},
            speakingNarrationRef: ref(""),
          }),
        },
        "../../lib/turn/lessonOwnership": {
          lessonAdmission: () => shell.admission,
        },
        "../../lib/turn/liveTurnSave": { liveTurnSave: () => shell.registry },
      },
      react,
    );
    return (
      hook.useTurnControl as (
        ...args: unknown[]
      ) => import("../../features/tutor-session/hooks/turn/types").TurnControlApi
    )(shell.params, ref((question: string, options?: HandleQuestionOptions) => handler.handleQuestion(question, options)));
  };
  // Actual Stop cancels the pending admission before a delayed platform claim arrives.
  let released = 0;
  const late = defer<LessonClaim>();
  const stopped = handlerFixture({
    acquire: () => late.promise,
    probe: async () => "inactive",
  });
  const question = stopped.render();
  const control = mountControl(stopped, question);
  const waiting = question.handleQuestion("stop while acquiring");
  control.stopTurn();
  late.resolve({
    release: () => {
      released++;
    },
  });
  await waiting;
  assert.equal(stopped.titles, 0);
  assert.equal(stopped.bills, 0);
  assert.equal(released, 1);
  // Actual re-render switches board ownership while an old acquisition remains pending.
  const switchedClaim = defer<LessonClaim>();
  const switched = handlerFixture({
    acquire: () => switchedClaim.promise,
    probe: async () => "inactive",
  });
  const old = switched.render().handleQuestion("old board");
  switched.values.sessionId = "new-board";
  switched.render();
  switchedClaim.resolve({
    release: () => {
      released++;
    },
  });
  await old;
  assert.equal(switched.titles, 0);
  assert.equal(switched.bills, 0);
  assert.equal(released, 2);
  const stoppedTurn: StoredTurn = {
    id: "parent",
    orderIndex: 0,
    question: "lesson",
    rawResponse: "shown",
    speedMultiplier: 1,
    traceId: "trace-parent",
    status: "stopped",
    persistedStatus: "stopped",
    sceneDocument: null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "text_only",
    sceneArtifacts: null,
    segments: [
      {
        id: "row",
        orderIndex: 0,
        narration: "shown",
        spokenText: "shown",
        command: null,
        audioUrl: null,
        durationMs: null,
        timings: null,
      },
    ],
  };
  const resume = {
    boardId: "board",
    reason: "stop" as const,
    lessonQuestion: "lesson",
    parentTraceId: "trace-parent",
    parentTurnId: "parent",
    turnPlan: null,
    solverProjection: null,
    scene: null,
    figureDrawn: false,
    codeLesson: false,
  };
  for (const fresh of [
    {
      ...stoppedTurn,
      status: "complete" as const,
      persistedStatus: "complete" as const,
    },
    { ...stoppedTurn, id: "different-parent", traceId: "different-trace" },
  ]) {
    const saved = defer<StoredTurn[] | null>();
    const shell = handlerFixture(
      {
        acquire: async () => ({ release: () => {} }),
        probe: async () => "inactive",
      },
      "parent",
    );
    shell.setFreshRead(saved.promise);
    let ack: boolean | undefined;
    // A local dirty stopped overlay may coexist with a fresh final same-ID server turn.
    const localOwner = {};
    const local = shell.registry.begin({
      owner: localOwner,
      generation: 1,
      boardId: "board",
      traceId: "trace-parent",
      kind: "resume",
      question: "lesson",
      preview: "lesson",
      speedMultiplier: 1,
      continuesBoard: true,
    });
    shell.registry.setResumeState(localOwner, 1, {
      v: 1,
      solverProjection: { old: true },
    });
    shell.registry
      .prepareSegment(
        localOwner,
        1,
        {
          orderIndex: 0,
          narration: "shown",
          spokenText: "shown",
          command: null,
          audioBytes: null,
          durationMs: null,
          timings: null,
        },
        { intro: false },
      )!
      .markShown();
    local.close();
    const pending = shell.render().handleQuestion("lesson", {
      resume,
      onAdmission: (value) => {
        ack = value;
      },
    });
    await tick();
    saved.resolve([fresh]);
    await pending;
    assert.equal(ack, false);
    assert.equal(shell.titles, 0);
    assert.equal(
      shell.bills,
      0,
      "fresh final/different same-text chain refuses stale Continue",
    );
  }
  // Real control and handler share the same pending receipt; repeated Continue cannot overwrite it.
  const grant = defer<LessonClaim>();
  let acquires = 0;
  const shell = handlerFixture({
    acquire: () => {
      acquires++;
      return grant.promise;
    },
    probe: async () => "inactive",
  });
  shell.setFetched([stoppedTurn]);
  const handler = shell.render();
  const resumeControl = mountControl(shell, handler);
  Object.assign(shell.control, resumeControl);
  Object.assign(handler, shell.render());
  resumeControl.offerPausedLessonResume(resume);
  resumeControl.flushPausedLesson();
  resumeControl.flushPausedLesson();
  await tick();
  assert.equal(acquires, 1);
  assert.equal(shell.bills, 0);
  grant.resolve({ release: () => {} });
  await tick();
  assert.equal(shell.bills, 1);
  resumeControl.flushPausedLesson();
  assert.equal(acquires, 1, "admitted receipt consumes original offer");
  shell.finish();
  await tick();
  resumeControl.flushPausedLesson();
  await tick();
  assert.equal(shell.bills, 2, "an admitted billing refusal restores a Continue that can actually retry");
}

async function pageEvents() {
  const listeners = new Map<string, (event?: unknown) => void>();
  const log: string[] = [];
  let dirty = false;
  let cleanup: (() => void) | undefined;
  Object.defineProperty(globalThis, "window", {
    value: {
      addEventListener: (name: string, fn: (event?: unknown) => void) =>
        listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    },
    configurable: true,
  });
  const hook = loadHook(
    "features/tutor-session/hooks/useLecturePageHalt.ts",
    {
      "@heytutor/tutor-core": { haltAllLectureAudio: () => log.push("audio") },
      "../lib/turn/liveTurnSave": {
        liveTurnSave: () => ({
          hasUnsentData: () => dirty,
          pageHideClose: () => log.push("capture"),
        }),
      },
    },
    {
      useRef: (current: unknown) => ({ current }),
      useLayoutEffect: (fn: () => void) => fn(),
      useEffect: (fn: () => () => void) => {
        cleanup = fn();
      },
    },
  );
  (hook.useLecturePageHalt as (fn: () => void) => void)(() =>
    log.push("runtime/claim"),
  );
  let prompted = 0;
  const event = {
    preventDefault: () => {
      prompted++;
    },
    returnValue: undefined,
  };
  listeners.get("beforeunload")!(event);
  assert.deepEqual(
    log,
    [],
    "cancelled no-dirty unload leaves audio/runtime/claim",
  );
  dirty = true;
  listeners.get("beforeunload")!(event);
  assert.equal(prompted, 1);
  assert.deepEqual(
    log,
    [],
    "cancelled prompted unload also leaves runtime intact",
  );
  listeners.get("pagehide")!();
  assert.deepEqual(
    log,
    ["capture", "runtime/claim", "audio"],
    "actual pagehide synchronously captures before halt/release",
  );
  cleanup!();
  assert.equal(listeners.size, 0);
}

async function restoreReadBoardSwitch() {
  // Drive the real hook's scheduled re-read, preserving refs and effect cleanup across boards.
  const shell = handlerFixture({
    acquire: async () => "busy",
    probe: async () => "inactive",
  });
  const ref = <T>(current: T) => ({ current });
  Object.assign(shell.values, {
    phase: "idle", isReplaying: false, enableKeyboardControls: false, autoQuestion: undefined,
    isReplayingRef: ref(false), boardShowsStoppedReplayRef: ref(false),
    replayGenerationRef: ref(0), replayAudioPreloadRef: ref(new Map()),
    collectedSegmentsRef: ref([]),
  });
  const refs: Array<{ current: unknown }> = [];
  const effectSlots: Array<{ deps?: unknown[]; cleanup?: () => void }> = [];
  const pendingEffects: Array<() => void> = [];
  let refIndex = 0, effectIndex = 0;
  const offers: Array<{ boardId: string } | null> = [];
  const react = {
    useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
    useCallback: (fn: unknown) => fn,
    useState: (value: unknown) => [value, (next: { boardId: string } | null) => offers.push(next)],
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => {
      const index = effectIndex++;
      const old = effectSlots[index];
      if (old && deps && old.deps && deps.every((item, i) => item === old.deps![i]) && deps.length === old.deps.length) return;
      pendingEffects.push(() => {
        old?.cleanup?.();
        effectSlots[index] = { deps, cleanup: fn() ?? undefined };
      });
    },
  };
  const readingA = defer<{ turns: StoredTurn[] }>();
  const reads: string[] = [];
  const hook = loadHook("features/tutor-session/hooks/turn/useTurnControl.ts", {
    "./useSegmentRunner": { useSegmentRunner: () => ({
      runSegment: async () => {}, pauseFallbackSpeech() {}, resumeFallbackSpeech() {},
      stopFallbackSpeech() {}, speakingNarrationRef: ref(""),
    }) },
    "../../lib/turn/lessonOwnership": { lessonAdmission: () => shell.admission },
    "../../lib/turn/liveTurnSave": { liveTurnSave: () => shell.registry },
    "@/lib/boards/boardsClient": {
      ...requireApp("./lib/boards/boardsClient"),
      fetchBoardDetail: (board: string) => { reads.push(board); return readingA.promise; },
    },
  }, react);
  const render = () => {
    refIndex = 0; effectIndex = 0;
    const control = (hook.useTurnControl as (...args: unknown[]) => import("../../features/tutor-session/hooks/turn/types").TurnControlApi)(shell.params, ref(async () => {}));
    for (const effect of pendingEffects.splice(0)) effect();
    return control;
  };
  const row = (id: string, question: string, status: "live" | "stopped"): StoredTurn => ({
    id, orderIndex: 0, question, rawResponse: "shown", speedMultiplier: 1,
    traceId: id, status: status === "live" ? "stopped" : status, persistedStatus: status,
    updatedAt: Date.now(), sceneDocument: null, sceneEngineVersion: null,
    validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
    segments: [{ id: `${id}-row`, orderIndex: 0, narration: "shown", spokenText: "shown", command: null, audioUrl: null, durationMs: null, timings: null }],
  });
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  globalThis.setTimeout = ((fn: () => void) => { const id = ++nextTimer; timers.set(id, fn); return id; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  try {
    const a = render();
    assert.equal(await a.restorePausedLesson([row("A", "lesson A", "live")]), null);
    const timerA = [...timers.values()][0];
    timers.clear(); timerA();
    await tick();
    assert.deepEqual(reads, ["board"]);
    shell.values.sessionId = "board-B";
    const b = render();
    assert.equal((await b.restorePausedLesson([row("B", "lesson B", "stopped")]))?.lessonQuestion, "lesson B");
    readingA.resolve({ turns: [row("A", "lesson A", "stopped")] });
    await tick();
    assert.equal(offers.at(-1)?.boardId, "board-B", "delayed A timer read cannot install A over B's newer offer");
    // A queued old callback cannot clear the successor board's scheduled re-read.
    assert.equal(await b.restorePausedLesson([row("B", "lesson B", "live")]), null);
    const successor = [...timers.keys()][0];
    timerA();
    await tick();
    assert(timers.has(successor), "obsolete timer callback preserves B's timer");
    assert.deepEqual(reads, ["board"], "obsolete callback does not fetch A again");
  } finally {
    globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear;
  }
}
async function main() {
  await nativeAndLifetime();
  await actualHandlerAdmissions();
  await staleIntegratedAdmissions();
  await pageEvents();
  await restoreReadBoardSwitch();
  console.log(
    "verify-lesson-admission: native lock contract, held lifetime, duplicate/cancel receipts, actual Ask/doubt/queued admission before title/billing, pagehalt event consumer",
  );
}
const watchdog = setTimeout(() => {
  throw Error("consumer probe did not settle");
}, 10_000);
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
