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
 */
import assert from "node:assert/strict";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import { serializeSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import circle from "./fixtures/replay/circle-s3-turn.json";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { composeLessonFigureQuestion, lessonFiguresOf, type StoredLessonFigure } from "../../lib/boards/lessonFigures";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import { lessonFigureReturnAfter, pageFigureAt, storedTurnFocusIds } from "../../lib/boards/pageFigure";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { stored } from "./fixtures/doubtFigureScene";

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
  const { restoreLessonFigureViews } = await import("../../features/tutor-session/lib/scene/restoreLessonFigures");
  const { restoreVerifiedDiagramFromTurn } = await import("../../features/tutor-session/lib/scene/restoreVerifiedDiagram");
  const probeTurn = stored(L_ID, 0, LESSON, probe.value, { opensOnClear: true, kind: "lesson" });
  const second = restoreLessonFigureViews(probeTurn)[0]!.diagram;
  const firstDiagram = restoreVerifiedDiagramFromTurn(probeTurn)!;
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

async function main(): Promise<void> {
  await pageFigureChecks();
  console.log(`verify-lesson-figures-replay: ${passed} checks passed`);
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
