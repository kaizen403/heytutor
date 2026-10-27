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
import { fluidApparatusRefusals } from "@heytutor/scene-engine";
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
const withGravity = "Explain why a fully immersed body feels an upthrust.";
draws("gravity alone is not a contradicted value", archimedes, withGravity, plan(withGravity, ["archimedes_principle"], [{ id: "g", symbol: "g", value: 9.8, unit: "m/s^2" }]));

for (const stem of [
  "Fig 10.6: derive Archimedes' principle.",
  "1. Derive Archimedes' principle. (5 marks)",
  "New syllabus session 2026-27: derive Archimedes' principle.",
]) draws(`reference numbers are not values: ${stem}`, archimedes, stem, plan(stem, ["archimedes_principle"]));
draws("a plan giving g in m s^-2 is not a contradicted value", archimedes, withGravity, plan(withGravity, ["archimedes_principle"], [{ id: "g", symbol: "g", value: 9.8, unit: "m s^-2" }]));

for (const stem of [
  "A hydraulic press consists of two cylinders of different areas. Explain how it works.",
  "Explain why F2 = F1 × A2/A1 in a hydraulic press.",
  "Ques 3 explain the hydraulic press.",
]) draws(`a conceptual press stem: ${stem}`, press, stem, plan(stem, ["pascals_law"]));
for (const stem of [
  "State Archimedes' principle: a body wholly or partially immersed in a fluid experiences an upthrust. Derive it.",
  "CBSE 2023: derive Archimedes' principle.",
  "Explain W1 and W2 in the derivation of Archimedes' principle.",
]) draws(`a conceptual Archimedes stem: ${stem}`, archimedes, stem, plan(stem, ["archimedes_principle"]));

for (const stem of [
  "State Archimedes' principle: a body partially or wholly immersed in a fluid experiences an upthrust. Derive it.",
]) draws(`a conceptual Archimedes stem: ${stem}`, archimedes, stem, plan(stem, ["archimedes_principle"]));
for (const stem of ["Explain the hydraulic press in three steps.", "Explain how a hydraulic elevator works using Pascal's law."]) {
  draws(`a conceptual press stem: ${stem}`, press, stem, plan(stem, ["pascals_law"]));
}

// Right figures the positive evidence rule gives up: each says more than a
// bare ask (a count, "times", a figure the stem cites but we cannot see, no
// named law). Failing closed costs a figure here, never a wrong one.
for (const [candidate, stem] of [
  [press, "Explain why the force is multiplied many times in a hydraulic press."],
  [press, "Show that F2/F1 = A2/A1."],
  [archimedes, "The force on one face is larger than on the other. Explain why."],
  [archimedes, "Fig 10.6 shows a body in a liquid. Derive Archimedes' principle from it."],
  // The final vocabulary cut (no placement or role words) gives these up too.
  [archimedes, "NCERT Exemplar 10.5: explain the upthrust on a fully immersed block."],
  [archimedes, "Explain why the force at the bottom of the body is greater than at the top."],
  [archimedes, "Explain how the two forces on the top and bottom faces of a submerged block compare."],
  [archimedes, "Why do the forces on the top and bottom faces differ?"],
  [archimedes, "Explain why a body in water feels an upthrust."],
  [press, "Explain how a car is raised by a hydraulic lift."],
  [press, "Why does the second piston feel a larger force?"],
] as const) refused(`declined by design: ${stem}`, candidate, stem, plan(stem, [candidate === press ? "pascals_law" : "archimedes_principle"]));

// The merge review's 30 stems (pr-335 review): each drew a wrong figure on
// d19771581. Refused through selection with a plan, and by save admission with
// no plan.
const reviewBody = [
  "Why does an ice cube stay on top of water? Explain using Archimedes' principle.",
  "Lakdi ka tukda paani par kyun tairta hai? Archimedes ke siddhant se samjhao.",
  "लकड़ी का टुकड़ा पानी पर क्यों तैरता है?",
  "A wooden block has some of its volume above the water. Explain the upthrust on it.",
  "A cork bobs on the water surface. Explain the forces on it.",
  "A block is held so that its top is above the water. Explain the upthrust.",
  "A wooden block stays on water with part of it outside. Explain.",
  "A body is immersed up to its middle in water. Explain the upthrust.",
  "Explain why a person can lie on the surface of the Dead Sea.",
  "A block touches the bottom of the beaker. Explain the forces on it.",
  "A block is lying on the seabed. Explain the upthrust.",
  "A cube is held with its top face level with the water surface. Explain the forces on its faces.",
  "A cube is just submerged in water. Explain the forces on the top and bottom faces.",
  "A block is held just below the surface of water. Explain the upthrust.",
  "Ek block paani mein poora dooba hai aur uska upar wala hissa surface ke barabar hai. Samjhao.",
  "A block is held at the interface between oil and water. Explain the upthrust.",
  "Explain the upthrust on a block in a liquid whose density increases with depth.",
  "Including the air pressure P0 on the water surface, explain the forces on the faces of a submerged block.",
  "A cube of side one metre has its top face one metre below the surface. Explain the upthrust.",
  "Explain the upthrust on an irregularly shaped stone fully immersed in water.",
  "Explain the forces on a cube held tilted at an angle under water.",
  "Explain the upthrust on a cylinder held horizontally under water.",
];
const reviewPress = [
  "Explain Pascal's law with two pistons of equal area.",
  "Explain a hydraulic press with pistons of the same size.",
  "A hydraulic press with both pistons of the same diameter: explain Pascal's law.",
  "Explain how the two pistons of a hydraulic lift with equal cross sections behave.",
  "A hydraulic car lift has three pistons. Explain how it works.",
  "A hydraulic system has three cylinders connected by a pipe. Explain Pascal's law.",
  "Explain how a hydraulic press with five pistons works.",
  "In a hydraulic lift the large piston is higher. Explain the forces.",
  "Explain a hydraulic press whose large piston is at a higher level.",
  "The two pistons are at heights h1 and h2 above the ground. Explain the forces.",
  "The output piston sits at a greater height than the input piston. Explain.",
  "The pistons are separated vertically by a distance h. Explain the forces.",
  "The small piston has a quarter of the area of the large one. Explain.",
  "Bade piston ka area chhote piston ka chaar times hai. Hydraulic press samjhao.",
  "Bade piston ka area chhote ka teen times hai, samjhao.",
];
const offTopic = [
  "Explain how a U-tube manometer measures pressure.",
  "Explain why liquid stands at the same level in connected vessels.",
  "Explain how a syringe works.",
];
// Wrong cases no refusal list names: only the positive evidence rule stops them.
const unseenBody = [
  "A raft carries a man across a river. Explain using Archimedes' principle.",
  "Why does a duck rest on a pond? Explain with Archimedes' principle.",
  "A stone hangs from a spring balance inside water. Explain the upthrust on it.",
  "Explain the upthrust on a block in mercury and then in water.",
  "A submarine rises towards the surface. Explain the upthrust on it.",
];
const unseenPress = [
  "Explain a hydraulic press whose small piston is pushed by a lever.",
  "Explain how a hydraulic press works when some oil leaks out.",
  "Explain a hydraulic press whose connecting pipe climbs over a wall.",
];
const unseenOffTopic = ["Explain how a siphon works.", "Explain how a water tank supplies water to a house."];
// The delta review (pr-335-delta): placements, piston roles and a single piston, drawn wrong on 0684e395f.
const deltaBody = [
  "Explain the upthrust on a body at the bottom.",
  "Why does a body at the bottom of water feel an upthrust?",
  "Explain the buoyant force on a body held at the bottom under water.",
  "Explain the upthrust on a submerged block at the bottom of the water.",
  "Explain the upthrust on a submerged block on the bottom.",
  "Explain the forces on a submerged block at the bottom.",
  "Explain the forces on a block held underwater at the bottom.",
  "Explain the upthrust on a block submerged at the bottom of the liquid.",
  "Explain the upthrust on a block immersed in a fluid at the bottom of water.",
  "Explain the upthrust on a block immersed with its bottom face on the bottom.",
  "Explain the upthrust on a body at the top of the water.",
  "Explain the upthrust on a submerged block at the top of the liquid.",
  "Explain the upthrust on a body in water at the top.",
  "Explain the upthrust on a block immersed in water with its top at the water.",
];
const deltaPress = [
  "Explain a hydraulic jack with a large input piston and a small output piston.",
  "Explain the hydraulic press with the effort on the large piston and the load on the small piston.",
  "Explain the hydraulic lift with the input force on the larger piston.",
  "Explain a hydraulic press with the car on the small piston and the effort on the large piston.",
  "Explain how a hydraulic lift works with the effort on the output piston.",
  "Explain Pascal's law with a piston.",
  "Explain Pascal's law with a piston in a cylinder.",
  "Explain a hydraulic lift with two pistons of small area.",
];
const reviewRows: Array<readonly [SceneDocument, string]> = [
  ...deltaBody.map((stem) => [archimedes, stem] as const),
  ...deltaPress.map((stem) => [press, stem] as const),
  ...unseenBody.map((stem) => [archimedes, stem] as const),
  ...unseenPress.map((stem) => [press, stem] as const),
  ...unseenOffTopic.flatMap((stem) => [[archimedes, stem] as const, [press, stem] as const]),
  ...reviewBody.map((stem) => [archimedes, stem] as const),
  ...reviewPress.map((stem) => [press, stem] as const),
  ...offTopic.flatMap((stem) => [[archimedes, stem] as const, [press, stem] as const]),
];
for (const [candidate, stem] of reviewRows) {
  const law = candidate === press ? "pascals_law" : "archimedes_principle";
  refused(`review stem (${candidate === press ? "press" : "body"}): ${stem}`, candidate, stem, plan(stem, [law]));
  row(`review stem, no plan (${candidate === press ? "press" : "body"}): ${stem}`, () => {
    const failure = sceneSaveAdmissionFailure({ document: { ...candidate, source: { question: stem } } as SceneDocument, question: stem, turnPlan: null, tier: "qualitative_verified" });
    assert.match(failure ?? "", /_source_has_values/, `${stem}: refused without a plan`);
  });
}

// With no retained plan (legacy saves), the stem alone still refuses.
for (const [candidate, stem] of [
  [press, "The large piston has sixteen times the area of the small piston. Explain the press."],
  [press, "Explain a hydraulic press whose pistons are at different elevations."],
  [press, "The large piston has an area ninety times that of the small one."],
  [archimedes, "A block is held under water at a depth of twelfth of a metre."],
] as const) {
  row(`no plan, stem refuses: ${stem}`, () => {
    const failure = sceneSaveAdmissionFailure({ document: { ...candidate, source: { question: stem } } as SceneDocument, question: stem, turnPlan: null, tier: "qualitative_verified" });
    assert.match(failure ?? "", /_source_has_values/, `${stem}: refused without a plan`);
  });
}

// Spelled or disguised values refuse.
for (const stem of [
  "In a hydraulic press the large piston has ten times the area of the small one. Explain the force multiplication.",
  "Explain why the large piston of a hydraulic lift has twice the force when its area is double.",
  "Hydraulic press mein bada piston das guna area ka hai, samjhao.",
  "The large piston area is x10 the small one; explain the hydraulic press.",
  "Explain how a hydraulic lift raises a 2000 kg car using Pascal's law.",
  "If the area of the large piston is doubled, explain what happens to the force.",
  "Explain why a tenfold larger piston gives a tenfold larger force.",
  "If the small piston's area is quadrupled, explain the change.",
  "The small piston has one-eighth the area of the large one. Explain.",
  "हाइड्रोलिक प्रेस में बड़ा पिस्टन दस गुना क्षेत्रफल का है, समझाइए।",
]) refused(`a spelled or disguised value: ${stem}`, press, stem, plan(stem, ["pascals_law"]));
const decimalStem = "0.5 cubic metre block is fully immersed in oil. Explain the upthrust.";
refused("a leading decimal value", archimedes, decimalStem, plan(decimalStem, ["archimedes_principle"]));

// Situations the figure cannot show refuse.
for (const stem of [
  "State and explain the principle of floatation.",
  "Why does a log stay on the surface of water?",
  "Explain the upthrust on a hemisphere held under water.",
  "A block lies at the bottom of the tank. Explain the forces on it.",
  "Why does a ship float? Explain using Archimedes' principle.",
  "A block is partially immersed in water. Explain the upthrust on it.",
  "Explain the forces on a metal sphere held under water.",
  "A block rests on the bottom of a tank of water. Explain the forces on it.",
]) refused(`a body the figure cannot show: ${stem}`, archimedes, stem, plan(stem, ["archimedes_principle"]));
for (const stem of [
  "The large piston is at a height h above the smaller piston. Explain the forces.",
  "Explain a hydraulic press whose pistons are not at the same level.",
  "Explain hydraulic brakes in a car using Pascal's law.",
  "In a hydraulic press the large piston is raised above the small one. Explain the forces.",
]) refused(`a press the figure cannot show: ${stem}`, press, stem, plan(stem, ["pascals_law"]));

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

// The second line on its own: one row per pattern, so widening the vocabulary
// can never silently reopen what these name.
for (const [operator, stem, why] of [
  ["submerged_body", "Explain the upthrust on a block 3 cm below the surface.", "a digit"],
  ["hydraulic_press", "The large piston has twice the area of the small one.", "a multiplier"],
  ["hydraulic_press", "The piston areas are in the ratio sixteen to one.", "a spelled number"],
  ["hydraulic_press", "A hydraulic lift with three pistons.", "a count other than two"],
  ["submerged_body", "Why does a block float?", "a floating body"],
  ["submerged_body", "Explain the upthrust on a body at the bottom of the water.", "a body at the bottom of the liquid"],
  ["hydraulic_press", "A hydraulic press whose pistons are at different levels.", "pistons at different levels"],
  ["hydraulic_press", "A hydraulic press with pistons of the same size.", "equal pistons"],
  ["hydraulic_press", "Explain how a U-tube manometer works.", "other apparatus"],
] as const) {
  row(`second line refuses ${why}: ${stem}`, () => {
    assert.ok(fluidApparatusRefusals(operator, stem).length > 0, `${stem}: the second line must refuse ${why}`);
  });
}
row("second line counts two parts: Explain the two forces on a submerged block.", () => {
  assert.equal(fluidApparatusRefusals("submerged_body", "Explain the two forces on a submerged block.").length, 0, "two counts parts");
});
// A body that is named but never said to be under the liquid: only the concrete body rule refuses it.
const looseBody = "Why does a block in water feel an upthrust?";
refused(`the concrete body rule: ${looseBody}`, archimedes, looseBody, plan(looseBody, ["archimedes_principle"]));

if (failures.length > 0) {
  console.error(`verify-fluid-apparatus-admission: ${failures.length} failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`verify-fluid-apparatus-admission: ${checks} checks passed`);
