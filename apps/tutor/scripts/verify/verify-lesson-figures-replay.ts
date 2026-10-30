/**
 * Lesson figures on stored surfaces (DIAGRAM_LESSON_FIGURES, lane 6).
 *
 * A stored lesson that moved to `[FOCUS:figure_2]` must replay, restore after
 * a reload, export and seek to the figure live showed, across a doubt that
 * swapped its own figure in and the resume after it. Flag off and lessons
 * without the artifact keep today's bytes.
 *
 * Fixture: the recorded circle lesson, with figure 2 the fast selector's
 * figure for the view "vector_diagram" on the composed question (as
 * the lane 4 persist gate), saved through the real server canonicalizer.
 *
 * Mutations this gate catches (brief lane 6 table):
 * (a) return figure_1: `pageFigureAt` returns the lesson at figure_1 on a resume;
 * (b) `restoreLessonFigures` not called in `useBoardSession` (board restore);
 * (c) ignore the advance in `lecturePlayer` (a return installs figure 1's state);
 * (d) rebuild figure k on `Turn.question` instead of the composed question;
 * (e) uQH `doubt-figure-return` returns figure 1 after a reload;
 * (f) `pausedLessonRestore` drops `returnsFigure.figureId`;
 * (g) `pageFigureLoader` ignores `figureId` (a doubt pointing at figure 2 is
 *     checked against figure 1 and loses its FOCUS);
 * (h) the loader takes any stored later figure, not the one named (a forged
 *     `figure_3` resolves);
 * (i) the figure cache key drops `figureId` (figure 2 is served for figure 1);
 * (j) the canonicalizer keeps `figureId` with the flag off;
 * (k) uQH `doubt-lesson-figure` drops the zone's figure id.
 *
 * Lane 8a (round 2 review):
 * (l) F3: the loader skips the `page-figure-reached` walk (a doubt naming
 *     figure 2 on a page that never advanced keeps its FOCUS);
 * (m) F3: the walk ignores the source turn (a figure named on L while a
 *     doubt's own figure holds the zone resolves);
 * (n) F1: the canonicalizer drops the resume start (`resumeStart` null): a
 *     resume's FOCUS on a figure 2 part after the advance is filtered;
 * (o) F1: the start loader names figure 1 always.
 *
 * Lane 10 (round 3 review):
 * (p) M1: `restoreLessonFigures` moves to figure k with `advanceTo` (pending),
 *     so the next doubt's lesson-figure-finish erases and redraws figure k;
 * (q) M1: `seekTo` leaves the figure pending.
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
import { LESSON_FIGURES_VERSION, composeLessonFigureQuestion, lessonFiguresOf, type StoredLessonFigure } from "../../lib/boards/lessonFigures";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import { DOUBT_FIGURE_REF_VERSION, doubtFigureRefArtifacts, type DoubtFigureRef } from "../../lib/boards/doubtFigureRef";
import { bindLessonFigureStart, bindPageFigureLoader, memoryPageFigureStore, type PageFigureTurn } from "../../lib/scene/pageFigureLoader";
import { doubtFigureRefFor } from "../../features/tutor-session/lib/turn/doubtTurn";
import { lessonFigureReturnAfter, pageFigureAt, storedTurnFocusIds } from "../../lib/boards/pageFigure";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { figureFingerprint, lessonFigureIdInZone, selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { stored } from "./fixtures/doubtFigureScene";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";
import { lessonRecoveryFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import { storedPageZoneStash } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { restoreVerifiedDiagramFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { LessonFigureSequence, finishLessonFigureAdvance, lessonFigureIntroCommands } from "../../features/tutor-session/lib/scene/lessonFigureSequence";
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
/** A closed view the engine draws on this lesson as a figure other than figure 1 (the client would refuse it as not a lesson family; the server checks truth only). */
const VIEW = "vector_diagram" as const;
const COMPOSED = composeLessonFigureQuestion(LESSON, VIEW);
const L_ID = "a1111111-1111-4111-8111-111111111111";
const P_ID = "a2222222-2222-4222-8222-222222222222";
const D_ID = "a3333333-3333-4333-8333-333333333333";
const R_ID = "a4444444-4444-4444-8444-444444444444";

function figureTwo(): StoredLessonFigure {
  const plan = validateTurnPlanV3({ ...recorded.sceneArtifacts.turnPlan, question: COMPOSED }, COMPOSED).plan!;
  const gate = deriveSceneGate({ question: COMPOSED, turnPlan: plan, problemIR: null, conversationContext: "" });
  const fast = selectFastFigure({ question: COMPOSED, turnPlan: plan, authority: null, families: [VIEW, ...gate.sceneCapabilities.families] });
  assert(fast && fast.family === VIEW, "the fast selector draws figure 2, of the picked view, on the composed question");
  return { id: "figure_2", view: VIEW, sceneDocument: fast.sceneDocument, tier: fast.tier, family: VIEW, figureSource: "fast_family" };
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
  const artifact = { schemaVersion: LESSON_FIGURES_VERSION, figures: [figure] };
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
    // Round 3 M1: the surface stands figure 2 whole itself; nothing is left for a later turn to finish.
    assert.equal(sequence.pendingIntro(), null, "a restore at figure 2 leaves no pending advance");
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
  await check("m1/labels-survive-restore-then-doubt", async () => {
    // Round 3 M1: a reload restores R (figure 2 back with whatever L's rows
    // released on it), then the student asks a doubt. uQH's lesson-figure-finish runs
    // finishLessonFigureAdvance on any pending figure: it must find none, so
    // nothing is erased and nothing redrawn without those labels.
    const R = 3;
    const events: string[] = [];
    const drawn: DrawCommand[] = [];
    const wb = {
      eraseSceneInk: async (duration: number) => { events.push(`eraseSceneInk:${duration}`); },
      erasePinnedInk: () => { events.push("erasePinnedInk"); },
    } as unknown as WhiteboardHandle;
    const sequence = new LessonFigureSequence();
    const result = await syncStoredPageFigure({
      turns: on.turns, turnIndex: R, whiteboard: wb, shouldCancel: () => false, lessonFigures: sequence,
      executeCommand: async (command) => { drawn.push(command); },
    });
    assert(result.changed && !result.cancelled && sequence.currentId() === "figure_2");
    const figure2 = storedLessonFigurePresentation(L, "figure_2");
    const intro = lessonFigureIntroCommands({ diagram: figure2.diagram!, introSegments: figure2.introSegments });
    // This fixture's figure 2 withholds no label, so the check proves the zone's
    // ink (released labels and kept rings included) is never touched again,
    // rather than counting labels.
    assert(drawn.length >= intro.length && drawn.length > 0, "the return stamped figure 2");
    const restored = { events: [...events], drawn: drawn.map((command) => JSON.stringify(command)) };
    const finished = await finishLessonFigureAdvance(wb, null, sequence, { executeCommand: async (command) => { drawn.push(command); } });
    assert.equal(finished, null, "the doubt after the restore finishes nothing");
    assert.deepEqual(events, restored.events, "no erase after the restore");
    assert.deepEqual(drawn.map((command) => JSON.stringify(command)), restored.drawn, "the released labels stay; nothing is redrawn");
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

// ---------------------------------------------------------------------------
// Continue after a reload: the resume returns figure 2, live and stored alike.
// ---------------------------------------------------------------------------

async function resumeChecks(): Promise<void> {
  const on = await lessonFiguresPage(true);
  const off = await lessonFiguresPage(false);
  const stoppedAt = (turns: StoredTurn[], lastLesson: number) => turns.map((turn, index) => index === lastLesson
    ? { ...turn, status: "stopped" as const, persistedStatus: "stopped" as const }
    : { ...turn, persistedStatus: "complete" as const });

  await check("paused/returns-figure-2", () => {
    const recovery = lessonRecoveryFromStoredTurns(stoppedAt(on.turns.slice(0, 3), 0), { boardId: "b1", ownerState: "inactive" });
    assert(recovery?.kind === "continue", "the stopped lesson under a doubt figure can Continue");
    const back = recovery.request.returnsFigure;
    assert(back, "Continue returns the lesson's figure");
    assert.equal(back.turnId, on.turns[0]!.id);
    assert.equal(back.figureId, "figure_2", "the figure the lesson had moved to");
    assert.deepEqual(back.consumedIds, [on.secondOnly, on.secondToo], "only what was released on figure 2");
  });
  await check("paused/flag-off-has-no-figure-id", () => {
    const recovery = lessonRecoveryFromStoredTurns(stoppedAt(off.turns.slice(0, 3), 0), { boardId: "b1", ownerState: "inactive" });
    assert(recovery?.kind === "continue" && recovery.request.returnsFigure);
    assert(!("figureId" in recovery.request.returnsFigure), "flag off: the request keeps its old shape");
  });
  await check("stash/restored-board-reads-figure-2", () => {
    const L = on.turns[0]!;
    const figure2 = storedLessonFigurePresentation(L, "figure_2").diagram!;
    // A doubt after a reload with figure 2 in the zone stashes figure 2, not figure 1.
    const live = storedPageZoneStash(on.turns.slice(0, 2), figure2);
    assert(live && live.diagram && live.figureId === "figure_2", "figure 2 in the zone is stashed as figure 2");
    // With a doubt's own figure in the zone, the stash is the figure the resume returns.
    const doubtZone = storedLessonFigurePresentation(on.turns[2]!, "figure_1").diagram!;
    const swapped = storedPageZoneStash(on.turns.slice(0, 3), doubtZone);
    assert(swapped && swapped.presentation && swapped.figureId === "figure_2");
    assert.deepEqual(ids(swapped.presentation.diagram), ids(figure2), "the stash holds figure 2");
  });
  await check("uqh/return-after-a-reload-reads-the-figure-id", () => {
    const slice = anchoredSlice("hooks/turn/useQuestionHandler.ts", "doubt-figure-return");
    assert(/storedLessonFigurePresentation\(source, back\.figureId \?\? "figure_1"\)/.test(slice), "the reload return draws the figure the lesson had moved to");
    assert(!/storedFigurePresentation\(/.test(slice), "never figure 1 alone");
    assert(/page\.lessonFigureId = returned \? back\.figureId \?\? null : null;/.test(slice), "the page remembers it");
  });
}

// ---------------------------------------------------------------------------
// A plain doubt pointing at figure 2 (lane 6d): saved through the real
// canonicalizer with the real loader over the stored lesson row.
// ---------------------------------------------------------------------------

const BOARD = "b0000000-0000-4000-8000-000000000000";
const OWNER = "user-lesson-figures";

/** A stored turn as the database holds it: every row, its kind. */
function boardRow(turn: StoredTurn, orderIndex: number): PageFigureTurn {
  return {
    id: turn.id, boardId: BOARD, userId: OWNER, orderIndex, question: turn.question, visualStatus: turn.visualStatus,
    sceneDocument: turn.sceneDocument, sceneArtifacts: turn.sceneArtifacts, kind: turn.kind ?? null,
    segments: turn.segments.map((segment) => ({ orderIndex: segment.orderIndex, command: segment.command })),
  };
}

/** L as saved by a Stop before its advance cue: every row before `[FOCUS:figure_2]`. */
function beforeTheAdvance(L: StoredTurn): StoredTurn {
  const cue = L.segments.findIndex((segment) => parseStoredSegmentCommands(segment.command)
    .some((command) => command.type === "FOCUS" && command.text === "figure_2"));
  assert(cue > 0, "L saved its advance cue");
  return { ...L, segments: L.segments.slice(0, cue) };
}

async function doubtRefChecks(): Promise<void> {
  const on = await lessonFiguresPage(true);
  const L = on.turns[0]!;
  const lessonRow = boardRow(L, 0);
  const loaderOn = (rows: PageFigureTurn[]) => bindPageFigureLoader({ boardId: BOARD, userId: OWNER, turnId: null }, { store: memoryPageFigureStore(rows) });
  const loadPageFigure = loaderOn([lessonRow]);
  const ref = (figureId?: "figure_2" | "figure_3"): DoubtFigureRef => ({
    schemaVersion: DOUBT_FIGURE_REF_VERSION, turnId: L_ID, kind: "verified_scene", ...(figureId ? { figureId } : {}),
  });
  const save = (pointsAt: DoubtFigureRef, flag = true, loader = loadPageFigure, target = on.secondToo) => canonicalizeTurnSceneMetadata({
    question: "Doubt: what is that force?",
    sceneDocument: null,
    visualStatus: "text_only",
    sceneArtifacts: { ...boardContinuationArtifacts(LESSON), ...doubtFigureRefArtifacts(pointsAt) },
    segments: [row(0, "That force is this one.", [focus(target)])],
  }, { kind: "doubt", loadPageFigure: loader, doubtPointingEnabled: true, lessonFiguresEnabled: flag });
  const focusTargets = (segments: SubmittedTurnSceneMetadata["segments"]) => segments
    .flatMap((segment) => parseStoredSegmentCommands(segment.command))
    .filter((command) => command.type === "FOCUS").map((command) => command.text ?? "");
  const artifactsOf = (value: { sceneArtifacts: unknown }) => value.sceneArtifacts as Record<string, unknown>;
  const unresolved = (value: { sceneArtifacts: unknown }) =>
    (artifactsOf(value).failureTelemetry as Record<string, unknown> | undefined)?.pointsAtFigureStatus === "unresolved";

  await check("doubt-ref/figure-2-focus-survives-save", async () => {
    const saved = await save(ref("figure_2"));
    assert(saved.ok, `the doubt saves: ${saved.ok ? "" : saved.error}`);
    assert.deepEqual(focusTargets(saved.value.segments), [on.secondToo], "FOCUS on a figure 2 part is kept");
    assert.equal((artifactsOf(saved.value).pointsAtFigure as Record<string, unknown>).figureId, "figure_2", "the reference keeps its figure");
    assert(!unresolved(saved.value), "the reference resolved");
  });
  await check("doubt-ref/figure-1-reference-filters-figure-2-parts", async () => {
    // Same lesson turn, no figure id: the page had reached figure 2, so figure 1 is refused.
    const saved = await save(ref());
    assert(saved.ok);
    assert.deepEqual(focusTargets(saved.value.segments), [], "a figure 2 part is not on figure 1");
    assert.equal(saved.value.segments[0]!.narration, "That force is this one.", "the words stay");
    assert(!("figureId" in (artifactsOf(saved.value).pointsAtFigure as Record<string, unknown>)));
    assert(unresolved(saved.value), "figure 1 is not the figure the page had reached");
  });
  // page-figure-reached (review F3): the figure named must be the one the stored page reached.
  await check("doubt-ref/figure-2-before-the-advance-is-refused", async () => {
    const early = loaderOn([boardRow(beforeTheAdvance(L), 0)]);
    const saved = await save(ref("figure_2"), true, early);
    assert(saved.ok, "a figure the page never reached never fails the save");
    assert.deepEqual(focusTargets(saved.value.segments), [], "figure 2's part is filtered: the stored page is still on figure 1");
    assert(unresolved(saved.value), "recorded as unresolved");
    const honest = await save(ref(), true, early, on.firstOnly);
    assert(honest.ok);
    assert.deepEqual(focusTargets(honest.value.segments), [on.firstOnly], "before the advance, figure 1 is the zone's figure and its part is kept");
    assert(!unresolved(honest.value));
  });
  await check("doubt-ref/another-turns-figure-in-the-zone-is-refused", async () => {
    // D drew its own figure after L: L's figure 2 is stashed, not in the zone.
    const D = on.turns[2]!;
    const swapped = loaderOn([lessonRow, boardRow(on.turns[1]!, 1), boardRow(D, 2)]);
    const saved = await save(ref("figure_2"), true, swapped);
    assert(saved.ok);
    assert.deepEqual(focusTargets(saved.value.segments), [], "L is not the zone's source while D's figure stands there");
    assert(unresolved(saved.value));
    // D's own figure is a figure 1: naming L's figure 1 instead is refused on the source alone.
    const figureOne = await save(ref(), true, swapped, on.firstOnly);
    assert(figureOne.ok);
    assert.deepEqual(focusTargets(figureOne.value.segments), [], "L's figure 1 is not in the zone either");
    assert(unresolved(figureOne.value));
    const later = await save(ref("figure_2"), true, loaderOn([lessonRow, boardRow(on.turns[1]!, 1)]));
    assert(later.ok);
    assert.deepEqual(focusTargets(later.value.segments), [on.secondToo], "after a plain doubt L's figure 2 still holds the zone");
  });
  await check("doubt-ref/flag-off-skips-the-walk", async () => {
    // Flag off with no figure id: today's check on figure 1, with no walk (no unresolved for a kept figure 1 part).
    const saved = await save(ref(), false, loadPageFigure, on.firstOnly);
    assert(saved.ok);
    assert.deepEqual(focusTargets(saved.value.segments), [on.firstOnly], "flag off: figure 1, as before lane 8a");
    assert(!unresolved(saved.value));
  });
  await check("doubt-ref/forged-figure-id-is-refused", async () => {
    // figure_3 is a well formed id the stored artifact does not list.
    const saved = await save(ref("figure_3"));
    assert(saved.ok, "a forged id never fails the save");
    assert.deepEqual(focusTargets(saved.value.segments), [], "pointing at a figure the lesson never stored is filtered");
    assert(unresolved(saved.value), "recorded as unresolved");
    assert.equal(saved.value.segments[0]!.narration, "That force is this one.");
  });
  await check("doubt-ref/flag-off-strips-figure-id", async () => {
    const saved = await save(ref("figure_2"), false);
    assert(saved.ok);
    assert.deepEqual(artifactsOf(saved.value).pointsAtFigure, doubtFigureRefArtifacts(ref()).pointsAtFigure, "flag off: today's reference");
    assert.deepEqual(focusTargets(saved.value.segments), [], "and today's check, on figure 1");
  });
  await check("doubt-ref/client-names-the-zone-figure", () => {
    const sequence = new LessonFigureSequence();
    restoreLessonFigures(sequence, L);
    // After a restore the zone holds a rebuilt copy of the view, not the view itself.
    const figure2 = storedLessonFigurePresentation(L, "figure_2").diagram!;
    const figure1 = storedLessonFigurePresentation(L, "figure_1").diagram!;
    assert.equal(lessonFigureIdInZone(sequence.views(), figure2), "figure_2");
    assert.equal(lessonFigureIdInZone(sequence.views(), figure1), null, "figure 1 names no later figure");
    assert.equal(lessonFigureIdInZone([], figure2), null, "no sequence, no id");
    const input = { record: null, boardId: BOARD, afterReplay: false, figureOnPage: true, storedTurns: on.turns.slice(0, 2), codeLessonFrameIndex: null };
    const pointed = doubtFigureRefFor({ ...input, activeDiagram: figure2, lessonFigureId: lessonFigureIdInZone(sequence.views(), figure2) });
    assert.deepEqual(pointed, ref("figure_2"), "the doubt names L and figure 2");
    assert.deepEqual(doubtFigureRefFor({ ...input, activeDiagram: figure1, lessonFigureId: null }), ref(), "figure 1: today's reference");
  });
  await check("loader/page-figure-reached-anchors", () => {
    const slice = anchoredServerSlice("lib/scene/pageFigureLoader.ts", "page-figure-reached");
    assert(/storedPageZone\(context, deps\.store, \{ kind: "doubt" \}\)/.test(slice), "the loader walks the stored page with the doubt appended");
    assert(/zone\.turnIds\[zone\.at\.sourceIndex\] !== target\.id/.test(slice), "the zone's source must be the turn named");
    assert(/zone\.at\.figureId !== \(figureId \?\? "figure_1"\)/.test(slice), "and its figure the figure named");
  });
  await check("uqh/doubt-names-the-zone-figure", () => {
    const slice = anchoredSlice("hooks/turn/useQuestionHandler.ts", "doubt-lesson-figure");
    assert(/lessonFigureId: lessonFigureIdInZone\(lessonFiguresRef\?\.current\?\.views\(\) \?\? \[\], activeVerifiedDiagramRef\.current\)/.test(slice),
      "the doubt's reference reads the figure in the zone");
  });
}

/**
 * Review F1: a resume after the advance, saved the way live builds it (no cue,
 * no LATER FIGURES, a FOCUS on a figure 2 part), keeps that FOCUS: its cursor
 * starts on the figure the stored page had reached.
 */
async function resumeStartChecks(): Promise<void> {
  const on = await lessonFiguresPage(true);
  const L = on.turns[0]!;
  const artifact = { schemaVersion: LESSON_FIGURES_VERSION, figures: [on.figure] };
  const resumeId = "a6666666-6666-4666-8666-666666666666";
  const saveResume = async (rows: PageFigureTurn[], options: { flag?: boolean; bound?: boolean; target?: string } = {}) => {
    const store = memoryPageFigureStore(rows);
    const context = { boardId: BOARD, userId: OWNER, turnId: null };
    const metadata = lessonMetadata([row(0, "So this force acts on the body.", [focus(options.target ?? on.secondOnly)])], {
      lessonFigures: artifact, ...boardContinuationArtifacts(LESSON),
    });
    return canonicalizeTurnSceneMetadata(metadata, {
      kind: "resume",
      lessonFiguresEnabled: options.flag ?? true,
      ...(options.bound === false ? {} : { lessonFigureStart: bindLessonFigureStart(context, { store }) }),
    });
  };
  const kept = (value: { segments: SubmittedTurnSceneMetadata["segments"] }) => value.segments
    .filter((segment) => !isStoredCommandTrustedGeometry(segment.command))
    .flatMap((segment) => parseStoredSegmentCommands(segment.command))
    .filter((command) => command.type === "FOCUS").map((command) => command.text ?? "");

  await check("resume-start/after-the-advance-keeps-figure-2-focus", async () => {
    const start = await bindLessonFigureStart({ boardId: BOARD, userId: OWNER, turnId: null }, { store: memoryPageFigureStore([boardRow(L, 0)]) })();
    assert.equal(start, "figure_2", "the stored page reached figure 2");
    const saved = await saveResume([boardRow(L, 0)]);
    assert(saved.ok, `the resume saves: ${saved.ok ? "" : saved.error}`);
    assert.deepEqual(kept(saved.value), [on.secondOnly], "the resume's FOCUS on a figure 2 part is kept");
    // Replay resolves it against the same figure: pageFigureAt puts figure 2 in the zone at R.
    const R = stored(resumeId, 1, LESSON, { ...saved.value, sceneArtifacts: saved.value.sceneArtifacts as StoredTurn["sceneArtifacts"] }, { opensOnClear: false, kind: "resume" });
    assert.equal(pageFigureAt([L, R], 1).figureId, "figure_2");
  });
  await check("resume-start/after-a-doubt-figure-returns-figure-2", async () => {
    const rows = on.turns.slice(0, 3).map((turn, index) => boardRow(turn, index));
    const saved = await saveResume(rows);
    assert(saved.ok);
    assert.deepEqual(kept(saved.value), [on.secondOnly], "the resume returns figure 2 and points at it");
  });
  await check("resume-start/before-the-advance-stays-on-figure-1", async () => {
    const saved = await saveResume([boardRow(beforeTheAdvance(L), 0)]);
    assert(saved.ok);
    assert.deepEqual(kept(saved.value), [], "the page never reached figure 2: its part is filtered");
    const one = await saveResume([boardRow(beforeTheAdvance(L), 0)], { target: on.firstOnly });
    assert(one.ok);
    assert.deepEqual(kept(one.value), [on.firstOnly], "figure 1's part is kept");
  });
  await check("resume-start/a-cue-in-the-resume-still-moves-forward-only", async () => {
    // On figure 2 already, a figure_2 cue is a repeat: filtered as a stale FOCUS.
    const store = memoryPageFigureStore([boardRow(L, 0)]);
    const saved = await canonicalizeTurnSceneMetadata(lessonMetadata([
      row(0, "Again the forces.", [focus("figure_2")]),
      row(1, "This one.", [focus(on.secondOnly)]),
    ], { lessonFigures: artifact, ...boardContinuationArtifacts(LESSON) }), {
      kind: "resume", lessonFiguresEnabled: true,
      lessonFigureStart: bindLessonFigureStart({ boardId: BOARD, userId: OWNER, turnId: null }, { store }),
    });
    assert(saved.ok);
    assert.deepEqual(kept(saved.value), [on.secondOnly], "the repeat cue is filtered, figure 2's part is kept");
  });
  await check("resume-start/flag-off-and-unbound-start-on-figure-1", async () => {
    const off = await saveResume([boardRow(L, 0)], { flag: false });
    assert(off.ok);
    assert.deepEqual(kept(off.value), [], "flag off: the artifact is stripped and the resume is checked on figure 1");
    const unbound = await saveResume([boardRow(L, 0)], { bound: false });
    assert(unbound.ok);
    assert.deepEqual(kept(unbound.value), [], "no start loader (the legacy one shot route): figure 1");
  });
  await check("resume-start/server-anchors", () => {
    const slice = anchoredServerSlice("lib/scene/turnScenePersistence.ts", "lesson-figure-resume-start");
    assert(/options\.kind === "resume" && options\.lessonFigureStart/.test(slice), "only a resume asks for its start");
    assert(/reached = await options\.lessonFigureStart\(\)/.test(slice));
    const checkpoint = readFileSync(path.join(APP_ROOT, "lib/boards/turnCheckpoint.ts"), "utf8");
    assert.equal(checkpoint.split("lessonFigureStart, kind: turnKind }").length - 1, 2, "both checkpoint canonicalizations pass the start");
  });
}

const APP_ROOT = fileURLToPath(new URL("../../", import.meta.url));
function anchoredServerSlice(file: string, name: string): string {
  const source = readFileSync(path.join(APP_ROOT, file), "utf8");
  const begin = source.indexOf(`// ${name}:begin\n`);
  const end = source.indexOf(`// ${name}:end\n`, begin);
  assert(begin >= 0, `slice anchor: ${name}:begin in ${file}`);
  assert(end > begin, `slice anchor: ${name}:end after its begin in ${file}`);
  assert.equal(source.split(`// ${name}:begin`).length, 2, `one ${name}:begin in ${file}`);
  assert.equal(source.split(`// ${name}:end`).length, 2, `one ${name}:end in ${file}`);
  return stripComments(source.slice(begin, end));
}

async function main(): Promise<void> {
  await pageFigureChecks();
  await resumeChecks();
  await restoreChecks();
  await boardRestoreChecks();
  await doubtRefChecks();
  await resumeStartChecks();
  console.log(`verify-lesson-figures-replay: ${passed} checks passed`);
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
