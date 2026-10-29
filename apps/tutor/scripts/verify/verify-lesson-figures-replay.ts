/**
 * Lesson figures on stored surfaces (DIAGRAM_LESSON_FIGURES, lane 6).
 *
 * A stored lesson that moved to `[FOCUS:figure_2]` must replay, restore after
 * a reload, export and seek to the figure live showed, across a doubt that
 * swapped its own figure in and the resume after it. Flag off and lessons
 * without the artifact keep today's bytes.
 *
 * Fixture: the recorded circle lesson, with figure 2 the fast selector's
 * figure for "free body diagram of the body" on the composed question (as
 * the lane 4 persist gate), saved through the real server canonicalizer.
 *
 * Mutations this gate catches (brief lane 6 table):
 * (a) return figure_1: `pageFigureAt` returns the lesson at figure_1 on a resume;
 * (b) `restoreLessonFigures` not called in `useBoardSession` (board restore);
 * (c) ignore the advance in `lecturePlayer` (a return installs figure 1's state);
 * (d) rebuild figure k on `Turn.question` instead of the composed question.
 */
import assert from "node:assert/strict";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import type Konva from "konva";
import { isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands, type DrawCommand, type VerifiedDiagram } from "@heytutor/drawing";
import circle from "./fixtures/replay/circle-s3-turn.json";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { composeLessonFigureQuestion, lessonFiguresOf, type StoredLessonFigure } from "../../lib/boards/lessonFigures";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import { lessonFigureReturnAfter, pageFigureAt, storedTurnFocusIds } from "../../lib/boards/pageFigure";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { figureFingerprint, selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { stored } from "./fixtures/doubtFigureScene";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { LessonFigureSequence, lessonFigureIntroCommands } from "../../features/tutor-session/lib/scene/lessonFigureSequence";
import { restoreLessonFigureViews, restoreLessonFigures } from "../../features/tutor-session/lib/scene/restoreLessonFigures";
import { storedLessonFigurePresentation, storedPageFigureChange, syncStoredPageFigure } from "../../features/tutor-session/lib/replay/pageFigureSync";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { lectureInstalledDiagramByTurn } from "../../lib/replay/lecturePlayer";
import type { useCommandExecution as CommandHook } from "../../features/tutor-session/hooks/useCommandExecution";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const focus = (id: string): DrawCommand => ({ type: "FOCUS", params: [], text: id, semanticRef: { entityId: id }, charPosition: 0, narrationBefore: "" });
const write = (text: string): DrawCommand => ({ type: "WRITE", params: [90, 142], text, charPosition: 0, narrationBefore: "" });
const row = (orderIndex: number, narration: string, commands: DrawCommand[]) => ({
  orderIndex, narration, spokenText: narration,
  command: serializeSegmentCommands(commands, { trustedDiagramGeometry: false }),
});

const recorded = circle.turn as unknown as {
  question: string; sceneDocument: unknown; sceneArtifacts: Record<string, unknown> & { turnPlan: TurnPlanV3; representationTier: string };
  segments: Array<{ orderIndex: number; narration: string; spokenText?: string; command: unknown }>;
};
const LESSON = recorded.question;
const ASK = "free body diagram of the body";
const COMPOSED = composeLessonFigureQuestion(LESSON, ASK);
const L_ID = "a1111111-1111-4111-8111-111111111111";
const P_ID = "a2222222-2222-4222-8222-222222222222";
const D_ID = "a3333333-3333-4333-8333-333333333333";
const R_ID = "a4444444-4444-4444-8444-444444444444";

function figureTwo(): StoredLessonFigure {
  const plan = validateTurnPlanV3({ ...recorded.sceneArtifacts.turnPlan, question: COMPOSED }, COMPOSED).plan!;
  const gate = deriveSceneGate({ question: COMPOSED, turnPlan: plan, problemIR: null, conversationContext: "" });
  const fast = selectFastFigure({ question: COMPOSED, turnPlan: plan, authority: null, families: gate.sceneCapabilities.families });
  assert(fast, "the fast selector draws figure 2 on the composed question");
  return { id: "figure_2", ask: ASK, sceneDocument: fast.sceneDocument, tier: fast.tier, family: fast.family ?? null, figureSource: "fast_family" };
}

function baseRows(): SubmittedTurnSceneMetadata["segments"] {
  return recorded.segments.map((segment) => ({
    orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText ?? segment.narration, command: segment.command,
  }));
}

function lessonMetadata(segments: SubmittedTurnSceneMetadata["segments"], extra: Record<string, unknown> = {}): SubmittedTurnSceneMetadata {
  return {
    question: LESSON,
    sceneDocument: structuredClone(recorded.sceneDocument),
    visualStatus: "validated",
    sceneArtifacts: { ...structuredClone(recorded.sceneArtifacts), ...extra },
    segments,
  };
}

export interface LessonFiguresPage {
  figure: StoredLessonFigure;
  firstOnly: string;
  secondOnly: string;
  secondToo: string;
  /** [L (advances to figure_2), P (plain doubt, points at figure 2), D (its own figure), R (resume)]. */
  turns: StoredTurn[];
}

/** The page, flag on (the artifact kept) or off (stripped at save). */
export async function lessonFiguresPage(flag: boolean): Promise<LessonFiguresPage> {
  const figure = figureTwo();
  const artifact = { schemaVersion: "lesson-figures/v1", figures: [figure] };
  const probe = await canonicalizeTurnSceneMetadata(lessonMetadata(baseRows(), { lessonFigures: artifact }), { lessonFiguresEnabled: true });
  assert(probe.ok, `the probe lesson saves: ${probe.ok ? "" : probe.error}`);
  // Part ids from the server's own admission, independent of the client rebuild under test.
  const storedFigure = lessonFiguresOf(probe.value.sceneArtifacts)!.figures[0]!;
  const admitted = admitStoredScene({
    sceneDocument: storedFigure.sceneDocument, sceneQuestion: COMPOSED, submittedTier: storedFigure.tier,
    turnPlan: validateTurnPlanV3({ ...recorded.sceneArtifacts.turnPlan, question: COMPOSED }, COMPOSED).plan,
  });
  assert(admitted.ok, "figure 2 admits on the composed question");
  const second = admitted.presentation.diagram;
  const firstDiagram = restoreVerifiedDiagramFromTurn(stored(L_ID, 0, LESSON, probe.value, { opensOnClear: true, kind: "lesson" }))!;
  const firstIds = new Set(firstDiagram.anchors.map((anchor) => anchor.id));
  const secondIds = second.anchors.map((anchor) => anchor.id).filter((id) => !firstIds.has(id));
  const firstOnly = [...firstIds].find((id) => !second.anchors.some((anchor) => anchor.id === id));
  assert(firstOnly && secondIds.length >= 2, "each figure has parts the other does not");
  const [secondOnly, secondToo] = secondIds as [string, string];

  const n = recorded.segments.length;
  const saved = await canonicalizeTurnSceneMetadata(lessonMetadata([
    ...baseRows(),
    row(n, "First, the circle part.", [focus(firstOnly)]),
    row(n + 1, "Now the second figure.", [focus("figure_2")]),
    row(n + 2, "Here is the body.", [focus(secondOnly)]),
  ], { lessonFigures: artifact }), { lessonFiguresEnabled: flag });
  assert(saved.ok, `the lesson saves: ${saved.ok ? "" : saved.error}`);
  assert.equal(Boolean(lessonFiguresOf(saved.value.sceneArtifacts)), flag, flag ? "the artifact is kept" : "flag off strips the artifact");
  const lesson = stored(L_ID, 0, LESSON, saved.value, { opensOnClear: true, kind: "lesson" });

  const continuation = boardContinuationArtifacts(LESSON);
  const plain = stored(P_ID, 1, "Doubt: what is that force?", {
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: continuation,
    segments: [row(0, "That force is this one.", [focus(secondToo)])],
  }, { opensOnClear: false, kind: "doubt" });
  // A doubt that drew its own figure (shape only: pageFigureAt reads the marker).
  const doubt = stored(D_ID, 2, "Doubt: show me the circle again", {
    sceneDocument: structuredClone(saved.value.sceneDocument), sceneEngineVersion: saved.value.sceneEngineVersion,
    validationReport: saved.value.validationReport, visualStatus: "validated",
    sceneArtifacts: { ...continuation, ...doubtFigureArtifacts(L_ID) },
    segments: [row(0, "On this copy, the centre.", [focus(firstOnly)])],
  }, { opensOnClear: false, kind: "doubt" });
  const resume = stored(R_ID, 3, LESSON, {
    sceneDocument: saved.value.sceneDocument, sceneEngineVersion: saved.value.sceneEngineVersion,
    validationReport: saved.value.validationReport, visualStatus: "validated",
    sceneArtifacts: { ...(saved.value.sceneArtifacts as unknown as Record<string, unknown>), ...continuation },
    segments: [row(0, "So the point is outside.", [write("d > r")])],
  }, { opensOnClear: false, kind: "resume" });
  return { figure, firstOnly, secondOnly, secondToo, turns: [lesson, plain, doubt, resume] };
}

async function pageFigureChecks(): Promise<void> {
  const on = await lessonFiguresPage(true);
  const off = await lessonFiguresPage(false);

  await check("page/opener-starts-on-figure-1", () => {
    const at = pageFigureAt(on.turns, 0);
    assert.equal(at.sourceIndex, 0);
    assert.equal(at.figureId, "figure_1");
  });
  await check("page/plain-doubt-points-at-figure-2", () => {
    const at = pageFigureAt(on.turns, 1);
    assert.equal(at.sourceIndex, 0);
    assert.equal(at.figureId, "figure_2", "the advance in L moved the zone to figure 2");
    assert.deepEqual(at.consumedIds, [on.secondOnly], "only the ids L released after its advance");
  });
  await check("page/doubt-figure-swaps-in", () => {
    const at = pageFigureAt(on.turns, 2);
    assert(at.swapIn && at.sourceIndex === 2 && at.figureId === "figure_1", "the doubt's own figure is in the zone");
  });
  await check("page/resume-returns-figure-2", () => {
    const at = pageFigureAt(on.turns, 3);
    assert(at.returnsLesson && at.sourceIndex === 0, "R returns the lesson");
    assert.equal(at.figureId, "figure_2", "R returns figure 2, the figure reached before the doubt");
    assert.deepEqual(at.consumedIds, [on.secondOnly, on.secondToo],
      "only ids released on figure 2: not figure 1's, not the advance cue, not the doubt figure's");
  });
  await check("page/reload-return-names-figure-2", () => {
    const back = lessonFigureReturnAfter(on.turns.slice(0, 3));
    assert(back, "a reload after D must return the lesson");
    assert.equal(back.sourceIndex, 0);
    assert.equal(back.figureId, "figure_2");
    assert.deepEqual(back.consumedIds, [on.secondOnly, on.secondToo]);
  });
  await check("page/forward-only", () => {
    // A second cue to figure 2 in a later resume is a repeat, not a new advance.
    const again = { ...on.turns[3]!, segments: [...on.turns[3]!.segments, { ...on.turns[3]!.segments[0]!, id: "again", orderIndex: 9, command: serializeSegmentCommands([focus("figure_2")], { trustedDiagramGeometry: false }) as StoredTurn["segments"][number]["command"] }] };
    const turns = [...on.turns.slice(0, 3), again, { ...on.turns[1]!, id: "b5555555-5555-4555-8555-555555555555", orderIndex: 4 }];
    assert.equal(pageFigureAt(turns, 4).figureId, "figure_2");
    assert(pageFigureAt(turns, 4).consumedIds.includes("figure_2"), "a repeat cue is a plain FOCUS id, as the server keeps none");
  });
  await check("page/flag-off-stays-on-figure-1", () => {
    for (let index = 0; index < off.turns.length; index += 1) {
      assert.equal(pageFigureAt(off.turns, index).figureId, "figure_1", `turn ${index} stays on figure 1`);
    }
    const at = pageFigureAt(off.turns, 3);
    assert(at.returnsLesson && at.sourceIndex === 0);
    // Lane 1's rule: every id the lesson's turns before R released.
    const before = [...new Set([...storedTurnFocusIds(off.turns[0]!), ...storedTurnFocusIds(off.turns[1]!)])];
    assert(before.includes(on.firstOnly) && !before.includes(on.secondOnly) && !before.includes("figure_2"), "the server kept figure 1's ids only");
    assert.deepEqual(at.consumedIds, before, "every id released on figure 1, as before lane 6");
  });
  await check("page/no-artifact-cue-is-a-plain-id", () => {
    // A hand-made lesson with the cue but no artifact never advances.
    const bare = { ...on.turns[0]!, sceneArtifacts: { ...(on.turns[0]!.sceneArtifacts as Record<string, unknown>), lessonFigures: undefined } };
    const turns = [bare, ...on.turns.slice(1)];
    assert.equal(pageFigureAt(turns, 1).figureId, "figure_1");
    assert.deepEqual(pageFigureAt(turns, 1).consumedIds, storedTurnFocusIds(bare));
    assert(storedTurnFocusIds(bare).includes("figure_2"));
  });
}

// ---------------------------------------------------------------------------
// The rebuild, the sync step, the player's install state.
// ---------------------------------------------------------------------------

const ids = (diagram: VerifiedDiagram | null) => (diagram?.anchors ?? []).map((anchor) => anchor.id).sort();

async function restoreChecks(): Promise<void> {
  const on = await lessonFiguresPage(true);
  const off = await lessonFiguresPage(false);
  const [L] = on.turns as [StoredTurn];

  await check("rebuild/composed-question", () => {
    const views = restoreLessonFigureViews(L);
    assert.deepEqual(views.map((view) => view.id), ["figure_2"]);
    assert.equal(views[0]!.family, on.figure.family);
    assert(views[0]!.introSegments.length > 0, "figure 2 has intro beats");
  });
  await check("rebuild/lesson-question-document-is-dropped", () => {
    // A figure 2 document whose source question is the lesson's own, not the composed one.
    const artifacts = structuredClone(L.sceneArtifacts) as unknown as { lessonFigures: { figures: Array<{ sceneDocument: { source: { question: string } } }> } };
    artifacts.lessonFigures.figures[0]!.sceneDocument.source.question = LESSON;
    const forged = { ...L, sceneArtifacts: artifacts as unknown as StoredTurn["sceneArtifacts"] };
    assert.deepEqual(restoreLessonFigureViews(forged), [], "planned on the lesson's own question: never drawn");
    const sequence = new LessonFigureSequence();
    restoreLessonFigures(sequence, forged);
    assert(!sequence.active(), "no sequence from a forged figure");
  });
  await check("rebuild/sequence-and-at", () => {
    const sequence = new LessonFigureSequence();
    restoreLessonFigures(sequence, L);
    assert(sequence.active() && sequence.currentId() === "figure_1");
    restoreLessonFigures(sequence, L, undefined, "figure_2");
    assert.equal(sequence.currentId(), "figure_2", "a return commits at the figure it returns");
    restoreLessonFigures(sequence, off.turns[0]);
    assert(!sequence.active(), "flag off: no artifact, no sequence");
  });
  await check("sync/return-draws-figure-2", async () => {
    const R = 3;
    const change = storedPageFigureChange(on.turns, R);
    assert(change.kind === "return" && change.figureId === "figure_2", "R returns figure 2");
    const drawn: DrawCommand[] = [];
    const events: string[] = [];
    const wb = {
      eraseSceneInk: async (duration: number) => { events.push(`eraseSceneInk:${duration}`); },
      erasePinnedInk: () => { events.push("erasePinnedInk"); },
    } as unknown as WhiteboardHandle;
    const sequence = new LessonFigureSequence();
    const result = await syncStoredPageFigure({
      turns: on.turns, turnIndex: R, whiteboard: wb, shouldCancel: () => false, lessonFigures: sequence,
      executeCommand: async (command) => { drawn.push(command); },
    });
    assert(result.changed && !result.cancelled);
    const figure2 = storedLessonFigurePresentation(L, "figure_2");
    assert.deepEqual(ids(result.diagram), ids(figure2.diagram), "the zone's diagram is figure 2");
    assert.equal(figureFingerprint(result.diagram!), figureFingerprint(figure2.diagram!));
    const intro = lessonFigureIntroCommands({ diagram: figure2.diagram!, introSegments: figure2.introSegments });
    assert.deepEqual(drawn.slice(0, intro.length).map((command) => command.type), intro.map((command) => command.type), "figure 2's intro is stamped back");
    assert.equal(sequence.currentId(), "figure_2", "the sequence is at figure 2 after the return");
  });
  await check("sync/flag-off-returns-figure-1", async () => {
    const change = storedPageFigureChange(off.turns, 3);
    assert(change.kind === "return" && change.figureId === "figure_1");
    const sequence = new LessonFigureSequence();
    const wb = { eraseSceneInk: async () => {}, erasePinnedInk: () => {} } as unknown as WhiteboardHandle;
    const result = await syncStoredPageFigure({
      turns: off.turns, turnIndex: 3, whiteboard: wb, shouldCancel: () => false, lessonFigures: sequence, executeCommand: async () => {},
    });
    assert(result.changed && ids(result.diagram).join() === ids(storedLessonFigurePresentation(off.turns[0]!, "figure_1").diagram).join());
    assert(!sequence.active());
  });

  await check("player/installed-after-an-advance", () => {
    const withErase = (turns: StoredTurn[]) => turns.map((turn, index) => index !== 3 ? turn : {
      ...turn,
      segments: [...turn.segments, { ...turn.segments[0]!, id: "erase", orderIndex: 9, narration: "Clean the row.", command: serializeSegmentCommands([{ type: "ERASE", params: [40, 140, 300, 40], charPosition: 0, narrationBefore: "" }], { trustedDiagramGeometry: false }) as StoredTurn["segments"][number]["command"] }],
    });
    const turns = withErase(on.turns);
    const installed = lectureInstalledDiagramByTurn(turns, buildReplayTimeline(turns).cues);
    assert.deepEqual([0, 1, 2, 3].map((index) => installed.get(index)), [true, true, true, true], "a figure stands in the zone on every turn");
    // Figure 2 does not rebuild on this client: R returns nothing, as syncTurn does.
    const artifacts = structuredClone(on.turns[0]!.sceneArtifacts) as unknown as { lessonFigures: { figures: Array<{ sceneDocument: { source: { question: string } } }> } };
    artifacts.lessonFigures.figures[0]!.sceneDocument.source.question = LESSON;
    const broken = withErase([{ ...on.turns[0]!, sceneArtifacts: artifacts as unknown as StoredTurn["sceneArtifacts"] }, ...on.turns.slice(1)]);
    const brokenInstalled = lectureInstalledDiagramByTurn(broken, buildReplayTimeline(broken).cues);
    assert.equal(brokenInstalled.get(3), false, "R returns figure 2, which is not there: the zone is empty");
  });
}

// ---------------------------------------------------------------------------
// Board restore: the real executor over L's stored rows at durationScale 0.
// ---------------------------------------------------------------------------

const SOURCE_ROOT = fileURLToPath(new URL("../../features/tutor-session/", import.meta.url));
const EXECUTOR = path.join(SOURCE_ROOT, "hooks/useCommandExecution.ts");
function loadExecutor(): typeof CommandHook {
  const requireApp = createRequire(new URL("../../package.json", import.meta.url));
  const react = { useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn, useEffect: () => {}, useState: (value: unknown) => [value, () => {}] };
  const compiled = ts.transpileModule(readFileSync(EXECUTOR, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { useCommandExecution: typeof CommandHook } };
  new Function("require", "module", "exports", compiled)((specifier: string) =>
    specifier === "react" ? react : requireApp(specifier.startsWith(".")
      ? path.resolve(path.dirname(EXECUTOR), specifier) : specifier), mod, mod.exports);
  return mod.exports.useCommandExecution;
}
const ref = <T>(current: T) => ({ current });
const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 40; index++) await Promise.resolve();
};

function boardFixture(hook: typeof CommandHook, diagram: VerifiedDiagram | null, sequence: LessonFigureSequence | null) {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const activeVerifiedDiagramRef = ref<VerifiedDiagram | null>(diagram);
  const executor = hook({
    whiteboardRef: ref(board), cancelRef: ref(false), activeVerifiedDiagramRef,
    fbdPhaseStartedRef: ref(Boolean(diagram)), fbdPhaseMarkedRef: ref(false),
    boardLayoutRef: ref({ rects: [], nextY: 100 }), inkPaceRef: ref("follow"),
    speedRef: ref(1), adaptiveFactorRef: ref(1), forceSequentialWorkLayoutRef: ref(false),
    turnTelemetryRef: ref(null), notesEpochsRef: ref([]), narrationSinceEpochRef: ref(""),
    raceWithCancel: async (promise) => promise,
    resolveTextPlacement: async (_command, x, y) => ({ x, y }),
    cancellableDelay: async () => {}, forgetErasedTextRects() {}, resetBoardLayout() {},
    lessonFiguresRef: ref(sequence),
    setActiveVerifiedDiagram: () => {},
    nowMs: clock.source.now,
  } as Parameters<typeof CommandHook>[0]);
  const run = async (command: DrawCommand, trustedDiagramGeometry: boolean) => {
    let settled = false;
    const job = executor.executeCommandWithCancel(command, {
      durationScale: 0, applyLayout: false, trustedDiagramGeometry, isCancelled: () => false,
    }).then(() => { settled = true; });
    await flush();
    for (let elapsed = 0; !settled && elapsed < 60_000; elapsed += 64) {
      clock.advance(64); clock.pump(); await flush();
    }
    assert(settled, `${command.type} ${command.text ?? ""} finishes`);
    await job;
  };
  const sceneInk = () => board.getDrawLayer()!.getChildren()
    .filter((node: Konva.Node) => node.getAttrs().htInk === "scene")
    .map((node: Konva.Node) => JSON.stringify(node.toObject()))
    .sort();
  return { board, run, sceneInk, activeVerifiedDiagramRef };
}

const stripComments = (raw: string) => raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
function anchoredSlice(file: string, name: string): string {
  const source = readFileSync(path.join(SOURCE_ROOT, file), "utf8");
  // Whole anchor lines only: "// x:end" must not match "// x:ended".
  const begin = source.indexOf(`// ${name}:begin\n`);
  const end = source.indexOf(`// ${name}:end\n`, begin);
  assert(begin >= 0, `slice anchor: ${name}:begin in ${file}`);
  assert(end > begin, `slice anchor: ${name}:end after its begin in ${file}`);
  assert.equal(source.split(`// ${name}:begin`).length, 2, `one ${name}:begin in ${file}`);
  assert.equal(source.split(`// ${name}:end`).length, 2, `one ${name}:end in ${file}`);
  return stripComments(source.slice(begin, end));
}

async function boardRestoreChecks(): Promise<void> {
  const on = await lessonFiguresPage(true);
  const L = on.turns[0]!;
  const hook = loadExecutor();
  const sorted = [...L.segments].sort((a, b) => a.orderIndex - b.orderIndex);

  // Expected: figure 2 alone, its intro, then the one part L named on it.
  const alone = new LessonFigureSequence();
  restoreLessonFigures(alone, L, undefined, "figure_2");
  const view = alone.views()[0]!;
  const expectedBoard = boardFixture(hook, view.diagram, null);
  let expected: string[];
  try {
    for (const command of lessonFigureIntroCommands(view)) await expectedBoard.run(command, true);
    await expectedBoard.run(focus(on.secondOnly), false);
    expected = expectedBoard.sceneInk();
  } finally { expectedBoard.board.cancelAnimations(); await flush(); unmountTestWhiteboard(expectedBoard.board); }
  assert(expected.length > 0);

  await check("restore/stamped-rows-end-on-figure-2", async () => {
    // As useBoardSession restores an opener: commit, then every stored row at scale 0.
    const sequence = new LessonFigureSequence();
    restoreLessonFigures(sequence, L);
    const f = boardFixture(hook, storedLessonFigurePresentation(L, "figure_1").diagram, sequence);
    try {
      for (const segment of sorted) {
        const trusted = isStoredCommandTrustedGeometry(segment.command);
        for (const command of parseStoredSegmentCommands(segment.command)) {
          if (command.type === "CLEAR") continue;
          await f.run(command, trusted);
        }
      }
      assert.equal(sequence.currentId(), "figure_2");
      assert.deepEqual(ids(f.activeVerifiedDiagramRef.current), ids(view.diagram), "figure 2 is the active diagram");
      assert.deepEqual(f.sceneInk(), expected, "the zone holds figure 2's intro and the part L named on it, nothing of figure 1");
    } finally { f.board.cancelAnimations(); await flush(); unmountTestWhiteboard(f.board); }
  });
  await check("restore/useBoardSession-commits-the-sequence", () => {
    const slice = anchoredSlice("hooks/useBoardSession.ts", "lesson-figures-restore");
    assert(/restoreLessonFigures\(lessonFiguresRef\?\.current, turn\)/.test(slice), "the opener commits its later figures");
    const session = stripComments(readFileSync(path.join(SOURCE_ROOT, "hooks/useBoardSession.ts"), "utf8"));
    assert(/lessonFigures: lessonFiguresRef\?\.current,/.test(session), "a continuation's return commits it too");
  });
  await check("surfaces/every-sync-point-commits", () => {
    const read = (file: string) => stripComments(readFileSync(path.join(SOURCE_ROOT, file), "utf8"));
    const replay = read("hooks/useReplay.ts");
    assert(/restoreLessonFigures\(lessonFiguresRef\?\.current, turn\)/.test(replay) && /lessonFigures: lessonFiguresRef\?\.current,/.test(replay), "replay");
    const player = read("hooks/useLecturePlayer.ts");
    assert(/restoreLessonFigures\(lessonFiguresRef\.current, turn\)/.test(player) && /lessonFigures: lessonFiguresRef\.current,/.test(player) && /\blessonFiguresRef,\n\s*nowMs/.test(player), "player");
    const exportHook = read("hooks/useLectureExport.ts");
    assert(/lessonFigures: lessonFiguresRef\.current,/.test(exportHook) && /\blessonFiguresRef,\n\s*nowMs/.test(exportHook), "export hook");
    const exporter = stripComments(readFileSync(fileURLToPath(new URL("../../lib/lecture-export/exportLectureMp4.ts", import.meta.url)), "utf8"));
    assert(/restoreLessonFigures\(options\.lessonFigures, turn\)/.test(exporter) && /lessonFigures: options\.lessonFigures,/.test(exporter), "export");
    const shell = read("TutorSessionShell.tsx");
    assert.equal(shell.match(/^\s+lessonFiguresRef,$/gm)?.length, 4, "the shell passes its sequence to the executor, uQH, restore and replay");
  });
}

async function main(): Promise<void> {
  await pageFigureChecks();
  await restoreChecks();
  await boardRestoreChecks();
  console.log(`verify-lesson-figures-replay: ${passed} checks passed`);
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
