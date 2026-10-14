/** Actual handler/control/registry/compiler/executor/replay; HTTP/media/render ports are local. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import * as core from "@heytutor/tutor-core";
import { isExplanationOnlyDsaQuestion } from "../../../../packages/tutor-core/src/code/codeLessonPlan";
import { getSegmentCommands, isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands, type DrawCommand, type TutorSegment } from "@heytutor/drawing";
import { CodeLessonController } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import { resolveDsaFrames, restoreDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { LiveTurnSaveRegistry } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { LessonAdmission } from "../../features/tutor-session/lib/turn/lessonOwnership";
import { partialTurnScene, partialTurnSegments, type PausedLessonRequest } from "../../features/tutor-session/lib/turn/doubtTurn";
import { pausedLessonFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { buildCodeLessonExportTrack, codeLessonFrameSpec } from "../../lib/lecture-export/codeLessonExportTrack";
import { drawReplayDiagramTimeline } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import { resetReplayPageAtTurn } from "../../features/tutor-session/lib/replay/replayPageBoundary";
import { createEmptySegmentPlanStats } from "../../features/tutor-session/lib/turn/segmentPlanning";
import type { RecordedSegmentPayload, StoredTurn } from "../../lib/boards/boardsClient";

const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
function selectedIntent() {
  if (!process.env.CODE_STOP_INTENT_SOURCE) return isExplanationOnlyDsaQuestion;
  const mod = { exports: {} as { isExplanationOnlyDsaQuestion: typeof isExplanationOnlyDsaQuestion } };
  const js = ts.transpileModule(readFileSync(process.env.CODE_STOP_INTENT_SOURCE, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", js)(mod, mod.exports);
  return mod.exports.isExplanationOnlyDsaQuestion;
}
const codeIntent = selectedIntent();
const ref = <T,>(current: T) => ({ current });
const noop = () => {};
const storedCommand = (command: unknown) => serializeSegmentCommands(parseStoredSegmentCommands(command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(command) });
const question = "Reverse a singly linked list in Python. Input: head = [1, 2, 3, 4]. Explain prev, curr and next, then return the reversed list.";
const code = [
  "class Node:\n    def __init__(self, value, next_node=None):\n        self.value, self.next = value, next_node",
  "def reverse(head):\n    prev = None\n    curr = head",
  "    while curr is not None:\n        next_node = curr.next",
  "        curr.next = prev\n        prev = curr",
  "        curr = next_node\n    return prev",
  "head = Node(1, Node(2, Node(3, Node(4))))\nhead = reverse(head)\nvalues = []",
  "while head is not None:\n    values.append(str(head.value))",
  "    head = head.next\nprint(\" \".join(values))",
];
const plan: core.CodeLessonPlan = {
  schemaVersion: "code-lesson/v1", title: "Reverse a Singly Linked List", language: "python", question,
  sections: [{ id: "s1", title: "Reverse the links", explanation: "Save the successor before changing each link, then return prev.",
    blocks: code.map((source, i) => ({ id: `s1b${i + 1}`, code: source })), typeAlongRanges: [{ startLine: 5, endLine: 12 }] }],
  diagramHint: { structure: "linked_list", caption: "Reverse the four links", nodes: [1, 2, 3, 4].map(value => ({ id: `n${value}`, label: String(value) })),
    edges: [1, 2, 3].map(value => ({ from: `n${value}`, to: `n${value + 1}` })),
    steps: [0, 1, 2, 4].map(count => ({ id: `hint${count}`, nodes: [1, 2, 3, 4].map(value => ({ id: `n${value}`, label: String(value) })),
      edges: [1, 2, 3].flatMap(value => value < count ? [{ from: `n${value + 1}`, to: `n${value}` }] : value === count ? [] : [{ from: `n${value}`, to: `n${value + 1}` }]) })) },
};
assert(core.validateCodeLessonPlan(plan).plan, `synthetic captured-shape program validates: ${JSON.stringify(core.validateCodeLessonPlan(plan).issues)}`);
const frames = resolveDsaFrames(question, plan.diagramHint, plan)!;
assert.equal(frames.frames.length, 6, "actual scene-engine compiles the input and five reversal states");
const parent: StoredTurn = {
  id: "stopped-opening", orderIndex: 0, kind: "lesson", question, rawResponse: "Reverse the list.", speedMultiplier: 1, traceId: null,
  status: "stopped", persistedStatus: "stopped", sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
  sceneArtifacts: { codeLesson: plan, turnPlan: core.createFallbackTurnPlanV3(question) },
  segments: [{ id: "opening-values", orderIndex: 0, narration: "Values are one, two, three, four.", spokenText: "Values are one, two, three, four.",
    command: { type: "WRITE", text: "values = [1, 2, 3, 4]", params: [90, 208], charPosition: 0, narrationBefore: "" }, audioUrl: null, durationMs: 1_000, timings: null }],
};
const react = { useRef: ref, useCallback: <T,>(fn: T) => fn, useEffect: noop, useLayoutEffect: (fn: () => void) => fn(),
  useState: (value: unknown) => [value, noop], useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() };
function load(file: string, overrides: Record<string, unknown> = {}) {
  const filename = path.join(app, file);
  const selected = file.endsWith("useQuestionHandler.ts") ? process.env.CODE_STOP_HANDLER_SOURCE ?? filename : filename;
  const js = ts.transpileModule(readFileSync(selected, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", js)((id: string) => id === "react" ? react : id in overrides ? overrides[id]
    : requireApp(id.startsWith("@/") ? path.join(app, id.slice(2)) : id.startsWith(".") ? path.resolve(path.dirname(filename), id) : id), mod, mod.exports);
  return mod.exports;
}
type Mode = "same-context" | "reload" | "already-drawn" | "cancel-intro" | "supersede-intro" | "partial-code" | "unsupported" | "declined-presentation" | "empty-presentation";
async function fixture(mode: Mode) {
  const capturedPlan = mode === "unsupported" ? { ...plan, diagramHint: { structure: "none" as const } } : plan;
  const controller = new CodeLessonController(); controller.commit(capturedPlan); controller.frames.commit(mode === "unsupported" ? null : frames);
  const firstBlock = plan.sections[0]!.blocks[0]!;
  let partial = 0;
  if (mode === "partial-code") {
    let clock = 0;
    await controller.typeBlock(firstBlock.id, { clock: () => clock, shouldCancel: () => clock >= 720, delay: async () => { clock += 120; } });
    partial = controller.getState().revealedChars[firstBlock.id] ?? 0;
    assert(partial > 0 && partial < firstBlock.code.length, "actual natural typing stops at a real visible prefix");
  }
  const savedParent = structuredClone(parent);
  savedParent.sceneArtifacts = { codeLesson: capturedPlan, turnPlan: core.createFallbackTurnPlanV3(question) };
  if (mode === "already-drawn") {
    const first = frames.scenes.frames[0]!;
    savedParent.sceneDocument = { ...first.document, source: { ...first.document.source, question, representationTier: frames.tier, nonMetric: frames.nonMetric } };
    savedParent.visualStatus = "validated";
    savedParent.validationReport = first.validationReport;
    savedParent.sceneArtifacts = { schemaVersion: "scene-artifacts/v3", turnPlan: core.createFallbackTurnPlanV3(question),
      representationTier: frames.tier, nonMetric: frames.nonMetric, candidates: [], diagramResultStatus: "ready", codeLesson: plan };
    savedParent.segments.push({ id: "shown-frame", orderIndex: 1, narration: "Reverse the first link.", spokenText: "Reverse the first link.",
      command: { type: "FRAME", params: [], charPosition: 0, narrationBefore: "" }, audioUrl: null, durationMs: 1_000, timings: null });
    const trusted = await canonicalizeTurnSceneMetadata({ ...savedParent, segments: savedParent.segments.map(({ durationMs, ...row }) => ({ ...row, ...(durationMs == null ? {} : { durationMs }) })) });
    assert(trusted.ok, `already-shown parent passes the actual server compile: ${trusted.ok ? "" : trusted.error}`);
    Object.assign(savedParent, trusted.value, { segments: trusted.value.segments.map((row, index) => ({ ...row,
      command: storedCommand(row.command), id: `shown-${index}`, audioUrl: null, durationMs: 1_000, timings: null })) });
  }
  if (partial) savedParent.segments.push({ id: "partial-type", orderIndex: 1, narration: "Define the node.", spokenText: "Define the node.",
    command: { type: "TYPE", params: [], text: firstBlock.code, semanticRef: { entityId: firstBlock.id }, charPosition: 0, narrationBefore: "", shownChars: partial }, audioUrl: null, durationMs: null, timings: null });
  const request = pausedLessonFromStoredTurns([savedParent], { boardId: "code-stop-board", ownerState: "inactive" });
  assert(request?.codeLesson, "actual saved-parent admission recognizes the code lesson");
  assert.equal(request.figureDrawn, mode === "already-drawn", "the controlled saved parent proves its claimed figure state");
  const registry = new LiveTurnSaveRegistry({ transport: {
    checkpoint: async () => ({ ok: false, status: 403, error: "controlled offline save", reason: "forbidden", retryable: false }),
    close: async () => ({ ok: false, status: 403, error: "controlled offline close", reason: "forbidden", retryable: false }),
  }, mintId: () => `resume-${mode}`, now: () => 1_000, isOnline: () => true, setTimer: () => 1, clearTimer: noop });
  const operations: Array<{ name: string; args: unknown[] }> = [];
  let committed = 0, aborted = 0, transactionStart = 0, streamCalls = 0, observedBeforeStream = 0;
  const board = new Proxy({ getDrawLayer: () => ({}), getInkSettings: () => ({ inkColor: "white", pencilThickness: 2 }),
    getCursorPosition: () => ({ x: 450, y: 142 }), beginDrawTransaction: () => { transactionStart = operations.length; return "own-intro"; },
    createDrawSavepoint: () => "beat", commitDrawTransaction: () => { committed++; }, abortDrawTransaction: () => { aborted++; operations.splice(transactionStart); },
    createDrawSavepointSnapshot: () => null }, { get: (target, key: string) => key in target ? target[key as keyof typeof target]
      : (...args: unknown[]) => { operations.push({ name: key, args }); return Promise.resolve(); } });
  const values = {
    sessionId: "code-stop-board", boards: [{ id: "code-stop-board", title: "Reversal" }], boardLoaded: true, isDraft: false, commitDraftBoard: undefined, phase: "idle", isReplaying: false,
    onComplete: undefined, onError: undefined, enableKeyboardControls: false,
    whiteboardRef: ref(board), cancelRef: ref(false), turnGenerationRef: ref(1), turnActiveRef: ref(false), phaseRef: ref("idle"), pendingSegmentCountRef: ref(0),
    turnAbortRef: ref<AbortController | null>(null), isPausedRef: ref(false), conversationHistoryRef: ref<Array<{ user: string; assistant: string }>>([]),
    boardPageRef: ref<ReturnType<typeof import("../../features/tutor-session/lib/turn/doubtTurn").resumePageRecord> | null>(null),
    boardLayoutRef: ref({ rects: [] }), activeVerifiedDiagramRef: ref(mode === "reload" ? null : frames.frames[0]!.presentation.diagram), codeLessonControllerRef: ref(controller),
    segmentChainRef: ref(Promise.resolve()), drawChainRef: ref(Promise.resolve()), collectedSegmentsRef: ref<TutorSegment[]>([]), recordedSegmentsRef: ref<RecordedSegmentPayload[]>([]),
    storedTurnsRef: ref([savedParent]), liveQuestionRef: ref(question), rawResponseRef: ref(""), currentTraceIdRef: ref<string | null>(null), turnTelemetryRef: ref(null),
    turnStatsRef: ref({ drawMs: 0, ttsChars: 0 }), segmentPlanStatsRef: ref(createEmptySegmentPlanStats()), narrationSinceEpochRef: ref(""),
    speedRef: ref(1), fastModeRef: ref(false), familiarityRef: ref("revision"), voicePreferencesRef: ref({}), pendingVoicePreferencesRef: ref(null),
    teachingPrefsRef: ref({ teachingNote: "", alwaysShowUnits: false, alwaysStateLawFirst: false }),
    fbdPhaseMarkedRef: ref(false), fbdPhaseStartedRef: ref(false), rewoundRef: ref(false), boardShowsStoppedReplayRef: ref(false),
    replayAudioPreloadRef: ref(new Map()), notesEpochsRef: ref([]), narrationDensityRef: ref(0), inkPaceRef: ref("follow"), adaptiveFactorRef: ref(1),
    setPhase: (phase: string) => { values.phaseRef.current = phase; }, setLastError: noop, setBoards: noop,
    ensureTTSClient: () => ({ unlockAudio: noop, stop: noop, prewarm: async () => {}, prefetchSegment: noop }),
    raceWithCancel: <T,>(promise: Promise<T>) => promise, cancellableDelay: async () => {}, reserveTextCommandPlacements: async (command: DrawCommand) => [command],
    resolveTextPlacement: async () => ({ x: 90, y: 208 }), resetBoardLayout: noop, forgetErasedTextRects: noop, clearCancelTimers: noop,
  };
  const dynamic = values as unknown as Record<string, unknown>;
  const params = new Proxy(dynamic, { get: (target, key: string) => key in target ? target[key] : key.endsWith("Ref") ? (target[key] = ref(null)) : noop });
  const execute = (load("features/tutor-session/hooks/useCommandExecution.ts").useCommandExecution as typeof import("../../features/tutor-session/hooks/useCommandExecution").useCommandExecution)(params as never).executeCommand;
  dynamic.executeCommandWithCancel = execute;
  let interrupted = false;
  const interruption: { page: typeof values.boardPageRef.current; diagram: typeof values.activeVerifiedDiagramRef.current; successorPage: typeof values.boardPageRef.current } = {
    page: null, diagram: null, successorPage: null,
  };
  const runSegment = async (segment: TutorSegment, index: number, _all: TutorSegment[], generation: number, _rollback?: unknown, _layout?: unknown, onRecorded?: (row: RecordedSegmentPayload) => void) => {
    const cancelled = () => values.cancelRef.current || generation !== values.turnGenerationRef.current;
    if (cancelled()) return;
    const commands = getSegmentCommands(segment);
    const row: RecordedSegmentPayload = { orderIndex: index, narration: segment.narration, spokenText: segment.narration,
      command: serializeSegmentCommands(commands, { trustedDiagramGeometry: segment.verifiedDiagramIntro === true }), audioBytes: null, durationMs: 1_000, timings: null };
    const pending = registry.prepareSegment(values.cancelRef, generation, row, { intro: onRecorded !== undefined,
      getTypeShownChars: (id) => controller.getState().revealedChars[id] ?? 0 });
    for (const command of commands) {
      if (cancelled()) break;
      await execute(command, { durationScale: 0, trustedDiagramGeometry: segment.verifiedDiagramIntro === true, isCancelled: cancelled });
      if (!interrupted && onRecorded && ["cancel-intro", "supersede-intro"].includes(mode)) {
        interrupted = true;
        interruption.page = values.boardPageRef.current;
        if (mode === "cancel-intro") values.cancelRef.current = true;
        else {
          values.turnGenerationRef.current++;
          interruption.diagram = { ...frames.frames[0]!.presentation.diagram, name: "successor-owned-diagram" };
          values.activeVerifiedDiagramRef.current = interruption.diagram;
          interruption.successorPage = { ...values.boardPageRef.current!, boardId: "successor-board", figureDrawn: true };
          values.boardPageRef.current = interruption.successorPage;
        }
      }
    }
    if (cancelled()) { pending?.interrupt(); return; }
    pending?.markShown(); pending?.complete(row); values.recordedSegmentsRef.current.push(row); onRecorded?.(row);
  };
  const admission = new LessonAdmission({ acquire: async () => ({ release: noop }), probe: async () => "inactive" });
  const overrides = {
    "../../lib/turn/liveTurnSave": { ...requireApp(path.join(app, "features/tutor-session/lib/turn/liveTurnSave.ts")), liveTurnSave: () => registry },
    "../../lib/turn/lessonOwnership": { lessonAdmission: () => admission },
    "./useSegmentRunner": { useSegmentRunner: () => ({ runSegment, speakingNarrationRef: ref(""), pauseFallbackSpeech: noop, resumeFallbackSpeech: noop, stopFallbackSpeech: noop }) },
  };
  const control = (load("features/tutor-session/hooks/turn/useTurnControl.ts", overrides).useTurnControl as typeof import("../../features/tutor-session/hooks/turn/useTurnControl").useTurnControl)(params as never, ref(async () => {}));
  let offered: PausedLessonRequest = request;
  if (mode === "already-drawn") {
    controller.frames.advance();
    values.activeVerifiedDiagramRef.current = controller.frames.current()!.presentation.diagram;
    offered = { ...request, figureDrawn: true };
  }
  const stream = frames.frames.slice(mode === "already-drawn" ? 2 : 0).map(frame => `[STEP]Explain ${frame.caption}. [FOCUS:${frame.id}|spotlight][/STEP]`).join("\n") +
    plan.sections[0]!.blocks.map(block => `[STEP]These lines implement the pointer update. [TYPE:${block.id}][/STEP]`).join("\n") + "[STEP]Visit each node once with three references.[/STEP]";
  const handler = (load("features/tutor-session/hooks/turn/useQuestionHandler.ts", {
    ...overrides,
    ...(["declined-presentation", "empty-presentation"].includes(mode) ? {
      "../../lib/scene/verifiedScenePresentation": {
        buildVerifiedDiagramPresentation: (...args: Parameters<typeof import("../../features/tutor-session/lib/scene/verifiedScenePresentation").buildVerifiedDiagramPresentation>) => {
          if (mode === "declined-presentation") return null;
          const actual: typeof import("../../features/tutor-session/lib/scene/verifiedScenePresentation") = requireApp(path.join(app, "features/tutor-session/lib/scene/verifiedScenePresentation.ts"));
          const result = actual.buildVerifiedDiagramPresentation(...args);
          return { ...result, diagram: { ...result.diagram, commands: [] }, introSegments: [] };
        },
      },
    } : {}),
    "@heytutor/tutor-core": { ...core, isExplanationOnlyDsaQuestion: codeIntent,
      streamLLMResponse: async (_options: unknown, content: (text: string) => void) => {
        streamCalls++; observedBeforeStream = controller.getState().revealedChars[firstBlock.id] ?? 0;
        content(stream); return { text: stream, traceId: null, streamStats: { finishReason: "stop" } };
      } },
    "@/lib/billing/billingClient": { beginTurn: async () => ({ ok: true }), rememberBillingFailure: noop, parseBillingFailureFromUnknown: () => null },
    "@/lib/boards/boardsClient": { ...requireApp(path.join(app, "lib/boards/boardsClient.ts")), fetchBoardDetail: async () => ({ turns: [savedParent] }), requestBoardTitle: async () => null },
  }).useQuestionHandler as typeof import("../../features/tutor-session/hooks/turn/useQuestionHandler").useQuestionHandler)(params as never, control);
  await handler.handleQuestion(question, { resume: offered });
  await values.segmentChainRef.current.catch(noop);
  const snapshot = registry.reopen("code-stop-board").find(turn => turn.turnId === `resume-${mode}`);
  return { controller, firstBlock, partial, observedBeforeStream, values, snapshot, operations, committed, aborted, streamCalls, savedParent, execute,
    interruptedPage: interruption.page, successorDiagram: interruption.diagram, successorPage: interruption.successorPage };
}

async function completeCase(mode: "same-context" | "reload" | "already-drawn" | "partial-code") {
  const f = await fixture(mode);
  assert.equal(f.streamCalls, 1, "resume never replans code or repeats its teaching request");
  assert(f.snapshot, "actual registry retains the taught resume");
  assert.equal(f.values.boardPageRef.current?.figureDrawn, true, "actual atomic queue commits the rebuilt first figure before saving gestures");
  assert.equal(f.snapshot.turn.visualStatus, "validated", "Continue upgrades its own actually committed figure metadata");
  assert.equal(f.committed, mode === "already-drawn" ? 0 : 1, "a drawn figure is not re-introduced");
  if (mode === "partial-code") assert.equal(f.observedBeforeStream, f.partial, "Continue cannot fill queued future code before a TYPE beat");
  const typeRows = f.snapshot.rows.flatMap(row => parseStoredSegmentCommands(row.command)).filter(command => command.type === "TYPE");
  assert.equal(typeRows.length, 8, "Python implementation retains all eight actually executed TYPE beats");
  assert.equal(f.controller.frames.current()?.id, "reversed", "actual executor lands on the last narrated frame");
  const canonical = await canonicalizeTurnSceneMetadata({ ...f.snapshot.turn, question,
    segments: f.snapshot.rows.map(({ durationMs, ...row }) => ({ ...row, ...(durationMs == null ? {} : { durationMs }) })) });
  assert(canonical.ok, `actual server compiler admits the captured scene: ${canonical.ok ? "" : canonical.error}`);
  const resumed: StoredTurn = { ...canonical.value, id: "saved-resume", orderIndex: 1, kind: "resume", question, rawResponse: "Recorded complete code lesson", speedMultiplier: 1, traceId: null,
    status: "complete", persistedStatus: "complete", segments: canonical.value.segments.map((row, index) => ({ ...row, command: storedCommand(row.command), id: `resume-${index}`, audioUrl: null, durationMs: 1_000, timings: null })) };
  const timeline = buildReplayTimeline([f.savedParent, resumed]);
  assert.equal(timeline.cues.flatMap(cue => cue.commands).filter(command => command.type === "TYPE").length, mode === "partial-code" ? 9 : 8);
  const track = buildCodeLessonExportTrack(f.savedParent, timeline.cues); assert(track);
  const spec = codeLessonFrameSpec(track, Number.POSITIVE_INFINITY);
  assert.equal(spec.revealedChars, core.codeLessonSectionCode(plan.sections[0]!).length, "End panel is exactly the recorded code");
  const stoppedPrefix = buildReplayTimeline([f.savedParent]);
  assert.equal(codeLessonFrameSpec(track, stoppedPrefix.totalMs - 1).revealedChars, mode === "partial-code" ? f.partial : 0,
    "the stopped prefix cannot borrow the later resume's code");
  const replayController = new CodeLessonController(); replayController.commit(plan); restoreDsaFrames(replayController, f.savedParent, plan);
  const replayParams = { ...f.values, codeLessonControllerRef: ref(replayController), cancelRef: ref(false), activeVerifiedDiagramRef: ref(frames.frames[0]!.presentation.diagram) };
  const replayExecute = (load("features/tutor-session/hooks/useCommandExecution.ts").useCommandExecution as typeof import("../../features/tutor-session/hooks/useCommandExecution").useCommandExecution)(replayParams as never).executeCommand;
  let previous = -1;
  if (mode !== "already-drawn") {
    const stoppedController = new CodeLessonController(); stoppedController.commit(plan); restoreDsaFrames(stoppedController, f.savedParent, plan);
    const stoppedExecute = (load("features/tutor-session/hooks/useCommandExecution.ts").useCommandExecution as typeof import("../../features/tutor-session/hooks/useCommandExecution").useCommandExecution)({ ...replayParams, codeLessonControllerRef: ref(stoppedController) } as never).executeCommand;
    const before = f.operations.length;
    await drawReplayDiagramTimeline({ cues: stoppedPrefix.cues, getClockMs: () => Number.POSITIVE_INFINITY, waitForAdvance: async () => {}, shouldCancel: () => false,
      executeCommand: (command, options) => stoppedExecute(command, { ...options, durationScale: 0 }), getTurn: () => f.savedParent, getDiagram: () => replayParams.activeVerifiedDiagramRef.current });
    assert(!f.operations.slice(before).some(operation => operation.name.startsWith("draw") || operation.name === "drawArrow"),
      "actual stopped-prefix dispatcher cannot paint any of the future linked-list geometry");
    assert.equal(stoppedController.getState().revealedChars.s1b1 ?? 0, mode === "partial-code" ? f.partial : 0,
      "actual stopped-prefix executor cannot fill untyped source");
  }
  await drawReplayDiagramTimeline({ cues: timeline.cues, getClockMs: () => Number.POSITIVE_INFINITY, waitForAdvance: async () => {}, shouldCancel: () => false,
    executeCommand: (command, options) => replayExecute(command, { ...options, durationScale: 0 }), getTurn: index => [f.savedParent, resumed][index], getDiagram: () => replayParams.activeVerifiedDiagramRef.current,
    onCueStart: async cue => { assert(await resetReplayPageAtTurn({ turn: [f.savedParent, resumed][cue.turnIndex], previousTurnIndex: previous, turnIndex: cue.turnIndex,
      whiteboard: f.values.whiteboardRef.current as never, resetBoardLayout: noop, shouldCancel: () => false })); previous = cue.turnIndex; } });
  assert.equal(replayController.frames.current()?.id, "reversed", "actual Replay/End dispatcher retains the last executed linked-list frame");
}
async function noFigureCase(mode: "unsupported" | "declined-presentation" | "empty-presentation") {
  const f = await fixture(mode);
  assert(f.snapshot, "actual code teaching remains a recorded contribution");
  assert.equal(f.committed, 0, "absent/declined/non-drawable presentation cannot commit an intro");
  assert.equal(f.values.activeVerifiedDiagramRef.current, null, "undrawn Continue clears the stale planned figure reference");
  assert.equal(f.controller.frames.getSet(), null, "a declined first figure cannot expose later walk frames");
  assert.equal(f.snapshot.turn.sceneDocument, null, "no executable figure leaves no persisted scene");
  assert.notEqual(f.snapshot.turn.visualStatus, "validated", "planned metadata cannot claim a validated drawn figure");
  assert(!f.snapshot.rows.some(row => isStoredCommandTrustedGeometry(row.command)), "no empty/unseen scene intro is saved");
  assert.equal(f.snapshot.rows.flatMap(row => parseStoredSegmentCommands(row.command)).filter(command => command.type === "TYPE").length, 8,
    "missing figure does not hide the explicitly requested Python program");
}
async function interruptedCase(mode: "cancel-intro" | "supersede-intro") {
  const f = await fixture(mode);
  assert.equal(f.committed, 0, "cancelled/superseded intro cannot commit");
  assert.equal(f.aborted, 1, "actual atomic queue aborts the owned intro");
  const page = f.interruptedPage; assert(page);
  assert.equal(page.figureDrawn, false);
  assert.equal(partialTurnScene(page).visualStatus, "text_only", "planned geometry stays withheld after cancellation");
  const kept = partialTurnSegments(f.snapshot?.rows ?? [], partialTurnScene(page));
  assert(!kept.some(row => row.command && typeof row.command === "object" && "trustedDiagramGeometry" in row.command), "no unseen intro geometry reaches the saved/replay chain");
  assert.equal(f.controller.getState().revealedChars.s1b1 ?? 0, 0, "cancelled queue cannot dump future code");
  if (mode === "supersede-intro") {
    assert.equal(f.values.activeVerifiedDiagramRef.current, f.successorDiagram, "old intro cleanup cannot erase the successor diagram reference");
    assert.equal(f.values.boardPageRef.current, f.successorPage, "old intro cleanup cannot replace the successor page");
    assert.equal(f.values.boardPageRef.current?.figureDrawn, true, "old intro cannot alter the successor figure receipt");
  }
}
const cases: Array<[string, () => Promise<void>]> = [
  ["same-context-undrawn", () => completeCase("same-context")], ["reload-undrawn", () => completeCase("reload")],
  ["already-drawn-keeps-frame", () => completeCase("already-drawn")], ["partial-type-prefix", () => completeCase("partial-code")],
  ["cancel-owned-intro", () => interruptedCase("cancel-intro")], ["supersede-owned-intro", () => interruptedCase("supersede-intro")],
  ["unsupported-undrawn", () => noFigureCase("unsupported")], ["declined-undrawn", () => noFigureCase("declined-presentation")],
  ["no-drawable-undrawn", () => noFigureCase("empty-presentation")],
];
const savedFetch = globalThis.fetch, savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
globalThis.fetch = (async (url: unknown) => { assert(/\/api\/(trace\/event|home-suggestions)$/.test(String(url)), `fixture forbids external/provider request: ${url}`); return Response.json({}); }) as typeof fetch;
Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout } });
const watchdog = setTimeout(() => { console.error("code Stop/Continue gate did not settle"); process.exit(1); }, 10_000);
void (async () => {
  const selected = process.env.CODE_STOP_CASE ? cases.filter(([name]) => name === process.env.CODE_STOP_CASE) : cases;
  assert(selected.length > 0, "unknown CODE_STOP_CASE");
  for (const [name, run] of selected) { await run(); console.log(`PASS ${name}`); }
  console.log(`PASS code Stop/Continue: ${selected.length} actual consumer groups; zero provider calls`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  clearTimeout(watchdog); globalThis.fetch = savedFetch;
  if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow); else Reflect.deleteProperty(globalThis, "window");
});
