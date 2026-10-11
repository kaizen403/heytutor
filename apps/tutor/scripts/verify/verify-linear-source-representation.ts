import assert from "node:assert/strict";
import { compileSceneDocument, FIGURE_SOURCES, type SceneDocument } from "@heytutor/scene-engine";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { decideDiagramStrategy, diagramStrategyAllowsFigureSource } from "../../features/tutor-session/lib/scene/diagramStrategy";
import { buildSourceGroundedRepresentation, selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";

const strict = decideDiagramStrategy({ assignedStrategy: "strict", subject: "maths", chemistryLane: false, codeLesson: false, dsa: false, doubt: false });
const questions = [
  "Graph x+2y<=10 and mark A=(2,3).",
  "Graph 3x-y>5. Mark A=(2,1) and B=(0,0). State which points belong to the half-plane.",
  "Let A=[-5,-2) and B=(-2,3]. Represent A union B on a number line and state whether -2 belongs to it.",
  "Graph x+y=9 and x-y=1 and find their intersection.",
  "Maximize Z=3x+2y subject to x>=0, y>=0, x+y<=8 and x<=5. Show the feasible region and all corners.",
];
let checks = 0;
// A complete source figure must not conceal a stale narrated answer. Check
// selection, direct fallback and persistence at the same authority boundary.
const lpQuestion = "Maximize Z=3x+2y subject to x>=0, y>=0, x+y<=8 and x<=5. Show the feasible region and find the optimal point.";
const lpBase = { ...createFallbackTurnPlanV3(lpQuestion), visualRequirement: "required" as const };
const lpFigure = selectVerifiedRepresentation({ question: lpQuestion, turnPlan: lpBase });
for (const [symbol, value] of [["Z", 999], ["x", 999], ["y", 999]] as const) {
  const plan = { ...lpBase, derived: [{ id: "answer", symbol, unit: "1", provenance: "derived" as const, value }] };
  assert.equal(selectVerifiedRepresentation({ question: lpQuestion, turnPlan: plan }).figureSource, "text_only"); checks++;
  assert.throws(() => buildSourceGroundedRepresentation(lpQuestion, plan), /linear_source_plan_/); checks++;
  assert.match(liveSceneSaveFailure({ document: lpFigure.sceneDocument, question: lpQuestion, turnPlan: plan, tier: lpFigure.tier }) ?? "", /linear_source_plan_/); checks++;
}
const correctLp = { ...lpBase, derived: [
  { id: "objective", symbol: "Z", unit: "1", provenance: "derived" as const, value: 21 },
  { id: "optimal_x", symbol: "x", unit: "1", provenance: "derived" as const, value: 5 },
  { id: "optimal_y", symbol: "y", unit: "1", provenance: "derived" as const, value: 3 },
] };
assert.equal(selectVerifiedRepresentation({ question: lpQuestion, turnPlan: correctLp }).figureSource, "linear_source"); checks++;
assert.equal(liveSceneSaveFailure({ document: lpFigure.sceneDocument, question: lpQuestion, turnPlan: correctLp, tier: lpFigure.tier }), null); checks++;
for (const [question, coordinates] of [
  ["The graphs y=(3/2)x+4 and y=-(1/2)x+10 cross at P. Show the graphs and find the exact coordinates of P.", [["x_P", 3], ["y_P", 8.5]]],
  ["Solve the pair x+y=6 and x-y=2. Graph both lines. Find x and y.", [["x", 4], ["y", 2]]],
] as const) {
  const base = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
  const correct = { ...base, derived: coordinates.map(([symbol, value], index) => ({ id: `coordinate_${index}`, symbol, value, unit: "1", provenance: "derived" as const })) };
  const selected = selectVerifiedRepresentation({ question, turnPlan: correct });
  assert.equal(selected.figureSource, "linear_source"); checks++;
  assert.equal(liveSceneSaveFailure({ document: selected.sceneDocument, question, turnPlan: correct, tier: selected.tier }), null); checks++;
  const stale = { ...correct, derived: correct.derived.map(quantity => ({ ...quantity, value: 999 })) };
  assert.equal(selectVerifiedRepresentation({ question, turnPlan: stale }).figureSource, "text_only"); checks++;
  assert.throws(() => buildSourceGroundedRepresentation(question, stale), /linear_source_plan_/); checks++;
  assert.match(liveSceneSaveFailure({ document: selected.sceneDocument, question, turnPlan: stale, tier: selected.tier }) ?? "", /linear_source_plan_/); checks++;
  // A caller-supplied fast scene still faces the shared final admission guard.
  const production = selectProductionScene({ question, turnPlan: stale, problemIR: null, fastRepresentation: selected });
  assert.equal(production.representation, null); checks++;
  assert.match(production.saveFailure ?? "", /linear_source_plan_/); checks++;
}
for (const question of [
  "Maximize Z=x subject to x>=0,y>=0,x<1 and y<=1. Show the feasible region.",
  "Maximize Z=x+y subject to x>=0 and y>=0. Show the feasible region.",
]) {
  const plan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const, derived: [{ id: "objective", symbol: "Z", value: 1, unit: "1", provenance: "derived" as const }] };
  assert.equal(selectVerifiedRepresentation({ question, turnPlan: plan }).figureSource, "text_only"); checks++;
  assert.throws(() => buildSourceGroundedRepresentation(question, plan), /linear_source_plan_/); checks++;
}
const coordinateQuestion = "The lines x+y=6 and x-y=2 meet at P. Graph both lines, label P, and find its x-coordinate.";
const coordinateBase = { ...createFallbackTurnPlanV3(coordinateQuestion), visualRequirement: "required" as const };
for (const symbol of ["xP", "x(P)", "answer", "perimeter"]) {
  const plan = { ...coordinateBase, unknowns: [{ id: "requested_x", symbol, unit: "1" }], derived: [{ id: "requested_x", symbol, value: 999, unit: "1", provenance: "derived" as const }] };
  assert.equal(selectVerifiedRepresentation({ question: coordinateQuestion, turnPlan: plan }).figureSource, "text_only"); checks++;
}
const coordinatePlan = { ...coordinateBase, unknowns: [{ id: "requested_x", symbol: "x_P", unit: "1" }], derived: [{ id: "requested_x", symbol: "x_P", value: 4, unit: "1", provenance: "derived" as const }] };
assert.equal(selectVerifiedRepresentation({ question: coordinateQuestion, turnPlan: coordinatePlan }).figureSource, "linear_source"); checks++;
for (const question of questions) {
  const plan = { ...createFallbackTurnPlanV3(question), visualRequirement: "required" as const };
  const selected = selectVerifiedRepresentation({ question, turnPlan: plan, preferPlanner: true });
  assert.equal(selected.figureSource, "linear_source", question); checks++;
  assert.equal(selected.tier, "qualitative_verified"); checks++;
  assert.equal(selected.nonMetric, true); checks++;
  assert.equal(selected.sceneDocument.source.question, question); checks++;
  assert.equal(selected.sceneDocument.constructions.length, 1); checks++;
  assert.equal(selected.sceneDocument.quantities.length, 0); checks++;
  assert.equal(selected.sceneDocument.annotations.length, 0); checks++;
  assert(selected.validationReport.valid); checks++;
  assert(compileSceneDocument(selected.sceneDocument).ok); checks++;
  assert(FIGURE_SOURCES.includes(selected.figureSource)); checks++;
  assert(diagramStrategyAllowsFigureSource(strict, selected.figureSource)); checks++;
  assert.deepEqual(buildSourceGroundedRepresentation(question, plan).renderScene, selected.renderScene); checks++;
  const rejected = structuredClone(selected.sceneDocument);
  rejected.entities.push({ id: "untrusted_point", kind: "point", role: "untrusted extra point" });
  rejected.constructions.push({ id: "untrusted_point_call", operator: "point", inputs: { x: 777, y: 777 }, outputs: ["untrusted_point"] });
  rejected.requiredEntityIds.push("untrusted_point");
  rejected.revealGroups[0]!.entityIds.push("untrusted_point");
  assert.equal(compileSceneDocument(rejected).ok, false); checks++;
  const input = { question, turnPlan: plan, problemIR: null, candidate: rejected as unknown as Record<string, unknown>, policy: { preferPlanner: true, allowedFigureSources: FIGURE_SOURCES.filter(source => diagramStrategyAllowsFigureSource(strict, source)) } };
  const production = selectProductionScene(input);
  assert.equal(production.candidateValidation?.valid, false); checks++;
  assert.equal(production.representation?.figureSource, "linear_source"); checks++;
  assert.equal(production.saveFailure, null); checks++;
  assert.deepEqual(production.representation?.sceneDocument, selected.sceneDocument); checks++;
  assert.equal(selectProductionScene({ ...input, solverAuthorityBlocked: true }).representation, null); checks++;
  // A planner-stamped scalar and question replacement cannot become source
  // geometry: the whole program is regenerated from the original question.
  const poisonedPlan = { ...plan, question: "Graph x+2y>999.", derived: [{ id: "forged", symbol: "Z", unit: "", provenance: "derived" as const, value: 999 }] };
  const poisoned = selectVerifiedRepresentation({ question, turnPlan: poisonedPlan });
  if (selected.family === "linear_feasible_region" || selected.family === "linear_system") {
    assert.equal(poisoned.figureSource, "text_only");
  } else {
    assert.deepEqual(poisoned.sceneDocument, selected.sceneDocument);
  }
  checks++;
}
for (const question of ["Graph x+y<4 or x-y>2.", "Graph x^2+y<4.", "Graph x+y<=4 subject to x being an integer."]) {
  const selected = selectVerifiedRepresentation({ question, turnPlan: { ...createFallbackTurnPlanV3(question), visualRequirement: "required" }, preferPlanner: true });
  assert.notEqual(selected.figureSource, "linear_source"); checks++;
}
assert.equal(diagramStrategyAllowsFigureSource(strict, "source_grounded"), false); checks++;
// Foreign generic candidates never replace a complete two-line source proof.
const question = questions[3]!;
const source = selectVerifiedRepresentation({ question, preferPlanner: true });
const generic: SceneDocument = { ...structuredClone(source.sceneDocument), constructions: [], entities: [], requiredEntityIds: [] };
const bad = compileSceneDocument(generic);
assert(!bad.ok || !bad.renderScene || selectVerifiedRepresentation({ question, exact: { sceneDocument: generic, validationReport: bad.report, renderScene: bad.renderScene }, preferPlanner: true }).figureSource === "linear_source"); checks++;
console.log(`linear source representation: ${checks} checks passed`);
