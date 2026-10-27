/**
 * Qualitative fluid figures (submerged_body, hydraulic_press) through live
 * strict selection and save admission.
 *
 * They draw display proportions, so they may only draw when the source states
 * no value they could contradict. A stated depth, piston area, force, density
 * or pressure (in the stem or the plan) must leave the board to a numeric
 * figure or to text, never be silently replaced by the display ratio. A
 * conceptual stem still draws, as a qualitative planner figure.
 *
 *   cd apps/tutor && tsx --tsconfig tsconfig.json scripts/verify/verify-fluid-apparatus-admission.ts
 */
import assert from "node:assert/strict";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import type { SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";

let checks = 0;
const failures: string[] = [];
/** Every row runs, so a mutation shows exactly which rows it turns red. */
function row(name: string, run: () => void): void {
  try { run(); checks++; } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${(error as Error).message.split("\n")[0]}`); }
}
const strict = { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "linear_source", "text_only"] as const };

type Entity = [id: string, kind: string, role: string, label?: string];
function document(operator: string, inputs: Record<string, unknown>, entities: Entity[]): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: operator },
    source: {},
    quantities: [],
    entities: entities.map(([id, kind, role, label]) => ({ id, kind, role, ...(label ? { label } : {}) })),
    constructions: [{ id: "make", operator, inputs, outputs: entities.map(([id]) => id) }],
    relations: [], assertions: [], annotations: [],
    requiredEntityIds: entities.map(([id]) => id),
    revealGroups: [{ id: "setup", entityIds: entities.map(([id]) => id), dependsOn: [], narrationCue: operator }],
    teachingTimeline: [],
  } as unknown as SceneDocument;
}
const archimedes = document("submerged_body", { topDepth: 2, bodyHeight: 2, bodyWidth: 2.4 }, [
  ["fluid", "polygon", "fluid", "fluid"], ["surface", "segment", "surface"], ["body", "polygon", "body", "body"],
  ["fTop", "vector", "force", "F1"], ["fBottom", "vector", "force", "F2"], ["fB", "vector", "force", "F_B"],
  ["h1", "dimension", "depth", "h1"], ["h2", "dimension", "depth", "h2"],
]);
const press = document("hydraulic_press", { smallWidth: 1, largeWidth: 2, forceLength: 0.8 }, [
  ["vessel", "polyline", "vessel"], ["liquid", "polygon", "fluid", "liquid"], ["small", "polygon", "piston", "A1"],
  ["large", "polygon", "piston", "A2"], ["f1", "vector", "force", "F1"], ["f2", "vector", "force", "F2"], ["p", "point", "pressure", "P"],
]);

type Given = { id: string; symbol: string; value: number; unit: string };
function plan(question: string, laws: string[], givens: Given[] = []): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question, subject: "physics", visualRequirement: "required", lawIds: laws,
    givens: givens.map((given) => ({ ...given, provenance: "given", sourceText: given.symbol })),
    unknowns: [], derived: [], assumptions: [],
    qualitativeClaims: [{ id: "c1", claim: "The pressure difference across the body gives an upward net force." }],
  } as unknown as TurnPlanV3;
}
function select(candidate: SceneDocument, question: string, turnPlan: TurnPlanV3) {
  // A live planner document names the question it was drawn for.
  const asked = { ...structuredClone(candidate), source: { question } };
  return selectProductionScene({ question, turnPlan, problemIR: null, candidate: asked as unknown as Record<string, unknown>, policy: strict, requiredRetryEnabled: true });
}
function draws(name: string, candidate: SceneDocument, question: string, turnPlan: TurnPlanV3): void {
  row(name, () => {
  const selected = select(candidate, question, turnPlan);
  assert.ok(selected.representation, `${name}: expected a figure, got ${selected.reason}`);
  assert.equal(selected.representation.figureSource, "planner", `${name}: drawn by the planner`);
  assert.equal(selected.representation.tier, "qualitative_verified", `${name}: never exact`);
  });
}
function refused(name: string, candidate: SceneDocument, question: string, turnPlan: TurnPlanV3): void {
  row(name, () => {
  const selected = select(candidate, question, turnPlan);
  assert.equal(selected.representation, null, `${name}: expected no figure`);
  assert.match(selected.reason, /_source_has_values/, `${name}: refused by the fluid source guard, not by chance: ${selected.reason}`);
  const failure = sceneSaveAdmissionFailure({ document: { ...candidate, source: { question } } as SceneDocument, question, turnPlan, tier: "qualitative_verified" });
  assert.match(failure ?? "", /_source_has_values/, `${name}: persistence refuses it too`);
  });
}

// Conceptual stems draw.
const deriveArchimedes = "Derive Archimedes' principle and explain it simply.";
draws("conceptual Archimedes", archimedes, deriveArchimedes, plan(deriveArchimedes, ["archimedes_principle", "fluid_pressure_depth_relation"]));
const explainPress = "Explain the hydraulic press on the basis of Pascal's law with a diagram.";
draws("conceptual press", press, explainPress, plan(explainPress, ["pascals_law", "pressure_definition"]));
const curriculum = "Class 11 chapter 10, section 10.3: explain Archimedes' principle and why F2 - F1 equals the upthrust.";
draws("curriculum numbers and symbol subscripts are not values", archimedes, curriculum, plan(curriculum, ["archimedes_principle"]));
const withGravity = "Explain why a body in water feels an upthrust.";
draws("gravity alone is not a contradicted value", archimedes, withGravity, plan(withGravity, ["archimedes_principle"], [{ id: "g", symbol: "g", value: 9.8, unit: "m/s^2" }]));

// Stated values refuse.
const depthStem = "A cube of side 10 cm is held with its top face 20 cm below the water surface. Find the upthrust.";
refused("Archimedes with a stated depth in the stem", archimedes, depthStem, plan(depthStem, ["archimedes_principle"]));
const planDepth = "Find the upthrust on the submerged cube.";
refused("Archimedes with a stated depth in the plan", archimedes, planDepth, plan(planDepth, ["archimedes_principle"], [{ id: "h", symbol: "h", value: 0.2, unit: "m" }]));
const areaStem = "In a hydraulic press the large piston has 10 times the area of the small piston. Explain the force multiplication.";
refused("press with stated piston areas in the stem", press, areaStem, plan(areaStem, ["pascals_law"]));
const ratioPlan = "Explain the force on the large piston of a hydraulic lift.";
refused("press with a stated area ratio in the plan", press, ratioPlan, plan(ratioPlan, ["pascals_law"], [{ id: "ratio", symbol: "A2/A1", value: 10, unit: "" }]));
const forcePlan = "Explain how a hydraulic jack lifts a car.";
refused("press with a stated force in the plan", press, forcePlan, plan(forcePlan, ["pascals_law"], [{ id: "F1", symbol: "F1", value: 200, unit: "N" }]));

if (failures.length > 0) {
  console.error(`verify-fluid-apparatus-admission: ${failures.length} failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`verify-fluid-apparatus-admission: ${checks} checks passed`);
