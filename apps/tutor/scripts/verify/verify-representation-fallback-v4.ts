import {
  compileSceneDocument,
  pruneDeadSceneEntities,
  validateSceneDocument,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  buildSourceGroundedRepresentation,
  selectVerifiedRepresentation,
} from "../../features/tutor-session/lib/representationFallbackV4";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const calculusQuestion = "A curve y=x^2 and the line y=4 enclose a region. Sketch the region, then find its area using integration.";
const calculusPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: calculusQuestion,
  givens: [],
  unknowns: [{ id: "area", symbol: "A", unit: "square units" }],
  derived: [{
    id: "area_value",
    symbol: "A",
    value: 32 / 3,
    unit: "square units",
    provenance: "derived",
  }],
  qualitativeClaims: [],
  lawIds: ["area_between_curves"],
  assumptions: [],
  visualRequirement: "required",
};

const calculusFallback = buildSourceGroundedRepresentation(calculusQuestion, calculusPlan);
assert(calculusFallback.tier === "question_representation", "calculus fallback must remain a question-only representation");
assert(calculusFallback.nonMetric, "calculus fallback must be explicitly nonmetric");
assert(calculusFallback.validationReport.valid, "calculus fallback must pass deterministic scene validation");
assert(
  calculusFallback.sceneDocument.constructions.filter((construction) =>
    construction.operator === "function_curve").length === 2,
  "both equations explicitly stated in the calculus question must be plotted",
);
assert(
  !calculusFallback.sceneDocument.constructions.some((construction) =>
    construction.operator === "function_region" || construction.operator === "intersection"),
  "question representation must not derive the enclosed region or intersections",
);
assert(
  calculusFallback.sceneDocument.quantities.length === 0,
  "derived area must never enter fallback scene quantities",
);
assert(
  !JSON.stringify(calculusFallback.sceneDocument).includes("10.666"),
  "derived metric result leaked into the calculus fallback",
);

const circuitQuestion = "Three resistors R1 = 12 ohm, R2 = 12 ohm, and R3 = 12 ohm are connected in parallel.";
const circuitPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: circuitQuestion,
  givens: ["R1", "R2", "R3"].map((symbol, index) => ({
    id: `resistance_${index + 1}`,
    symbol,
    value: 12,
    unit: "ohm",
    sourceText: `${symbol} = 12 ohm`,
    provenance: "given" as const,
  })),
  unknowns: [],
  derived: [],
  qualitativeClaims: [{
    id: "parallel_relationship",
    claim: "resistors_connected_in_parallel",
    expected: true,
    relatedEntityHints: ["R1", "R2", "R3"],
  }],
  lawIds: [],
  assumptions: [],
  visualRequirement: "optional",
};

const circuitFallback = buildSourceGroundedRepresentation(circuitQuestion, circuitPlan);
assert(circuitFallback.tier === "qualitative_verified", "grounded parallel relation must select the qualitative tier");
assert(circuitFallback.validationReport.valid, "circuit-like source map must compile");
const circuitSourceFacts = circuitFallback.sceneDocument.source.sourceFacts;
assert(Array.isArray(circuitSourceFacts), "optional source summary must retain grounded facts");
const circuitLabels = circuitSourceFacts.flatMap((fact) =>
  typeof fact === "object" && fact !== null && typeof (fact as { label?: unknown }).label === "string"
    ? [(fact as { label: string }).label]
    : []);
assert(circuitFallback.sceneDocument.visualDecision.mode === "text_only", "unsupported optional structure must remain text-only");
assert(circuitLabels.includes("R1=12 ohm"), "first grounded circuit quantity is missing");
assert(circuitLabels.includes("R2=12 ohm"), "second grounded circuit quantity is missing");
assert(circuitLabels.includes("R3=12 ohm"), "third grounded circuit quantity is missing");
assert(circuitLabels.includes("parallel"), "grounded qualitative relation is missing");
assert(
  circuitFallback.sceneDocument.constructions.length === 0,
  "fallback must not invent circuit symbols, topology, or fact boxes",
);

const contaminatedPlan = structuredClone(circuitPlan);
contaminatedPlan.givens.push({
  id: "invented_resistance",
  symbol: "R4",
  value: 999,
  unit: "ohm",
  sourceText: "R4 = 999 ohm",
  provenance: "given",
});
const uncontaminatedFallback = buildSourceGroundedRepresentation(circuitQuestion, contaminatedPlan);
assert(
  !JSON.stringify(uncontaminatedFallback.sceneDocument).includes("999"),
  "a planner-stamped given without literal question evidence leaked into the fallback",
);
const mismatchedEvidencePlan = structuredClone(circuitPlan);
mismatchedEvidencePlan.givens.push({
  id: "forged_value",
  symbol: "R4",
  value: 999,
  unit: "ohm",
  sourceText: "R1 = 12 ohm",
  provenance: "given",
});
const mismatchedEvidenceFallback = buildSourceGroundedRepresentation(circuitQuestion, mismatchedEvidencePlan);
assert(
  !JSON.stringify(mismatchedEvidenceFallback.sceneDocument).includes("999"),
  "literal but numerically unrelated source evidence must not ground a planner value",
);
const forgedRelationshipPlan = structuredClone(circuitPlan);
forgedRelationshipPlan.qualitativeClaims = [{
  id: "forged_series",
  claim: "resistors_connected_in_series",
  expected: true,
}];
const relationshipFallback = buildSourceGroundedRepresentation(circuitQuestion, forgedRelationshipPlan);
const relationshipFacts = relationshipFallback.sceneDocument.source.sourceFacts;
const relationshipLabels = Array.isArray(relationshipFacts)
  ? relationshipFacts.flatMap((fact) =>
      typeof fact === "object" && fact !== null && typeof (fact as { label?: unknown }).label === "string"
        ? [(fact as { label: string }).label]
        : [])
  : [];
assert(relationshipLabels.includes("parallel"), "literal source relationship must survive model-claim replacement");
assert(!relationshipLabels.includes("series"), "model-only relationship must not enter the source-grounded fallback");

const malformedFallback = buildSourceGroundedRepresentation(
  "A moving block is shown with an unknown force.",
  {
    givens: "not-an-array",
    qualitativeClaims: [null, { claim: 42, expected: true }],
    derived: [{ value: Number.NaN }],
  },
);
assert(malformedFallback.tier === "question_representation", "malformed plans must degrade to source-only representation");
assert(malformedFallback.validationReport.valid, "malformed plans must not poison deterministic fallback compilation");
assert(
  !malformedFallback.sceneDocument.constructions.some((construction) => construction.operator === "rectangle"),
  "source fallback must not turn question words into boxes",
);

const refractionQuestion =
  "Light enters glass at 45 degrees with n = 1.5. Find the angle of refraction and draw both rays.";
const refractionPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: refractionQuestion,
  givens: [
    { id: "theta_i", symbol: "theta_i", value: 45, unit: "degree", provenance: "given" },
    { id: "n_2", symbol: "n_2", value: 1.5, unit: "none", provenance: "given" },
  ],
  unknowns: [{ id: "theta_r", symbol: "theta_r", unit: "degree" }],
  derived: [{
    id: "theta_r",
    symbol: "theta_r",
    value: 28.125505702055708,
    unit: "degree",
    provenance: "derived",
  }],
  qualitativeClaims: [],
  lawIds: ["snells_law"],
  assumptions: ["air refractive index is 1"],
  visualRequirement: "required",
};
let rejectedUnrelatedRefractionFallback = false;
try {
  buildSourceGroundedRepresentation(refractionQuestion, refractionPlan);
} catch (error) {
  rejectedUnrelatedRefractionFallback = /required visual representation unavailable/i.test(String(error));
}
assert(
  rejectedUnrelatedRefractionFallback,
  "a required refraction diagram must not degrade to unrelated fact boxes",
);

const exactDocument: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "verified exact fixture" },
  source: { question: calculusQuestion, exact: true },
  quantities: [],
  entities: [
    { id: "a", kind: "point", role: "endpoint", label: "A" },
    { id: "b", kind: "point", role: "endpoint", label: "B" },
    { id: "ab", kind: "segment", role: "verified segment", label: "AB" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
  ],
  relations: [],
  assertions: [{
    id: "assert_ab",
    predicate: "exists",
    entities: ["ab"],
    expected: true,
    severity: "fatal",
  }],
  annotations: [],
  requiredEntityIds: ["a", "b", "ab"],
  revealGroups: [{ id: "exact_setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }],
  teachingTimeline: [{
    id: "reveal_exact",
    action: "reveal",
    targetId: "exact_setup",
    dependsOn: [],
    narrationIntent: "Draw the verified segment.",
  }],
};
const exactCompiled = compileSceneDocument(exactDocument);
assert(exactCompiled.ok && exactCompiled.renderScene, "exact fixture must compile");
const selectedExact = selectVerifiedRepresentation({
  question: calculusQuestion,
  turnPlan: calculusPlan,
  exact: {
    sceneDocument: exactDocument,
    renderScene: exactCompiled.renderScene,
    validationReport: exactCompiled.report,
  },
});
assert(selectedExact.tier === "exact_verified", "a valid exact scene must always win over fallback tiers");
assert(selectedExact.sceneDocument === exactDocument, "selector must preserve the accepted exact scene");

const rollingQuestion =
  "A solid cylinder of mass 2 kg and radius 10 cm rolls without slipping down an incline of height 1.5 m, starting from rest. Take g = 10 m/s^2.";
const guessedRollingDocument: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "planner guessed cylinder on a height triangle" },
  source: { question: rollingQuestion },
  quantities: [],
  entities: [
    { id: "p_top", kind: "point", role: "top" },
    { id: "p_bottom", kind: "point", role: "bottom" },
    { id: "p_ground", kind: "point", role: "ground" },
    { id: "incline", kind: "segment", role: "incline" },
    { id: "ground", kind: "segment", role: "ground" },
    { id: "center", kind: "point", role: "center" },
    { id: "contact", kind: "point", role: "contact" },
    { id: "cylinder", kind: "polyline", role: "solid projection" },
  ],
  constructions: [
    { id: "c_top", operator: "point", inputs: { x: 0, y: 1.5, coordinateSpace: "world" }, outputs: ["p_top"] },
    { id: "c_bottom", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["p_bottom"] },
    { id: "c_ground", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["p_ground"] },
    { id: "c_incline", operator: "segment", inputs: { start: "p_top", end: "p_bottom" }, outputs: ["incline"] },
    { id: "c_ground_seg", operator: "segment", inputs: { start: "p_ground", end: "p_bottom" }, outputs: ["ground"] },
    { id: "c_center", operator: "point", inputs: { x: 1, y: 0.5, coordinateSpace: "world" }, outputs: ["center"] },
    { id: "c_contact", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "world" }, outputs: ["contact"] },
    {
      id: "c_cylinder",
      operator: "solid_projection",
      inputs: { kind: "cylinder", center: "center", radius: 0.1, height: 0.2, axis: "vertical" },
      outputs: ["cylinder"],
    },
  ],
  relations: [],
  assertions: [{
    id: "a1",
    predicate: "on",
    entities: ["contact", "incline"],
    expected: true,
    severity: "warning",
  }],
  annotations: [],
  requiredEntityIds: ["incline", "cylinder", "contact"],
  revealGroups: [{
    id: "rg1",
    entityIds: ["incline", "ground", "cylinder", "contact"],
    dependsOn: [],
    narrationCue: "Draw the setup.",
  }],
  teachingTimeline: [],
};
const guessedRollingValidated = validateSceneDocument(pruneDeadSceneEntities(
  guessedRollingDocument as unknown as Record<string, unknown>,
));
assert(guessedRollingValidated.document, "guessed rolling fixture must normalize");
const guessedRollingCompiled = compileSceneDocument(guessedRollingValidated.document);
assert(guessedRollingCompiled.ok && guessedRollingCompiled.renderScene, "guessed rolling fixture must still compile");
assert(
  guessedRollingCompiled.report.issues.some((issue) => issue.code === "assertion_failed"),
  "contact-not-on-incline must surface as a failed proof",
);
const rejectedGuessedRolling = selectVerifiedRepresentation({
  question: rollingQuestion,
  families: ["contact_body", "solid_figure"],
  exact: {
    sceneDocument: guessedRollingValidated.document,
    renderScene: guessedRollingCompiled.renderScene,
    validationReport: guessedRollingCompiled.report,
  },
});
assert(
  rejectedGuessedRolling.tier !== "exact_verified" ||
    !rejectedGuessedRolling.sceneDocument.constructions.some((construction) =>
      construction.operator === "solid_projection"),
  "a guessed mensuration cylinder on an incline must not be accepted as exact",
);
assert(
  rejectedGuessedRolling.sceneDocument.constructions.some((construction) => construction.operator === "circle"),
  "rolling incline fallback must draw a circular section on the plane",
);
assert(
  !rejectedGuessedRolling.sceneDocument.constructions.some((construction) =>
    construction.operator === "solid_projection"),
  "rolling incline fallback must not keep the 3D solid",
);

const mismatchedExactDocument = structuredClone(exactDocument);
mismatchedExactDocument.source.question = "A different submitted question";
const mismatchedExact = selectVerifiedRepresentation({
  question: calculusQuestion,
  exact: {
    sceneDocument: mismatchedExactDocument,
    renderScene: exactCompiled.renderScene,
    validationReport: exactCompiled.report,
  },
});
assert(
  mismatchedExact.tier !== "exact_verified",
  "an exact scene belonging to another question must not cross the selection boundary",
);

const invalidExact = selectVerifiedRepresentation({
  question: calculusQuestion,
  turnPlan: calculusPlan,
  exact: {
    sceneDocument: exactDocument,
    renderScene: exactCompiled.renderScene,
    validationReport: {
      ...exactCompiled.report,
      valid: false,
      issues: [{ code: "proof_failed", message: "fixture", severity: "fatal" }],
    },
  },
});
assert(invalidExact.tier !== "exact_verified", "a failed exact proof must never bypass fallback isolation");

const selectedRefraction = selectVerifiedRepresentation({
  question: refractionQuestion,
  turnPlan: refractionPlan,
  families: ["interface", "ray_path"],
});
assert(selectedRefraction.sceneDocument.visualDecision.mode === "scene", "required refraction must compile onto the board");
assert(
  selectedRefraction.sceneDocument.constructions.some((construction) => construction.operator === "refract_at"),
  "required refraction must use refract_at",
);
assert(selectedRefraction.renderScene.primitives.length > 0, "required refraction produced no ink");

const selectedCircuit = selectVerifiedRepresentation({
  question: circuitQuestion,
  turnPlan: circuitPlan,
  families: ["circuit_network"],
});
assert(selectedCircuit.sceneDocument.visualDecision.mode === "scene", "named parallel resistors must compile a circuit");
assert(
  selectedCircuit.sceneDocument.constructions.some((construction) => construction.operator === "symbol"),
  "circuit family must use symbol operators",
);

const mirrorQuestion =
  "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.";
const selectedMirror = selectVerifiedRepresentation({
  question: mirrorQuestion,
  turnPlan: {
    schemaVersion: "turn-plan/v3",
    question: mirrorQuestion,
    givens: [
      { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given" },
      { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given" },
    ],
    unknowns: [{ id: "v", symbol: "v", unit: "cm" }],
    derived: [{ id: "v", symbol: "v", value: 60, unit: "cm", provenance: "derived" }],
    qualitativeClaims: [],
    lawIds: ["mirror_formula"],
    assumptions: [],
    visualRequirement: "required",
  },
  families: ["axis_view", "ray_path"],
});
assert(selectedMirror.sceneDocument.visualDecision.mode === "scene", "required mirror must compile onto the board");
assert(
  selectedMirror.sceneDocument.entities.some((entity) => entity.kind === "arc"),
  "required concave mirror must be an arc rather than a straight line",
);
assert(
  selectedMirror.renderScene.primitives.some((primitive) => primitive.kind === "arc"),
  "compiled mirror ink must be an arc",
);

const seriesParallelQuestion =
  "Three 12 ohm resistors in series and in parallel. Find both equivalent resistances and draw each circuit.";
const collidingCircuitDocument: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "planner stacked both circuits on one origin" },
  source: { question: seriesParallelQuestion },
  quantities: [],
  entities: [
    { id: "series_p0", kind: "point", role: "terminal" },
    { id: "series_p1", kind: "point", role: "terminal" },
    { id: "series_r1", kind: "component", role: "resistor" },
    { id: "parallel_p0", kind: "point", role: "terminal" },
    { id: "parallel_p1", kind: "point", role: "terminal" },
    { id: "parallel_r1", kind: "component", role: "resistor" },
    { id: "parallel_r2", kind: "component", role: "resistor" },
  ],
  constructions: [
    { id: "c_s0", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["series_p0"] },
    { id: "c_s1", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["series_p1"] },
    { id: "c_sr1", operator: "symbol", inputs: { symbol: "resistor", start: "series_p0", end: "series_p1" }, outputs: ["series_r1"] },
    { id: "c_p0", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["parallel_p0"] },
    { id: "c_p1", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["parallel_p1"] },
    { id: "c_pr1", operator: "symbol", inputs: { symbol: "resistor", start: "parallel_p0", end: "parallel_p1" }, outputs: ["parallel_r1"] },
    { id: "c_pr2", operator: "symbol", inputs: { symbol: "resistor", start: "parallel_p0", end: "parallel_p1" }, outputs: ["parallel_r2"] },
  ],
  relations: [],
  assertions: [
    { id: "series_path", predicate: "path", entities: ["series_r1"], expected: true, severity: "warning" },
    { id: "parallel_pair", predicate: "sameTerminalPair", entities: ["parallel_r1", "parallel_r2"], expected: true, severity: "warning" },
  ],
  annotations: [],
  requiredEntityIds: ["series_r1", "parallel_r1", "parallel_r2"],
  revealGroups: [
    { id: "series_group", entityIds: ["series_p0", "series_p1", "series_r1"], dependsOn: [], narrationCue: "series" },
    { id: "parallel_group", entityIds: ["parallel_p0", "parallel_p1", "parallel_r1", "parallel_r2"], dependsOn: [], narrationCue: "parallel" },
  ],
  teachingTimeline: [],
};
const collidingValidated = validateSceneDocument(pruneDeadSceneEntities(
  collidingCircuitDocument as unknown as Record<string, unknown>,
));
assert(collidingValidated.document, "colliding circuit fixture must normalize");
const collidingCompiled = compileSceneDocument(collidingValidated.document);
assert(collidingCompiled.ok && collidingCompiled.renderScene, "colliding circuit fixture must still compile");
const rejectedCollidingCircuit = selectVerifiedRepresentation({
  question: seriesParallelQuestion,
  families: ["circuit_network"],
  exact: {
    sceneDocument: collidingValidated.document,
    renderScene: collidingCompiled.renderScene,
    validationReport: collidingCompiled.report,
  },
});
assert(
  rejectedCollidingCircuit.reason !== "caller supplied a fully verified exact scene",
  "stacked series and parallel views must not win as exact",
);
assert(
  rejectedCollidingCircuit.sceneDocument !== collidingValidated.document,
  "selector must replace the colliding planner scene",
);
assert(
  rejectedCollidingCircuit.sceneDocument.revealGroups.some((group) => group.id === "series_group") &&
    rejectedCollidingCircuit.sceneDocument.revealGroups.some((group) => group.id === "parallel_group"),
  "fallback must still draw both circuit views",
);
const selectedPointKeys = rejectedCollidingCircuit.sceneDocument.constructions.flatMap((construction) =>
  construction.operator === "point" ? [`${construction.inputs.x}:${construction.inputs.y}`] : []);
assert(new Set(selectedPointKeys).size === selectedPointKeys.length, "fallback circuit views must not share coordinates");

const relativeCars = selectVerifiedRepresentation({
  question: "Car A travels east at 20 m/s and car B travels east at 5.0 m/s on the same straight road. Find the velocity of A relative to B and of B relative to A.",
  families: [],
});
assert(relativeCars.sceneDocument.visualDecision.mode === "scene", "1D relative velocity must not stay text-only");
assert(relativeCars.renderScene.primitives.length > 0, "1D relative velocity must put ink on the board");

const projectileFallback = selectVerifiedRepresentation({
  question: "A ball is projected from the ground at 45° to the horizontal and reaches a maximum height of 120 m.",
  families: [],
});
assert(projectileFallback.sceneDocument.visualDecision.mode === "scene", "projectile lecture must not stay text-only");
assert(projectileFallback.renderScene.primitives.length > 0, "projectile lecture must put ink on the board");

const motionGraphFallback = selectVerifiedRepresentation({
  question: "A velocity–time graph is a horizontal line at v = 10 m/s from t = 0 to t = 4.0 s. Sketch it.",
  families: [],
});
assert(motionGraphFallback.sceneDocument.visualDecision.mode === "scene", "motion-graph lecture must not stay text-only");
assert(motionGraphFallback.renderScene.primitives.length > 0, "motion-graph lecture must put ink on the board");

const riverCrossingQuestion = "A river flows west to east at 9 km/h. A boat with maximum speed 27 km/h in still water crosses in half a minute while moving at maximum speed at 150° to the direction of river flow. Find the width of the river.";
const recycledAngleDocument: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "shared-origin vector diagram" },
  source: { question: riverCrossingQuestion, representationTier: "exact_verified", nonMetric: false },
  quantities: [],
  entities: [
    { id: "origin", kind: "point", role: "origin", label: "O" },
    { id: "a_end", kind: "point", role: "vector A tip" },
    { id: "b_end", kind: "point", role: "vector B tip" },
    { id: "a", kind: "vector", role: "vector", label: "A" },
    { id: "b", kind: "vector", role: "vector", label: "B" },
  ],
  constructions: [
    { id: "make_origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["origin"] },
    { id: "make_a_end", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["a_end"] },
    { id: "make_b_end", operator: "point", inputs: { x: 1.5, y: 2, coordinateSpace: "world" }, outputs: ["b_end"] },
    { id: "make_a", operator: "vector", inputs: { start: "origin", end: "a_end" }, outputs: ["a"] },
    { id: "make_b", operator: "vector", inputs: { start: "origin", end: "b_end" }, outputs: ["b"] },
  ],
  relations: [],
  assertions: [
    { id: "a_exists", predicate: "exists", entities: ["a"], expected: true, severity: "fatal" },
    { id: "b_exists", predicate: "exists", entities: ["b"], expected: true, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["origin", "a_end", "b_end", "a", "b"],
  revealGroups: [{
    id: "setup",
    entityIds: ["origin", "a_end", "b_end", "a", "b"],
    dependsOn: [],
    narrationCue: "shared-origin vector diagram",
  }],
  teachingTimeline: [],
};
const recycledAngleValidated = validateSceneDocument(pruneDeadSceneEntities(
  recycledAngleDocument as unknown as Record<string, unknown>,
));
assert(recycledAngleValidated.document, "recycled angle fixture must normalize");
const recycledAngleCompiled = compileSceneDocument(recycledAngleValidated.document);
assert(recycledAngleCompiled.ok && recycledAngleCompiled.renderScene, "recycled angle fixture must compile");
const rejectedRiverAngle = selectVerifiedRepresentation({
  question: riverCrossingQuestion,
  families: ["vector_diagram"],
  exact: {
    sceneDocument: recycledAngleValidated.document,
    renderScene: recycledAngleCompiled.renderScene,
    validationReport: recycledAngleCompiled.report,
  },
});
assert(
  !rejectedRiverAngle.sceneDocument.entities.some((entity) => entity.id === "a" && entity.label === "A"),
  "a recycled A/B angle on a river-boat stem must not be accepted as exact",
);
assert(
  rejectedRiverAngle.sceneDocument.entities.some((entity) => /bank/i.test(`${entity.id} ${entity.role}`)),
  "river-boat fallback must draw banks instead of the generic angle",
);

console.log("representation fallback v4 verification passed");
