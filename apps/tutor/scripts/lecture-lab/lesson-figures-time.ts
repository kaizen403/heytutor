/**
 * How long planLessonFigures holds the main thread (round 2 review N5). $0:
 * no network, no LLM. Each fixture runs once cold (first call in the
 * process, as the first lesson of a session) and then RUNS times warm.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/lecture-lab/lesson-figures-time.ts
 */
import { performance } from "node:perf_hooks";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { VerifiedDiagram } from "@heytutor/drawing";
import incline from "../verify/fixtures/lesson-figures-incline-plan.json";
import circle from "../verify/fixtures/replay/circle-s3-turn.json";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { planLessonFigures } from "../../features/tutor-session/lib/turn/lessonFigurePlan";
import type { LessonFigureAsk } from "../../lib/boards/lessonFigures";

const RUNS = Number(process.env.RUNS ?? 20);

function lesson(question: string, raw: unknown): { plan: TurnPlanV3; families: string[]; first: VerifiedDiagram | null } {
  const plan = validateTurnPlanV3(raw, question).plan;
  if (!plan) throw new Error(`plan does not validate: ${question.slice(0, 40)}`);
  const families = [...deriveSceneGate({ question, turnPlan: plan, problemIR: null, conversationContext: "" }).sceneCapabilities.families];
  const fast = selectFastFigure({ question, turnPlan: plan, authority: null, families });
  const first = fast ? buildVerifiedDiagramPresentation(fast.sceneDocument, fast.renderScene, { originalQuestion: question, turnPlan: plan }).diagram : null;
  return { plan, families, first };
}

const LINE_QUESTION = "Plot the line y = 2x + 1 and find where it crosses the y axis.";
const line = lesson(LINE_QUESTION, {
  schemaVersion: "turn-plan/v3", question: LINE_QUESTION, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
});
const inclineLesson = lesson(incline.turnPlan.question, incline.turnPlan);
const circleLesson = lesson(circle.turn.question, circle.turn.sceneArtifacts.turnPlan);

const fixtures: Array<{ name: string; question: string; lesson: typeof inclineLesson; first: VerifiedDiagram; picks: LessonFigureAsk[] }> = [
  { name: "incline, own figure 1, contact_body (same figure)", question: incline.turnPlan.question, lesson: inclineLesson, first: inclineLesson.first!, picks: [{ id: "figure_2", view: "contact_body" }] },
  { name: "incline, line first, contact_body + state_plot", question: incline.turnPlan.question, lesson: inclineLesson, first: line.first!, picks: [{ id: "figure_2", view: "contact_body" }, { id: "figure_3", view: "state_plot" }] },
  { name: "circle, own figure 1, coordinate_figure + vector_diagram", question: circle.turn.question, lesson: circleLesson, first: circleLesson.first!, picks: [{ id: "figure_2", view: "coordinate_figure" }, { id: "figure_3", view: "vector_diagram" }] },
];

function once(fixture: (typeof fixtures)[number]): { ms: number; drawn: number } {
  const started = performance.now();
  const result = planLessonFigures({
    lessonQuestion: fixture.question, turnPlan: fixture.lesson.plan, authority: null, families: fixture.lesson.families,
    first: fixture.first, narrationLanguage: "english", deadlineAt: Date.now() + 60_000, asks: fixture.picks,
  });
  return { ms: performance.now() - started, drawn: result.figures.length };
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

for (const fixture of fixtures) {
  const cold = once(fixture);
  const warm = Array.from({ length: RUNS }, () => once(fixture).ms).sort((a, b) => a - b);
  console.log(`${fixture.name}: drawn ${cold.drawn}, cold ${cold.ms.toFixed(1)} ms, warm p50 ${quantile(warm, 0.5).toFixed(1)} ms, max ${warm[warm.length - 1]!.toFixed(1)} ms (${RUNS} runs)`);
}
