/**
 * Lesson figures, plan side (DIAGRAM_LESSON_FIGURES, lane 4).
 *
 * Mutations this gate catches (brief lane 4 table):
 * (a) allow digits: lessonFigureAsksOf keeps an ask with a digit;
 * (b) skip the same-figure reject in planLessonFigures;
 * (c) append the planner addon unconditionally (turnPlannerV3.ts; rebuild
 *     tutor-core, this gate reads its dist).
 */
import assert from "node:assert/strict";
import {
  TURN_PLAN_V3_LESSON_FIGURES_ADDON,
  TURN_PLAN_V3_PROMPT,
  auditTurnPlanV3,
  planTurnV3,
  withChemistryExampleAddon,
  type TurnPlannerV3Options,
} from "@heytutor/tutor-core";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { VerifiedDiagram } from "@heytutor/drawing";
import incline from "./fixtures/lesson-figures-incline-plan.json";
import circle from "./fixtures/replay/circle-s3-turn.json";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { figureFingerprint, selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { lessonFiguresArtifact, planLessonFigures } from "../../features/tutor-session/lib/turn/lessonFigurePlan";
import {
  composeLessonFigureQuestion,
  isLessonFigureAdvanceId,
  lessonFigureAsksOf,
  lessonFiguresOf,
  resolveLessonFiguresEnabled,
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

async function askChecks(): Promise<void> {
  await check("asks/well-formed", () => {
    assert.deepEqual(asks([{ id: "figure_2", ask: " velocity time graph of the block " }]), [{ id: "figure_2", ask: "velocity time graph of the block" }]);
    assert.deepEqual(asks([{ id: "figure_2", ask: "free body diagram" }, { id: "figure_3", ask: "velocity time graph" }]).map((entry) => entry.id), ["figure_2", "figure_3"]);
  });
  await check("asks/absent-or-not-a-list", () => {
    assert.deepEqual(lessonFigureAsksOf({}), []);
    assert.deepEqual(lessonFigureAsksOf(null), []);
    assert.deepEqual(asks({ id: "figure_2", ask: "free body diagram" }), []);
    assert.deepEqual(asks([]), []);
  });
  await check("asks/digit-drops-the-list", () => {
    assert.deepEqual(asks([{ id: "figure_2", ask: "free body diagram" }, { id: "figure_3", ask: "graph for 5 seconds" }]), [], "a digit in any ask drops the whole list");
    assert.deepEqual(asks([{ id: "figure_2", ask: "graph up to ٣ seconds" }]), [], "any script's digit");
    assert.deepEqual(asks([{ id: "figure_2", ask: "graph for two seconds" }]), [], "a number word");
  });
  await check("asks/three-entries", () => {
    assert.deepEqual(asks([
      { id: "figure_2", ask: "free body diagram" }, { id: "figure_3", ask: "velocity time graph" }, { id: "figure_3", ask: "energy bar chart" },
    ]), []);
  });
  await check("asks/duplicate-id", () => {
    assert.deepEqual(asks([{ id: "figure_2", ask: "free body diagram" }, { id: "figure_2", ask: "velocity time graph" }]), []);
  });
  await check("asks/id-outside", () => {
    for (const id of ["figure_1", "figure_4", "Figure_2", "figure_2 ", 2, null]) {
      assert.deepEqual(asks([{ id, ask: "free body diagram" }]), [], `id ${JSON.stringify(id)}`);
    }
    assert.deepEqual(asks([{ id: "figure_3", ask: "velocity time graph" }, { id: "figure_2", ask: "free body diagram" }]), [], "ids ascend");
  });
  await check("asks/shape", () => {
    for (const ask of ["ab", "x".repeat(81), "graph [FOCUS:x]", "graph: velocity", "graph\nnext", 7, null]) {
      assert.deepEqual(asks([{ id: "figure_2", ask }]), [], `ask ${JSON.stringify(ask)}`);
    }
    assert.equal(asks([{ id: "figure_2", ask: "x".repeat(80) }]).length, 1, "80 characters is allowed");
  });
  await check("ids/advance", () => {
    assert(isLessonFigureAdvanceId("figure_2") && isLessonFigureAdvanceId("figure_3"));
    for (const id of ["figure_1", "figure_4", "figure_2x", " figure_2", "FIGURE_2"]) assert(!isLessonFigureAdvanceId(id), id);
  });
  await check("compose", () => {
    assert.equal(composeLessonFigureQuestion("  A block slides.  ", " velocity time graph "), "A block slides.\n\nFigure: velocity time graph");
  });
  await check("flag", () => {
    assert.equal(resolveLessonFiguresEnabled({}), false);
    assert.equal(resolveLessonFiguresEnabled({ DIAGRAM_LESSON_FIGURES: "1" }), false);
    assert.equal(resolveLessonFiguresEnabled({ DIAGRAM_LESSON_FIGURES: "on" }), true);
  });
  await check("artifact/validated-whole", () => {
    const figure = { id: "figure_2", ask: "velocity time graph", sceneDocument: { schemaVersion: "scene-document/v2" }, tier: "qualitative_verified", family: "graph", figureSource: "fast_family" };
    const artifact = (figures: unknown[]) => lessonFiguresOf({ lessonFigures: { schemaVersion: "lesson-figures/v1", figures } });
    assert.equal(artifact([figure])?.figures.length, 1);
    assert.equal(artifact([]), null, "an empty list is no artifact");
    assert.equal(artifact([{ ...figure, ask: "graph for 5 s" }]), null);
    assert.equal(artifact([figure, { ...figure, id: "figure_3" }, { ...figure, id: "figure_3" }]), null);
    assert.equal(artifact([{ ...figure, figureSource: "planner" }]), null);
    assert.equal(artifact([{ ...figure, tier: "drawn" }]), null);
    assert.equal(lessonFiguresOf({ lessonFigures: { schemaVersion: "lesson-figures/v2", figures: [figure] } }), null);
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

async function promptChecks(): Promise<void> {
  const base: TurnPlannerV3Options = { proxyUrl: "http://planner.invalid/api/chat", timeoutMs: 2000 };
  for (const question of ["A 2 kg block slides down a 30 degree incline. Find its acceleration.", "Explain the SN2 mechanism."]) {
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
      await check(`prompt/${label}/on-appends-addon`, () => {
        assert.equal(on.length, absent.length);
        on.forEach((prompt, index) => {
          const plain = absent[index]!;
          const subjectAt = plain.indexOf("\n\nAlso return a top-level subject");
          const expected = subjectAt >= 0
            ? `${plain.slice(0, subjectAt)}\n\n${TURN_PLAN_V3_LESSON_FIGURES_ADDON}${plain.slice(subjectAt)}`
            : `${plain}\n\n${TURN_PLAN_V3_LESSON_FIGURES_ADDON}`;
          assert.equal(prompt, expected, `lane ${index} gains exactly the addon`);
        });
      });
    }
  }
  await check("prompt/audit-never", async () => {
    const plan = { schemaVersion: "turn-plan/v3", question: "q" } as unknown as TurnPlanV3;
    const off = await systemPrompts(() => auditTurnPlanV3("q", plan, base));
    const on = await systemPrompts(() => auditTurnPlanV3("q", plan, { ...base, lessonFigures: true }));
    assert.deepEqual(on, off, "the audit call keeps its bytes");
  });
  await check("prompt/addon-size", () => {
    assert(TURN_PLAN_V3_LESSON_FIGURES_ADDON.length < 600, `addon is ${TURN_PLAN_V3_LESSON_FIGURES_ADDON.length} characters`);
    assert(!TURN_PLAN_V3_LESSON_FIGURES_ADDON.includes("[FOCUS"), "the plan addon names no teaching cue");
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
  const lesson = lessonFigure(plan);
  const line = lessonFigure(LINE_PLAN);
  const run = (first: VerifiedDiagram, asks: Array<{ id: "figure_2" | "figure_3"; ask: string }>, extra: Partial<Parameters<typeof planLessonFigures>[0]> = {}) =>
    planLessonFigures({
      lessonQuestion: plan.question, turnPlan: plan, authority: null, families: lesson.families,
      first, narrationLanguage: "english", deadlineAt: Date.now() + 60_000, asks, ...extra,
    });

  await check("plan/asks-from-the-plan", () => {
    const fromPlan = run(lesson.diagram, undefined as never, { asks: undefined, turnPlan: { ...plan, figures: [{ id: "figure_2", ask: "free body diagram of the block" }] } as TurnPlanV3 });
    assert.deepEqual([...fromPlan.misses.map((miss) => miss.id), ...fromPlan.figures.map((figure) => figure.ask.id)], ["figure_2"], "the plan's own figures are read");
    assert.deepEqual(run(lesson.diagram, undefined as never, { asks: undefined }), { figures: [], misses: [] }, "no figures key: nothing planned");
  });
  await check("plan/velocity-time-graph-is-an-honest-miss", () => {
    const result = run(lesson.diagram, [{ id: "figure_2", ask: "velocity time graph of the block" }]);
    assert.deepEqual(result, { figures: [], misses: [{ id: "figure_2", reason: "no_fast_figure" }] }, "the engine has no such view of this plan: no figure, never a wrong one");
  });
  await check("plan/same-figure-as-first-is-refused", () => {
    const result = run(lesson.diagram, [{ id: "figure_2", ask: "free body diagram of the block" }]);
    assert.deepEqual(result.misses, [{ id: "figure_2", reason: "same_figure" }], "a redraw of figure 1 is refused");
    assert.equal(result.figures.length, 0);
  });
  // With another first figure (a stand in for a planner drawn figure 1), the
  // same ask draws: the plan is restamped to the composed question and every
  // stated given stays stated.
  const drawn = run(line.diagram, [{ id: "figure_2", ask: "free body diagram of the block" }, { id: "figure_3", ask: "the block resting on the plane" }]);
  await check("plan/drawn-restamped", () => {
    assert.equal(drawn.figures.length, 1, `figure 2 draws: ${JSON.stringify(drawn.misses)}`);
    const figure = drawn.figures[0]!;
    const composed = composeLessonFigureQuestion(plan.question, "free body diagram of the block");
    assert.equal(figure.ask.id, "figure_2");
    assert.equal(figure.question, composed);
    assert.equal(figure.turnPlan.question, composed, "the plan is restamped");
    assert.equal(figure.representation.sceneDocument.source.question, composed, "the scene is planned on the composed question");
    assert.equal(figure.representation.figureSource, "fast_family");
    assert(lesson.families.includes(figure.representation.family!), "a family the lesson question already reads");
    for (const given of plan.givens) {
      const kept = figure.turnPlan.givens.find((candidate) => candidate.id === given.id);
      assert(kept && kept.value === given.value && kept.unit === given.unit, `given ${given.id} keeps the lesson's value`);
      assert(composed.includes(given.sourceText!), `given ${given.id} is still stated`);
    }
    assert(validateTurnPlanV3({ ...plan, question: composed }, composed).plan, "the server's restamp validates on the composed question");
    assert.notEqual(figureFingerprint(figure.presentation.diagram), figureFingerprint(line.diagram));
  });
  await check("plan/earlier-figure-redraw-is-refused", () => {
    assert.deepEqual(drawn.misses, [{ id: "figure_3", reason: "same_figure" }], "figure 3 equal to figure 2 is a redraw");
  });
  await check("plan/artifact", () => {
    const artifact = lessonFiguresArtifact(drawn.figures);
    assert.equal(artifact.schemaVersion, "lesson-figures/v1");
    assert.deepEqual(artifact.figures.map(({ id, ask, tier, family, figureSource }) => ({ id, ask, tier, family, figureSource })),
      [{ id: "figure_2", ask: "free body diagram of the block", tier: drawn.figures[0]!.representation.tier, family: drawn.figures[0]!.representation.family, figureSource: "fast_family" }]);
    assert.deepEqual(lessonFiguresOf({ lessonFigures: JSON.parse(JSON.stringify(artifact)) }), JSON.parse(JSON.stringify(artifact)), "it reads back whole");
  });
  await check("plan/id-collision", () => {
    const named = { ...line.diagram, anchors: line.diagram.anchors.map((anchor, index) => index === 0 ? { ...anchor, id: "figure_2" } : anchor) };
    assert.deepEqual(run(named, [{ id: "figure_2", ask: "free body diagram of the block" }]).misses, [{ id: "figure_2", reason: "id_collision" }]);
  });
  await check("plan/other-situation-is-refused", () => {
    // Recorded: on this circle lesson the ask "free body diagram of the body"
    // made the selector draw a block. The block is no part of the lesson.
    const circlePlan = validateTurnPlanV3(circle.turn.sceneArtifacts.turnPlan, circle.turn.question).plan!;
    const own = lessonFigure(circlePlan);
    const asks = [{ id: "figure_2" as const, ask: "free body diagram of the body" }];
    const result = planLessonFigures({
      lessonQuestion: circlePlan.question, turnPlan: circlePlan, authority: null, families: own.families,
      first: own.diagram, narrationLanguage: "english", deadlineAt: Date.now() + 60_000, asks,
    });
    assert.deepEqual(result, { figures: [], misses: [{ id: "figure_2", reason: "not_lesson_family" }] }, "a body the lesson does not have is refused");
    const composed = composeLessonFigureQuestion(circlePlan.question, asks[0]!.ask);
    const gate = deriveSceneGate({ question: composed, turnPlan: { ...circlePlan, question: composed }, problemIR: null, conversationContext: "" });
    assert.equal(selectFastFigure({ question: composed, turnPlan: { ...circlePlan, question: composed }, authority: null, families: gate.sceneCapabilities.families })?.family,
      "contact_body", "without the family check the selector would draw the block (the guard is load bearing)");
  });
  await check("plan/no-first-figure", () => {
    const empty = { ...line.diagram, anchors: [], commands: [] };
    assert.deepEqual(run(empty, [{ id: "figure_2", ask: "free body diagram of the block" }]).misses, [{ id: "figure_2", reason: "no_first_figure" }]);
  });
  await check("plan/budget", () => {
    assert.deepEqual(run(line.diagram, [{ id: "figure_2", ask: "free body diagram of the block" }], { deadlineAt: Date.now() - 1 }).misses, [{ id: "figure_2", reason: "budget" }]);
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
