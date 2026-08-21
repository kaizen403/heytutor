import {
  compileSceneDocument,
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
  mismatchedExact.tier === "question_representation",
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
assert(invalidExact.tier === "question_representation", "a failed exact proof must never bypass fallback isolation");

console.log("representation fallback v4 verification passed");
