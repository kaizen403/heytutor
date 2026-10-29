/**
 * Lesson figures at the server boundary (DIAGRAM_LESSON_FIGURES, lane 4).
 *
 * A lesson save carrying `sceneArtifacts.lessonFigures` admits each later
 * figure on its own composed question; one that fails is dropped with its id.
 * The teaching rows are checked by a diagram cursor: a kept `[FOCUS:figure_2]`
 * moves every later check to figure 2, forward only.
 *
 * The figure here is a recorded circle lesson's, with figure 2 the fast
 * selector's figure for the ask "free body diagram of the body". The client
 * refuses that pairing (not a family the lesson reads, see the plan gate);
 * the server's job is truth, not relevance, and the pairing gives figure 2
 * parts figure 1 does not have, which the cursor checks need.
 *
 * Mutations this gate catches (brief lane 4 table):
 * (d) accept Turn.question as a lesson figure's scene question;
 * (e) check every segment against figure 1 (no cursor);
 * (f) skip the strip when the flag is off;
 * (g) the begin-turn grant defaults to on (any payload value but true grants).
 *
 * Lane 8a (round 2 review N4):
 * (h) admitLessonFigures keeps a figure with a part named like a cue;
 * (i) admitLessonFigures ignores a turn figure with a part named like a cue.
 */
import assert from "node:assert/strict";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import { parseStoredSegmentCommands, serializeSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import circle from "./fixtures/replay/circle-s3-turn.json";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { admitLessonFigures, admitStoredScene } from "../../lib/scene/sceneAdmission";
import { composeLessonFigureQuestion, lessonFiguresOf, type StoredLessonFigure } from "../../lib/boards/lessonFigures";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import { doubtFigureArtifacts } from "../../lib/boards/doubtFigure";
import { stripSceneInk } from "../../lib/boards/turnCheckpoint";
import { resumeTurnScene } from "../../features/tutor-session/lib/turn/doubtTurn";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beginTurn } from "../../lib/billing/billingClient";
import { selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";

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

const focus = (id: string): DrawCommand => ({ type: "FOCUS", params: [], text: id, charPosition: 0, narrationBefore: "" });
const row = (orderIndex: number, narration: string, commands: DrawCommand[]) => ({
  orderIndex, narration, spokenText: narration,
  command: serializeSegmentCommands(commands, { trustedDiagramGeometry: false }),
});

const turn = circle.turn as unknown as {
  question: string; sceneDocument: unknown; sceneArtifacts: Record<string, unknown> & { turnPlan: TurnPlanV3; representationTier: string };
  segments: Array<{ orderIndex: number; narration: string; spokenText?: string; command: unknown }>;
};
const LESSON = turn.question;
const ASK = "free body diagram of the body";
const COMPOSED = composeLessonFigureQuestion(LESSON, ASK);

function figureTwo(): StoredLessonFigure {
  const plan = validateTurnPlanV3({ ...turn.sceneArtifacts.turnPlan, question: COMPOSED }, COMPOSED).plan!;
  const gate = deriveSceneGate({ question: COMPOSED, turnPlan: plan, problemIR: null, conversationContext: "" });
  const fast = selectFastFigure({ question: COMPOSED, turnPlan: plan, authority: null, families: gate.sceneCapabilities.families });
  assert(fast, "the fast selector draws figure 2 on the composed question");
  return { id: "figure_2", ask: ASK, sceneDocument: fast.sceneDocument, tier: fast.tier, family: fast.family ?? null, figureSource: "fast_family" };
}

function lessonMetadata(segments: SubmittedTurnSceneMetadata["segments"], extra: Record<string, unknown> = {}): SubmittedTurnSceneMetadata {
  return {
    question: LESSON,
    sceneDocument: structuredClone(turn.sceneDocument),
    visualStatus: "validated",
    sceneArtifacts: { ...structuredClone(turn.sceneArtifacts), ...extra },
    segments,
  };
}

function baseRows(): SubmittedTurnSceneMetadata["segments"] {
  return turn.segments.map((segment) => ({
    orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText ?? segment.narration, command: segment.command,
  }));
}

function focusIdsOf(segments: Array<{ narration: string; command: unknown }>, narration: string): string[] {
  const found = segments.find((segment) => segment.narration === narration);
  assert(found, `row "${narration}" is kept`);
  return found.command == null ? [] : parseStoredSegmentCommands(found.command).filter((command) => command.type === "FOCUS").map((command) => command.text ?? "");
}

async function main(): Promise<void> {
  const figure = figureTwo();
  const artifact = { schemaVersion: "lesson-figures/v1", figures: [figure] };
  const firstAdmitted = admitStoredScene({ sceneDocument: turn.sceneDocument, sceneQuestion: LESSON, turnPlan: validateTurnPlanV3(turn.sceneArtifacts.turnPlan, LESSON).plan, submittedTier: turn.sceneArtifacts.representationTier });
  assert(firstAdmitted.ok, "figure 1 admits");
  const secondAdmitted = admitStoredScene({ sceneDocument: figure.sceneDocument, sceneQuestion: COMPOSED, turnPlan: validateTurnPlanV3({ ...turn.sceneArtifacts.turnPlan, question: COMPOSED }, COMPOSED).plan, submittedTier: figure.tier });
  assert(secondAdmitted.ok, `figure 2 admits on its composed question: ${secondAdmitted.ok ? "" : secondAdmitted.message}`);
  const firstIds = new Set(firstAdmitted.presentation.diagram.anchors.map((anchor) => anchor.id));
  const secondIds = new Set(secondAdmitted.presentation.diagram.anchors.map((anchor) => anchor.id));
  const secondOnly = [...secondIds].find((id) => !firstIds.has(id));
  const firstOnly = [...firstIds].find((id) => !secondIds.has(id));
  assert(secondOnly && firstOnly, "each figure has a part the other does not");

  const n = turn.segments.length;
  const teaching = [
    ...baseRows(),
    row(n, "Before we move, look at the body.", [focus(secondOnly)]),
    row(n + 1, "Now the second figure.", [focus("figure_2")]),
    row(n + 2, "Here is the body.", [focus(secondOnly)]),
    row(n + 3, "And the old circle part.", [focus(firstOnly)]),
    row(n + 4, "Back to the second figure again.", [focus("figure_2")]),
    row(n + 5, "A third figure that was never drawn.", [focus("figure_3")]),
  ];

  const on = await canonicalizeTurnSceneMetadata(lessonMetadata(teaching, { lessonFigures: artifact }), { lessonFiguresEnabled: true });
  assert(on.ok, `the lesson saves: ${on.ok ? "" : on.error}`);
  const stored = lessonFiguresOf(on.value.sceneArtifacts);

  await check("admitted/artifact", () => {
    assert(stored, "the artifact is kept");
    assert.deepEqual(stored.figures.map((entry) => entry.id), ["figure_2"]);
    assert.equal((stored.figures[0]!.sceneDocument as { source: { question: string } }).source.question, COMPOSED, "the stored document is the server's, on the composed question");
    assert.equal(on.value.sceneArtifacts?.lessonFigures?.droppedFigureIds, undefined, "nothing dropped");
  });
  await check("admitted/cursor-keeps-figure-2-parts-after-the-advance", () => {
    assert.deepEqual(focusIdsOf(on.value.segments, "Now the second figure."), ["figure_2"], "the advance cue is kept as is");
    assert.deepEqual(focusIdsOf(on.value.segments, "Here is the body."), [secondOnly], "a figure 2 part after the advance is kept");
  });
  await check("admitted/cursor-filters-before-the-advance", () => {
    assert.deepEqual(focusIdsOf(on.value.segments, "Before we move, look at the body."), [], "a figure 2 part before the advance is filtered, the words stay");
  });
  await check("admitted/cursor-forward-only", () => {
    assert.deepEqual(focusIdsOf(on.value.segments, "And the old circle part."), [], "figure 1 has left the zone");
    assert.deepEqual(focusIdsOf(on.value.segments, "Back to the second figure again."), [], "a repeat advance is filtered");
    assert.deepEqual(focusIdsOf(on.value.segments, "A third figure that was never drawn."), [], "an advance to a figure not admitted is filtered");
  });
  await check("admitted/main-figure-unchanged", async () => {
    const plain = await canonicalizeTurnSceneMetadata(lessonMetadata(baseRows()), { lessonFiguresEnabled: true });
    assert(plain.ok);
    assert.deepEqual(on.value.sceneDocument, plain.value.sceneDocument);
    assert.deepEqual(on.value.segments.slice(0, plain.value.segments.length), plain.value.segments, "figure 1's rows are unchanged");
  });

  await check("forged/lesson-question-is-dropped", async () => {
    // A figure 2 planned on Turn.question, not on the composed question.
    const plan = validateTurnPlanV3(turn.sceneArtifacts.turnPlan, LESSON).plan!;
    const gate = deriveSceneGate({ question: COMPOSED, turnPlan: { ...plan, question: COMPOSED }, problemIR: null, conversationContext: "" });
    const fast = selectFastFigure({ question: COMPOSED, turnPlan: { ...plan, question: COMPOSED }, authority: null, families: gate.sceneCapabilities.families })!;
    const forgedDocument = structuredClone(fast.sceneDocument) as unknown as { source: { question: string } };
    forgedDocument.source.question = LESSON;
    const forged = await canonicalizeTurnSceneMetadata(
      lessonMetadata(teaching, { lessonFigures: { ...artifact, figures: [{ ...figure, sceneDocument: forgedDocument }] } }),
      { lessonFiguresEnabled: true },
    );
    assert(forged.ok, "a dropped figure never fails the save");
    assert.deepEqual(forged.value.sceneArtifacts?.lessonFigures?.figures, [], "the forged figure is dropped");
    assert.deepEqual(forged.value.sceneArtifacts?.lessonFigures?.droppedFigureIds, ["figure_2"]);
    assert.equal(lessonFiguresOf(forged.value.sceneArtifacts), null, "nothing to restore");
    assert.deepEqual(focusIdsOf(forged.value.segments, "Now the second figure."), [], "its advance cue is filtered");
    assert.deepEqual(focusIdsOf(forged.value.segments, "Here is the body."), [], "and the FOCUS on its parts after it");
    assert.deepEqual(focusIdsOf(forged.value.segments, "And the old circle part."), [firstOnly], "figure 1 stays in the zone");
  });

  // Review N4: a part named like an advance cue makes `[FOCUS:figure_k]` name two things.
  await check("collision/figure-part-named-like-a-cue-is-dropped", async () => {
    const renamed = JSON.parse(JSON.stringify(figure.sceneDocument).split(`"${secondOnly}"`).join("\"figure_3\""));
    const lessonPlan = validateTurnPlanV3({ ...turn.sceneArtifacts.turnPlan, question: COMPOSED }, COMPOSED).plan;
    const alone = admitStoredScene({ sceneDocument: renamed, sceneQuestion: COMPOSED, turnPlan: lessonPlan, submittedTier: figure.tier });
    assert(alone.ok, `the renamed figure is otherwise true: ${alone.ok ? "" : alone.message}`);
    assert(alone.presentation.diagram.anchors.some((anchor) => anchor.id === "figure_3"), "it has a part named figure_3");
    const saved = await canonicalizeTurnSceneMetadata(
      lessonMetadata(teaching, { lessonFigures: { ...artifact, figures: [{ ...figure, sceneDocument: renamed }] } }),
      { lessonFiguresEnabled: true },
    );
    assert(saved.ok, "a dropped figure never fails the save");
    assert.deepEqual(saved.value.sceneArtifacts?.lessonFigures?.droppedFigureIds, ["figure_2"], "dropped as id_collision");
    assert.deepEqual(focusIdsOf(saved.value.segments, "Now the second figure."), [], "its advance cue is filtered");
  });
  await check("collision/turn-figure-part-named-like-a-cue-drops-every-figure", () => {
    const first = firstAdmitted.presentation.diagram;
    const plan = validateTurnPlanV3(turn.sceneArtifacts.turnPlan, LESSON).plan;
    const clean = admitLessonFigures(artifact as never, { lessonQuestion: LESSON, turnPlan: plan, first });
    assert.deepEqual([...clean.diagrams.keys()], ["figure_2"], "a clean figure 1 admits figure 2");
    const colliding = { ...first, anchors: [...first.anchors, { ...first.anchors[0]!, id: "figure_2" }] };
    const admitted = admitLessonFigures(artifact as never, { lessonQuestion: LESSON, turnPlan: plan, first: colliding });
    assert.deepEqual([...admitted.diagrams.keys()], [], "figure 1 with a part named figure_2: no later figure");
    assert.deepEqual(admitted.droppedFigureIds, ["figure_2"]);
  });

  const without = await canonicalizeTurnSceneMetadata(lessonMetadata(teaching), { lessonFiguresEnabled: false });
  assert(without.ok);
  await check("flag-off/deep-equals-without-the-artifact", async () => {
    const off = await canonicalizeTurnSceneMetadata(lessonMetadata(teaching, { lessonFigures: artifact }), { lessonFiguresEnabled: false });
    assert(off.ok);
    assert.deepEqual(off.value, without.value, "the artifact is stripped and nothing else changes");
    assert.deepEqual(focusIdsOf(off.value.segments, "Here is the body."), [], "the cursor never switches");
  });
  await check("flag-on/no-artifact-deep-equals-flag-off", async () => {
    const plain = await canonicalizeTurnSceneMetadata(lessonMetadata(teaching), { lessonFiguresEnabled: true });
    assert(plain.ok);
    assert.deepEqual(plain.value, without.value, "a lesson with no later figures saves as before");
  });
  await check("malformed/stripped-whole", async () => {
    for (const bad of [
      { ...artifact, figures: [{ ...figure, ask: "graph for 5 seconds" }] },
      { ...artifact, figures: [figure, { ...figure, id: "figure_3" }, { ...figure, id: "figure_3" }] },
      { ...artifact, figures: [{ ...figure, id: "figure_4" }] },
      { ...artifact, schemaVersion: "lesson-figures/v2" },
    ]) {
      const saved = await canonicalizeTurnSceneMetadata(lessonMetadata(teaching, { lessonFigures: bad }), { lessonFiguresEnabled: true });
      assert(saved.ok);
      assert.deepEqual(saved.value, without.value, `stripped: ${JSON.stringify(bad).slice(0, 60)}`);
    }
  });
  await check("resume/carries-and-admits", async () => {
    const scene = resumeTurnScene({
      sceneDocument: structuredClone(turn.sceneDocument) as never, sceneEngineVersion: null, validationReport: null,
      visualStatus: "validated", sceneArtifacts: { ...structuredClone(turn.sceneArtifacts), lessonFigures: artifact } as never,
    }, LESSON);
    const resume = await canonicalizeTurnSceneMetadata({
      question: LESSON, ...scene, visualStatus: "validated",
      segments: [row(0, "Back to the second figure.", [focus("figure_2")]), row(1, "The body again.", [focus(secondOnly)])],
    } as SubmittedTurnSceneMetadata, { kind: "resume", lessonFiguresEnabled: true });
    assert(resume.ok, `the resume saves: ${resume.ok ? "" : resume.error}`);
    assert.deepEqual(lessonFiguresOf(resume.value.sceneArtifacts)?.figures.map((entry) => entry.id), ["figure_2"], "the resume keeps the artifact");
    assert(resume.value.sceneArtifacts?.boardContinuation, "and its continuation");
    assert.deepEqual(focusIdsOf(resume.value.segments, "The body again."), [secondOnly]);
  });
  await check("doubt-figure/stripped", async () => {
    const doubt = await canonicalizeTurnSceneMetadata(
      lessonMetadata(teaching, { lessonFigures: artifact, ...boardContinuationArtifacts(LESSON), ...doubtFigureArtifacts(null) }),
      { kind: "doubt", doubtFiguresEnabled: true, lessonFiguresEnabled: true, checkDoubtFigurePage: async () => false },
    );
    assert(doubt.ok);
    assert.equal(doubt.value.sceneArtifacts?.lessonFigures, undefined, "a doubt never carries later figures");
  });
  await check("memo/second-save-identical", async () => {
    const again = await canonicalizeTurnSceneMetadata(lessonMetadata(teaching, { lessonFigures: artifact }), { lessonFiguresEnabled: true });
    assert(again.ok);
    assert.deepEqual(again.value, on.value);
  });
  await check("checkpoint/strip-keeps-advance-cues", () => {
    const rows = [{ orderIndex: 0, narration: "Now the second figure.", spokenText: "Now the second figure.", command: serializeSegmentCommands([focus("figure_2")]) }];
    assert.deepEqual(stripSceneInk(rows, { keepPointing: true }), rows, "an advance cue is a lesson FOCUS, kept with pointing");
  });

  await check("grant/begin-turn-route", () => {
    const route = readFileSync(join(__dirname, "../../app/api/billing/begin-turn/route.ts"), "utf8");
    assert(route.includes("    lessonFigures: resolveLessonFiguresEnabled(),\n"), "begin-turn grants DIAGRAM_LESSON_FIGURES per turn");
  });
  await check("grant/client-reads-true-only", async () => {
    const original = globalThis.fetch;
    const granted = async (payload: Record<string, unknown>) => {
      globalThis.fetch = (async () => new Response(JSON.stringify({ remainingPct: 50, planId: "free", diagramStrategy: "current", ...payload }), { status: 200 })) as typeof fetch;
      try {
        const result = await beginTurn({ traceId: "11111111-1111-4111-8111-111111111111", kind: "lesson" as never, ownsTurn: () => true, timeoutMs: 2000 });
        assert(result.ok, "begin-turn answers");
        return result.lessonFigures;
      } finally {
        globalThis.fetch = original;
      }
    };
    assert.equal(await granted({ lessonFigures: true }), true);
    for (const value of [undefined, false, "on", 1, "true"]) {
      assert.equal(await granted(value === undefined ? {} : { lessonFigures: value }), false, `payload ${JSON.stringify(value)} grants nothing`);
    }
  });

  console.log(`verify-lesson-figures-persist: ${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
