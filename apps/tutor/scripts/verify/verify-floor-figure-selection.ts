/**
 * DIAGRAM_FLOOR_FIGURE through the production strict selector. Off changes
 * nothing. On, every adversarial case (the review's counter-examples for #245
 * included) draws or declines exactly as the engine gate says; a drawn floor
 * figure faces save admission and both yield policies untrimmed; the floor
 * never draws over a valid planner figure, a solver contradiction, a source
 * veto or a turn that asks for no figure. Synthetic questions only.
 */
import assert from "node:assert/strict";
import { FIGURE_SOURCES, parseDiagramFloorFigure, type ProblemIR, type TurnPlanV3 } from "@heytutor/scene-engine";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision } from "../../features/tutor-session/lib/scene/diagramStrategy";
import {
  selectProductionScene, validateProductionSceneCandidate, type ProductionSceneSelectionInput,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { resolveDiagramFloorFigure } from "../../lib/scene/diagramStrategy.server";
import { FLOOR_ADVERSARIAL_CASES } from "../../../../packages/scene-engine/scripts/verify/fixtures/floorAdversarial";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}

const strict = liveDiagramStrategyDecision({ assignedStrategy: "current", subject: "physics", strictSubjects: ["maths", "physics"],
  chemistryLane: false, codeLesson: false, dsa: false, doubt: false });
check(strict.strategy === "strict", "physics runs strict");
const policy = { preferPlanner: true, allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(strict, source)) };
check(policy.allowedFigureSources.includes("floor"), "strict admits the floor source; the flag gates it");
check(!policy.allowedFigureSources.includes("archetype") && !policy.allowedFigureSources.includes("family"), "strict still suppresses archetype and family figures");
check(parseDiagramFloorFigure("on") && parseDiagramFloorFigure(" ON ") && !parseDiagramFloorFigure("1") && !parseDiagramFloorFigure(undefined) &&
  !parseDiagramFloorFigure("off"), "only DIAGRAM_FLOOR_FIGURE=on enables the floor");
check(resolveDiagramFloorFigure(undefined) === false && resolveDiagramFloorFigure("on") === true, "the server flag defaults off");

const select = (question: string, turnPlan: unknown, problemIR: ProblemIR | null, extra: Partial<ProductionSceneSelectionInput> = {}) =>
  selectProductionScene({
    question, turnPlan: turnPlan as TurnPlanV3, problemIR, candidateValidation: null, fastRepresentation: null,
    exactFigureSource: "planner", solverAuthorityBlocked: false, requiredRetryEnabled: true, policy, ...extra,
  });

// Every adversarial case: off draws no floor; on draws exactly when the engine gate says, through every admission check.
for (const item of FLOOR_ADVERSARIAL_CASES) {
  const off = select(item.question, item.turnPlan, item.problemIR);
  check(off.representation?.figureSource !== "floor" && off.floor === undefined, `${item.id}: flag off never draws a floor figure`);
  const on = select(item.question, item.turnPlan, item.problemIR, { floorFigureEnabled: true });
  if (off.representation) {
    check(on.representation?.figureSource === off.representation.figureSource, `${item.id}: a figure main draws is kept`);
    continue;
  }
  const drewFloor = on.representation?.figureSource === "floor";
  check(drewFloor === (item.expect === "draw"), `${item.id} must ${item.expect} through the strict selector: ${on.floor?.reason ?? on.reason}`);
  if (!drewFloor) continue;
  const representation = on.representation!;
  check(representation.tier === "question_representation" && representation.nonMetric, `${item.id}: a nonmetric question representation`);
  check(liveSceneSaveFailure({ document: representation.sceneDocument, question: item.question, turnPlan: item.turnPlan as unknown as TurnPlanV3, tier: representation.tier }) === null,
    `${item.id}: passes save admission`);
  for (const yieldPolicy of ["off", "verified_parts"] as const) {
    const admitted = validateProductionSceneCandidate({ candidate: structuredClone(representation.sceneDocument) as unknown as Record<string, unknown>,
      question: item.question, turnPlan: item.turnPlan as unknown as TurnPlanV3, yieldPolicy });
    check(admitted.valid && admitted.value?.document.source.yieldDemotions === undefined, `${item.id}: passes ${yieldPolicy} admission untrimmed`);
  }
}

// Never over a solver contradiction, a valid planner figure, or a turn that asks for no figure.
const ladder = FLOOR_ADVERSARIAL_CASES.find((item) => item.id === "circuit-parallel-cell")!;
const drawn = select(ladder.question, ladder.turnPlan, ladder.problemIR, { floorFigureEnabled: true });
check(drawn.representation?.figureSource === "floor", "the parallel pair across a cell draws a floor figure");
check(select(ladder.question, ladder.turnPlan, ladder.problemIR, { floorFigureEnabled: true, solverAuthorityBlocked: true }).representation === null,
  "no floor over a solver contradiction");
{
  const document = structuredClone(drawn.representation!.sceneDocument) as unknown as Record<string, unknown>;
  document.source = { question: ladder.question };
  const planner = validateProductionSceneCandidate({ candidate: document, question: ladder.question, turnPlan: ladder.turnPlan as unknown as TurnPlanV3 });
  check(planner.valid, "the planner-shaped control validates");
  const kept = select(ladder.question, ladder.turnPlan, ladder.problemIR, { floorFigureEnabled: true, candidateValidation: planner });
  check(kept.representation?.figureSource === "planner" && kept.floor === undefined, "a valid planner figure is drawn and the floor is not tried");
}
{
  const plain = "What is the sum of 2 and 3?";
  const none = select(plain, { ...(ladder.turnPlan as object), question: plain, visualRequirement: "none", givens: [], unknowns: [] }, null, { floorFigureEnabled: true });
  check(none.representation === null && none.floor === undefined && none.reason === "the question asks for no figure", "a turn that asks for no figure gets no floor");
}

// Never over a source veto: stated lines whose plan contradicts the source's own solution.
{
  const question = "Solve the pair x + y = 6 and x - y = 2 by the graphical method.";
  const lines: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: [], unknowns: [{ id: "x", symbol: "x" }, { id: "y", symbol: "y" }],
    derived: [{ id: "x", symbol: "x", value: 5, provenance: "derived" }, { id: "y", symbol: "y", value: 1, provenance: "derived" }],
    qualitativeClaims: [], lawIds: [], assumptions: [],
  };
  const vetoed = select(question, lines, null, { floorFigureEnabled: true });
  check(/linear_source/.test(vetoed.reason) && vetoed.representation === null && vetoed.floor === undefined, `no floor over a source veto: ${vetoed.reason}`);
}

console.log(`verify-floor-figure-selection: ${checks} checks passed (${FLOOR_ADVERSARIAL_CASES.length} adversarial cases through the strict selector)`);
