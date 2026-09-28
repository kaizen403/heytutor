import assert from "node:assert/strict";
import { compileSceneDocument, synthesizeFamilyScene, validateSceneDocument, type SceneDocument, type ValidationReport } from "@heytutor/scene-engine";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

const question = "Sketch y=x^2 and evaluate it at x=2.";

function functionDocument(expression: string, expected: number, id: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "function value fixture" },
    source: { question },
    quantities: [],
    entities: [
      { id: "axes", kind: "axes", role: "coordinate axes" },
      { id, kind: "polyline", role: "function graph", label: `y=${expression}` },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -2, xMax: 2, yMin: -1, yMax: 7 }, outputs: ["axes"] },
      { id: `make_${id}`, operator: "function_curve", inputs: { expression, xMin: -2, xMax: 2, samples: 65 }, outputs: [id] },
    ],
    relations: [],
    assertions: [
      { id: "prove_function_value", predicate: "function_value", entities: [id], expected: { x: 2, y: expected }, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: ["axes", id],
    revealGroups: [{ id: `${id}_setup`, entityIds: ["axes", id], dependsOn: [], narrationCue: `Show ${expression}` }],
    teachingTimeline: [{ id: `${id}_reveal`, action: "reveal", targetId: `${id}_setup`, dependsOn: [], narrationIntent: `Reveal ${expression}` }],
  };
}

const document = functionDocument("x^2", 4, "source_curve");
const alienDocument = functionDocument("3*x", 6, "alien_curve");
const accepted = compileSceneDocument(document);
const alien = compileSceneDocument(alienDocument);
assert(accepted.ok && accepted.renderScene && accepted.report.valid, "source fixture must compile with a metric proof");
assert(alien.ok && alien.renderScene && alien.report.valid, "alien fixture must independently compile");
assert(alien.renderScene.primitives.some((primitive) => primitive.entityId === "alien_curve"), "alien fixture must have real ink");

const selected = selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: document, renderScene: alien.renderScene, validationReport: alien.report },
});
assert.equal(selected.sceneDocument, document, "the accepted document must remain the current source document");
assert.equal(selected.tier, "exact_verified", "the accepted metric proof must determine the tier");
assert.deepEqual(selected.renderScene, accepted.renderScene, "all selected ink, labels, reveal groups, timeline and bounds must come from the accepted document");
assert.deepEqual(selected.validationReport, accepted.report, "selected proof report must come from the accepted document");

const positive = selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: document, renderScene: accepted.renderScene, validationReport: accepted.report },
});
assert.equal(positive.sceneDocument, document, "an ordinary same-document exact candidate must be accepted");
assert.equal(positive.tier, "exact_verified", "an ordinary metric exact candidate must stay exact");
assert.deepEqual(positive.renderScene, accepted.renderScene, "same-document rendering must stay unchanged");

// Array methods and own index/length descriptors still look ordinary after
// prototype replacement, but inherited fields are not JSON-shaped payloads.
const inheritedArray = (array: unknown[]): void => {
  Object.setPrototypeOf(array, Object.assign(Object.create(Array.prototype), { inherited: "hidden semantic payload" }));
};
const inheritedIssuesReport = structuredClone(accepted.report);
inheritedArray(inheritedIssuesReport.issues);
assert.notEqual(selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: document, renderScene: accepted.renderScene, validationReport: inheritedIssuesReport },
}).sceneDocument, document, "a report issues array with an inherited field cannot attest the exact scene");
for (const field of ["entities", "requiredEntityIds", "teachingTimeline"] as const) {
  const exoticDocument = structuredClone(document);
  inheritedArray(exoticDocument[field]);
  const exoticCompile = compileSceneDocument(exoticDocument);
  assert(exoticCompile.ok && exoticCompile.renderScene && exoticCompile.report.valid,
    `${field} fixture must still compile so the attestation boundary is exercised`);
  assert.notEqual(selectVerifiedRepresentation({
    question,
    exact: { sceneDocument: exoticDocument, renderScene: exoticCompile.renderScene, validationReport: exoticCompile.report },
  }).sceneDocument, exoticDocument, `${field} array with an inherited field cannot attest the exact scene`);
}

// Render/report self-consistency is not a proof that scene operands came from
// the question: this forged source marker still has a valid metric assertion.
const sourceMeaningNotAttested = selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: alienDocument, renderScene: alien.renderScene, validationReport: alien.report },
});
assert.equal(sourceMeaningNotAttested.sceneDocument, alienDocument, "render attestation does not independently authenticate source operands");
assert.equal(sourceMeaningNotAttested.tier, "exact_verified", "a self-consistent forged source can still earn the metric tier");
assert.equal(alienDocument.constructions[1]?.inputs.expression, "3*x", "the forged operand must differ from the question's x^2");

// A real compiler warning has nested payloads. Reordering issue object keys
// must not make an otherwise identical, fresh report stale.
const vectorQuestion = "Show the sum of two vectors.";
const vectorDocument: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "vector warning fixture" },
  source: { question: vectorQuestion },
  quantities: [],
  entities: [
    { id: "origin", kind: "point", role: "origin" },
    { id: "component_tip", kind: "point", role: "component tip" },
    { id: "sum_tip", kind: "point", role: "sum tip" },
    { id: "resultant_tip", kind: "point", role: "resultant tip" },
    { id: "horizontal", kind: "vector", role: "first component" },
    { id: "vertical", kind: "vector", role: "second component" },
    { id: "resultant", kind: "vector", role: "resultant" },
  ],
  constructions: [
    { id: "make_origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["origin"] },
    { id: "make_component_tip", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["component_tip"] },
    { id: "make_sum_tip", operator: "point", inputs: { x: 2, y: 1, coordinateSpace: "world" }, outputs: ["sum_tip"] },
    { id: "make_resultant_tip", operator: "point", inputs: { x: 2, y: 1.005, coordinateSpace: "world" }, outputs: ["resultant_tip"] },
    { id: "make_horizontal", operator: "vector", inputs: { start: "origin", end: "component_tip" }, outputs: ["horizontal"] },
    { id: "make_vertical", operator: "vector", inputs: { start: "component_tip", end: "sum_tip" }, outputs: ["vertical"] },
    { id: "make_resultant", operator: "vector", inputs: { start: "origin", end: "resultant_tip" }, outputs: ["resultant"] },
  ],
  relations: [],
  assertions: [{ id: "vector_proof", predicate: "vector_sum", entities: ["horizontal", "vertical", "resultant"], expected: true, severity: "fatal" }],
  annotations: [],
  requiredEntityIds: ["origin", "component_tip", "sum_tip", "resultant_tip", "horizontal", "vertical", "resultant"],
  revealGroups: [{ id: "vector_setup", entityIds: ["origin", "component_tip", "sum_tip", "resultant_tip", "horizontal", "vertical", "resultant"], dependsOn: [], narrationCue: "Show the sum" }],
  teachingTimeline: [{ id: "reveal_vectors", action: "reveal", targetId: "vector_setup", dependsOn: [], narrationIntent: "Reveal the vectors" }],
};
const vectorCompiled = compileSceneDocument(vectorDocument);
assert(vectorCompiled.ok && vectorCompiled.renderScene && vectorCompiled.report.valid, "warning fixture must compile");
const vectorWarning = vectorCompiled.report.issues.find((issue) => issue.code === "approximate_vector_sum");
assert(vectorWarning && vectorWarning.expected && vectorWarning.entityIds && vectorWarning.residual, "the warning must have a nested expectation, entity IDs, and residual");
const vectorSelection = (validationReport: ValidationReport) => selectVerifiedRepresentation({
  question: vectorQuestion,
  exact: { sceneDocument: vectorDocument, renderScene: vectorCompiled.renderScene!, validationReport },
});
assert.equal(vectorSelection(vectorCompiled.report).sceneDocument, vectorDocument, "the freshly compiled vector warning must be accepted");
const inheritedIssueEntityIdsReport = structuredClone(vectorCompiled.report);
inheritedArray(inheritedIssueEntityIdsReport.issues[0]!.entityIds!);
assert.notEqual(vectorSelection(inheritedIssueEntityIdsReport).sceneDocument, vectorDocument,
  "a nested issue entityIds array with an inherited field cannot attest the vector scene");
for (const [name, mutate] of [
  ["explicit undefined expected", (issue: ValidationReport["issues"][number]) => { issue.expected = undefined; }],
  ["explicit undefined actual", (issue: ValidationReport["issues"][number]) => { issue.actual = undefined; }],
  ["explicit undefined path", (issue: ValidationReport["issues"][number]) => { issue.path = undefined; }],
  ["undefined nested expected", (issue: ValidationReport["issues"][number]) => {
    Object.assign(issue.expected as object, { ignored: undefined });
  }],
  ["non-JSON nested expected", (issue: ValidationReport["issues"][number]) => {
    Object.assign(issue.expected as object, { ignored: () => true });
  }],
  ["symbol-keyed issue", (issue: ValidationReport["issues"][number]) => {
    Object.defineProperty(issue, Symbol("hidden"), { value: true, enumerable: true });
  }],
  ["changed nested expectation", (issue: ValidationReport["issues"][number]) => {
    issue.expected = { maxResidual: 999 };
  }],
  ["changed entity order", (issue: ValidationReport["issues"][number]) => {
    issue.entityIds?.reverse();
  }],
] as const) {
  const malformed = structuredClone(vectorCompiled.report);
  mutate(malformed.issues[0]!);
  assert.notEqual(vectorSelection(malformed).sceneDocument, vectorDocument, `${name} must not attest the vector scene`);
}
const reorderedReport = structuredClone(vectorCompiled.report);
reorderedReport.issues[0] = Object.fromEntries(Object.entries(reorderedReport.issues[0]!).reverse()) as unknown as typeof vectorWarning;
const reorderedSelection = vectorSelection(reorderedReport);
assert.equal(reorderedSelection.sceneDocument, vectorDocument, "reordering issue keys without changing any values must retain the source scene");
assert.deepEqual(reorderedSelection.validationReport, vectorCompiled.report, "the selected report must still come from current compilation");

const lossyDocument = structuredClone(document);
lossyDocument.source.ignored = undefined;
const lossyCompile = compileSceneDocument(lossyDocument);
assert(lossyCompile.ok && lossyCompile.renderScene && lossyCompile.report.valid, "lossy source fixture must still compile");
assert.notEqual(selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: lossyDocument, renderScene: lossyCompile.renderScene, validationReport: lossyCompile.report },
}).sceneDocument, lossyDocument, "a scene with an undefined source field must not pass JSON serialization loss");

const failedWarningDocument = structuredClone(document);
failedWarningDocument.assertions.push({
  id: "false_claim",
  predicate: "function_value",
  entities: ["source_curve"],
  expected: { x: 1, y: 99 },
  severity: "warning",
});
const freshFailedWarning = compileSceneDocument(failedWarningDocument);
assert(freshFailedWarning.ok && freshFailedWarning.report.valid, "a warning-level proof failure must not be confused with fatal validation");
assert(freshFailedWarning.report.issues.some((issue) => issue.code === "assertion_failed"), "the current assertion must actually fail");
const rejectedStaleProof = selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: failedWarningDocument, renderScene: accepted.renderScene, validationReport: accepted.report },
});
assert.notEqual(rejectedStaleProof.sceneDocument, failedWarningDocument, "a clean caller report must not bless a newly failed assertion");

const danglingTimelineDocument = structuredClone(document);
danglingTimelineDocument.teachingTimeline.push({
  id: "bad_reveal",
  action: "reveal",
  targetId: "missing_group",
  dependsOn: [],
  narrationIntent: "Reveal a nonexistent group",
});
const normalizedTimeline = validateSceneDocument(danglingTimelineDocument);
assert(normalizedTimeline.document && normalizedTimeline.report.valid, "the normalizer must admit the fixture before removing the dangling action");
assert.equal(normalizedTimeline.document.teachingTimeline.length, 1, "the dangling action must be demonstrably erased by normalization");
const selectedDanglingTimeline = selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: danglingTimelineDocument, renderScene: accepted.renderScene, validationReport: accepted.report },
});
assert.notEqual(selectedDanglingTimeline.sceneDocument, danglingTimelineDocument, "the selected document must not retain a timeline action erased by validation");

const missingReportSelection = selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: document, renderScene: accepted.renderScene, validationReport: undefined as unknown as ValidationReport },
});
assert.notEqual(missingReportSelection.sceneDocument, document, "an absent caller proof must degrade to fallback without throwing");

const missingIssuesSelection = selectVerifiedRepresentation({
  question,
  exact: { sceneDocument: document, renderScene: accepted.renderScene, validationReport: { valid: true } as ValidationReport },
});
assert.notEqual(missingIssuesSelection.sceneDocument, document, "a caller report without issues must degrade to fallback without throwing");

for (const [name, report] of [
  ["partial report", { valid: true, issues: [] }],
  ["missing engine version", { ...accepted.report, engineVersion: undefined }],
  ["wrong engine version", { ...accepted.report, engineVersion: "scene-engine/old" }],
  ["missing stats", { ...accepted.report, stats: undefined }],
  ["partial stats", { ...accepted.report, stats: { entityCount: document.entities.length } }],
  ["fake stats", { ...accepted.report, stats: { ...accepted.report.stats, primitiveCount: 0 } }],
  ["unrecognized stats", { ...accepted.report, stats: { ...accepted.report.stats, certifiedCount: 1 } }],
  ["unrecognized report field", { ...accepted.report, certified: true }],
  ["invalid count", { ...accepted.report, stats: { ...accepted.report.stats, assertionCount: -1 } }],
  ["untyped issue", { ...accepted.report, issues: [{}] }],
  ["invalid severity", { ...accepted.report, issues: [{ code: "note", message: "none", severity: "info" }] }],
  ["fabricated warning", { ...accepted.report, issues: [{ code: "fabricated", message: "not from this scene", severity: "warning" }] }],
  ["unserializable issue", { ...accepted.report, issues: [{ code: "fabricated", message: "not from this scene", severity: "warning", expected: 1n }] }],
] as const) {
  const selectedMalformed = selectVerifiedRepresentation({
    question,
    exact: { sceneDocument: document, renderScene: accepted.renderScene, validationReport: report as unknown as ValidationReport },
  });
  assert.notEqual(selectedMalformed.sceneDocument, document, `${name} must not admit the exact candidate`);
}

for (const [name, sourceQuestion, family] of [
  ["circuit", "Three resistors R1 = 12 ohm, R2 = 12 ohm, and R3 = 12 ohm are connected in parallel.", "circuit_network"],
  ["vector", "A boat’s speed in still water is 5.0 m/s and the current is 3.0 m/s along the river. Find the speed downstream and upstream. Then find the time to go 100 m downstream and return 100 m upstream.", "vector_diagram"],
] as const) {
  const scene = synthesizeFamilyScene({ question: sourceQuestion, families: [family] });
  assert(scene && scene.family === family, `${name} must synthesize its actual source-owned family`);
  const compiled = compileSceneDocument(scene.document);
  assert(compiled.ok && compiled.renderScene && compiled.report.valid, `${name} must compile into verifiable ink`);
  const selectedFamily = selectVerifiedRepresentation({
    question: sourceQuestion,
    exact: { sceneDocument: scene.document, renderScene: compiled.renderScene, validationReport: compiled.report },
  });
  assert.equal(selectedFamily.sceneDocument, scene.document, `${name} must retain the canonical exact candidate`);
  assert.deepEqual(selectedFamily.renderScene, compiled.renderScene, `${name} selected ink/timeline must match its freshly compiled document`);
  assert.deepEqual(selectedFamily.validationReport, compiled.report, `${name} selected report must match its freshly compiled document`);
}

// validateSceneDocument materializes annotation style as
// { count, pointStyle, transient }, using undefined for omitted fields.
// A compiled exact scene that only authored { pointStyle: "open" } must stay
// selected. Undefined anywhere else, including an unknown style field, must not.
const openPointDocument = functionDocument("x^2", 4, "source_curve");
openPointDocument.annotations = [
  { id: "open_mark", kind: "endpoint", targetIds: ["source_curve"], style: { pointStyle: "open" } },
];
const openPointValidated = validateSceneDocument(openPointDocument);
assert(openPointValidated.document, "an open point annotation must validate");
const normalizedStyle = openPointValidated.document.annotations[0]?.style;
assert(normalizedStyle && normalizedStyle.pointStyle === "open", "normalization must keep pointStyle open");
assert.equal(Object.hasOwn(normalizedStyle, "count") && normalizedStyle.count === undefined, true, "normalization must materialize count as undefined");
assert.equal(Object.hasOwn(normalizedStyle, "transient") && normalizedStyle.transient === undefined, true, "normalization must materialize transient as undefined");
const openPointCompiled = compileSceneDocument(openPointValidated.document);
assert(openPointCompiled.ok && openPointCompiled.renderScene && openPointCompiled.report.valid && openPointCompiled.renderScene.primitives.length > 0, "the normalized open-point scene must compile as an exact figure");
const selectedOpenPoint = selectVerifiedRepresentation({
  question,
  exact: {
    sceneDocument: openPointValidated.document,
    renderScene: openPointCompiled.renderScene,
    validationReport: openPointCompiled.report,
  },
});
assert.equal(selectedOpenPoint.sceneDocument, openPointValidated.document, "schema-normalized undefined annotation style fields must not replace a compiled exact scene");
assert.equal(selectedOpenPoint.tier, "exact_verified", "the open-point metric proof must stay exact");
assert.equal(selectedOpenPoint.sceneDocument.annotations[0]?.id, "open_mark", "the open-point annotation must stay on the selected document");
assert.deepEqual(selectedOpenPoint.renderScene, openPointCompiled.renderScene, "open-point ink must come from the fresh compile");
assert.deepEqual(selectedOpenPoint.validationReport, openPointCompiled.report, "open-point report must come from the fresh compile");

for (const [name, style] of [
  ["authored pointStyle", { pointStyle: "open" as const }],
  ["authored count", { count: 2 as const }],
  ["authored transient", { transient: false }],
] as const) {
  const authored = functionDocument("x^2", 4, "source_curve");
  authored.annotations = [{ id: "open_mark", kind: "endpoint", targetIds: ["source_curve"], style }];
  const authoredCompile = compileSceneDocument(authored);
  assert(authoredCompile.ok && authoredCompile.renderScene && authoredCompile.report.valid, `${name} must compile`);
  assert.equal(selectVerifiedRepresentation({
    question,
    exact: { sceneDocument: authored, renderScene: authoredCompile.renderScene, validationReport: authoredCompile.report },
  }).sceneDocument, authored, `${name} must stay selected when normalization only adds undefined style siblings`);
}

const unknownStyleField = functionDocument("x^2", 4, "source_curve");
unknownStyleField.annotations = [{
  id: "open_mark",
  kind: "endpoint",
  targetIds: ["source_curve"],
  style: { pointStyle: "open" },
}];
Object.assign(unknownStyleField.annotations[0]!.style!, { ignored: undefined });
const unknownStyleCompile = compileSceneDocument(unknownStyleField);
assert(unknownStyleCompile.ok && unknownStyleCompile.renderScene && unknownStyleCompile.report.valid, "an unknown undefined style field must still compile");
assert.notEqual(selectVerifiedRepresentation({
  question,
  exact: {
    sceneDocument: unknownStyleField,
    renderScene: unknownStyleCompile.renderScene,
    validationReport: unknownStyleCompile.report,
  },
}).sceneDocument, unknownStyleField, "an undefined style field outside count, pointStyle, and transient must not attest the scene");

console.log("render scene attestation verification passed");
