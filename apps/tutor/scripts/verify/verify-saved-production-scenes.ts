/**
 * Production figures from 20 to 26 Oct, replayed through the live selection.
 *
 * Each row is a scene document a student saw, with the turn plan and ProblemIR
 * it was saved with; the student's question is replaced by a synthetic stem
 * that keeps the same subject words, so routing reads the same evidence. A
 * planner row offers its saved document as the planner candidate; a family row
 * offers none, since the planner's reply was not saved. Every row runs on three
 * arms: the strict cohort (planner first), the current cohort (a fast figure
 * first) and the current cohort with subject classification off.
 *
 * Each arm's outcome must equal the recorded one. Every recorded draw was
 * rendered and judged; a row whose figure is still wrong names the work that
 * closes it in `open`. When an outcome changes, render the row, judge it, and
 * update the fixture.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-saved-production-scenes.ts
 */
import { readFileSync } from "node:fs";
import { FIGURE_SOURCES, type TurnPlanV3 } from "@heytutor/scene-engine";
import { deriveSceneGate, selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { decideDiagramStrategy, diagramStrategyAllowsFigureSource, type DiagramStrategy } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

type Arm = "strict" | "current" | "current_unclassified";
interface Row {
  id: string;
  question: string;
  productionSource: string;
  productionVerdict: string;
  turnPlan: TurnPlanV3;
  problemIR: Parameters<typeof selectProductionScene>[0]["problemIR"];
  candidate: Record<string, unknown>;
  expect: Record<Arm, string>;
  open?: Partial<Record<Arm, string>>;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/saved-production-scenes.json", import.meta.url), "utf8")) as { rows: Row[] };
const ARMS: Array<{ arm: Arm; assigned: DiagramStrategy; classified: boolean }> = [
  { arm: "strict", assigned: "strict", classified: true },
  { arm: "current", assigned: "current", classified: true },
  { arm: "current_unclassified", assigned: "current", classified: false },
];
const subjectOf = (plan: TurnPlanV3) => {
  const subject = String((plan as { subject?: string }).subject ?? "other").toLowerCase();
  return subject === "physics" || subject === "chemistry" || subject === "maths" ? subject : "other";
};

function outcome(row: Row, arm: (typeof ARMS)[number]): string {
  const { question, turnPlan } = row;
  const problemIR = row.problemIR ?? null;
  const gate = deriveSceneGate({ question, turnPlan, problemIR });
  const decision = decideDiagramStrategy({
    assignedStrategy: arm.assigned, chemistryLane: gate.chemistryLane, codeLesson: false, dsa: false, doubt: false,
    ...(arm.classified ? { subject: subjectOf(turnPlan), strictSubjects: ["maths"] as const } : {}),
  });
  // planningOverlap: planner first never computes the fast figure; the current order
  // skips the planner once a fast figure exists.
  const fast = decision.selectionOrder === "planner_first" || !gate.shouldPlanExactScene ? null
    : selectFastVerifiedRepresentation({ question, turnPlan: gate.turnPlan, problemIR, families: gate.sceneCapabilities.families });
  const planner = row.productionSource === "planner" && !fast ? structuredClone(row.candidate) : null;
  const selection = selectProductionScene({
    question, turnPlan, problemIR, sceneCapabilities: gate.sceneCapabilities,
    candidate: planner, fastRepresentation: fast, requiredRetryEnabled: true,
    policy: {
      preferPlanner: decision.strategy === "strict",
      allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)),
    },
  });
  const drawn = selection.representation;
  return drawn ? `${drawn.figureSource}:${drawn.family ?? ""}` : "none";
}

const failures: string[] = [];
const open: string[] = [];
let passed = 0;
for (const row of fixture.rows) {
  for (const arm of ARMS) {
    const actual = outcome(row, arm);
    const expected = row.expect[arm.arm];
    if (actual !== expected) {
      failures.push(`${row.id} ${arm.arm}: expected ${expected}, got ${actual}`);
      console.log(`FAIL ${row.id} ${arm.arm}: expected ${expected}, got ${actual} (render it, judge it, update the fixture)`);
      continue;
    }
    passed += 1;
    const note = row.open?.[arm.arm];
    if (note) open.push(`${row.id} ${arm.arm}: ${actual} (${note})`);
    console.log(`pass ${row.id} ${arm.arm}: ${actual}${note ? `  OPEN: ${note}` : ""}`);
  }
}
console.log(`\n${passed} passed, ${failures.length} failed, ${open.length} open`);
if (failures.length) process.exit(1);
