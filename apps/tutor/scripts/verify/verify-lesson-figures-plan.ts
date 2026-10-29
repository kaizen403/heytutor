/**
 * Lesson figures, plan side (DIAGRAM_LESSON_FIGURES, lane 4).
 *
 * Mutations this gate catches (brief lane 4 table):
 * (a) accept a view outside the closed list (lessonFigureAsksOf);
 * (b) skip the same-figure reject in planLessonFigures;
 * (c) append the planner addon unconditionally (turnPlannerV3.ts; rebuild
 *     tutor-core, this gate reads its dist).
 *
 * Lane 8b (round 2 review F4): a later figure is a closed pick, never words.
 * (d) the restamped figure plan keeps the planner's `figures` entries;
 * (e) the entry's words are kept and composed into the figure's question
 *     (the round 1 design);
 * (f) the selector draws another kind than the one picked and it is kept.
 */
import assert from "node:assert/strict";
import {
  TURN_PLAN_V3_PROMPT,
  auditTurnPlanV3,
  lessonFigureViewsFor,
  planTurnV3,
  turnPlanV3LessonFiguresAddon,
  withChemistryExampleAddon,
  type TurnPlannerV3Options,
} from "@heytutor/tutor-core";
import { SCENE_VISUAL_FAMILIES, describeSceneFamily, validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { VerifiedDiagram } from "@heytutor/drawing";
import incline from "./fixtures/lesson-figures-incline-plan.json";
import circle from "./fixtures/replay/circle-s3-turn.json";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { figureFingerprint, selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { lessonFiguresArtifact, planLessonFigures } from "../../features/tutor-session/lib/turn/lessonFigurePlan";
import {
  LESSON_FIGURES_VERSION,
  composeLessonFigureQuestion,
  isLessonFigureAdvanceId,
  isLessonFigureView,
  lessonFigureAsksOf,
  lessonFiguresOf,
  resolveLessonFiguresEnabled,
  type LessonFigureAsk,
} from "../../lib/boards/lessonFigures";

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

const asks = (figures: unknown) => lessonFigureAsksOf({ schemaVersion: "turn-plan/v3", figures });

/** Words the stem readers act on (archetypes/detect.ts cue and veto vocabularies): state, not view. */
const STATE_CUE = /\b(?:rough|frictionless|smooth|upwards?|downwards?|vertical(?:ly)?|horizontal(?:ly)?|thrown|dropped|incline[sd]?|slope|pulley|hanging|projectile|banked|circular|orbit|lossless|ideal|at rest)\b/i;
/** The words a planner might have written in round 1 (review F4); none is in the incline stem. */
const PLANNER_WORDS = /\b(?:smooth|frictionless|upwards?)\b/i;

async function askChecks(): Promise<void> {
  await check("asks/well-formed", () => {
    assert.deepEqual(asks([{ id: "figure_2", view: "contact_body" }]), [{ id: "figure_2", view: "contact_body" }]);
    assert.deepEqual(asks([{ id: "figure_2", view: "ray_path" }, { id: "figure_3", view: "screen_pattern" }]).map((entry) => entry.id), ["figure_2", "figure_3"]);
  });
  await check("asks/absent-or-not-a-list", () => {
    assert.deepEqual(lessonFigureAsksOf({}), []);
    assert.deepEqual(lessonFigureAsksOf(null), []);
    assert.deepEqual(asks({ id: "figure_2", view: "contact_body" }), []);
    assert.deepEqual(asks([]), []);
  });
  await check("asks/closed-list-only", () => {
    // Mutation (a): a view outside the engine's figure kinds is kept.
    assert.deepEqual(asks([{ id: "figure_2", ask: "free body diagram of the block" }]), [], "a round 1 ask in words is no view");
    for (const view of ["free body diagram", "contact body", "Contact_Body", " contact_body", "contact_body on a smooth incline", "graph", 7, null]) {
      assert.deepEqual(asks([{ id: "figure_2", view }]), [], `view ${JSON.stringify(view)}`);
    }
    assert.deepEqual(asks([{ id: "figure_2", view: "contact_body" }, { id: "figure_3", view: "velocity time graph" }]), [], "one bad view drops the whole list");
    for (const family of SCENE_VISUAL_FAMILIES) assert(isLessonFigureView(family), family);
  });
  await check("asks/three-entries", () => {
    assert.deepEqual(asks([
      { id: "figure_2", view: "ray_path" }, { id: "figure_3", view: "screen_pattern" }, { id: "figure_3", view: "aperture" },
    ]), []);
  });
  await check("asks/duplicate-id", () => {
    assert.deepEqual(asks([{ id: "figure_2", view: "ray_path" }, { id: "figure_2", view: "screen_pattern" }]), []);
  });
  await check("asks/id-outside", () => {
    for (const id of ["figure_1", "figure_4", "Figure_2", "figure_2 ", 2, null]) {
      assert.deepEqual(asks([{ id, view: "contact_body" }]), [], `id ${JSON.stringify(id)}`);
    }
    assert.deepEqual(asks([{ id: "figure_3", view: "ray_path" }, { id: "figure_2", view: "contact_body" }]), [], "ids ascend");
  });
  await check("f4/words-beside-a-view-are-never-read", () => {
    const parsed = asks([{ id: "figure_2", view: "contact_body", ask: "the block moving upward on a smooth frictionless plane", caption: "smooth" }]);
    assert.deepEqual(parsed, [{ id: "figure_2", view: "contact_body" }], "only the id and the view survive");
    assert(!PLANNER_WORDS.test(JSON.stringify(parsed)));
  });
  await check("ids/advance", () => {
    assert(isLessonFigureAdvanceId("figure_2") && isLessonFigureAdvanceId("figure_3"));
    for (const id of ["figure_1", "figure_4", "figure_2x", " figure_2", "FIGURE_2"]) assert(!isLessonFigureAdvanceId(id), id);
  });
  await check("compose/engine-phrase", () => {
    assert.equal(composeLessonFigureQuestion("  A block slides.  ", "contact_body"), "A block slides.\n\nFigure: contact body");
    assert.equal(composeLessonFigureQuestion("Shape of SF6.", "chem_vsepr"), `Shape of SF6.\n\nFigure: ${describeSceneFamily("chem_vsepr")}`);
  });
  await check("f4/engine-phrases-carry-no-state-cue", () => {
    // The only text a view adds is the engine's own name for it; none of those
    // names states a surface, a direction or a motion a stem reader acts on.
    for (const family of SCENE_VISUAL_FAMILIES) {
      const added = composeLessonFigureQuestion("Q.", family).slice("Q.".length);
      assert(!STATE_CUE.test(added), `${family}: "${added.trim()}"`);
      assert(!/\p{Nd}/u.test(added), `${family}: no digit`);
    }
  });
  await check("flag", () => {
    assert.equal(resolveLessonFiguresEnabled({}), false);
    assert.equal(resolveLessonFiguresEnabled({ DIAGRAM_LESSON_FIGURES: "1" }), false);
    assert.equal(resolveLessonFiguresEnabled({ DIAGRAM_LESSON_FIGURES: "on" }), true);
  });
  await check("artifact/validated-whole", () => {
    const figure = { id: "figure_2", view: "state_plot", sceneDocument: { schemaVersion: "scene-document/v2" }, tier: "qualitative_verified", family: "state_plot", figureSource: "fast_family" };
    const artifact = (figures: unknown[]) => lessonFiguresOf({ lessonFigures: { schemaVersion: LESSON_FIGURES_VERSION, figures } });
    assert.equal(artifact([figure])?.figures.length, 1);
    assert.equal(artifact([]), null, "an empty list is no artifact");
    assert.equal(artifact([{ ...figure, view: "velocity time graph", family: "velocity time graph" }]), null, "a view in words");
    assert.equal(artifact([{ ...figure, family: "contact_body" }]), null, "the drawn kind must be the picked view");
    assert.equal(artifact([figure, { ...figure, id: "figure_3" }, { ...figure, id: "figure_3" }]), null);
    assert.equal(artifact([{ ...figure, figureSource: "planner" }]), null);
    assert.equal(artifact([{ ...figure, tier: "drawn" }]), null);
    assert.deepEqual(Object.keys(artifact([{ ...figure, ask: "on a smooth plane" }])!.figures[0]!).sort(),
      ["family", "figureSource", "id", "sceneDocument", "tier", "view"], "stored words beside the view are dropped");
    assert.equal(lessonFiguresOf({ lessonFigures: { schemaVersion: "lesson-figures/v1", figures: [figure] } }), null, "round 1 artifacts (words) are refused");
  });
}

/** Every system prompt the planner sends, with fetch answering 503. */
async function systemPrompts(run: () => Promise<unknown>): Promise<string[]> {
  const original = globalThis.fetch;
  const prompts: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ role: string; content: string }> };
    prompts.push(body.messages?.find((message) => message.role === "system")?.content ?? "");
    return new Response("{}", { status: 503 });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return prompts;
}

const YDSE = "In Young's double slit experiment the slits are 0.5 mm apart and the screen is 1 m away. Find the fringe width.";

async function promptChecks(): Promise<void> {
  const base: TurnPlannerV3Options = { proxyUrl: "http://planner.invalid/api/chat", timeoutMs: 2000 };
  await check("prompt/closed-list", () => {
    const addon = turnPlanV3LessonFiguresAddon(YDSE);
    assert(addon, "two or more figure kinds: the addon is offered");
    const views = lessonFigureViewsFor(YDSE);
    assert(views.length >= 2);
    for (const view of views) assert(addon.includes(view), `lists ${view}`);
    assert(addon.includes("{id,view}") && !/\bask\b/.test(addon), "asks for a view id, never words");
    assert.equal(turnPlanV3LessonFiguresAddon(incline.turnPlan.question), null, "one kind can only redraw figure 1: no addon");
    assert.equal(turnPlanV3LessonFiguresAddon("Explain the SN2 mechanism."), null);
  });
  for (const question of [YDSE, "A 2 kg block slides down a 30 degree incline. Find its acceleration.", "Explain the SN2 mechanism."]) {
    const addon = turnPlanV3LessonFiguresAddon(question);
    for (const classifySubject of [false, true]) {
      const label = `${question.slice(0, 12)}/${classifySubject ? "subject" : "plain"}`;
      const absent = await systemPrompts(() => planTurnV3(question, { ...base, classifySubject }));
      const off = await systemPrompts(() => planTurnV3(question, { ...base, classifySubject, lessonFigures: false }));
      const on = await systemPrompts(() => planTurnV3(question, { ...base, classifySubject, lessonFigures: true }));
      await check(`prompt/${label}/absent-equals-fixture`, () => {
        assert(absent.length >= 2, "both plan lanes ran");
        const fixture = withChemistryExampleAddon(TURN_PLAN_V3_PROMPT, question);
        assert(absent.some((prompt) => prompt === fixture || prompt.startsWith(`${fixture}\n\nAlso return a top-level subject`)), "the primary lane's bytes are withChemistryExampleAddon's output");
        for (const prompt of absent) assert(!prompt.includes("LESSON FIGURES"), "no addon when absent");
      });
      await check(`prompt/${label}/off-equals-absent`, () => assert.deepEqual(off, absent));
      await check(`prompt/${label}/on-appends-the-closed-list-or-nothing`, () => {
        assert.equal(on.length, absent.length);
        on.forEach((prompt, index) => {
          const plain = absent[index]!;
          if (!addon) {
            assert.equal(prompt, plain, `lane ${index}: no second kind, no addon`);
            return;
          }
          const subjectAt = plain.indexOf("\n\nAlso return a top-level subject");
          const expected = subjectAt >= 0
            ? `${plain.slice(0, subjectAt)}\n\n${addon}${plain.slice(subjectAt)}`
            : `${plain}\n\n${addon}`;
          assert.equal(prompt, expected, `lane ${index} gains exactly the addon`);
        });
      });
    }
  }
  await check("prompt/audit-never", async () => {
    const plan = { schemaVersion: "turn-plan/v3", question: YDSE } as unknown as TurnPlanV3;
    const off = await systemPrompts(() => auditTurnPlanV3(YDSE, plan, base));
    const on = await systemPrompts(() => auditTurnPlanV3(YDSE, plan, { ...base, lessonFigures: true }));
    assert.deepEqual(on, off, "the audit call keeps its bytes");
  });
  await check("prompt/addon-size", () => {
    const addon = turnPlanV3LessonFiguresAddon(YDSE)!;
    assert(addon.length < 600, `addon is ${addon.length} characters`);
    assert(!addon.includes("[FOCUS"), "the plan addon names no teaching cue");
  });
}

/** A lesson's own fast figure, as the live turn draws it first. */
function lessonFigure(plan: TurnPlanV3): { diagram: VerifiedDiagram; families: string[] } {
  const gate = deriveSceneGate({ question: plan.question, turnPlan: plan, problemIR: null, conversationContext: "" });
  const fast = selectFastFigure({ question: plan.question, turnPlan: plan, authority: null, families: gate.sceneCapabilities.families });
  assert(fast, `the lesson draws a fast figure: ${plan.question.slice(0, 40)}`);
  const presentation = buildVerifiedDiagramPresentation(fast.sceneDocument, fast.renderScene, { originalQuestion: plan.question, turnPlan: plan });
  return { diagram: presentation.diagram, families: [...gate.sceneCapabilities.families] };
}

const LINE_QUESTION = "Plot the line y = 2x + 1 and find where it crosses the y axis.";
const LINE_PLAN = {
  schemaVersion: "turn-plan/v3", question: LINE_QUESTION, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
} as unknown as TurnPlanV3;

async function planChecks(): Promise<void> {
  const plan = validateTurnPlanV3(incline.turnPlan, incline.turnPlan.question).plan;
  assert(plan, "the recorded incline plan validates");
  assert(!PLANNER_WORDS.test(plan.question), "the stem states none of the planner words");
  const lesson = lessonFigure(plan);
  const line = lessonFigure(LINE_PLAN);
  const run = (first: VerifiedDiagram, picks: readonly LessonFigureAsk[] | undefined, extra: Partial<Parameters<typeof planLessonFigures>[0]> = {}) =>
    planLessonFigures({
      lessonQuestion: plan.question, turnPlan: plan, authority: null, families: lesson.families,
      first, narrationLanguage: "english", deadlineAt: Date.now() + 60_000, asks: picks, ...extra,
    });

  await check("plan/asks-from-the-plan", () => {
    const fromPlan = run(lesson.diagram, undefined, { turnPlan: { ...plan, figures: [{ id: "figure_2", view: "contact_body" }] } as TurnPlanV3 });
    assert.deepEqual([...fromPlan.misses.map((miss) => miss.id), ...fromPlan.figures.map((figure) => figure.ask.id)], ["figure_2"], "the plan's own figures are read");
    assert.deepEqual(run(lesson.diagram, undefined), { figures: [], misses: [] }, "no figures key: nothing planned");
  });
  await check("plan/another-kind-is-an-honest-miss", () => {
    // Mutation (f): the selector draws the block for "state plot"; kept, the
    // board would show a figure of another kind than the one picked.
    const result = run(line.diagram, [{ id: "figure_2", view: "state_plot" }]);
    assert(lesson.families.includes("state_plot"), "a kind this lesson reads");
    assert.deepEqual(result, { figures: [], misses: [{ id: "figure_2", reason: "not_picked_view" }] }, "the engine has no such view of this plan: no figure, never a wrong one");
  });
  await check("plan/same-figure-as-first-is-refused", () => {
    const result = run(lesson.diagram, [{ id: "figure_2", view: "contact_body" }]);
    assert.deepEqual(result.misses, [{ id: "figure_2", reason: "same_figure" }], "a redraw of figure 1 is refused");
    assert.equal(result.figures.length, 0);
  });
  // With another first figure (a stand in for a planner drawn figure 1), the
  // same pick draws: the plan is restamped to the composed question and every
  // stated given stays stated.
  const drawn = run(line.diagram, [{ id: "figure_2", view: "contact_body" }, { id: "figure_3", view: "contact_body" }]);
  const composed = composeLessonFigureQuestion(plan.question, "contact_body");
  await check("plan/drawn-restamped", () => {
    assert.equal(drawn.figures.length, 1, `figure 2 draws: ${JSON.stringify(drawn.misses)}`);
    const figure = drawn.figures[0]!;
    assert.equal(figure.ask.id, "figure_2");
    assert.equal(figure.question, composed);
    assert.equal(figure.turnPlan.question, composed, "the plan is restamped");
    assert.equal(figure.representation.sceneDocument.source.question, composed, "the scene is planned on the composed question");
    assert.equal(figure.representation.figureSource, "fast_family");
    assert.equal(figure.representation.family, "contact_body", "the picked kind");
    assert(lesson.families.includes(figure.representation.family!), "a family the lesson question already reads");
    for (const given of plan.givens) {
      const kept = figure.turnPlan.givens.find((candidate) => candidate.id === given.id);
      assert(kept && kept.value === given.value && kept.unit === given.unit, `given ${given.id} keeps the lesson's value`);
      assert(composed.includes(given.sourceText!), `given ${given.id} is still stated`);
    }
    assert(validateTurnPlanV3({ ...plan, question: composed }, composed).plan, "the server's restamp validates on the composed question");
    assert.notEqual(figureFingerprint(figure.presentation.diagram), figureFingerprint(line.diagram));
  });
  await check("f4/planner-words-never-reach-the-selector", () => {
    // Review F4: the planner writes state words beside (or as) its pick. The
    // selector's question, the figure's plan and its source document are the
    // same bytes as for the bare pick, and none of the words is in them.
    // Mutations (d) and (e) turn this red.
    const worded = { ...plan, figures: [{ id: "figure_2", view: "contact_body", ask: "the block moving upward on a smooth frictionless plane" }] } as unknown as TurnPlanV3;
    const fromWords = run(line.diagram, undefined, { turnPlan: worded });
    assert.equal(fromWords.figures.length, 1, `figure 2 draws: ${JSON.stringify(fromWords.misses)}`);
    const figure = fromWords.figures[0]!;
    assert.equal(figure.question, composed, "the selector reads the lesson question and the engine's phrase only");
    for (const [what, value] of [["question", figure.question], ["plan", figure.turnPlan], ["document", figure.representation.sceneDocument]] as const) {
      assert(!PLANNER_WORDS.test(JSON.stringify(value)), `no planner word in the figure's ${what}`);
    }
    assert(!Object.hasOwn(figure.turnPlan, "figures"), "the plan's figures entries never travel into a figure's plan");
    const bare = drawn.figures[0]!;
    assert.deepEqual(figure.turnPlan, bare.turnPlan, "the figure's plan equals the bare pick's");
    assert.equal(figureFingerprint(figure.presentation.diagram), figureFingerprint(bare.presentation.diagram), "the same figure as the bare pick");
    assert.deepEqual(run(line.diagram, undefined, {
      turnPlan: { ...plan, figures: [{ id: "figure_2", view: "contact_body on a smooth frictionless plane moving upward" }] } as unknown as TurnPlanV3,
    }), { figures: [], misses: [] }, "words in place of a view: no figure at all");
  });
  await check("plan/earlier-figure-redraw-is-refused", () => {
    assert.deepEqual(drawn.misses, [{ id: "figure_3", reason: "same_figure" }], "figure 3 equal to figure 2 is a redraw");
  });
  await check("plan/artifact", () => {
    const artifact = lessonFiguresArtifact(drawn.figures);
    assert.equal(artifact.schemaVersion, LESSON_FIGURES_VERSION);
    assert.deepEqual(artifact.figures.map(({ id, view, tier, family, figureSource }) => ({ id, view, tier, family, figureSource })),
      [{ id: "figure_2", view: "contact_body", tier: drawn.figures[0]!.representation.tier, family: "contact_body", figureSource: "fast_family" }]);
    assert.deepEqual(lessonFiguresOf({ lessonFigures: JSON.parse(JSON.stringify(artifact)) }), JSON.parse(JSON.stringify(artifact)), "it reads back whole");
  });
  await check("plan/id-collision", () => {
    const named = { ...line.diagram, anchors: line.diagram.anchors.map((anchor, index) => index === 0 ? { ...anchor, id: "figure_2" } : anchor) };
    assert.deepEqual(run(named, [{ id: "figure_2", view: "contact_body" }]).misses, [{ id: "figure_2", reason: "id_collision" }]);
  });
  await check("plan/other-situation-is-refused", () => {
    // On this circle lesson the engine's own "vector diagram" draws two
    // vectors. Neither is part of the lesson.
    const circlePlan = validateTurnPlanV3(circle.turn.sceneArtifacts.turnPlan, circle.turn.question).plan!;
    const own = lessonFigure(circlePlan);
    const picks = [{ id: "figure_2" as const, view: "vector_diagram" as const }];
    const result = planLessonFigures({
      lessonQuestion: circlePlan.question, turnPlan: circlePlan, authority: null, families: own.families,
      first: own.diagram, narrationLanguage: "english", deadlineAt: Date.now() + 60_000, asks: picks,
    });
    assert.deepEqual(result, { figures: [], misses: [{ id: "figure_2", reason: "not_lesson_family" }] }, "a body the lesson does not have is refused");
    const composedCircle = composeLessonFigureQuestion(circlePlan.question, "vector_diagram");
    const gate = deriveSceneGate({ question: composedCircle, turnPlan: { ...circlePlan, question: composedCircle }, problemIR: null, conversationContext: "" });
    assert.equal(selectFastFigure({ question: composedCircle, turnPlan: { ...circlePlan, question: composedCircle }, authority: null, families: ["vector_diagram", ...gate.sceneCapabilities.families] })?.family,
      "vector_diagram", "without the family check the selector would draw the vectors (the guard is load bearing)");
  });
  await check("plan/no-first-figure", () => {
    const empty = { ...line.diagram, anchors: [], commands: [] };
    assert.deepEqual(run(empty, [{ id: "figure_2", view: "contact_body" }]).misses, [{ id: "figure_2", reason: "no_first_figure" }]);
  });
  await check("plan/budget", () => {
    assert.deepEqual(run(line.diagram, [{ id: "figure_2", view: "contact_body" }], { deadlineAt: Date.now() - 1 }).misses, [{ id: "figure_2", reason: "budget" }]);
  });
}

async function main(): Promise<void> {
  await askChecks();
  await promptChecks();
  await planChecks();
  console.log(`verify-lesson-figures-plan: ${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
