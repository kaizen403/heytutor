import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileSceneDocument,
  evaluateMathExpression,
  evaluateTopologyAssertion,
  pruneDeadSceneEntities,
  pruneUnverifiedSceneAnnotations,
  normalizeClaimedClosedRouteGeometry,
  normalizeClaimedParaxialReflectionGeometry,
  reconcileTurnPlanV3ExplicitArithmetic,
  validateSceneDocument,
  validateSceneQuantityAgreement,
  validateTurnPlanSceneProofs,
  validateTurnPlanV3,
} from "../../src/index";
import type { SceneIssue } from "../../src/types";

const candidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "triangle construction" },
  source: { question: "Draw triangle ABC and its median AM" },
  quantities: [],
  entities: [
    { id: "a", kind: "point", role: "vertex", label: "A" },
    { id: "b", kind: "point", role: "vertex", label: "B" },
    { id: "c", kind: "point", role: "vertex", label: "C" },
    { id: "m", kind: "point", role: "midpoint", label: "M" },
    { id: "ab", kind: "segment", role: "side" },
    { id: "bc", kind: "segment", role: "side" },
    { id: "ca", kind: "segment", role: "side" },
    { id: "am", kind: "segment", role: "median" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 3 }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: -2, y: 0 }, outputs: ["b"] },
    { id: "make_c", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["c"] },
    { id: "make_m", operator: "midpoint", inputs: { a: "b", b: "c" }, outputs: ["m"] },
    { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
    { id: "make_bc", operator: "segment", inputs: { start: "b", end: "c" }, outputs: ["bc"] },
    { id: "make_ca", operator: "segment", inputs: { start: "c", end: "a" }, outputs: ["ca"] },
    { id: "make_am", operator: "segment", inputs: { start: "a", end: "m" }, outputs: ["am"] },
  ],
  relations: [],
  assertions: [
    { id: "m_between", predicate: "between", entities: ["m", "b", "c"], expected: true, severity: "fatal", reason: "M lies on BC" },
    { id: "triangle_not_flat", predicate: "collinear", entities: ["a", "b", "c"], expected: false, severity: "fatal", reason: "ABC must form a triangle" },
    { id: "a_connected_b", predicate: "connected", entities: ["a", "b"], expected: true, severity: "fatal", reason: "AB joins A and B" },
  ],
  annotations: [
    { id: "label_a", kind: "label", targetIds: ["a"], text: "A", placementIntent: "above" },
    { id: "callout_median", kind: "callout", targetIds: ["am"], text: "Median (constructed from A)" },
  ],
  requiredEntityIds: ["a", "b", "c", "m", "ab", "bc", "ca", "am"],
  revealGroups: [
    { id: "triangle", entityIds: ["a", "b", "c", "ab", "bc", "ca"], dependsOn: [], narrationCue: "draw triangle ABC" },
    { id: "median", entityIds: ["m", "am"], dependsOn: ["triangle"], narrationCue: "construct midpoint M and median AM" },
  ],
  teachingTimeline: [
    { id: "show_triangle", action: "reveal", targetId: "triangle", dependsOn: [], narrationIntent: "start with triangle ABC" },
    { id: "show_median", action: "reveal", targetId: "median", dependsOn: ["show_triangle"], narrationIntent: "mark midpoint M and join AM" },
  ],
};

const validated = validateSceneDocument(candidate);
if (!validated.document || !validated.report.valid) throw new Error(JSON.stringify(validated.report.issues));
const compiled = compileSceneDocument(validated.document);
if (!compiled.ok || !compiled.renderScene) throw new Error(JSON.stringify(compiled.report.issues));
if (compiled.renderScene.primitives.filter((primitive) => primitive.kind !== "label").length !== 8) {
  throw new Error("triangle must render exactly its eight geometric entities");
}
if (compiled.renderScene.primitives.filter((primitive) => primitive.kind === "label").length !== 5) {
  throw new Error("triangle must render named points plus its compact owner-bound callout");
}
if (!compiled.renderScene.primitives.some((primitive) => primitive.id === "callout_median" && primitive.text === "Median")) {
  throw new Error("descriptive callout was not reduced to a compact diagram label");
}
if (compiled.renderScene.timeline[1]?.dependsOn[0] !== "show_triangle") throw new Error("timeline dependency was not preserved");

let malformedEntityValidation:
  | ReturnType<typeof validateSceneDocument>
  | undefined;
try {
  malformedEntityValidation = validateSceneDocument({
    ...structuredClone(candidate),
    entities: [null],
  });
} catch (error) {
  throw new Error(`malformed array entries must return a validation report, not throw: ${String(error)}`);
}
if (
  malformedEntityValidation.document ||
  !malformedEntityValidation.report.issues.some((issue) => issue.code === "invalid_id")
) {
  throw new Error(`malformed array entries were not reported structurally: ${JSON.stringify(malformedEntityValidation.report.issues)}`);
}

const narrationAliasCandidate = structuredClone(candidate);
narrationAliasCandidate.teachingTimeline = [
  {
    action: "reveal",
    target: "triangle",
    narration: "Triangle ABC is the starting figure for the median construction.",
  },
  {
    action: "focus",
    target: "am",
    dependsOn: ["timeline_1"],
    narration: "Median AM joins vertex A to the midpoint of BC.",
  },
];
const narrationAliasValidated = validateSceneDocument(narrationAliasCandidate);
if (!narrationAliasValidated.document || !narrationAliasValidated.report.valid) {
  throw new Error(JSON.stringify(narrationAliasValidated.report.issues));
}
if (
  narrationAliasValidated.document.teachingTimeline[0]?.narrationIntent !==
    "Triangle ABC is the starting figure for the median construction." ||
  narrationAliasValidated.document.teachingTimeline[1]?.narrationIntent !==
    "Median AM joins vertex A to the midpoint of BC."
) {
  throw new Error("timeline narration aliases were not normalized into narrationIntent");
}

const smallScaleGraph = structuredClone(candidate);
smallScaleGraph.source = { question: "Draw two P-V points at 0.002 and 0.004 cubic metres" };
smallScaleGraph.entities = [
  { id: "low_v", kind: "point", role: "graph point" },
  { id: "high_v", kind: "point", role: "graph point" },
  { id: "isobar", kind: "segment", role: "isobaric path" },
];
smallScaleGraph.constructions = [
  { id: "make_low", operator: "point", inputs: { x: 0.002, y: 100000, coordinateSpace: "world" }, outputs: ["low_v"] },
  { id: "make_high", operator: "point", inputs: { x: 0.004, y: 100000, coordinateSpace: "world" }, outputs: ["high_v"] },
  { id: "make_path", operator: "segment", inputs: { start: "low_v", end: "high_v" }, outputs: ["isobar"] },
];
smallScaleGraph.relations = [];
smallScaleGraph.assertions = [];
smallScaleGraph.annotations = [];
smallScaleGraph.requiredEntityIds = ["low_v", "high_v", "isobar"];
smallScaleGraph.revealGroups = [{
  id: "pv_graph",
  entityIds: ["low_v", "high_v", "isobar"],
  dependsOn: [],
  narrationCue: "P-V path",
}];
smallScaleGraph.teachingTimeline = [{
  id: "show_pv",
  action: "reveal",
  targetId: "pv_graph",
  dependsOn: [],
  narrationIntent: "show the P-V path",
}];
const smallScaleDocument = validateSceneDocument(smallScaleGraph).document;
const smallScaleCompiled = smallScaleDocument
  ? compileSceneDocument(smallScaleDocument)
  : null;
if (!smallScaleCompiled?.ok) {
  throw new Error(`small world coordinates were falsely treated as duplicates: ${JSON.stringify(smallScaleCompiled?.report.issues)}`);
}

const retracedRayScene = structuredClone(candidate);
retracedRayScene.source = { question: "A ray retraces its path after normal incidence" };
retracedRayScene.entities = [
  { id: "ray_start", kind: "point", role: "ray start" },
  { id: "ray_hit", kind: "point", role: "ray hit" },
  { id: "inc3", kind: "ray", role: "ray" },
  { id: "ray3_out", kind: "ray", role: "ray" },
];
retracedRayScene.constructions = [
  { id: "make_start", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["ray_start"] },
  { id: "make_hit", operator: "point", inputs: { x: 2, y: 1 }, outputs: ["ray_hit"] },
  { id: "make_incident", operator: "ray", inputs: { start: "ray_start", end: "ray_hit" }, outputs: ["inc3"] },
  { id: "make_reflected", operator: "ray", inputs: { start: "ray_start", end: "ray_hit" }, outputs: ["ray3_out"] },
];
retracedRayScene.relations = [];
retracedRayScene.assertions = [];
retracedRayScene.annotations = [];
retracedRayScene.requiredEntityIds = retracedRayScene.entities.map((entity) => entity.id);
retracedRayScene.revealGroups = [{
  id: "rays",
  entityIds: retracedRayScene.requiredEntityIds,
  dependsOn: [],
  narrationCue: "show retraced ray",
}];
retracedRayScene.teachingTimeline = [{
  id: "show_rays",
  action: "reveal",
  targetId: "rays",
  dependsOn: [],
  narrationIntent: "show retraced ray",
}];
const retracedRayDocument = validateSceneDocument(retracedRayScene).document;
const retracedRayCompiled = retracedRayDocument ? compileSceneDocument(retracedRayDocument) : null;
if (
  !retracedRayCompiled?.ok ||
  retracedRayCompiled.renderScene?.primitives.filter((primitive) =>
    primitive.entityId === "inc3" || primitive.entityId === "ray3_out").length !== 1
) {
  throw new Error(`a physically retraced ray was rendered twice: ${JSON.stringify(retracedRayCompiled?.report.issues)}`);
}

const omittedMeaningfulPointOwnership = structuredClone(candidate);
omittedMeaningfulPointOwnership.entities.push({
  id: "observation_point",
  kind: "point",
  role: "observation point",
});
omittedMeaningfulPointOwnership.constructions.push({
  id: "make_observation_point",
  operator: "point",
  inputs: { x: 4, y: 1, coordinateSpace: "world" },
  outputs: ["observation_point"],
});
omittedMeaningfulPointOwnership.annotations.push({
  id: "mark_observation_point",
  kind: "label",
  targetIds: ["observation_point"],
  text: "P",
});
omittedMeaningfulPointOwnership.revealGroups = [{
  id: "diagram",
  entityIds: [...omittedMeaningfulPointOwnership.requiredEntityIds],
  dependsOn: [],
  narrationCue: "show the complete construction",
}];
omittedMeaningfulPointOwnership.teachingTimeline = [{
  id: "show_diagram",
  action: "reveal",
  targetId: "diagram",
  dependsOn: [],
  narrationIntent: "show the complete construction",
}];
const meaningfulPointValidation = validateSceneDocument(omittedMeaningfulPointOwnership);
if (
  !meaningfulPointValidation.document ||
  !meaningfulPointValidation.document.requiredEntityIds.includes("observation_point") ||
  !meaningfulPointValidation.document.revealGroups.some((group) =>
    group.entityIds.includes("observation_point"))
) {
  throw new Error(`an unambiguously presentational point was not assigned scene ownership: ${JSON.stringify(meaningfulPointValidation.report.issues)}`);
}

const semanticGroupMetadata = structuredClone(candidate);
semanticGroupMetadata.entities.push({ id: "diagram_group", kind: "group", role: "group" });
semanticGroupMetadata.revealGroups[0]!.entityIds.push("diagram_group");
const semanticGroupMetadataDocument = validateSceneDocument(semanticGroupMetadata).document;
const semanticGroupMetadataCompilation = semanticGroupMetadataDocument
  ? compileSceneDocument(semanticGroupMetadataDocument)
  : null;
if (
  !semanticGroupMetadataCompilation?.ok ||
  semanticGroupMetadataDocument?.requiredEntityIds.includes("diagram_group")
) {
  throw new Error(`semantic group metadata was treated as visible ink: ${JSON.stringify(semanticGroupMetadataCompilation?.report.issues)}`);
}

const analyticCurveIncidence = structuredClone(candidate);
analyticCurveIncidence.source = {
  question: "Sketch y=x^2 and mark the point (-2,4)",
};
analyticCurveIncidence.entities = [
  { id: "parabola", kind: "polyline", role: "function graph" },
  { id: "intersection", kind: "point", role: "intersection", label: "(-2,4)" },
];
analyticCurveIncidence.constructions = [
  {
    id: "make_parabola",
    operator: "function_curve",
    inputs: { expression: "x^2", xMin: -2.5, xMax: 2.5, samples: 65 },
    outputs: ["parabola"],
  },
  {
    id: "make_intersection",
    operator: "point",
    inputs: { x: -2, y: 4, coordinateSpace: "world" },
    outputs: ["intersection"],
  },
];
analyticCurveIncidence.relations = [];
analyticCurveIncidence.assertions = [{
  id: "intersection_on_parabola",
  predicate: "on",
  entities: ["intersection", "parabola"],
  expected: true,
  severity: "fatal",
}];
analyticCurveIncidence.annotations = [];
analyticCurveIncidence.requiredEntityIds = ["parabola", "intersection"];
analyticCurveIncidence.revealGroups = [{
  id: "graph",
  entityIds: ["parabola", "intersection"],
  dependsOn: [],
  narrationCue: "show the exact graph intersection",
}];
analyticCurveIncidence.teachingTimeline = [{
  id: "show_graph",
  action: "reveal",
  targetId: "graph",
  dependsOn: [],
  narrationIntent: "mark the exact point on the analytic curve",
}];
const analyticCurveDocument = validateSceneDocument(analyticCurveIncidence).document;
const analyticCurveCompiled = analyticCurveDocument
  ? compileSceneDocument(analyticCurveDocument)
  : null;
if (!analyticCurveCompiled?.ok) {
  throw new Error(
    `analytic curve incidence depended on display sampling: ${JSON.stringify(analyticCurveCompiled?.report.issues)}`,
  );
}

const wrongCurveIncidence = structuredClone(analyticCurveIncidence);
wrongCurveIncidence.constructions[1]!.inputs = {
  x: -2,
  y: 4.01,
  coordinateSpace: "world",
};
const wrongCurveDocument = validateSceneDocument(wrongCurveIncidence).document;
const wrongCurveCompiled = wrongCurveDocument
  ? compileSceneDocument(wrongCurveDocument)
  : null;
if (
  wrongCurveCompiled?.ok ||
  !wrongCurveCompiled?.report.issues.some((issue) => issue.code === "assertion_failed")
) {
  throw new Error("analytic curve incidence accepted a point that is not on the function");
}

const equalPointPairs = structuredClone(candidate);
equalPointPairs.assertions = [{
  id: "symmetric_sides",
  predicate: "equal_length",
  entities: ["a", "b", "a", "c"],
  expected: true,
  severity: "fatal",
}];
const equalPointPairsDocument = validateSceneDocument(equalPointPairs).document;
const equalPointPairsCompiled = equalPointPairsDocument
  ? compileSceneDocument(equalPointPairsDocument)
  : null;
if (!equalPointPairsCompiled?.ok) {
  throw new Error(`equal_length rejected multiple point-pair distances: ${JSON.stringify(equalPointPairsCompiled?.report.issues)}`);
}

const angleMarkScene = structuredClone(candidate);
angleMarkScene.entities.push({ id: "angle_a", kind: "angle_mark", role: "angle at A" });
angleMarkScene.constructions.push({
  id: "make_angle_a",
  operator: "angle_mark",
  inputs: { vertex: "a", a: "b", b: "c" },
  outputs: ["angle_a"],
});
angleMarkScene.requiredEntityIds.push("angle_a");
angleMarkScene.revealGroups[0]!.entityIds.push("angle_a");
const angleMarkDocument = validateSceneDocument(angleMarkScene).document;
const angleMarkCompiled = angleMarkDocument ? compileSceneDocument(angleMarkDocument) : null;
if (!angleMarkCompiled?.ok || !angleMarkCompiled.renderScene?.primitives.some((primitive) =>
  primitive.entityId === "angle_a" && primitive.kind === "arc")) {
  throw new Error(`semantic angle mark did not compile: ${JSON.stringify(angleMarkCompiled?.report.issues)}`);
}

const curvedSurfaceCandidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "derive contact and local normal" },
  source: { question: "Reflect a path from a circular surface" },
  quantities: [],
  entities: [
    { id: "center", kind: "point", role: "center" },
    { id: "origin", kind: "point", role: "source" },
    { id: "surface", kind: "circle", role: "surface" },
    { id: "hit", kind: "point", role: "surface intersection" },
    { id: "incident", kind: "vector", role: "incident ray" },
    { id: "normal", kind: "vector", role: "surface normal" },
    { id: "reflected", kind: "ray", role: "reflected ray" },
  ],
  constructions: [
    { id: "make_center", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
    { id: "make_origin", operator: "point", inputs: { x: -10, y: 3, coordinateSpace: "world" }, outputs: ["origin"] },
    { id: "make_surface", operator: "circle", inputs: { center: "center", radius: 5 }, outputs: ["surface"] },
    { id: "make_contact", operator: "surface_contact", inputs: { origin: "origin", through: "center", surface: "surface" }, outputs: ["hit", "incident"] },
    { id: "make_normal", operator: "normal_at", inputs: { point: "hit", surface: "surface" }, outputs: ["normal"] },
    { id: "make_reflected", operator: "reflect_direction", inputs: { origin: "hit", incoming: "incident", normal: "normal" }, outputs: ["reflected"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["center", "origin", "surface", "hit", "incident", "normal", "reflected"],
  revealGroups: [{ id: "setup", entityIds: ["center", "origin", "surface", "hit", "incident", "normal", "reflected"] }],
  teachingTimeline: [{ action: "reveal", targetId: "setup" }],
};
const curvedSurface = validateSceneDocument(curvedSurfaceCandidate);
const compiledCurvedSurface = curvedSurface.document ? compileSceneDocument(curvedSurface.document) : null;
if (!compiledCurvedSurface?.ok || !compiledCurvedSurface.renderScene) {
  throw new Error(`curved surface construction failed: ${JSON.stringify(compiledCurvedSurface?.report.issues ?? curvedSurface.report.issues)}`);
}
const duplicateIncidentDeclaration = structuredClone(curvedSurfaceCandidate) as Record<string, any>;
duplicateIncidentDeclaration.entities.push({ id: "incident_short", kind: "vector", role: "incident ray through center" });
duplicateIncidentDeclaration.constructions.push({
  id: "make_incident_short",
  operator: "vector",
  inputs: { start: "origin", end: "center" },
  outputs: ["incident_short"],
});
duplicateIncidentDeclaration.requiredEntityIds.push("incident_short");
duplicateIncidentDeclaration.revealGroups[0].entityIds.push("incident_short");
duplicateIncidentDeclaration.assertions.push({
  id: "duplicate_incident_reference",
  predicate: "on",
  entities: ["origin", "incident_short"],
  expected: true,
  severity: "fatal",
});
const prunedDuplicateIncident = pruneDeadSceneEntities(duplicateIncidentDeclaration);
if (
  (prunedDuplicateIncident.entities as Array<Record<string, unknown>>).some((entity) => entity.id === "incident_short") ||
  (prunedDuplicateIncident.constructions as Array<Record<string, unknown>>).some((construction) =>
    Array.isArray(construction.outputs) && construction.outputs.includes("incident_short"))
) {
  throw new Error("an exact duplicate of the surface_contact incident path was not pruned");
}
if (!(prunedDuplicateIncident.assertions as Array<Record<string, any>>).some((assertion) =>
  assertion.id === "duplicate_incident_reference" && assertion.entities?.includes("incident"))) {
  throw new Error("semantic references to a redundant incident path were not preserved");
}
const prunedDuplicateIncidentDocument = validateSceneDocument(prunedDuplicateIncident).document;
if (!prunedDuplicateIncidentDocument || !compileSceneDocument(prunedDuplicateIncidentDocument).ok) {
  throw new Error("pruning a redundant incident path damaged the verified reflection construction");
}
const wrappedDerivedPath = structuredClone(curvedSurfaceCandidate) as Record<string, any>;
const wrappedTransform = wrappedDerivedPath.constructions.find(
  (construction: Record<string, any>) => construction.operator === "reflect_direction",
);
wrappedTransform.outputs = ["reflected_direction_helper"];
wrappedDerivedPath.constructions.push({
  id: "wrap_reflected_direction",
  operator: "ray",
  inputs: { start: "hit", direction: "reflected_direction_helper" },
  outputs: ["reflected"],
});
wrappedDerivedPath.entities.push({
  id: "reflection_angle",
  kind: "angle_mark",
  role: "reflected angle mark",
});
wrappedDerivedPath.constructions.push({
  id: "make_reflection_angle",
  operator: "angle_mark",
  inputs: { vertex: "hit", a: "origin", b: "center" },
  outputs: ["reflection_angle"],
});
wrappedDerivedPath.requiredEntityIds.push("reflection_angle");
wrappedDerivedPath.revealGroups[0].entityIds.push("reflection_angle");
const normalizedWrappedPath = pruneDeadSceneEntities(wrappedDerivedPath);
const normalizedWrappedPathResult = validateSceneDocument(normalizedWrappedPath);
const normalizedWrappedPathCompile = normalizedWrappedPathResult.document
  ? compileSceneDocument(normalizedWrappedPathResult.document)
  : null;
if (!normalizedWrappedPathCompile?.ok || !normalizedWrappedPathCompile.renderScene) {
  throw new Error(`equivalent derived path wrapper was not normalized: ${JSON.stringify(
    normalizedWrappedPathCompile?.report.issues ?? normalizedWrappedPathResult.report.issues,
  )}`);
}
if (
  normalizedWrappedPathResult.document?.constructions.some((construction) =>
    construction.id === "wrap_reflected_direction") ||
  normalizedWrappedPathResult.document?.constructions.find((construction) =>
    construction.operator === "reflect_direction")?.outputs[0] !== "reflected"
) {
  throw new Error("derived path wrapper normalization did not preserve the semantic output ID");
}
const pathArmAngle = structuredClone(curvedSurfaceCandidate) as Record<string, any>;
pathArmAngle.entities.push({ id: "path_angle", kind: "angle_mark", role: "reflected angle mark" });
pathArmAngle.constructions.push({
  id: "make_path_angle",
  operator: "angle_mark",
  inputs: { vertex: "hit", a: "incident", b: "reflected" },
  outputs: ["path_angle"],
});
pathArmAngle.requiredEntityIds.push("path_angle");
pathArmAngle.revealGroups[0].entityIds.push("path_angle");
const pathArmAngleResult = validateSceneDocument(pathArmAngle);
const pathArmAngleCompile = pathArmAngleResult.document
  ? compileSceneDocument(pathArmAngleResult.document)
  : null;
if (!pathArmAngleCompile?.ok || !pathArmAngleCompile.renderScene?.primitives.some(
  (primitive) => primitive.entityId === "path_angle" && primitive.kind === "arc",
)) {
  throw new Error(`angle_mark rejected verified path arms: ${JSON.stringify(
    pathArmAngleCompile?.report.issues ?? pathArmAngleResult.report.issues,
  )}`);
}
const semanticIncidentSource = structuredClone(curvedSurfaceCandidate) as Record<string, any>;
semanticIncidentSource.entities.find((entity: Record<string, any>) => entity.id === "origin").role =
  "incident ray source point";
const semanticIncidentSourceResult = validateSceneDocument(semanticIncidentSource);
const semanticIncidentSourceCompile = semanticIncidentSourceResult.document
  ? compileSceneDocument(semanticIncidentSourceResult.document)
  : null;
if (!semanticIncidentSourceCompile?.ok) {
  throw new Error(`an incident source point was mistaken for an unused incident path: ${JSON.stringify(
    semanticIncidentSourceCompile?.report.issues ?? semanticIncidentSourceResult.report.issues,
  )}`);
}
if (compiledCurvedSurface.renderScene.primitives.some((primitive) => primitive.entityId === "normal")) {
  throw new Error("solver-only surface normal leaked into render primitives");
}
const implicitNormal = structuredClone(curvedSurfaceCandidate) as Record<string, any>;
implicitNormal.entities = implicitNormal.entities.filter((entity: any) => entity.id !== "normal");
implicitNormal.requiredEntityIds = implicitNormal.requiredEntityIds.filter((id: string) => id !== "normal");
implicitNormal.revealGroups[0].entityIds = implicitNormal.revealGroups[0].entityIds.filter((id: string) => id !== "normal");
const implicitNormalValidated = validateSceneDocument(implicitNormal);
const implicitNormalCompiled = implicitNormalValidated.document
  ? compileSceneDocument(implicitNormalValidated.document)
  : null;
if (!implicitNormalCompiled?.ok || !implicitNormalCompiled.renderScene) {
  throw new Error(`implicit solver normal was rejected: ${JSON.stringify(implicitNormalCompiled?.report.issues ?? implicitNormalValidated.report.issues)}`);
}
const implicitContactPoint = structuredClone(implicitNormal) as Record<string, any>;
implicitContactPoint.entities = implicitContactPoint.entities.filter((entity: any) => entity.id !== "hit");
implicitContactPoint.requiredEntityIds = implicitContactPoint.requiredEntityIds.filter((id: string) => id !== "hit");
implicitContactPoint.revealGroups[0].entityIds = implicitContactPoint.revealGroups[0].entityIds.filter((id: string) => id !== "hit");
const implicitContactValidated = validateSceneDocument(implicitContactPoint);
const implicitContactCompiled = implicitContactValidated.document
  ? compileSceneDocument(implicitContactValidated.document)
  : null;
if (!implicitContactCompiled?.ok || !implicitContactCompiled.renderScene) {
  throw new Error(`implicit surface contact was rejected: ${JSON.stringify(implicitContactCompiled?.report.issues ?? implicitContactValidated.report.issues)}`);
}
const implicitVectorTipCandidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "vector with a construction-only endpoint" },
  source: { question: "Draw a velocity vector pointing right" },
  quantities: [],
  entities: [
    { id: "origin", kind: "point", role: "vector origin" },
    { id: "velocity", kind: "vector", role: "velocity", label: "v" },
  ],
  constructions: [
    { id: "make_origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["origin"] },
    { id: "make_tip", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["velocity_tip"] },
    { id: "make_velocity", operator: "vector", inputs: { start: "origin", end: "velocity_tip" }, outputs: ["velocity"] },
  ],
  relations: [],
  assertions: [{
    id: "tip_on_velocity",
    predicate: "on",
    entities: ["velocity_tip", "velocity"],
    expected: true,
    severity: "fatal",
  }],
  annotations: [],
  requiredEntityIds: ["origin", "velocity"],
  revealGroups: [{ id: "setup", entityIds: ["origin", "velocity"] }],
  teachingTimeline: [{ action: "reveal", targetId: "setup" }],
};
const implicitVectorTipValidated = validateSceneDocument(implicitVectorTipCandidate);
const implicitVectorTipCompiled = implicitVectorTipValidated.document
  ? compileSceneDocument(implicitVectorTipValidated.document)
  : null;
if (!implicitVectorTipCompiled?.ok || !implicitVectorTipCompiled.renderScene) {
  throw new Error(`implicit vector endpoint was rejected: ${JSON.stringify(implicitVectorTipCompiled?.report.issues ?? implicitVectorTipValidated.report.issues)}`);
}
if (implicitVectorTipCompiled.renderScene.primitives.some((primitive) => primitive.entityId === "velocity_tip")) {
  throw new Error("construction-only vector endpoint leaked into render primitives");
}
const declaredEndpointCandidate = structuredClone(implicitVectorTipCandidate) as Record<string, any>;
declaredEndpointCandidate.entities.push({ id: "velocity_tip", kind: "point", role: "vector_endpoint" });
const declaredEndpointValidated = validateSceneDocument(declaredEndpointCandidate);
const declaredEndpointCompiled = declaredEndpointValidated.document
  ? compileSceneDocument(declaredEndpointValidated.document)
  : null;
if (!declaredEndpointCompiled?.ok || !declaredEndpointCompiled.renderScene) {
  throw new Error(`underscore-delimited helper endpoint was rejected: ${JSON.stringify(declaredEndpointCompiled?.report.issues ?? declaredEndpointValidated.report.issues)}`);
}
if (declaredEndpointCompiled.renderScene.primitives.some((primitive) => primitive.entityId === "velocity_tip")) {
  throw new Error("declared construction-only endpoint leaked into render primitives");
}
const plannerVectorTipCandidate = structuredClone(declaredEndpointCandidate) as Record<string, any>;
plannerVectorTipCandidate.entities = plannerVectorTipCandidate.entities.map((entity: Record<string, unknown>) =>
  entity.id === "velocity_tip" ? { ...entity, role: "vector_tip" } : entity,
);
const plannerVectorTipValidated = validateSceneDocument(plannerVectorTipCandidate);
const plannerVectorTipCompiled = plannerVectorTipValidated.document
  ? compileSceneDocument(plannerVectorTipValidated.document)
  : null;
if (!plannerVectorTipCompiled?.ok || !plannerVectorTipCompiled.renderScene) {
  throw new Error(`planner vector tip helper was rejected: ${JSON.stringify(plannerVectorTipCompiled?.report.issues ?? plannerVectorTipValidated.report.issues)}`);
}
const annotationAnchorCandidate = structuredClone(implicitVectorTipCandidate) as Record<string, any>;
annotationAnchorCandidate.entities.push({ id: "velocity_tip", kind: "point", role: "field_marker" });
annotationAnchorCandidate.annotations = [{
  id: "tip_label",
  kind: "label",
  targetIds: ["velocity_tip"],
  text: "×",
  placementIntent: "above",
}];
const annotationAnchorValidated = validateSceneDocument(annotationAnchorCandidate);
const annotationAnchorCompiled = annotationAnchorValidated.document
  ? compileSceneDocument(annotationAnchorValidated.document)
  : null;
if (!annotationAnchorCompiled?.ok || !annotationAnchorCompiled.renderScene) {
  throw new Error(`annotation anchor was rejected: ${JSON.stringify(annotationAnchorCompiled?.report.issues ?? annotationAnchorValidated.report.issues)}`);
}
if (annotationAnchorCompiled.renderScene.primitives.some((primitive) =>
  primitive.entityId === "velocity_tip" && primitive.kind !== "label")) {
  throw new Error("annotation anchor rendered an unwanted point mark");
}
if (!annotationAnchorCompiled.renderScene.primitives.some((primitive) =>
  primitive.entityId === "velocity_tip" && primitive.kind === "label" && primitive.text === "×")) {
  throw new Error("annotation anchor did not render its label");
}
const fieldSymbolAnchorCandidate = structuredClone(annotationAnchorCandidate) as Record<string, any>;
fieldSymbolAnchorCandidate.entities = fieldSymbolAnchorCandidate.entities.map((entity: Record<string, unknown>) =>
  entity.id === "velocity_tip" ? { ...entity, role: "field_symbol" } : entity,
);
const fieldSymbolAnchorValidated = validateSceneDocument(fieldSymbolAnchorCandidate);
const fieldSymbolAnchorCompiled = fieldSymbolAnchorValidated.document
  ? compileSceneDocument(fieldSymbolAnchorValidated.document)
  : null;
if (!fieldSymbolAnchorCompiled?.ok || !fieldSymbolAnchorCompiled.renderScene) {
  throw new Error(`field-symbol anchor helper was rejected: ${JSON.stringify(fieldSymbolAnchorCompiled?.report.issues ?? fieldSymbolAnchorValidated.report.issues)}`);
}
const interiorJunctionCandidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "two paths meet at an interior junction" },
  source: { question: "Draw two connected conductors meeting at a T junction" },
  quantities: [],
  entities: [
    { id: "horizontal", kind: "segment", role: "conductor" },
    { id: "vertical", kind: "segment", role: "conductor" },
    { id: "left", kind: "point", role: "wire_endpoint" },
    { id: "right", kind: "point", role: "wire_endpoint" },
    { id: "junction", kind: "point", role: "wire_junction" },
    { id: "bottom", kind: "point", role: "wire_endpoint" },
  ],
  constructions: [
    { id: "make_left", operator: "point", inputs: { x: -2, y: 1, coordinateSpace: "layout" }, outputs: ["left"] },
    { id: "make_right", operator: "point", inputs: { x: 2, y: 1, coordinateSpace: "layout" }, outputs: ["right"] },
    { id: "make_junction", operator: "point", inputs: { x: 0, y: 1, coordinateSpace: "layout" }, outputs: ["junction"] },
    { id: "make_bottom", operator: "point", inputs: { x: 0, y: -1, coordinateSpace: "layout" }, outputs: ["bottom"] },
    { id: "make_horizontal", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["horizontal"] },
    { id: "make_vertical", operator: "segment", inputs: { start: "junction", end: "bottom" }, outputs: ["vertical"] },
  ],
  relations: [],
  assertions: [{ id: "joined", predicate: "connected", entities: ["horizontal", "vertical"], expected: true, severity: "fatal" }],
  annotations: [],
  requiredEntityIds: ["horizontal", "vertical"],
  revealGroups: [{ id: "setup", entityIds: ["horizontal", "vertical"] }],
  teachingTimeline: [{ action: "reveal", targetId: "setup" }],
};
const interiorJunctionValidated = validateSceneDocument(interiorJunctionCandidate);
const interiorJunctionCompiled = interiorJunctionValidated.document
  ? compileSceneDocument(interiorJunctionValidated.document)
  : null;
if (!interiorJunctionCompiled?.ok) {
  throw new Error(`interior path junction was rejected: ${JSON.stringify(interiorJunctionCompiled?.report.issues ?? interiorJunctionValidated.report.issues)}`);
}
const assertedPointChainCandidate = structuredClone(interiorJunctionCandidate) as Record<string, any>;
assertedPointChainCandidate.source.question = "Connect A through B to C";
assertedPointChainCandidate.entities = [
  { id: "a", kind: "point", role: "chain endpoint" },
  { id: "b", kind: "point", role: "chain junction" },
  { id: "c", kind: "point", role: "chain endpoint" },
  { id: "ab", kind: "connector", role: "existing connection" },
];
assertedPointChainCandidate.constructions = [
  { id: "make_a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["a"] },
  { id: "make_b", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "layout" }, outputs: ["b"] },
  { id: "make_c", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["c"] },
  { id: "make_ab", operator: "connect", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
];
assertedPointChainCandidate.assertions = [{
  id: "connected_chain",
  predicate: "connected",
  entities: ["a", "b", "c"],
  expected: true,
  severity: "fatal",
}];
assertedPointChainCandidate.requiredEntityIds = ["a", "b", "c", "ab"];
assertedPointChainCandidate.revealGroups = [{
  id: "setup",
  entityIds: ["a", "b", "c", "ab"],
}];
const assertedPointChainNormalized = pruneDeadSceneEntities(assertedPointChainCandidate);
const assertedPointChainValidated = validateSceneDocument(assertedPointChainNormalized);
const assertedPointChainCompiled = assertedPointChainValidated.document
  ? compileSceneDocument(assertedPointChainValidated.document)
  : null;
if (!assertedPointChainCompiled?.report.issues.some((issue) => issue.code === "assertion_failed")) {
  throw new Error("a connected assertion must not materialize the missing B-C construction");
}
const explicitlyConnectedPointChain = structuredClone(assertedPointChainCandidate) as Record<string, any>;
explicitlyConnectedPointChain.entities.push({ id: "bc", kind: "connector", role: "explicit connection" });
explicitlyConnectedPointChain.constructions.push({
  id: "make_bc",
  operator: "connect",
  inputs: { start: "b", end: "c" },
  outputs: ["bc"],
});
explicitlyConnectedPointChain.requiredEntityIds.push("bc");
explicitlyConnectedPointChain.revealGroups[0].entityIds.push("bc");
const explicitlyConnectedPointChainValidated = validateSceneDocument(explicitlyConnectedPointChain);
const explicitlyConnectedPointChainCompiled = explicitlyConnectedPointChainValidated.document
  ? compileSceneDocument(explicitlyConnectedPointChainValidated.document)
  : null;
if (!explicitlyConnectedPointChainCompiled?.ok) {
  throw new Error(`an explicitly constructed connected point chain was rejected: ${JSON.stringify(explicitlyConnectedPointChainCompiled?.report.issues ?? explicitlyConnectedPointChainValidated.report.issues)}`);
}
const directionOverlayCandidate = structuredClone(interiorJunctionCandidate) as Record<string, any>;
directionOverlayCandidate.source.question = "Draw a conductor and mark flow direction along it";
directionOverlayCandidate.entities = [
  { id: "conductor", kind: "segment", role: "conductor" },
  { id: "direction", kind: "vector", role: "flow direction" },
  { id: "start", kind: "point", role: "wire_endpoint" },
  { id: "end", kind: "point", role: "wire_endpoint" },
];
directionOverlayCandidate.constructions = [
  { id: "make_start", operator: "point", inputs: { x: -2, y: 0, coordinateSpace: "layout" }, outputs: ["start"] },
  { id: "make_end", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["end"] },
  { id: "make_conductor", operator: "segment", inputs: { start: "start", end: "end" }, outputs: ["conductor"] },
  { id: "make_direction", operator: "vector", inputs: { start: "start", end: "end" }, outputs: ["direction"] },
];
directionOverlayCandidate.assertions = [];
directionOverlayCandidate.requiredEntityIds = ["conductor", "direction"];
directionOverlayCandidate.revealGroups = [{ id: "setup", entityIds: ["conductor", "direction"] }];
const directionOverlayValidated = validateSceneDocument(directionOverlayCandidate);
const directionOverlayCompiled = directionOverlayValidated.document
  ? compileSceneDocument(directionOverlayValidated.document)
  : null;
if (!directionOverlayCompiled?.ok || !directionOverlayCompiled.renderScene) {
  throw new Error(`direction overlay was rejected: ${JSON.stringify(directionOverlayCompiled?.report.issues ?? directionOverlayValidated.report.issues)}`);
}
const conductorPrimitive = directionOverlayCompiled.renderScene.primitives.find((primitive) => primitive.entityId === "conductor");
const directionPrimitive = directionOverlayCompiled.renderScene.primitives.find((primitive) => primitive.entityId === "direction");
if (!conductorPrimitive || !directionPrimitive || JSON.stringify(conductorPrimitive.points) === JSON.stringify(directionPrimitive.points)) {
  throw new Error("direction marker overwrote the full structural path");
}
const explicitDirectionCandidate = structuredClone(directionOverlayCandidate) as Record<string, any>;
explicitDirectionCandidate.entities = [
  { id: "direction", kind: "vector", role: "velocity" },
  { id: "start", kind: "point", role: "vector_origin" },
  { id: "length_reference", kind: "point", role: "vector_endpoint" },
];
explicitDirectionCandidate.constructions = [
  { id: "make_start", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["start"] },
  { id: "make_length", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "layout" }, outputs: ["length_reference"] },
  { id: "make_direction", operator: "vector", inputs: { start: "start", end: "length_reference", direction: [1, 0] }, outputs: ["direction"] },
];
explicitDirectionCandidate.requiredEntityIds = ["direction"];
explicitDirectionCandidate.revealGroups = [{ id: "setup", entityIds: ["direction"] }];
const explicitDirectionValidated = validateSceneDocument(explicitDirectionCandidate);
const explicitDirectionCompiled = explicitDirectionValidated.document
  ? compileSceneDocument(explicitDirectionValidated.document)
  : null;
const explicitDirectionPrimitive = explicitDirectionCompiled?.renderScene?.primitives.find((primitive) => primitive.entityId === "direction");
if (!explicitDirectionCompiled?.ok || !explicitDirectionPrimitive || explicitDirectionPrimitive.points[0]!.y !== explicitDirectionPrimitive.points[1]!.y) {
  throw new Error(`explicit vector direction was ignored: ${JSON.stringify(explicitDirectionCompiled?.report.issues ?? explicitDirectionValidated.report.issues)}`);
}
const assertedIncidentCandidate = structuredClone(explicitDirectionCandidate) as Record<string, any>;
assertedIncidentCandidate.assertions = [{
  id: "direction_meets_contact",
  predicate: "incident",
  entities: ["direction", "length_reference"],
  expected: true,
  severity: "fatal",
}];
const assertedIncidentNormalized = pruneDeadSceneEntities(assertedIncidentCandidate);
const assertedIncidentValidated = validateSceneDocument(assertedIncidentNormalized);
const assertedIncidentCompiled = assertedIncidentValidated.document
  ? compileSceneDocument(assertedIncidentValidated.document)
  : null;
const assertedIncidentConstruction = assertedIncidentValidated.document?.constructions.find(
  (construction) => construction.outputs.includes("direction"),
);
const assertedIncidentPrimitive = assertedIncidentCompiled?.renderScene?.primitives.find(
  (primitive) => primitive.entityId === "direction",
);
if (
  !assertedIncidentCompiled?.ok ||
  assertedIncidentConstruction?.inputs.direction !== undefined ||
  !assertedIncidentPrimitive ||
  assertedIncidentPrimitive.points[0]!.x !== assertedIncidentPrimitive.points[1]!.x
) {
  throw new Error(`an asserted contact endpoint did not override a contradictory vector direction: ${JSON.stringify(
    assertedIncidentCompiled?.report.issues ?? assertedIncidentValidated.report.issues,
  )}`);
}
const groupTargetLabelCandidate = structuredClone(directionOverlayCandidate) as Record<string, any>;
groupTargetLabelCandidate.entities.find((entity: Record<string, unknown>) =>
  entity.id === "conductor"
)!.role = "medium interface boundary";
groupTargetLabelCandidate.entities.push(
  { id: "medium_region", kind: "group", role: "medium" },
  { id: "medium_label", kind: "label", role: "medium annotation", label: "n=1" },
);
groupTargetLabelCandidate.constructions.push({
  id: "make_medium_label",
  operator: "label",
  inputs: { target: "medium_region", text: "n=1" },
  outputs: ["medium_label"],
});
groupTargetLabelCandidate.requiredEntityIds.push("medium_label");
groupTargetLabelCandidate.revealGroups[0].entityIds.push("medium_region", "medium_label");
const groupTargetLabelValidated = validateSceneDocument(pruneDeadSceneEntities(groupTargetLabelCandidate));
const groupTargetLabelCompiled = groupTargetLabelValidated.document
  ? compileSceneDocument(groupTargetLabelValidated.document)
  : null;
if (!groupTargetLabelCompiled?.ok || !groupTargetLabelCompiled.renderScene?.primitives.some((primitive) =>
  primitive.entityId === "medium_label" && primitive.kind === "label" && primitive.text === "n=1"
)) {
  throw new Error(`a semantic region label was not attached to its unique boundary: ${JSON.stringify(
    groupTargetLabelCompiled?.report.issues ?? groupTargetLabelValidated.report.issues,
  )}`);
}
const zeroSpanDirectionCandidate = structuredClone(explicitDirectionCandidate) as Record<string, any>;
zeroSpanDirectionCandidate.constructions.find((construction: Record<string, any>) =>
  construction.id === "make_length"
)!.inputs = { x: 0, y: 0, coordinateSpace: "layout" };
const zeroSpanDirectionValidated = validateSceneDocument(zeroSpanDirectionCandidate);
const zeroSpanDirectionCompiled = zeroSpanDirectionValidated.document
  ? compileSceneDocument(zeroSpanDirectionValidated.document)
  : null;
const zeroSpanDirectionPrimitive = zeroSpanDirectionCompiled?.renderScene?.primitives.find((primitive) =>
  primitive.entityId === "direction"
);
if (
  !zeroSpanDirectionCompiled?.ok ||
  !zeroSpanDirectionPrimitive ||
  zeroSpanDirectionPrimitive.points[0]!.y !== zeroSpanDirectionPrimitive.points[1]!.y ||
  zeroSpanDirectionPrimitive.points[0]!.x === zeroSpanDirectionPrimitive.points[1]!.x
) {
  throw new Error(`zero-span explicit vector was rejected: ${JSON.stringify(zeroSpanDirectionCompiled?.report.issues ?? zeroSpanDirectionValidated.report.issues)}`);
}
const coincidentPointCandidate = structuredClone(interiorJunctionCandidate) as Record<string, any>;
coincidentPointCandidate.source.question = "Mark the pulley axis at the top of the incline";
coincidentPointCandidate.entities = [
  { id: "incline_top", kind: "point", role: "incline head" },
  { id: "pulley_axis", kind: "point", role: "pulley axis" },
];
coincidentPointCandidate.constructions = [
  { id: "make_incline_top", operator: "point", inputs: { x: 2, y: 2, coordinateSpace: "world" }, outputs: ["incline_top"] },
  { id: "make_pulley_axis", operator: "point", inputs: { x: 2, y: 2, coordinateSpace: "world" }, outputs: ["pulley_axis"] },
];
coincidentPointCandidate.assertions = [];
coincidentPointCandidate.requiredEntityIds = ["incline_top", "pulley_axis"];
coincidentPointCandidate.revealGroups = [{ id: "setup", entityIds: ["incline_top", "pulley_axis"] }];
const coincidentPointValidated = validateSceneDocument(coincidentPointCandidate);
const coincidentPointCompiled = coincidentPointValidated.document
  ? compileSceneDocument(coincidentPointValidated.document)
  : null;
const coincidentPointPrimitives = coincidentPointCompiled?.renderScene?.primitives.filter((primitive) =>
  primitive.kind === "point"
);
if (
  !coincidentPointCompiled?.ok ||
  coincidentPointPrimitives?.length !== 1 ||
  !coincidentPointCompiled.renderScene?.entityBounds.incline_top ||
  !coincidentPointCompiled.renderScene.entityBounds.pulley_axis
) {
  throw new Error(`coincident semantic points were not shared safely: ${JSON.stringify(coincidentPointCompiled?.report.issues ?? coincidentPointValidated.report.issues)}`);
}
const basisComponentCandidate = structuredClone(interiorJunctionCandidate) as Record<string, any>;
basisComponentCandidate.source.question = "Resolve weight parallel and perpendicular to a single inclined plane";
basisComponentCandidate.entities = [
  { id: "origin", kind: "point", role: "force origin" },
  { id: "base", kind: "point", role: "incline foot" },
  { id: "top", kind: "point", role: "incline head" },
  { id: "incline", kind: "line", role: "inclined plane surface" },
  { id: "incline_normal", kind: "line", role: "normal construction reference" },
  { id: "normal_force", kind: "vector", role: "normal force" },
  { id: "weight_parallel", kind: "vector", role: "parallel component" },
  { id: "weight_perpendicular", kind: "vector", role: "perpendicular component" },
];
basisComponentCandidate.constructions = [
  { id: "make_origin", operator: "point", inputs: { x: 2, y: 2, coordinateSpace: "world" }, outputs: ["origin"] },
  { id: "make_base", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["base"] },
  { id: "make_top", operator: "point", inputs: { x: 4, y: 3, coordinateSpace: "world" }, outputs: ["top"] },
  { id: "make_incline", operator: "line", inputs: { start: "base", end: "top" }, outputs: ["incline"] },
  { id: "make_incline_normal", operator: "perpendicular_through", inputs: { through: "origin", line: "incline" }, outputs: ["incline_normal"] },
  { id: "make_normal_force", operator: "vector", inputs: { start: "origin", end: { x: 2, y: 3, coordinateSpace: "world" }, direction: [-3, 4] }, outputs: ["normal_force"] },
  {
    id: "make_components",
    operator: "vector_components",
    inputs: { origin: "origin", vector: [0, -1] },
    outputs: ["weight_perpendicular", "weight_parallel"],
  },
];
basisComponentCandidate.assertions = [
  { id: "normal_is_perpendicular", predicate: "perpendicular", entities: ["normal_force", "incline"], expected: true, severity: "fatal" },
  { id: "component_uses_normal", predicate: "parallel", entities: ["weight_perpendicular", "incline_normal"], expected: true, severity: "fatal" },
];
basisComponentCandidate.requiredEntityIds = ["base", "top", "incline", "normal_force", "weight_parallel", "weight_perpendicular"];
basisComponentCandidate.revealGroups = [{
  id: "setup",
  entityIds: ["base", "top", "incline", "normal_force", "weight_parallel", "weight_perpendicular"],
}];
const normalizedBasisComponentCandidate = pruneDeadSceneEntities(basisComponentCandidate);
const basisComponentValidated = validateSceneDocument(normalizedBasisComponentCandidate);
const basisComponentCompiled = basisComponentValidated.document
  ? compileSceneDocument(basisComponentValidated.document)
  : null;
const basisConstruction = basisComponentValidated.document?.constructions.find((construction) =>
  construction.id === "make_components"
);
const componentPrimitives = basisComponentCompiled?.renderScene?.primitives.filter((primitive) =>
  primitive.entityId === "weight_parallel" || primitive.entityId === "weight_perpendicular"
);
if (
  !basisComponentCompiled?.ok ||
  basisConstruction?.inputs.basis !== "incline" ||
  basisConstruction.outputs[0] !== "weight_parallel" ||
  componentPrimitives?.length !== 2 ||
  JSON.stringify(componentPrimitives[0]!.points) === JSON.stringify(componentPrimitives[1]!.points)
) {
  throw new Error(`basis vector decomposition was not normalized: ${JSON.stringify(basisComponentCompiled?.report.issues ?? basisComponentValidated.report.issues)}`);
}
const positionedLabelCandidate = structuredClone(implicitVectorTipCandidate) as Record<string, any>;
positionedLabelCandidate.entities.push({
  id: "field_mark",
  kind: "label",
  role: "field direction marker",
  label: "×",
});
positionedLabelCandidate.constructions.push({
  id: "make_field_anchor",
  operator: "point",
  inputs: { x: 1, y: 1, coordinateSpace: "layout" },
  outputs: ["field_anchor"],
}, {
  id: "make_field_mark",
  operator: "label",
  inputs: { target: "field_anchor", text: "×" },
  outputs: ["field_mark"],
});
positionedLabelCandidate.requiredEntityIds.push("field_mark");
positionedLabelCandidate.revealGroups[0].entityIds.push("field_mark");
const positionedLabelValidated = validateSceneDocument(positionedLabelCandidate);
const positionedLabelCompiled = positionedLabelValidated.document
  ? compileSceneDocument(positionedLabelValidated.document)
  : null;
if (!positionedLabelCompiled?.ok || !positionedLabelCompiled.renderScene) {
  throw new Error(`positioned label was rejected: ${JSON.stringify(positionedLabelCompiled?.report.issues ?? positionedLabelValidated.report.issues)}`);
}
if (!positionedLabelCompiled.renderScene.primitives.some((primitive) =>
  primitive.entityId === "field_mark" && primitive.kind === "label" && primitive.text === "×")) {
  throw new Error("positioned label did not produce deterministic label ink");
}
const threeDimensionalVectorCandidate = structuredClone(positionedLabelCandidate) as Record<string, any>;
threeDimensionalVectorCandidate.constructions = threeDimensionalVectorCandidate.constructions.filter(
  (construction: Record<string, unknown>) =>
    construction.id !== "make_field_anchor" && construction.id !== "make_field_mark",
);
threeDimensionalVectorCandidate.constructions.push({
  id: "make_field_mark",
  operator: "vector",
  inputs: {
    start: [1, 1],
    end: [1, 1],
    direction: [0, 0, -1],
    length: 0.3,
  },
  outputs: ["field_mark"],
}, {
  id: "make_current_direction",
  operator: "vector",
  inputs: {
    start: { x: 2, y: 1 },
    end: { x: 2, y: 1 },
    direction: [0, 1, 0],
    length: 0.4,
  },
  outputs: ["current_direction"],
});
threeDimensionalVectorCandidate.entities.push({
  id: "current_direction",
  kind: "vector",
  role: "induced current direction",
});
threeDimensionalVectorCandidate.annotations.push({
  id: "field_value",
  kind: "label",
  targetIds: ["field_mark"],
  text: "B",
  placementIntent: "above",
});
threeDimensionalVectorCandidate.requiredEntityIds.push("current_direction");
threeDimensionalVectorCandidate.revealGroups[0].entityIds.push("current_direction");
const normalizedThreeDimensionalVectors = pruneDeadSceneEntities(threeDimensionalVectorCandidate);
const threeDimensionalVectorValidated = validateSceneDocument(normalizedThreeDimensionalVectors);
const threeDimensionalVectorCompiled = threeDimensionalVectorValidated.document
  ? compileSceneDocument(threeDimensionalVectorValidated.document)
  : null;
const fieldConstruction = threeDimensionalVectorValidated.document?.constructions.find(
  (construction) => construction.outputs.includes("field_mark"),
);
const currentConstruction = threeDimensionalVectorValidated.document?.constructions.find(
  (construction) => construction.outputs.includes("current_direction"),
);
if (
  !threeDimensionalVectorCompiled?.ok ||
  fieldConstruction?.operator !== "label" ||
  fieldConstruction.inputs.text !== "×" ||
  currentConstruction?.operator !== "vector" ||
  !Array.isArray(currentConstruction.inputs.direction) ||
  currentConstruction.inputs.direction.length !== 2 ||
  !threeDimensionalVectorCompiled.renderScene?.primitives.some((primitive) =>
    primitive.entityId === "field_mark" && primitive.kind === "label" && primitive.text === "×") ||
  !threeDimensionalVectorCompiled.renderScene.primitives.some((primitive) =>
    primitive.entityId === "current_direction" && primitive.kind === "vector")
) {
  throw new Error(`3D planner vectors were not projected into deterministic whiteboard marks: ${JSON.stringify(
    threeDimensionalVectorCompiled?.report.issues ?? threeDimensionalVectorValidated.report.issues,
  )}`);
}
const geometryTargetLabelCandidate = structuredClone(positionedLabelCandidate) as Record<string, any>;
geometryTargetLabelCandidate.constructions = geometryTargetLabelCandidate.constructions
  .filter((construction: Record<string, unknown>) => construction.id !== "make_field_anchor");
geometryTargetLabelCandidate.constructions
  .find((construction: Record<string, unknown>) => construction.id === "make_field_mark")
  .inputs.target = "velocity";
const geometryTargetLabelValidated = validateSceneDocument(geometryTargetLabelCandidate);
const geometryTargetLabelCompiled = geometryTargetLabelValidated.document
  ? compileSceneDocument(geometryTargetLabelValidated.document)
  : null;
if (!geometryTargetLabelCompiled?.ok || !geometryTargetLabelCompiled.renderScene?.primitives.some((primitive) =>
  primitive.entityId === "field_mark" && primitive.kind === "label" && primitive.text === "×")) {
  throw new Error(`label could not target rendered geometry: ${JSON.stringify(geometryTargetLabelCompiled?.report.issues ?? geometryTargetLabelValidated.report.issues)}`);
}
const narratedPositionedLabelCandidate = structuredClone(positionedLabelCandidate) as Record<string, any>;
narratedPositionedLabelCandidate.annotations = [{
  id: "explain_field",
  kind: "callout",
  targetIds: ["field_mark"],
  text: "Magnetic field directed into the page",
  placementIntent: "above",
}];
const narratedPositionedLabelValidated = validateSceneDocument(narratedPositionedLabelCandidate);
const narratedPositionedLabelCompiled = narratedPositionedLabelValidated.document
  ? compileSceneDocument(narratedPositionedLabelValidated.document)
  : null;
if (!narratedPositionedLabelCompiled?.ok || !narratedPositionedLabelCompiled.renderScene?.primitives.some((primitive) =>
  primitive.entityId === "field_mark" && primitive.kind === "label" && primitive.text === "×")) {
  throw new Error("a long narration callout suppressed its compact positioned mark");
}
const missingRedundantLabelCandidate = structuredClone(positionedLabelCandidate) as Record<string, any>;
delete missingRedundantLabelCandidate.entities.find((entity: Record<string, unknown>) => entity.id === "field_mark").label;
const normalizedMissingLabel = pruneDeadSceneEntities(missingRedundantLabelCandidate);
const missingRedundantLabelValidated = validateSceneDocument(normalizedMissingLabel);
const missingRedundantLabelCompiled = missingRedundantLabelValidated.document
  ? compileSceneDocument(missingRedundantLabelValidated.document)
  : null;
if (!missingRedundantLabelCompiled?.ok || !missingRedundantLabelCompiled.renderScene?.primitives.some((primitive) =>
  primitive.entityId === "field_mark" && primitive.kind === "label" && primitive.text === "×")) {
  throw new Error(`missing redundant label text was not normalized: ${JSON.stringify(missingRedundantLabelCompiled?.report.issues ?? missingRedundantLabelValidated.report.issues)}`);
}
const unpositionedLabelCandidate = structuredClone(positionedLabelCandidate) as Record<string, any>;
unpositionedLabelCandidate.constructions = unpositionedLabelCandidate.constructions
  .filter((construction: Record<string, unknown>) =>
    construction.id !== "make_field_mark" && construction.id !== "make_field_anchor");
const unpositionedLabelValidated = validateSceneDocument(unpositionedLabelCandidate);
const unpositionedLabelCompiled = unpositionedLabelValidated.document
  ? compileSceneDocument(unpositionedLabelValidated.document)
  : null;
if (unpositionedLabelCompiled?.ok || !unpositionedLabelCompiled?.report.issues.some((issue) =>
  issue.code === "unconstructed_required_entity" && issue.entityIds?.includes("field_mark"))) {
  throw new Error("an unpositioned required label was allowed to disappear silently");
}
const declaredSolverHelpers = structuredClone(curvedSurfaceCandidate) as Record<string, any>;
declaredSolverHelpers.requiredEntityIds = declaredSolverHelpers.requiredEntityIds
  .filter((id: string) => id !== "hit");
declaredSolverHelpers.revealGroups[0].entityIds = declaredSolverHelpers.revealGroups[0].entityIds
  .filter((id: string) => id !== "hit");
declaredSolverHelpers.entities.push({ id: "arc_center_helper", kind: "point", role: "point" });
declaredSolverHelpers.constructions.push({
  id: "make_arc_center_helper",
  operator: "point",
  inputs: { x: 0, y: 0, coordinateSpace: "world" },
  outputs: ["arc_center_helper"],
});
declaredSolverHelpers.constructions.find((item: Record<string, unknown>) => item.id === "make_surface")
  .inputs.center = "arc_center_helper";
const declaredHelpersDocument = validateSceneDocument(declaredSolverHelpers).document;
const declaredHelpersCompiled = declaredHelpersDocument
  ? compileSceneDocument(declaredHelpersDocument)
  : null;
if (!declaredHelpersCompiled?.ok || !declaredHelpersCompiled.renderScene) {
  throw new Error(`declared solver helpers were rejected: ${JSON.stringify(declaredHelpersCompiled?.report.issues)}`);
}
if (declaredHelpersCompiled.renderScene.primitives.some((primitive) =>
  primitive.entityId === "hit" || primitive.entityId === "arc_center_helper")) {
  throw new Error("declared solver helper leaked into render primitives");
}
const implicitIncidentPath = structuredClone(implicitContactPoint) as Record<string, any>;
implicitIncidentPath.entities = implicitIncidentPath.entities.filter((entity: any) => entity.id !== "incident");
implicitIncidentPath.requiredEntityIds = implicitIncidentPath.requiredEntityIds.filter((id: string) => id !== "incident");
implicitIncidentPath.revealGroups[0].entityIds = implicitIncidentPath.revealGroups[0].entityIds.filter((id: string) => id !== "incident");
const implicitIncidentValidated = validateSceneDocument(implicitIncidentPath);
const implicitIncidentCompiled = implicitIncidentValidated.document
  ? compileSceneDocument(implicitIncidentValidated.document)
  : null;
if (
  !implicitIncidentCompiled?.ok ||
  !implicitIncidentCompiled.renderScene?.primitives.some((primitive) => primitive.entityId === "incident")
) {
  throw new Error(`implicit incident path was not recovered: ${JSON.stringify(implicitIncidentCompiled?.report.issues ?? implicitIncidentValidated.report.issues)}`);
}
const literalNormal = structuredClone(curvedSurfaceCandidate) as Record<string, any>;
literalNormal.constructions.find((construction: any) => construction.id === "make_reflected").inputs.normal = [1, 0];
const literalNormalResult = validateSceneDocument(literalNormal);
if (literalNormalResult.document || !literalNormalResult.report.issues.some((issue) => issue.code === "normal_must_be_constructed")) {
  throw new Error("a guessed literal surface normal was accepted");
}

const approximateConvergence = structuredClone(candidate) as Record<string, any>;
approximateConvergence.entities = [
  { id: "a", kind: "point", role: "ray origin" },
  { id: "b", kind: "point", role: "ray direction" },
  { id: "c", kind: "point", role: "ray origin" },
  { id: "d", kind: "point", role: "ray direction" },
  { id: "target", kind: "point", role: "target" },
  { id: "ray1", kind: "ray", role: "path" },
  { id: "ray2", kind: "ray", role: "path" },
];
approximateConvergence.constructions = [
  { id: "make_a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["a"] },
  { id: "make_b", operator: "point", inputs: { x: 10, y: 0, coordinateSpace: "world" }, outputs: ["b"] },
  { id: "make_c", operator: "point", inputs: { x: 0, y: 0.1, coordinateSpace: "world" }, outputs: ["c"] },
  { id: "make_d", operator: "point", inputs: { x: 10, y: 0.02, coordinateSpace: "world" }, outputs: ["d"] },
  { id: "make_target", operator: "point", inputs: { x: 10, y: 0.01, coordinateSpace: "world" }, outputs: ["target"] },
  { id: "make_ray1", operator: "ray", inputs: { start: "a", end: "b" }, outputs: ["ray1"] },
  { id: "make_ray2", operator: "ray", inputs: { start: "c", end: "d" }, outputs: ["ray2"] },
];
approximateConvergence.assertions = [{ id: "near_target", predicate: "converges", entities: ["ray1", "ray2", "target"], expected: true, severity: "fatal" }];
approximateConvergence.annotations = [];
approximateConvergence.requiredEntityIds = approximateConvergence.entities.map((entity: any) => entity.id);
approximateConvergence.revealGroups = [{ id: "setup", entityIds: approximateConvergence.requiredEntityIds }];
approximateConvergence.teachingTimeline = [{ action: "reveal", targetId: "setup" }];
const approximateResult = validateSceneDocument(approximateConvergence);
const compiledApproximate = approximateResult.document ? compileSceneDocument(approximateResult.document) : null;
if (!compiledApproximate?.ok || !compiledApproximate.report.issues.some((issue) => issue.code === "approximate_convergence")) {
  throw new Error(`scale-aware convergence was not accepted with a warning: ${JSON.stringify(compiledApproximate?.report.issues ?? approximateResult.report.issues)}`);
}
const vectorSumConvergence = structuredClone(approximateConvergence) as Record<string, any>;
vectorSumConvergence.entities = [
  { id: "origin", kind: "point", role: "origin" },
  { id: "component_tip", kind: "point", role: "tip" },
  { id: "sum_tip", kind: "point", role: "tip" },
  { id: "horizontal", kind: "vector", role: "component" },
  { id: "vertical", kind: "vector", role: "component" },
  { id: "resultant", kind: "vector", role: "resultant" },
];
vectorSumConvergence.constructions = [
  { id: "make_origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["origin"] },
  { id: "make_component_tip", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["component_tip"] },
  { id: "make_sum_tip", operator: "point", inputs: { x: 2, y: 1, coordinateSpace: "world" }, outputs: ["sum_tip"] },
  { id: "make_horizontal", operator: "vector", inputs: { start: "origin", end: "component_tip" }, outputs: ["horizontal"] },
  { id: "make_vertical", operator: "vector", inputs: { start: "component_tip", end: "sum_tip" }, outputs: ["vertical"] },
  { id: "make_resultant", operator: "vector", inputs: { start: "origin", end: "sum_tip" }, outputs: ["resultant"] },
];
vectorSumConvergence.assertions = [{
  id: "vector_sum_closes",
  predicate: "vector_sum",
  entities: ["horizontal", "vertical", "resultant"],
  expected: true,
  severity: "fatal",
}];
vectorSumConvergence.requiredEntityIds = vectorSumConvergence.entities.map((entity: any) => entity.id);
vectorSumConvergence.revealGroups = [{
  id: "phasors",
  entityIds: vectorSumConvergence.requiredEntityIds,
  narrationCue: "show the vector sum",
}];
vectorSumConvergence.teachingTimeline = [{
  id: "show_phasors",
  action: "reveal",
  targetId: "phasors",
  narrationIntent: "draw the vector sum",
}];
const vectorSumDocument = validateSceneDocument(
  pruneDeadSceneEntities(vectorSumConvergence),
).document;
const vectorSumCompiled = vectorSumDocument ? compileSceneDocument(vectorSumDocument) : null;
if (
  !vectorSumCompiled?.ok ||
  vectorSumDocument?.assertions[0]?.entities.join(",") !== "horizontal,vertical,resultant"
) {
  throw new Error(`head-to-tail vector sum was not verified from explicit vector geometry: ${JSON.stringify(vectorSumCompiled?.report.issues)}`);
}
const assertedPerpendicularVectors = structuredClone(vectorSumConvergence) as Record<string, any>;
assertedPerpendicularVectors.constructions.find(
  (construction: Record<string, unknown>) => construction.id === "make_origin",
).inputs.coordinateSpace = "layout";
assertedPerpendicularVectors.constructions.find(
  (construction: Record<string, unknown>) => construction.id === "make_sum_tip",
).inputs = { x: 4, y: 3, coordinateSpace: "world" };
assertedPerpendicularVectors.assertions = [{
  id: "vertical_perpendicular_to_horizontal",
  predicate: "perpendicular",
  entities: ["horizontal", "vertical"],
  expected: true,
  severity: "fatal",
}];
const assertedPerpendicularDocument = validateSceneDocument(
  pruneDeadSceneEntities(assertedPerpendicularVectors),
).document;
const assertedPerpendicularCompiled = assertedPerpendicularDocument
  ? compileSceneDocument(assertedPerpendicularDocument)
  : null;
if (!assertedPerpendicularCompiled?.ok) {
  throw new Error(`uniquely constrained vector direction was not repaired: ${JSON.stringify(assertedPerpendicularCompiled?.report.issues)}`);
}
const commonOriginVectorSum = structuredClone(vectorSumConvergence) as Record<string, any>;
commonOriginVectorSum.entities.push({
  id: "vertical_tip",
  kind: "point",
  role: "tip",
});
commonOriginVectorSum.constructions.push({
  id: "make_vertical_tip",
  operator: "point",
  inputs: { x: 0, y: 1, coordinateSpace: "world" },
  outputs: ["vertical_tip"],
});
const commonVertical = commonOriginVectorSum.constructions.find(
  (construction: Record<string, unknown>) => construction.id === "make_vertical",
);
commonVertical.inputs = { start: "origin", end: "vertical_tip" };
commonOriginVectorSum.assertions = [{
  id: "common_origin_sum",
  predicate: "vector_sum",
  entities: ["horizontal", "vertical", "resultant"],
  expected: true,
  severity: "fatal",
}];
commonOriginVectorSum.requiredEntityIds.push("vertical_tip");
commonOriginVectorSum.revealGroups[0].entityIds.push("vertical_tip");
const commonOriginDocument = validateSceneDocument(
  pruneDeadSceneEntities(commonOriginVectorSum),
).document;
const commonOriginCompiled = commonOriginDocument
  ? compileSceneDocument(commonOriginDocument)
  : null;
if (
  !commonOriginCompiled?.ok ||
  commonOriginDocument?.assertions[0]?.predicate !== "vector_sum"
) {
  throw new Error(`common-origin vector sum was not proved: ${JSON.stringify(commonOriginCompiled?.report.issues)}`);
}
const semanticGroupCallout = structuredClone(vectorSumConvergence) as Record<string, any>;
semanticGroupCallout.entities.push({
  id: "phasors_group",
  kind: "group",
  role: "phasors_frame",
});
semanticGroupCallout.annotations = [{
  id: "phasor_summary",
  kind: "callout",
  targetIds: ["phasors_group"],
  text: "Result: vectors",
  placementIntent: "above",
}];
const semanticGroupDocument = validateSceneDocument(
  pruneDeadSceneEntities(semanticGroupCallout),
).document;
const semanticGroupCompiled = semanticGroupDocument
  ? compileSceneDocument(semanticGroupDocument)
  : null;
if (
  !semanticGroupCompiled?.ok ||
  semanticGroupCompiled.report.issues.some(
    (issue) => issue.code === "annotation_target_unrendered",
  )
) {
  throw new Error(`semantic group callout was not attached to its reveal view: ${JSON.stringify(semanticGroupCompiled?.report.issues)}`);
}
const coincidentVectorAliases = structuredClone(vectorSumConvergence) as Record<string, any>;
coincidentVectorAliases.entities.push({
  id: "horizontal_reference",
  kind: "vector",
  role: "direction reference",
});
coincidentVectorAliases.constructions.push({
  id: "make_horizontal_reference",
  operator: "vector",
  inputs: { start: "origin", end: "component_tip" },
  outputs: ["horizontal_reference"],
});
coincidentVectorAliases.assertions.push({
  id: "reference_parallel",
  predicate: "parallel",
  entities: ["horizontal", "horizontal_reference"],
  expected: true,
  severity: "fatal",
});
coincidentVectorAliases.requiredEntityIds.push("horizontal_reference");
coincidentVectorAliases.revealGroups[0].entityIds.push("horizontal_reference");
const coincidentVectorDocument = validateSceneDocument(
  pruneDeadSceneEntities(coincidentVectorAliases),
).document;
const coincidentVectorCompiled = coincidentVectorDocument
  ? compileSceneDocument(coincidentVectorDocument)
  : null;
const coincidentVectorPrimitives = coincidentVectorCompiled?.renderScene?.primitives.filter(
  (primitive) => primitive.entityId === "horizontal" ||
    primitive.entityId === "horizontal_reference",
) ?? [];
if (!coincidentVectorCompiled?.ok || coincidentVectorPrimitives.length !== 1) {
  throw new Error(`coincident parallel vectors were overdrawn: ${JSON.stringify(coincidentVectorCompiled?.report.issues)}`);
}
const coincidentPhasors = structuredClone(vectorSumConvergence) as Record<string, any>;
coincidentPhasors.entities = coincidentPhasors.entities.map((entity: Record<string, unknown>) =>
  entity.id === "horizontal" ? { ...entity, role: "current_phasor" } : entity,
);
coincidentPhasors.entities.push({
  id: "voltage_phasor",
  kind: "vector",
  role: "voltage-phasor",
});
coincidentPhasors.constructions.push({
  id: "make_voltage_phasor",
  operator: "vector",
  inputs: { start: "origin", end: "component_tip" },
  outputs: ["voltage_phasor"],
});
coincidentPhasors.requiredEntityIds.push("voltage_phasor");
coincidentPhasors.revealGroups[0].entityIds.push("voltage_phasor");
const coincidentPhasorDocument = validateSceneDocument(coincidentPhasors).document;
const coincidentPhasorCompilation = coincidentPhasorDocument
  ? compileSceneDocument(coincidentPhasorDocument)
  : null;
if (!coincidentPhasorCompilation?.ok) {
  throw new Error(`coincident in-phase phasors were rejected: ${JSON.stringify(coincidentPhasorCompilation?.report.issues)}`);
}

const circuitCandidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "connected topology" },
  source: { question: "A battery and two resistors in series" },
  entities: [
    { id: "top_left", kind: "point", role: "node" },
    { id: "midpoint", kind: "point", role: "midpoint", label: "Vmid" },
    { id: "top_right", kind: "point", role: "node" },
    { id: "bottom_right", kind: "point", role: "node" },
    { id: "bottom_left", kind: "point", role: "node" },
    { id: "r1", kind: "component", role: "first resistor", label: "4.7 kΩ" },
    { id: "r2", kind: "component", role: "second resistor", label: "4.7 kΩ" },
    { id: "battery", kind: "component", role: "supply", label: "9 V" },
    { id: "right_wire", kind: "connector", role: "wire" },
    { id: "bottom_wire", kind: "connector", role: "wire" },
  ],
  constructions: [
    { id: "p1", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "layout" }, outputs: ["top_left"] },
    { id: "p2", operator: "point", inputs: { x: 2, y: 2, coordinateSpace: "layout" }, outputs: ["midpoint"] },
    { id: "p3", operator: "point", inputs: { x: 4, y: 2, coordinateSpace: "layout" }, outputs: ["top_right"] },
    { id: "p4", operator: "point", inputs: { x: 4, y: 0, coordinateSpace: "layout" }, outputs: ["bottom_right"] },
    { id: "p5", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["bottom_left"] },
    { id: "make_r1", operator: "symbol", inputs: { symbol: "resistor", start: "top_left", end: "midpoint" }, outputs: ["r1"] },
    { id: "make_r2", operator: "symbol", inputs: { symbol: "resistor", start: "midpoint", end: "top_right" }, outputs: ["r2"] },
    { id: "make_battery", operator: "symbol", inputs: { symbol: "battery", start: "bottom_left", end: "top_left" }, outputs: ["battery"] },
    { id: "make_right", operator: "connect", inputs: { start: "top_right", end: "bottom_right" }, outputs: ["right_wire"] },
    { id: "make_bottom", operator: "connect", inputs: { start: "bottom_right", end: "bottom_left" }, outputs: ["bottom_wire"] },
  ],
  relations: [],
  assertions: [
    { id: "r1_connected", predicate: "connected", entities: ["top_left", "midpoint"], expected: true, severity: "fatal" },
    { id: "r2_connected", predicate: "connected", entities: ["midpoint", "top_right"], expected: true, severity: "fatal" },
    { id: "series_connected", predicate: "connected", entities: ["battery", "r1", "r2"], expected: true, severity: "fatal" },
    { id: "midpoint_on_r1", predicate: "on", entities: ["midpoint", "r1"], expected: true, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["top_left", "midpoint", "top_right", "bottom_right", "bottom_left", "r1", "r2", "battery", "right_wire", "bottom_wire"],
  revealGroups: [{ id: "setup", entityIds: ["top_left", "midpoint", "top_right", "bottom_right", "bottom_left", "r1", "r2", "battery", "right_wire", "bottom_wire"], dependsOn: [], narrationCue: "show the series circuit" }],
  teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "draw the circuit" }],
};
const validatedCircuit = validateSceneDocument(circuitCandidate);
if (!validatedCircuit.document) throw new Error(JSON.stringify(validatedCircuit.report.issues));
const compiledCircuit = compileSceneDocument(validatedCircuit.document);
if (!compiledCircuit.ok || !compiledCircuit.renderScene || compiledCircuit.renderScene.primitives.length < 10) {
  throw new Error(`circuit symbol compilation failed: ${JSON.stringify(compiledCircuit.report.issues)}`);
}
if (compiledCircuit.report.issues.some((issue) => issue.code === "layout_metric_assertion_ignored")) {
  throw new Error("affine layout assertions must be evaluated against rendered geometry");
}
const invalidLayoutGeometry = structuredClone(circuitCandidate);
invalidLayoutGeometry.assertions.push({
  id: "false_layout_incidence",
  predicate: "on",
  entities: ["bottom_left", "r1"],
  expected: true,
  severity: "fatal",
});
const invalidLayoutDocument = validateSceneDocument(invalidLayoutGeometry).document;
const invalidLayoutCompilation = invalidLayoutDocument
  ? compileSceneDocument(invalidLayoutDocument)
  : null;
if (invalidLayoutCompilation?.ok || !invalidLayoutCompilation?.report.issues.some((issue) =>
  issue.code === "assertion_failed" && issue.entityIds?.includes("bottom_left"))) {
  throw new Error("false affine layout geometry was not rejected");
}
const omittedConnectorOwnership = structuredClone(circuitCandidate) as Record<string, any>;
omittedConnectorOwnership.entities = omittedConnectorOwnership.entities.filter(
  (entity: Record<string, unknown>) => entity.id !== "right_wire" && entity.id !== "bottom_wire",
);
omittedConnectorOwnership.requiredEntityIds = omittedConnectorOwnership.requiredEntityIds.filter(
  (id: string) => id !== "right_wire" && id !== "bottom_wire",
);
omittedConnectorOwnership.revealGroups[0].entityIds = omittedConnectorOwnership.revealGroups[0].entityIds.filter(
  (id: string) => id !== "right_wire" && id !== "bottom_wire",
);
const reconciledConnectorValidation = validateSceneDocument(
  pruneDeadSceneEntities(omittedConnectorOwnership),
);
const reconciledConnectorDocument = reconciledConnectorValidation.document;
const reconciledConnectorCompiled = reconciledConnectorDocument
  ? compileSceneDocument(reconciledConnectorDocument)
  : null;
if (
  !reconciledConnectorCompiled?.ok ||
  !reconciledConnectorCompiled.renderScene?.primitives.some((primitive) => primitive.entityId === "right_wire") ||
  !reconciledConnectorCompiled.renderScene?.primitives.some((primitive) => primitive.entityId === "bottom_wire")
) {
  throw new Error(`constructed connector ownership was not recovered: ${JSON.stringify({
    issues: reconciledConnectorCompiled?.report.issues,
    validationIssues: reconciledConnectorValidation.report.issues,
    required: reconciledConnectorDocument?.requiredEntityIds,
    primitives: reconciledConnectorCompiled?.renderScene?.primitives.map((primitive) => primitive.entityId),
  })}`);
}
const forwardReferencedCircuit = structuredClone(validatedCircuit.document);
forwardReferencedCircuit.constructions.reverse();
const compiledForwardReference = compileSceneDocument(forwardReferencedCircuit);
if (!compiledForwardReference.ok || !compiledForwardReference.renderScene) {
  throw new Error(`construction dependency ordering failed: ${JSON.stringify(compiledForwardReference.report.issues)}`);
}

const seriesPathDoc = structuredClone(circuitCandidate) as Record<string, any>;
seriesPathDoc.entities = [
  { id: "n0", kind: "point", role: "node" },
  { id: "n1", kind: "point", role: "node" },
  { id: "n2", kind: "point", role: "node" },
  { id: "n3", kind: "point", role: "node" },
  { id: "r1", kind: "component", role: "resistor" },
  { id: "r2", kind: "component", role: "resistor" },
  { id: "r3", kind: "component", role: "resistor" },
];
seriesPathDoc.constructions = [
  { id: "p0", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["n0"] },
  { id: "p1", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "layout" }, outputs: ["n1"] },
  { id: "p2", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["n2"] },
  { id: "p3", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "layout" }, outputs: ["n3"] },
  { id: "make_r1", operator: "symbol", inputs: { symbol: "resistor", start: "n0", end: "n1" }, outputs: ["r1"] },
  { id: "make_r2", operator: "symbol", inputs: { symbol: "resistor", start: "n1", end: "n2" }, outputs: ["r2"] },
  { id: "make_r3", operator: "symbol", inputs: { symbol: "resistor", start: "n2", end: "n3" }, outputs: ["r3"] },
];
seriesPathDoc.assertions = [
  { id: "series_path", predicate: "path", entities: ["r1", "r2", "r3"], expected: true, severity: "fatal" },
  { id: "n1_degree", predicate: "degree", entities: ["n1"], expected: 2, severity: "fatal" },
];
seriesPathDoc.annotations = [];
seriesPathDoc.requiredEntityIds = ["n0", "n1", "n2", "n3", "r1", "r2", "r3"];
seriesPathDoc.revealGroups = [{ id: "setup", entityIds: seriesPathDoc.requiredEntityIds, dependsOn: [], narrationCue: "series" }];
seriesPathDoc.teachingTimeline = [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "series" }];
const validatedSeriesPath = validateSceneDocument(seriesPathDoc);
if (!validatedSeriesPath.document) throw new Error(JSON.stringify(validatedSeriesPath.report.issues));
const compiledSeriesPath = compileSceneDocument(validatedSeriesPath.document);
if (!compiledSeriesPath.ok) {
  throw new Error(`topology path/degree assertions failed: ${JSON.stringify(compiledSeriesPath.report.issues)}`);
}
const nodeInterleavedPath = structuredClone(seriesPathDoc) as Record<string, any>;
nodeInterleavedPath.assertions[0].entities = ["n0", "r1", "n1", "r2", "n2", "r3", "n3"];
const normalizedNodePath = validateSceneDocument(
  pruneDeadSceneEntities(nodeInterleavedPath),
).document;
const compiledNodePath = normalizedNodePath ? compileSceneDocument(normalizedNodePath) : null;
if (
  !compiledNodePath?.ok ||
  normalizedNodePath?.assertions[0]?.entities.join(",") !== "r1,r2,r3"
) {
  throw new Error(`node-interleaved topology path was not normalized: ${JSON.stringify(compiledNodePath?.report.issues)}`);
}
const misassignedSeriesPorts = structuredClone(seriesPathDoc) as Record<string, any>;
misassignedSeriesPorts.entities = [
  ...["a0", "a1", "b0", "b1", "c0", "c1"].map((id) => ({ id, kind: "point", role: "terminal" })),
  { id: "source", kind: "component", role: "ac_source" },
  { id: "load_1", kind: "component", role: "resistor" },
  { id: "load_2", kind: "component", role: "inductor" },
  ...["w01", "w12", "w20"].map((id) => ({ id, kind: "connector", role: "wire" })),
];
misassignedSeriesPorts.constructions = [
  ...[["a0", 0, 0], ["a1", 0, 2], ["b0", 2, 0], ["b1", 2, 2], ["c0", 4, 0], ["c1", 4, 2]]
    .map(([id, x, y]) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "layout" }, outputs: [id] })),
  { id: "make_source", operator: "symbol", inputs: { symbol: "ac_source", start: "a0", end: "a1" }, outputs: ["source"] },
  { id: "make_load_1", operator: "symbol", inputs: { symbol: "resistor", start: "b0", end: "b1" }, outputs: ["load_1"] },
  { id: "make_load_2", operator: "symbol", inputs: { symbol: "inductor", start: "c0", end: "c1" }, outputs: ["load_2"] },
  { id: "make_w01", operator: "connect", inputs: { start: "a1", end: "b1" }, outputs: ["w01"] },
  { id: "make_w12", operator: "connect", inputs: { start: "b1", end: "c1" }, outputs: ["w12"] },
  { id: "make_w20", operator: "connect", inputs: { start: "c0", end: "a0" }, outputs: ["w20"] },
];
misassignedSeriesPorts.assertions = [{
  id: "series_loop",
  predicate: "path",
  entities: ["source", "load_1", "load_2"],
  expected: true,
  severity: "fatal",
}];
misassignedSeriesPorts.requiredEntityIds = misassignedSeriesPorts.entities.map((entity: Record<string, unknown>) => entity.id);
misassignedSeriesPorts.revealGroups = [{ id: "setup", entityIds: misassignedSeriesPorts.requiredEntityIds }];
const repairedSeriesPortsDocument = validateSceneDocument(
  pruneDeadSceneEntities(misassignedSeriesPorts),
).document;
const repairedSeriesPortsCompiled = repairedSeriesPortsDocument
  ? compileSceneDocument(repairedSeriesPortsDocument)
  : null;
if (!repairedSeriesPortsCompiled?.ok) {
  throw new Error(`unique series terminal assignment was not repaired: ${JSON.stringify(repairedSeriesPortsCompiled?.report.issues)}`);
}
const poweredSeriesLoop = structuredClone(seriesPathDoc) as Record<string, any>;
poweredSeriesLoop.entities = poweredSeriesLoop.entities.map((entity: Record<string, unknown>) =>
  entity.id === "r1" ? { ...entity, role: "ac_source" } : entity,
);
poweredSeriesLoop.constructions = poweredSeriesLoop.constructions.map(
  (construction: Record<string, any>) =>
    construction.outputs?.[0] === "r1"
      ? { ...construction, inputs: { ...construction.inputs, symbol: "ac_source" } }
      : construction,
);
poweredSeriesLoop.entities.push({ id: "return_wire", kind: "connector", role: "return wire" });
poweredSeriesLoop.constructions.push({
  id: "make_return_wire",
  operator: "connect",
  inputs: { start: "n3", end: "n0" },
  outputs: ["return_wire"],
});
poweredSeriesLoop.requiredEntityIds.push("return_wire");
poweredSeriesLoop.revealGroups[0].entityIds.push("return_wire");
const poweredSeriesDocument = validateSceneDocument(poweredSeriesLoop).document;
const poweredSeriesCompiled = poweredSeriesDocument
  ? compileSceneDocument(poweredSeriesDocument)
  : null;
const returnWirePrimitive = poweredSeriesCompiled?.renderScene?.primitives.find(
  (primitive) => primitive.entityId === "return_wire",
);
if (
  !poweredSeriesCompiled?.ok ||
  !returnWirePrimitive?.points
) {
  throw new Error(`powered return path was rejected or not rendered: ${JSON.stringify({
    issues: poweredSeriesCompiled?.report.issues,
    returnWirePrimitive,
  })}`);
}
const poweredCircuitPlan = {
  schemaVersion: "turn-plan/v3" as const,
  question: "Draw a closed AC source and load circuit.",
  givens: [],
  unknowns: [],
  derived: [],
  qualitativeClaims: [],
  lawIds: ["closed circuit"],
  assumptions: [],
  visualRequirement: "required" as const,
};
if (
  !poweredSeriesDocument ||
  validateTurnPlanSceneProofs(poweredSeriesDocument, poweredCircuitPlan)
    .some((issue) => issue.severity === "fatal")
) {
  throw new Error("a closed powered component loop failed TurnPlanV3 proof");
}
const openPoweredSeries = structuredClone(poweredSeriesLoop) as Record<string, any>;
openPoweredSeries.entities = openPoweredSeries.entities.filter(
  (entity: Record<string, unknown>) => entity.id !== "return_wire",
);
openPoweredSeries.constructions = openPoweredSeries.constructions.filter(
  (construction: Record<string, any>) => construction.outputs?.[0] !== "return_wire",
);
openPoweredSeries.requiredEntityIds = openPoweredSeries.requiredEntityIds.filter(
  (id: string) => id !== "return_wire",
);
openPoweredSeries.revealGroups[0].entityIds = openPoweredSeries.revealGroups[0].entityIds.filter(
  (id: string) => id !== "return_wire",
);
const openPoweredDocument = validateSceneDocument(openPoweredSeries).document;
if (
  !openPoweredDocument ||
  !validateTurnPlanSceneProofs(openPoweredDocument, poweredCircuitPlan)
    .some((issue) => issue.code === "source_loop_not_closed")
) {
  throw new Error("an open powered circuit was accepted as a complete illustration");
}
const assertedClosedPoweredSeries = structuredClone(openPoweredSeries) as Record<string, any>;
assertedClosedPoweredSeries.source = { question: "Draw the complete closed series AC circuit" };
assertedClosedPoweredSeries.assertions.push({
  id: "complete_series_connection",
  predicate: "connected",
  entities: ["r1", "r2", "r3"],
  expected: true,
  severity: "fatal",
});
const repairedPoweredSeries = validateSceneDocument(
  pruneDeadSceneEntities(assertedClosedPoweredSeries),
).document;
if (
  !repairedPoweredSeries ||
  validateTurnPlanSceneProofs(repairedPoweredSeries, poweredCircuitPlan)
    .some((issue) => issue.code === "source_loop_not_closed") ||
  !repairedPoweredSeries.constructions.some((construction) =>
    construction.reason === "unique asserted powered-loop closure")
) {
  throw new Error("a uniquely repairable asserted powered loop was not closed");
}
const passiveShortcut = structuredClone(poweredSeriesLoop) as Record<string, any>;
passiveShortcut.entities = passiveShortcut.entities.map((entity: Record<string, unknown>) =>
  entity.id === "r1" ? { ...entity, role: "resistor" } : entity,
);
passiveShortcut.constructions = passiveShortcut.constructions.map(
  (construction: Record<string, any>) =>
    construction.outputs?.[0] === "r1"
      ? { ...construction, inputs: { ...construction.inputs, symbol: "resistor" } }
      : construction,
);
const passiveShortcutDocument = validateSceneDocument(passiveShortcut).document;
const passiveShortcutCompiled = passiveShortcutDocument
  ? compileSceneDocument(passiveShortcutDocument)
  : null;
if (
  passiveShortcutCompiled?.ok ||
  !passiveShortcutCompiled?.report.issues.some(
    (issue) => issue.code === "component_chain_bypassed",
  )
) {
  throw new Error("a passive-only component-chain shortcut was accepted");
}

const wiredSeriesPath = structuredClone(seriesPathDoc) as Record<string, any>;
wiredSeriesPath.entities = [
  ...["n0", "n1a", "n1b", "n2a", "n2b", "n3"].map((id) => ({ id, kind: "point", role: "terminal" })),
  ...["r1", "r2", "r3"].map((id) => ({ id, kind: "component", role: "resistor" })),
  ...["w12", "w23"].map((id) => ({ id, kind: "connector", role: "wire" })),
];
wiredSeriesPath.constructions = [
  ...["n0", "n1a", "n1b", "n2a", "n2b", "n3"].map((id, index) => ({
    id: `make_${id}`,
    operator: "point",
    inputs: { x: index, y: 0, coordinateSpace: "layout" },
    outputs: [id],
  })),
  { id: "make_r1", operator: "symbol", inputs: { symbol: "resistor", start: "n0", end: "n1a" }, outputs: ["r1"] },
  { id: "make_w12", operator: "connect", inputs: { start: "n1a", end: "n1b" }, outputs: ["w12"] },
  { id: "make_r2", operator: "symbol", inputs: { symbol: "resistor", start: "n1b", end: "n2a" }, outputs: ["r2"] },
  { id: "make_w23", operator: "connect", inputs: { start: "n2a", end: "n2b" }, outputs: ["w23"] },
  { id: "make_r3", operator: "symbol", inputs: { symbol: "resistor", start: "n2b", end: "n3" }, outputs: ["r3"] },
];
wiredSeriesPath.assertions = [{ id: "series_path", predicate: "path", entities: ["r1", "r2", "r3"], expected: true, severity: "fatal" }];
wiredSeriesPath.requiredEntityIds = wiredSeriesPath.entities.map((entity: any) => entity.id);
wiredSeriesPath.revealGroups = [{ id: "series", entityIds: wiredSeriesPath.requiredEntityIds, dependsOn: [], narrationCue: "series" }];
wiredSeriesPath.teachingTimeline = [{ id: "show", action: "reveal", targetId: "series", dependsOn: [], narrationIntent: "series" }];
const wiredSeriesDocument = validateSceneDocument(wiredSeriesPath).document;
const wiredSeriesCompiled = wiredSeriesDocument ? compileSceneDocument(wiredSeriesDocument) : null;
if (!wiredSeriesCompiled?.ok) {
  throw new Error(`wire-separated series components failed topology contraction: ${JSON.stringify(wiredSeriesCompiled?.report.issues)}`);
}

const parallelTopoDoc = structuredClone(seriesPathDoc) as Record<string, any>;
parallelTopoDoc.entities = [
  { id: "a", kind: "point", role: "terminal" },
  { id: "b", kind: "point", role: "terminal" },
  { id: "r1", kind: "component", role: "resistor" },
  { id: "r2", kind: "component", role: "resistor" },
  { id: "r3", kind: "component", role: "resistor" },
];
parallelTopoDoc.constructions = [
  { id: "pa", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["a"] },
  { id: "pb", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["b"] },
  { id: "make_r1", operator: "symbol", inputs: { symbol: "resistor", start: "a", end: "b" }, outputs: ["r1"] },
  { id: "make_r2", operator: "symbol", inputs: { symbol: "resistor", start: "a", end: "b" }, outputs: ["r2"] },
  { id: "make_r3", operator: "symbol", inputs: { symbol: "resistor", start: "a", end: "b" }, outputs: ["r3"] },
];
parallelTopoDoc.assertions = [
  { id: "same_pair", predicate: "sameTerminalPair", entities: ["r1", "r2", "r3"], expected: true, severity: "fatal" },
  { id: "paths", predicate: "pathCount", entities: ["a", "b"], expected: 3, severity: "fatal" },
  { id: "deg", predicate: "degree", entities: ["a"], expected: 3, severity: "fatal" },
];
parallelTopoDoc.requiredEntityIds = ["a", "b", "r1", "r2", "r3"];
parallelTopoDoc.revealGroups = [{ id: "setup", entityIds: parallelTopoDoc.requiredEntityIds, dependsOn: [], narrationCue: "parallel" }];
parallelTopoDoc.teachingTimeline = [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "parallel" }];
const validatedParallelTopo = validateSceneDocument(parallelTopoDoc);
if (!validatedParallelTopo.document) throw new Error(JSON.stringify(validatedParallelTopo.report.issues));
const parallelIssues: SceneIssue[] = [];
for (const assertion of validatedParallelTopo.document.assertions) {
  evaluateTopologyAssertion(assertion, validatedParallelTopo.document, parallelIssues);
}
if (parallelIssues.length > 0) {
  throw new Error(`parallel topology predicates failed: ${JSON.stringify(parallelIssues)}`);
}

const parallelTurnPlan = {
  schemaVersion: "turn-plan/v3" as const,
  question: "Compare three resistors in series and parallel",
  givens: [],
  unknowns: [],
  derived: [],
  qualitativeClaims: [],
  lawIds: ["series-resistance", "parallel-resistance"],
  assumptions: [],
  visualRequirement: "required" as const,
};
const falselyNamedParallel = structuredClone(seriesPathDoc) as Record<string, any>;
falselyNamedParallel.revealGroups = [{
  id: "parallel",
  entityIds: falselyNamedParallel.requiredEntityIds,
  dependsOn: [],
  narrationCue: "parallel circuit",
}];
falselyNamedParallel.teachingTimeline = [{
  id: "show_parallel",
  action: "reveal",
  targetId: "parallel",
  dependsOn: [],
  narrationIntent: "show parallel circuit",
}];
const falselyNamedParallelDocument = validateSceneDocument(falselyNamedParallel).document;
if (!falselyNamedParallelDocument || !validateTurnPlanSceneProofs(falselyNamedParallelDocument, {
  ...parallelTurnPlan,
  lawIds: ["parallel-resistance"],
}).some((issue) => issue.code === "turnplan_parallel_not_proven")) {
  throw new Error("TurnPlanV3 accepted a series chain presented as a parallel circuit");
}
if (validateTurnPlanSceneProofs(validated.document!, {
  ...parallelTurnPlan,
  lawIds: ["principal-ray-parallel-to-axis"],
}).length > 0) {
  throw new Error("a geometric parallel-ray law was misclassified as parallel-resistance topology");
}

const mixedSeriesParallel = structuredClone(parallelTopoDoc) as Record<string, any>;
mixedSeriesParallel.entities.push(
  { id: "source_node", kind: "point", role: "terminal" },
  { id: "series_resistor", kind: "component", role: "series resistor", label: "2 ohm" },
);
mixedSeriesParallel.constructions.push(
  { id: "make_source_node", operator: "point", inputs: { x: -2, y: 2, coordinateSpace: "layout" }, outputs: ["source_node"] },
  { id: "make_series_resistor", operator: "symbol", inputs: { symbol: "resistor", start: "source_node", end: "a" }, outputs: ["series_resistor"] },
);
mixedSeriesParallel.requiredEntityIds.push("source_node", "series_resistor");
mixedSeriesParallel.revealGroups[0].id = "complete_circuit";
mixedSeriesParallel.revealGroups[0].narrationCue = "one mixed network";
mixedSeriesParallel.revealGroups[0].entityIds.push("source_node", "series_resistor");
mixedSeriesParallel.teachingTimeline[0].targetId = "complete_circuit";
const mixedSeriesParallelDocument = validateSceneDocument(mixedSeriesParallel).document;
const mixedProofIssues = mixedSeriesParallelDocument
  ? validateTurnPlanSceneProofs(mixedSeriesParallelDocument, parallelTurnPlan)
  : [{ code: "invalid_test_scene" }];
if (mixedProofIssues.length > 0) {
  throw new Error(`mixed series-parallel topology required artificial view names: ${JSON.stringify(mixedProofIssues)}`);
}

const sceneWithDeadConnector = structuredClone(parallelTopoDoc) as Record<string, any>;
sceneWithDeadConnector.entities.push({ id: "dead_wire", kind: "connector", role: "unused wire" });
sceneWithDeadConnector.constructions.push({
  id: "make_dead_wire",
  operator: "connect",
  inputs: { start: "a", end: "b" },
  outputs: ["dead_wire"],
});
const rejectedDeadConnector = validateSceneDocument(sceneWithDeadConnector);
if (!rejectedDeadConnector.report.issues.some((issue) => issue.code === "unrequired_entity")) {
  throw new Error("strict validation accepted an unowned dead connector");
}
const prunedDeadConnector = validateSceneDocument(pruneDeadSceneEntities(sceneWithDeadConnector));
if (!prunedDeadConnector.document || !prunedDeadConnector.report.valid) {
  throw new Error(`dead scene output was not safely pruned: ${JSON.stringify(prunedDeadConnector.report.issues)}`);
}

const seriesWithRedundantLead = structuredClone(seriesPathDoc) as Record<string, any>;
seriesWithRedundantLead.entities.push({ id: "redundant_lead", kind: "connector", role: "connector" });
seriesWithRedundantLead.constructions.push({
  id: "make_redundant_lead",
  operator: "connect",
  inputs: { start: "n0", end: "n1" },
  outputs: ["redundant_lead"],
});
seriesWithRedundantLead.requiredEntityIds.push("redundant_lead");
seriesWithRedundantLead.revealGroups[0].entityIds.push("redundant_lead");
const normalizedRedundantLead = pruneDeadSceneEntities(seriesWithRedundantLead);
if ((normalizedRedundantLead.entities as Array<{ id: string }>).some((entity) => entity.id === "redundant_lead")) {
  throw new Error("planner artifact pruning retained an unclaimed direct component bypass");
}
const compiledNormalizedLead = validateSceneDocument(normalizedRedundantLead);
if (!compiledNormalizedLead.document || !compiledNormalizedLead.report.valid) {
  throw new Error(`unclaimed direct bypass was not safely normalized: ${JSON.stringify(compiledNormalizedLead.report.issues)}`);
}

const seriesWithClosingWire = structuredClone(seriesPathDoc) as Record<string, any>;
seriesWithClosingWire.entities.push({ id: "closing_wire", kind: "connector", role: "wire" });
seriesWithClosingWire.constructions.push({
  id: "make_closing_wire",
  operator: "connect",
  inputs: { start: "n3", end: "n0" },
  outputs: ["closing_wire"],
});
seriesWithClosingWire.requiredEntityIds.push("closing_wire");
seriesWithClosingWire.revealGroups[0].entityIds.push("closing_wire");
const normalizedClosingWire = pruneDeadSceneEntities(seriesWithClosingWire);
if ((normalizedClosingWire.entities as Array<{ id: string }>).some((entity) => entity.id === "closing_wire")) {
  throw new Error("an unreferenced connector closing an asserted component path was retained");
}
const compiledClosingWire = validateSceneDocument(normalizedClosingWire);
if (!compiledClosingWire.document || !compileSceneDocument(compiledClosingWire.document).ok) {
  throw new Error(`series path failed after closing-wire normalization: ${JSON.stringify(compiledClosingWire.report.issues)}`);
}

const seriesWithDuplicateLeads = structuredClone(seriesPathDoc) as Record<string, any>;
seriesWithDuplicateLeads.entities.push(
  { id: "lead_end", kind: "point", role: "terminal" },
  { id: "lead_a", kind: "connector", role: "wire" },
  { id: "lead_b", kind: "connector", role: "wire" },
  { id: "self_wire", kind: "connector", role: "wire" },
);
seriesWithDuplicateLeads.constructions.push(
  { id: "make_lead_end", operator: "point", inputs: { x: 4, y: 0, coordinateSpace: "layout" }, outputs: ["lead_end"] },
  { id: "make_lead_a", operator: "connect", inputs: { start: "n3", end: "lead_end" }, outputs: ["lead_a"] },
  { id: "make_lead_b", operator: "connect", inputs: { start: "n3", end: "lead_end" }, outputs: ["lead_b"] },
  { id: "make_self_wire", operator: "connect", inputs: { start: "lead_end", end: "lead_end" }, outputs: ["self_wire"] },
);
seriesWithDuplicateLeads.requiredEntityIds.push("lead_end", "lead_a", "lead_b", "self_wire");
seriesWithDuplicateLeads.revealGroups[0].entityIds.push("lead_end", "lead_a", "lead_b", "self_wire");
const normalizedDuplicateLeads = pruneDeadSceneEntities(seriesWithDuplicateLeads);
const normalizedLeadIds = new Set(
  (normalizedDuplicateLeads.entities as Array<{ id: string }>).map((entity) => entity.id),
);
if (!normalizedLeadIds.has("lead_a") || normalizedLeadIds.has("lead_b") || normalizedLeadIds.has("self_wire")) {
  throw new Error(`duplicate or zero-length connector normalization was not deterministic: ${JSON.stringify([...normalizedLeadIds])}`);
}
const compiledDuplicateLeads = validateSceneDocument(normalizedDuplicateLeads);
if (!compiledDuplicateLeads.document || !compileSceneDocument(compiledDuplicateLeads.document).ok) {
  throw new Error(`deduplicated connector scene failed: ${JSON.stringify(compiledDuplicateLeads.report.issues)}`);
}

const intentionalShort = structuredClone(seriesWithRedundantLead) as Record<string, any>;
intentionalShort.entities = intentionalShort.entities.map((entity: Record<string, unknown>) =>
  entity.id === "redundant_lead" ? { ...entity, role: "intentional short circuit" } : entity,
);
const retainedShort = pruneDeadSceneEntities(intentionalShort);
if (!(retainedShort.entities as Array<{ id: string }>).some((entity) => entity.id === "redundant_lead")) {
  throw new Error("planner artifact pruning removed an explicitly modeled short circuit");
}
const rejectedShort = validateSceneDocument(retainedShort);
const compiledShort = rejectedShort.document ? compileSceneDocument(rejectedShort.document) : null;
if (!compiledShort?.report.issues.some((issue) => issue.code === "component_bypassed")) {
  throw new Error("strict topology validation accepted an explicitly modeled component short");
}
const referencedHelper = structuredClone(sceneWithDeadConnector) as Record<string, any>;
referencedHelper.assertions.push({
  id: "dead_wire_is_referenced",
  predicate: "connected",
  entities: ["dead_wire", "a"],
  expected: true,
  severity: "fatal",
});
const retainedHelper = pruneDeadSceneEntities(referencedHelper);
if ((retainedHelper.entities as Array<{ id: string }>).some((entity) => entity.id === "dead_wire")) {
  throw new Error("a generic connectivity assertion retained a direct component bypass");
}
if ((retainedHelper.assertions as Array<{ id: string }>).some(
  (assertion) => assertion.id === "dead_wire_is_referenced",
)) {
  throw new Error("an assertion retained a pruned direct component bypass reference");
}
const declarationOnlyDead = structuredClone(parallelTopoDoc) as Record<string, any>;
declarationOnlyDead.entities.push({ id: "unused_point", kind: "point", role: "unused declaration" });
const prunedDeclaration = pruneDeadSceneEntities(declarationOnlyDead);
if ((prunedDeclaration.entities as Array<{ id: string }>).some((entity) => entity.id === "unused_point")) {
  throw new Error("dead-output pruning retained an unowned declaration-only entity");
}
const constructionLiteralCollision = structuredClone(parallelTopoDoc) as Record<string, any>;
constructionLiteralCollision.entities.push({
  id: "resistor",
  kind: "object",
  role: "unused duplicate declaration",
});
const prunedLiteralCollision = pruneDeadSceneEntities(constructionLiteralCollision);
if ((prunedLiteralCollision.entities as Array<{ id: string }>).some((entity) => entity.id === "resistor")) {
  throw new Error("a construction enum literal was mistaken for an entity reference");
}
const danglingAssertionReference = structuredClone(candidate) as Record<string, any>;
danglingAssertionReference.assertions.push({
  id: "unknown_length_reference",
  predicate: "equal_length",
  entities: ["am", "L"],
  expected: true,
  severity: "fatal",
});
const prunedDanglingAssertion = pruneDeadSceneEntities(danglingAssertionReference);
if ((prunedDanglingAssertion.assertions as Array<{ id: string }>).some(
  (assertion) => assertion.id === "unknown_length_reference",
)) {
  throw new Error("an assertion against a never-declared entity survived normalization");
}
if (!validateSceneDocument(prunedDanglingAssertion).document) {
  throw new Error("removing a never-executable assertion invalidated an otherwise valid scene");
}
const literalVectorAssertion = structuredClone(candidate) as Record<string, any>;
literalVectorAssertion.assertions.push({
  id: "literal_vector_subject",
  predicate: "opposite_direction",
  entities: ["am", [0, 0, 1]],
  expected: true,
  severity: "fatal",
});
const prunedLiteralVectorAssertion = pruneDeadSceneEntities(literalVectorAssertion);
if ((prunedLiteralVectorAssertion.assertions as Array<{ id: string }>).some(
  (assertion) => assertion.id === "literal_vector_subject",
)) {
  throw new Error("a literal vector masquerading as an entity reference survived normalization");
}
const redundantLabel = structuredClone(parallelTopoDoc) as Record<string, any>;
redundantLabel.entities.push({ id: "result_label", kind: "label", role: "annotation", label: "4 ohm" });
redundantLabel.requiredEntityIds.push("result_label");
redundantLabel.assertions.push({
  id: "result_attached",
  predicate: "label_attached",
  entities: ["result_label"],
  expected: true,
  severity: "warning",
});
redundantLabel.annotations = [{ id: "result_annotation", kind: "label", targetIds: ["b"], text: "4 ohm" }];
const normalizedLabel = pruneDeadSceneEntities(redundantLabel);
if ((normalizedLabel.entities as Array<{ id: string }>).some((entity) => entity.id === "result_label")) {
  throw new Error("redundant standalone label entity was not replaced by its real annotation");
}
if ((normalizedLabel.requiredEntityIds as string[]).includes("result_label")) {
  throw new Error("pruned standalone label remained required");
}

const wiredParallelDoc = structuredClone(seriesPathDoc) as Record<string, any>;
wiredParallelDoc.entities = [
  { id: "left", kind: "point", role: "junction" },
  { id: "right", kind: "point", role: "junction" },
  ...["l1", "l2", "l3", "r1n", "r2n", "r3n"].map((id) => ({ id, kind: "point", role: "branch terminal" })),
  ...["res1", "res2", "res3"].map((id) => ({ id, kind: "component", role: "resistor", label: "12 ohm" })),
  ...["wl1", "wl2", "wl3", "wr1", "wr2", "wr3"].map((id) => ({ id, kind: "connector", role: "junction wire" })),
];
wiredParallelDoc.constructions = [
  { id: "p_left", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "layout" }, outputs: ["left"] },
  { id: "p_right", operator: "point", inputs: { x: 5, y: 2, coordinateSpace: "layout" }, outputs: ["right"] },
  ...[["l1", 0], ["l2", 2], ["l3", 4]].map(([id, y]) => ({ id: `p_${id}`, operator: "point", inputs: { x: 1, y, coordinateSpace: "layout" }, outputs: [id] })),
  ...[["r1n", 0], ["r2n", 2], ["r3n", 4]].map(([id, y]) => ({ id: `p_${id}`, operator: "point", inputs: { x: 4, y, coordinateSpace: "layout" }, outputs: [id] })),
  ...[["res1", "l1", "r1n"], ["res2", "l2", "r2n"], ["res3", "l3", "r3n"]].map(([output, start, end]) => ({
    id: `make_${output}`,
    operator: "symbol",
    inputs: { symbol: "resistor", start, end },
    outputs: [output],
  })),
  ...[["wl1", "left", "l1"], ["wl2", "left", "l2"], ["wl3", "left", "l3"], ["wr1", "r1n", "right"], ["wr2", "r2n", "right"], ["wr3", "r3n", "right"]].map(([output, start, end]) => ({
    id: `make_${output}`,
    operator: "connect",
    inputs: { start, end },
    outputs: [output],
  })),
];
wiredParallelDoc.assertions = [{
  id: "three_paths",
  predicate: "pathCount",
  entities: ["left", "right"],
  expected: 3,
  severity: "fatal",
}];
wiredParallelDoc.annotations = [];
wiredParallelDoc.requiredEntityIds = wiredParallelDoc.entities.map((entity: any) => entity.id);
wiredParallelDoc.revealGroups = [{ id: "setup", entityIds: wiredParallelDoc.requiredEntityIds }];
wiredParallelDoc.teachingTimeline = [{ action: "reveal", targetId: "setup" }];
const validatedWiredParallel = validateSceneDocument(wiredParallelDoc);
const compiledWiredParallel = validatedWiredParallel.document
  ? compileSceneDocument(validatedWiredParallel.document)
  : null;
if (!compiledWiredParallel?.ok || !compiledWiredParallel.renderScene) {
  throw new Error(`connector-based parallel circuit failed: ${JSON.stringify(compiledWiredParallel?.report.issues ?? validatedWiredParallel.report.issues)}`);
}
if (validatedWiredParallel.document && validateTurnPlanSceneProofs(validatedWiredParallel.document, {
  ...parallelTurnPlan,
  lawIds: ["parallel-resistance"],
}).length > 0) {
  throw new Error(`connector-based parallel circuit failed TurnPlanV3 terminal contraction: ${JSON.stringify(
    validateTurnPlanSceneProofs(validatedWiredParallel.document, {
      ...parallelTurnPlan,
      lawIds: ["parallel-resistance"],
    }),
  )}`);
}
const indirectBypass = structuredClone(wiredParallelDoc) as Record<string, any>;
indirectBypass.entities.push(
  { id: "shortcut_mid", kind: "point", role: "junction" },
  { id: "shortcut_left", kind: "connector", role: "wire" },
  { id: "shortcut_right", kind: "connector", role: "wire" },
);
indirectBypass.constructions.push(
  { id: "p_shortcut", operator: "point", inputs: { x: 2.5, y: -1, coordinateSpace: "layout" }, outputs: ["shortcut_mid"] },
  { id: "make_shortcut_left", operator: "connect", inputs: { start: "l1", end: "shortcut_mid" }, outputs: ["shortcut_left"] },
  { id: "make_shortcut_right", operator: "connect", inputs: { start: "shortcut_mid", end: "r1n" }, outputs: ["shortcut_right"] },
);
indirectBypass.requiredEntityIds.push("shortcut_mid", "shortcut_left", "shortcut_right");
indirectBypass.revealGroups[0].entityIds.push("shortcut_mid", "shortcut_left", "shortcut_right");
const validatedIndirectBypass = validateSceneDocument(indirectBypass);
const compiledIndirectBypass = validatedIndirectBypass.document
  ? compileSceneDocument(validatedIndirectBypass.document)
  : null;
if (compiledIndirectBypass?.ok || !compiledIndirectBypass?.report.issues.some((issue) =>
  issue.code === "component_bypassed" && issue.entityIds?.includes("res1"))) {
  throw new Error("an indirect connector path across a component was accepted");
}

const compactCircuit = structuredClone(circuitCandidate) as Record<string, any>;
compactCircuit.entities = [
  { id: "top", kind: "point", role: "terminal" },
  { id: "mid", kind: "point", role: "midpoint" },
  { id: "bottom", kind: "point", role: "terminal" },
  { id: "battery", kind: "component", role: "battery" },
  { id: "r1", kind: "component", role: "resistor" },
  { id: "r2", kind: "component", role: "resistor" },
];
compactCircuit.constructions = [
  { id: "make_top", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "layout" }, outputs: ["top"] },
  { id: "make_mid", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["mid"] },
  { id: "make_bottom", operator: "point", inputs: { x: 0, y: -2, coordinateSpace: "layout" }, outputs: ["bottom"] },
  { id: "make_battery", operator: "symbol", inputs: { symbol: "battery", start: "top", end: "bottom" }, outputs: ["battery"] },
  { id: "make_r1", operator: "symbol", inputs: { symbol: "resistor", start: "top", end: "mid" }, outputs: ["r1"] },
  { id: "make_r2", operator: "symbol", inputs: { symbol: "resistor", start: "mid", end: "bottom" }, outputs: ["r2"] },
];
compactCircuit.assertions = [];
compactCircuit.annotations = [];
compactCircuit.requiredEntityIds = ["top", "mid", "bottom", "battery", "r1", "r2"];
compactCircuit.revealGroups = [{ id: "setup", entityIds: compactCircuit.requiredEntityIds }];
compactCircuit.teachingTimeline = [{ action: "reveal", targetId: "setup" }];
const normalizedCompact = validateSceneDocument(compactCircuit);
const compiledCompact = normalizedCompact.document
  ? compileSceneDocument(normalizedCompact.document)
  : null;
if (!compiledCompact?.ok || !compiledCompact.renderScene) {
  throw new Error(`compact topology layout failed: ${JSON.stringify(compiledCompact?.report.issues ?? normalizedCompact.report.issues)}`);
}
const compactTerminals = ["top", "mid", "bottom"].map((id) =>
  compiledCompact.renderScene!.primitives.find((primitive) => primitive.entityId === id)?.points[0],
);
if (new Set(compactTerminals.map((point) => point ? `${point.x}:${point.y}` : "missing")).size !== 3) {
  throw new Error("disconnected label/helper points disabled topology layout");
}

const shorthandCircuit = structuredClone(circuitCandidate) as Record<string, any>;
shorthandCircuit.visualDecision = "scene";
delete shorthandCircuit.entities[0].role;
shorthandCircuit.annotations = [{ id: "mid_label", kind: "label", targetId: "midpoint", text: "Vmid" }];
shorthandCircuit.requiredEntityIds.push("mid_label");
shorthandCircuit.revealGroups[0].entityIds.push("mid_label");
shorthandCircuit.teachingTimeline = [{ action: "reveal", target: "setup" }];
const normalizedCircuit = validateSceneDocument(shorthandCircuit);
if (!normalizedCircuit.document || normalizedCircuit.document.visualDecision.mode !== "scene") {
  throw new Error(`planner shorthand normalization failed: ${JSON.stringify(normalizedCircuit.report.issues)}`);
}
if (normalizedCircuit.document.requiredEntityIds.includes("mid_label")) {
  throw new Error("annotation id was not normalized to its target entity");
}

const invalid = structuredClone(candidate);
invalid.constructions[3]!.inputs = { a: "missing", b: "c" };
const failed = compileSceneDocument(validateSceneDocument(invalid).document!);
if (failed.ok || !failed.report.issues.some((issue) => issue.code === "construction_failed")) throw new Error("underspecified geometry did not fail closed");

const verboseLabel = structuredClone(candidate);
verboseLabel.entities[0]!.label = "Image (real, inverted, magnified)";
const verboseLabelResult = validateSceneDocument(verboseLabel);
if (!verboseLabelResult.document || !verboseLabelResult.report.issues.some((issue) => issue.code === "verbose_diagram_label")) {
  throw new Error("verbose prose did not produce a non-fatal annotation warning");
}

const plannerLabelNoise = {
  schemaVersion: "scene-document/v2",
  visualDecision: "scene",
  source: { question: "Show a body moving rightward through a field into the page." },
  quantities: [],
  entities: [
    { id: "tail", kind: "point" },
    { id: "tip", kind: "point" },
    { id: "velocity", kind: "vector", label: "velocity rightward" },
    { id: "field_anchor", kind: "point" },
  ],
  constructions: [
    { id: "make_tail", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["tail"] },
    { id: "make_tip", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "layout" }, outputs: ["tip"] },
    { id: "make_velocity", operator: "vector", inputs: { start: "tail", end: "tip" }, outputs: ["velocity"] },
    { id: "make_field_anchor", operator: "point", inputs: { x: 1, y: 2, coordinateSpace: "layout" }, outputs: ["field_anchor"] },
  ],
  relations: [],
  assertions: [],
  annotations: [
    { id: "velocity_label", kind: "label", targetIds: ["velocity"], text: "v = 4 m/s rightward", placementIntent: "above" },
    { id: "field_label", kind: "label", targetIds: ["field_anchor"], text: "B = 0.50 T (into page)", placementIntent: "above" },
  ],
  requiredEntityIds: ["velocity"],
  revealGroups: [{ id: "setup", entityIds: ["velocity"] }],
  teachingTimeline: [{ action: "reveal", targetId: "setup" }],
};
const normalizedPlannerLabelNoise = pruneDeadSceneEntities(plannerLabelNoise);
const normalizedPlannerAnnotations = normalizedPlannerLabelNoise.annotations as Array<{ kind: string }>;
if (normalizedPlannerAnnotations.some((annotation) => annotation.kind === "label")) {
  throw new Error("verbose planner labels were not moved out of the strict ink-label lane");
}
const plannerLabelNoiseDocument = validateSceneDocument(normalizedPlannerLabelNoise).document;
const plannerLabelNoiseCompiled = plannerLabelNoiseDocument
  ? compileSceneDocument(plannerLabelNoiseDocument)
  : null;
if (!plannerLabelNoiseCompiled?.ok || !plannerLabelNoiseCompiled.renderScene) {
  throw new Error(`planner label noise did not compile: ${JSON.stringify(plannerLabelNoiseCompiled?.report.issues)}`);
}
const velocityLabels = plannerLabelNoiseCompiled.renderScene.primitives.filter((primitive) =>
  primitive.kind === "label" && primitive.entityId === "velocity",
);
if (velocityLabels.length !== 1 || velocityLabels[0]?.text !== "v = 4 m/s") {
  throw new Error(`velocity received colliding or verbose labels: ${JSON.stringify(velocityLabels)}`);
}
if (plannerLabelNoiseCompiled.renderScene.primitives.some((primitive) =>
  primitive.entityId === "field_anchor" && primitive.kind !== "label")) {
  throw new Error("annotation-only helper point leaked into visible diagram ink");
}

const guessedReflection = structuredClone(candidate);
guessedReflection.entities[4]!.role = "reflected ray";
const guessedReflectionResult = validateSceneDocument(guessedReflection);
if (guessedReflectionResult.document || !guessedReflectionResult.report.issues.some((issue) => issue.code === "derived_role_operator_mismatch")) {
  throw new Error("a guessed line was accepted as a reflected ray");
}

const detachedReflection = structuredClone(candidate);
detachedReflection.entities.find((entity) => entity.id === "ab")!.role = "incident ray";
detachedReflection.constructions.find((construction) => construction.outputs.includes("ab"))!.operator = "vector";
detachedReflection.entities.push({ id: "reflected", kind: "ray", role: "reflected ray" });
detachedReflection.constructions.push({
  id: "make_reflected",
  operator: "reflect_direction",
  inputs: { origin: "c", incoming: "ab", normal: "ca" },
  outputs: ["reflected"],
});
detachedReflection.requiredEntityIds.push("reflected");
detachedReflection.revealGroups[0]!.entityIds.push("reflected");
const detachedDocument = validateSceneDocument(detachedReflection).document;
const detachedResult = detachedDocument ? compileSceneDocument(detachedDocument) : null;
if (detachedResult?.ok || !detachedResult?.report.issues.some((issue) => issue.code === "construction_failed")) {
  throw new Error("reflection accepted incoming geometry that misses its incidence point");
}

const explicitConvergence = structuredClone(candidate);
explicitConvergence.assertions = [{
  id: "sides_meet_at_a",
  predicate: "converges",
  entities: ["ab", "ca", "a"],
  expected: true,
  severity: "fatal",
}];
const convergenceDocument = validateSceneDocument(explicitConvergence).document;
const convergenceResult = convergenceDocument ? compileSceneDocument(convergenceDocument) : null;
if (!convergenceResult?.ok) {
  throw new Error(`explicit convergence target was not verified: ${JSON.stringify(convergenceResult?.report.issues)}`);
}

const authoritativePlan = validateTurnPlanV3({
  schemaVersion: "turn-plan/v3",
  question: "A resistance is 12 ohm.",
  givens: [{ id: "r", symbol: "R", value: 12, unit: "ohm", sign: "positive", provenance: "given" }],
  unknowns: [],
  derived: [],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
  visualRequirement: "optional",
}, "A resistance is 12 ohm.");
if (!authoritativePlan.valid || !authoritativePlan.plan) {
  throw new Error(`valid turn plan was rejected: ${JSON.stringify(authoritativePlan.issues)}`);
}
const unresolvedUnknown = validateTurnPlanV3({
  ...authoritativePlan.plan,
  unknowns: [{ id: "acceleration", symbol: "a", unit: "m/s^2" }],
  derived: [],
}, authoritativePlan.plan.question);
if (
  unresolvedUnknown.valid ||
  !unresolvedUnknown.issues.some((issue) => issue.code === "unresolved_numeric_unknown")
) {
  throw new Error("TurnPlanV3 accepted a requested numerical unknown without a finite result");
}
const unresolvedGreekUnknown = validateTurnPlanV3({
  ...authoritativePlan.plan,
  unknowns: [{ id: "phi", symbol: "φ", unit: "degree" }],
  derived: [{
    id: "omega",
    symbol: "ω",
    value: 100,
    unit: "rad/s",
    provenance: "derived",
  }],
}, authoritativePlan.plan.question);
if (
  unresolvedGreekUnknown.valid ||
  !unresolvedGreekUnknown.issues.some((issue) => issue.code === "unresolved_numeric_unknown")
) {
  throw new Error("empty normalized Greek symbols falsely resolved unrelated unknowns");
}
const qualitativeUnknown = validateTurnPlanV3({
  ...authoritativePlan.plan,
  unknowns: [{ id: "image_orientation", symbol: "image orientation" }],
  qualitativeClaims: [{
    id: "claim_inverted",
    claim: "image orientation",
    expected: "inverted",
  }],
}, authoritativePlan.plan.question);
if (!qualitativeUnknown.valid) {
  throw new Error(`TurnPlanV3 rejected a string-valued qualitative answer: ${JSON.stringify(qualitativeUnknown.issues)}`);
}
const booleanQualitativeUnknown = validateTurnPlanV3({
  ...authoritativePlan.plan,
  unknowns: [{ id: "image_type", symbol: "image type" }],
  qualitativeClaims: [{
    id: "image_real",
    claim: "image is real",
    expected: true,
  }],
}, authoritativePlan.plan.question);
if (!booleanQualitativeUnknown.valid) {
  throw new Error(`TurnPlanV3 rejected a boolean qualitative answer: ${JSON.stringify(booleanQualitativeUnknown.issues)}`);
}
const inconsistentSign = validateTurnPlanV3({
  ...authoritativePlan.plan,
  givens: [{ ...authoritativePlan.plan.givens[0], sign: "negative" }],
});
if (inconsistentSign.valid || !inconsistentSign.issues.some((issue) => issue.code === "sign_mismatch")) {
  throw new Error("turn plan accepted a sign that contradicts its numeric value");
}
const inconsistentClaimQuantity = validateTurnPlanV3({
  schemaVersion: "turn-plan/v3",
  question: "Find the angle of refraction.",
  givens: [{ id: "theta1", symbol: "theta_1", value: 45, unit: "°", provenance: "given" }],
  unknowns: [{ id: "theta2", symbol: "theta_2", unit: "°" }],
  derived: [{
    id: "theta2",
    symbol: "theta_2",
    value: 0.4714,
    unit: "°",
    provenance: "derived",
    dependsOn: ["theta1"],
    sourceText: "theta_2 = 0.4714°",
  }],
  qualitativeClaims: [{
    id: "refracted_angle",
    claim: "The refracted angle is approximately 28.1°.",
    expected: true,
    relatedQuantityIds: ["theta2"],
  }],
  lawIds: ["snell_law"],
  assumptions: [],
  visualRequirement: "required",
}, "Find the angle of refraction.");
if (
  inconsistentClaimQuantity.valid ||
  !inconsistentClaimQuantity.issues.some((issue) => issue.code === "claim_quantity_mismatch")
) {
  throw new Error("turn plan accepted a measured claim that contradicts its linked quantity");
}
const equivalentAngleClaim = validateTurnPlanV3({
  schemaVersion: "turn-plan/v3",
  question: "Find the phase angle.",
  givens: [],
  unknowns: [{ id: "phi", symbol: "phi", unit: "rad" }],
  derived: [{
    id: "phi",
    symbol: "phi",
    value: 0.6593100683328579,
    unit: "rad",
    provenance: "derived",
    sourceText: "phi = 0.6593100683328579 rad",
  }],
  qualitativeClaims: [{
    id: "inductive_phase",
    claim: "X_L = 62.83 ohm and the phase angle is 37.7757 degrees.",
    expected: "lags",
    relatedQuantityIds: ["phi"],
  }],
  lawIds: ["phase angle"],
  assumptions: [],
  visualRequirement: "required",
}, "Find the phase angle.");
if (!equivalentAngleClaim.valid) {
  throw new Error(`equivalent radian/degree claim was rejected: ${JSON.stringify(equivalentAngleClaim.issues)}`);
}
const contradictoryArithmetic = validateTurnPlanV3({
  schemaVersion: "turn-plan/v3",
  question: "Find the required power.",
  givens: [
    { id: "force", symbol: "F", value: 0.18, unit: "N", provenance: "given" },
    { id: "speed", symbol: "v", value: 4, unit: "m/s", provenance: "given" },
  ],
  unknowns: [{ id: "power", symbol: "P", unit: "W" }],
  derived: [{
    id: "power_value",
    symbol: "P",
    value: 2.4,
    unit: "W",
    provenance: "derived",
    dependsOn: ["force", "speed"],
    sourceText: "P = Fv = (0.18 N)(4 m/s) = 0.72 W; also P = (1.2 V)^2/(2 ohm) = 0.72 W",
  }],
  qualitativeClaims: [],
  lawIds: ["mechanical_power", "electrical_power"],
  assumptions: [],
  visualRequirement: "optional",
}, "Find the required power.");
if (
  contradictoryArithmetic.valid ||
  !contradictoryArithmetic.issues.some((issue) => issue.code === "source_text_value_mismatch")
) {
  throw new Error("turn plan accepted a derived value contradicted by its explicit arithmetic");
}
const conflictingArithmetic = validateTurnPlanV3({
  schemaVersion: "turn-plan/v3",
  question: "Check the calculation.",
  givens: [],
  unknowns: [],
  derived: [{
    id: "result",
    symbol: "Q",
    value: 6,
    unit: "J",
    provenance: "derived",
    sourceText: "Q = (2)(3) = 6 J; also Q = (2)(4) = 8 J",
  }],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
  visualRequirement: "none",
}, "Check the calculation.");
if (
  conflictingArithmetic.valid ||
  !conflictingArithmetic.issues.some((issue) => issue.code === "source_text_arithmetic_conflict")
) {
  throw new Error("turn plan accepted mutually inconsistent explicit calculation methods");
}
const invalidArithmetic = validateTurnPlanV3({
  schemaVersion: "turn-plan/v3",
  question: "Check the calculation.",
  givens: [],
  unknowns: [],
  derived: [{
    id: "result",
    symbol: "Q",
    value: 7,
    unit: "J",
    provenance: "derived",
    sourceText: "Q = (2)(4) = 7 J",
  }],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
  visualRequirement: "none",
}, "Check the calculation.");
if (
  invalidArithmetic.valid ||
  !invalidArithmetic.issues.some((issue) => issue.code === "source_text_arithmetic_invalid")
) {
  throw new Error("turn plan accepted an explicitly incorrect arithmetic calculation");
}
const descriptiveIntegralPlan = {
  schemaVersion: "turn-plan/v3",
  question: "Find the area enclosed by y=x^2 and y=4.",
  givens: [],
  unknowns: [{ id: "area", symbol: "A", unit: "square units" }],
  derived: [{
    id: "area",
    symbol: "A",
    value: 32,
    unit: "square units",
    provenance: "derived",
    sourceText: "Area = 2 * integral_0^2 (4-x^2) dx = 2 * (8-8/3) = 32/3 ≈ 10.6667",
  }],
  qualitativeClaims: [],
  lawIds: ["integration_area_between_curves"],
  assumptions: [],
  visualRequirement: "required",
};
const reconciledDescriptiveIntegral = reconcileTurnPlanV3ExplicitArithmetic(descriptiveIntegralPlan);
const reconciledArea = (reconciledDescriptiveIntegral.plan as typeof descriptiveIntegralPlan).derived[0]?.value;
if (
  Math.abs((reconciledArea ?? 0) - 32 / 3) > 1e-9 ||
  !validateTurnPlanV3(reconciledDescriptiveIntegral.plan, descriptiveIntegralPlan.question).valid
) {
  throw new Error("a descriptive calculus result was not reconciled to its explicit exact arithmetic");
}
const chainedArithmeticPlan = {
  schemaVersion: "turn-plan/v3",
  question: "Find impedance and current.",
  givens: [
    { id: "R", symbol: "R", value: 40, unit: "ohm", provenance: "given" },
    { id: "V", symbol: "V_rms", value: 200, unit: "V", provenance: "given" },
  ],
  unknowns: [
    { id: "Z", symbol: "Z", unit: "ohm" },
    { id: "I", symbol: "I_rms", unit: "A" },
  ],
  derived: [
    {
      id: "Xnet",
      symbol: "X_{net}",
      value: 31.00086445341679,
      unit: "ohm",
      provenance: "derived",
      sourceText: "X = 62.8318530718 - 31.8309886184 = 31.0008644534 ohm",
    },
    {
      id: "Z",
      symbol: "Z",
      value: 50.25,
      unit: "ohm",
      provenance: "derived",
      sourceText: "Z = sqrt(R^2 + X^2)",
    },
    {
      id: "I",
      symbol: "I_rms",
      value: 4.47213595499958,
      unit: "A",
      provenance: "derived",
      sourceText: "I_rms = V_rms / Z = 200 / 44.721359549995796",
    },
  ],
  qualitativeClaims: [],
  lawIds: ["impedance", "ohms_law"],
  assumptions: [],
  visualRequirement: "optional",
};
const reconciledChainedArithmetic = reconcileTurnPlanV3ExplicitArithmetic(chainedArithmeticPlan);
const reconciledChainedPlan = reconciledChainedArithmetic.plan as typeof chainedArithmeticPlan;
const reconciledZ = reconciledChainedPlan.derived.find((quantity) => quantity.id === "Z")?.value;
const reconciledI = reconciledChainedPlan.derived.find((quantity) => quantity.id === "I")?.value;
if (
  Math.abs((reconciledZ ?? 0) - 50.6068532598) > 1e-9 ||
  Math.abs((reconciledI ?? 0) - 3.95203390682) > 1e-9 ||
  !validateTurnPlanV3(reconciledChainedPlan, chainedArithmeticPlan.question).valid
) {
  throw new Error("symbolic chained arithmetic was not reconciled through corrected dependencies");
}
const adjacentSymbolPlan = {
  ...chainedArithmeticPlan,
  question: "Find angular frequency and inductive reactance.",
  givens: [
    { id: "f", symbol: "f", value: 50, unit: "Hz", provenance: "given" },
    { id: "L", symbol: "L", value: 0.2, unit: "H", provenance: "given" },
    { id: "C", symbol: "C", value: 0.0001, unit: "F", provenance: "given" },
  ],
  unknowns: [
    { id: "omega", symbol: "ω", unit: "rad/s" },
    { id: "XL", symbol: "X_L", unit: "ohm" },
  ],
  derived: [
    {
      id: "omega",
      symbol: "ω",
      value: 6.28,
      unit: "rad/s",
      provenance: "derived",
      sourceText: "ω = 2πf",
    },
    {
      id: "XL",
      symbol: "X_L",
      value: 1.256,
      unit: "ohm",
      provenance: "derived",
      sourceText: "X_L = ωL",
    },
  ],
};
const reconciledAdjacentPlan = reconcileTurnPlanV3ExplicitArithmetic(adjacentSymbolPlan)
  .plan as typeof adjacentSymbolPlan;
if (
  Math.abs(reconciledAdjacentPlan.derived[0]!.value - 100 * Math.PI) > 1e-9 ||
  Math.abs(reconciledAdjacentPlan.derived[1]!.value - 20 * Math.PI) > 1e-9 ||
  !validateTurnPlanV3(reconciledAdjacentPlan, adjacentSymbolPlan.question).valid
) {
  throw new Error("adjacent formula symbols or case-sensitive SI units corrupted arithmetic");
}
const nonlinearIntermediatePlan = {
  schemaVersion: "turn-plan/v3",
  question: "Find the angle of refraction.",
  givens: [
    { id: "theta1", symbol: "theta_1", value: 45, unit: "°", provenance: "given" },
    { id: "n2", symbol: "n_2", value: 1.5, unit: "", provenance: "given" },
  ],
  unknowns: [{ id: "theta2", symbol: "theta_2", unit: "°" }],
  derived: [{
    id: "theta2",
    symbol: "theta_2",
    value: 28.1255057021,
    unit: "°",
    provenance: "derived",
    dependsOn: ["theta1", "n2"],
    sourceText: "sin(theta_2) = sin(45*pi/180)/1.5 = 0.4714045208; theta_2 = 28.1255057021°",
  }],
  qualitativeClaims: [{
    id: "refracted_angle",
    claim: "The refracted angle is approximately 28.1255057021°.",
    expected: true,
    relatedQuantityIds: ["theta2"],
  }],
  lawIds: ["snell_law"],
  assumptions: [],
  visualRequirement: "required",
};
const nonlinearIntermediateReconciliation = reconcileTurnPlanV3ExplicitArithmetic(nonlinearIntermediatePlan);
const nonlinearIntermediateResult = nonlinearIntermediateReconciliation.plan as typeof nonlinearIntermediatePlan;
if (
  nonlinearIntermediateReconciliation.reconciliations.length !== 0 ||
  Math.abs(nonlinearIntermediateResult.derived[0]!.value - 28.1255057021) > 1e-10 ||
  !validateTurnPlanV3(nonlinearIntermediateResult, nonlinearIntermediatePlan.question).valid
) {
  throw new Error("a nonlinear intermediate was mistaken for the requested target value");
}
const incidentalEqualityPlan = structuredClone(nonlinearIntermediatePlan);
incidentalEqualityPlan.derived[0]!.sourceText =
  "Snell's law: n_air sinθ_i = n_glass sinθ_r, with n_air=1";
const incidentalEqualityReconciliation = reconcileTurnPlanV3ExplicitArithmetic(incidentalEqualityPlan);
const incidentalEqualityResult = incidentalEqualityReconciliation.plan as typeof incidentalEqualityPlan;
if (
  incidentalEqualityReconciliation.reconciliations.length !== 0 ||
  Math.abs(incidentalEqualityResult.derived[0]!.value - 28.1255057021) > 1e-10
) {
  throw new Error("an incidental assumption equality overwrote the requested result");
}
const inverseTrigDegreePlan = {
  ...nonlinearIntermediatePlan,
  question: "Find the phase angle of the series LCR circuit.",
  givens: [
    { id: "R", symbol: "R", value: 40, unit: "ohm", provenance: "given" },
  ],
  unknowns: [
    { id: "phi", symbol: "phi", unit: "deg" },
    { id: "P_avg", symbol: "P_avg", unit: "W" },
  ],
  derived: [
    {
      id: "phi",
      symbol: "phi",
      value: 37.77645789461688,
      unit: "deg",
      provenance: "derived",
      dependsOn: ["R"],
      sourceText: "phi = arctan((62.83185307179586 - 31.83098861837907)/40)",
    },
    {
      id: "P_avg",
      symbol: "P_avg",
      value: 624.7428800249404,
      unit: "W",
      provenance: "derived",
      dependsOn: ["R", "phi"],
      sourceText: "P_avg = 200 * 3.952033906816022 * cos(phi) = 3.952033906816022^2 * 40 = 624.7428800249404 W",
    },
  ],
  qualitativeClaims: [],
};
const inverseTrigDegreeReconciliation = reconcileTurnPlanV3ExplicitArithmetic(inverseTrigDegreePlan);
const inverseTrigDegreeResult = inverseTrigDegreeReconciliation.plan as typeof inverseTrigDegreePlan;
if (
  inverseTrigDegreeReconciliation.reconciliations.length !== 0 ||
  Math.abs(inverseTrigDegreeResult.derived[0]!.value - 37.77645789461688) > 1e-9 ||
  Math.abs(inverseTrigDegreeResult.derived[1]!.value - 624.7428800249404) > 1e-9 ||
  !validateTurnPlanV3(inverseTrigDegreeResult, inverseTrigDegreePlan.question).valid
) {
  throw new Error("degree-valued inverse trigonometry corrupted a downstream calculation");
}
const reciprocalEquationPlan = {
  schemaVersion: "turn-plan/v3",
  question: "Find the image distance and magnification.",
  givens: [
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given" },
    { id: "d_o", symbol: "d_o", value: 20, unit: "cm", provenance: "given" },
  ],
  unknowns: [
    { id: "d_i", symbol: "d_i", unit: "cm" },
    { id: "m", symbol: "m", unit: "dimensionless" },
  ],
  derived: [
    {
      id: "d_i_value",
      symbol: "d_i",
      value: 1 / 60,
      unit: "cm",
      sign: "positive",
      provenance: "derived",
      dependsOn: ["f", "d_o"],
      sourceText: "1/d_i = 1/f - 1/d_o = 1/15 - 1/20 = 1/60, so d_i = 0.0166666667 cm",
    },
    {
      id: "m_value",
      symbol: "m",
      value: -1 / 1200,
      unit: "dimensionless",
      sign: "negative",
      provenance: "derived",
      dependsOn: ["d_i_value", "d_o"],
      sourceText: "m = -d_i/d_o = -60/20 = -3",
    },
  ],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
  visualRequirement: "required",
};
const reciprocalReconciliation = reconcileTurnPlanV3ExplicitArithmetic(reciprocalEquationPlan);
const reciprocalReconciledPlan = reciprocalReconciliation.plan as typeof reciprocalEquationPlan;
if (
  Math.abs(reciprocalReconciledPlan.derived[0]!.value - 60) > 1e-8 ||
  Math.abs(reciprocalReconciledPlan.derived[1]!.value + 3) > 1e-8 ||
  reciprocalReconciliation.reconciliations.length !== 2 ||
  !validateTurnPlanV3(reciprocalReconciledPlan, reciprocalEquationPlan.question).valid
) {
  throw new Error(`single-variable reciprocal equations were not solved before downstream reconciliation: ${JSON.stringify({
    reconciliations: reciprocalReconciliation.reconciliations,
    derived: reciprocalReconciledPlan.derived,
    validation: validateTurnPlanV3(reciprocalReconciledPlan, reciprocalEquationPlan.question).issues,
  })}`);
}
const quantityMismatch = validateSceneQuantityAgreement(
  [{ id: "r", value: 10, unit: "ohm" }],
  authoritativePlan.plan,
);
if (!quantityMismatch.some((issue) => issue.code === "scene_quantity_mismatch")) {
  throw new Error("scene quantity disagreement with TurnPlanV3 was not rejected");
}
const dimensionlessAgreement = validateSceneQuantityAgreement(
  [{ id: "n2", value: 1.5, unit: "dimensionless" }],
  nonlinearIntermediatePlan,
);
if (dimensionlessAgreement.length > 0) {
  throw new Error(`blank and dimensionless scalar units disagreed: ${JSON.stringify(dimensionlessAgreement)}`);
}
const roundedAngleDisplay = validateSceneQuantityAgreement(
  [],
  nonlinearIntermediatePlan,
  ["theta_r = 28.1°"],
);
if (roundedAngleDisplay.length > 0) {
  throw new Error(`honestly rounded diagram value was rejected: ${JSON.stringify(roundedAngleDisplay)}`);
}
const recurringDecimalPlan = structuredClone(authoritativePlan.plan);
recurringDecimalPlan.derived = [{
  id: "area",
  symbol: "A",
  value: 10.66666666666667,
  unit: "square units",
  sign: "positive",
  provenance: "derived",
  sourceText: "A = 32/3",
}];
const equivalentRecurringDecimal = validateSceneQuantityAgreement(
  [{ id: "area", value: 10.666666666666668, unit: "square units" }],
  recurringDecimalPlan,
);
if (equivalentRecurringDecimal.length > 0) {
  throw new Error(`equivalent floating representations were rejected: ${JSON.stringify(equivalentRecurringDecimal)}`);
}
const wrongRecurringDecimal = validateSceneQuantityAgreement(
  [{ id: "area", value: 10.667, unit: "square units" }],
  recurringDecimalPlan,
);
if (!wrongRecurringDecimal.some((issue) => issue.code === "scene_quantity_mismatch")) {
  throw new Error("materially different recurring-decimal quantity was accepted");
}
const inventedDisplay = validateSceneQuantityAgreement(
  [{ id: "resistance", value: 12, unit: "Ω" }],
  authoritativePlan.plan,
  ["12 V"],
);
if (!inventedDisplay.some((issue) => issue.code === "displayed_quantity_unverified")) {
  throw new Error("an invented displayed measurement was not rejected");
}
const metricDisplayPlan = structuredClone(authoritativePlan.plan);
metricDisplayPlan.givens = [{
  id: "r",
  symbol: "r",
  value: 0.1,
  unit: "m",
  provenance: "given",
  sourceText: "10 cm",
}];
metricDisplayPlan.derived = [];
const equivalentMetricDisplay = validateSceneQuantityAgreement([], metricDisplayPlan, ["r = 10 cm"]);
if (equivalentMetricDisplay.length > 0) {
  throw new Error(`an equivalent metric display was rejected: ${JSON.stringify(equivalentMetricDisplay)}`);
}
const wrongMetricDisplay = validateSceneQuantityAgreement([], metricDisplayPlan, ["r = 11 cm"]);
if (!wrongMetricDisplay.some((issue) => issue.code === "displayed_quantity_unverified")) {
  throw new Error("a materially different metric display was accepted");
}
const forgedUnitlessQuantity = validateSceneQuantityAgreement(
  [{ id: "forged", value: 999 }],
  authoritativePlan.plan,
);
if (!forgedUnitlessQuantity.some((issue) => issue.code === "scene_quantity_unverified")) {
  throw new Error("an unplanned finite unitless quantity bypassed TurnPlan grounding");
}
const annotationPruningScene = structuredClone(validated.document!);
annotationPruningScene.annotations.push(
  { id: "supported_value", kind: "label", text: "12 ohm", targetIds: ["a"] },
  { id: "unsupported_value", kind: "label", text: "30 ohm", targetIds: ["b"] },
);
annotationPruningScene.teachingTimeline.push({
  id: "show_unsupported",
  action: "annotate",
  targetId: "unsupported_value",
  dependsOn: [],
  narrationIntent: "do not display an unverified value",
});
const prunedAnnotations = pruneUnverifiedSceneAnnotations(annotationPruningScene, authoritativePlan.plan);
if (
  !prunedAnnotations.annotations.some((annotation) => annotation.id === "supported_value") ||
  prunedAnnotations.annotations.some((annotation) => annotation.id === "unsupported_value") ||
  prunedAnnotations.teachingTimeline.some((action) => action.targetId === "unsupported_value")
) {
  throw new Error("unsupported optional measurement annotation was not pruned cleanly");
}
const qualitativeQuantityPlan = {
  ...authoritativePlan.plan,
  qualitativeClaims: [{
    id: "double_r",
    claim: "Twice the resistance is 24 ohm",
    expected: true,
    relatedQuantityIds: ["r"],
  }],
};
const groundedQualitativeQuantity = validateSceneQuantityAgreement(
  [{ id: "double_r", value: 24, unit: "ohm" }],
  qualitativeQuantityPlan,
  ["24 ohm"],
);
if (groundedQualitativeQuantity.length > 0) {
  throw new Error(`quantity grounded in an authoritative qualitative claim was rejected: ${JSON.stringify(groundedQualitativeQuantity)}`);
}

const physicalVectorPlan = {
  ...authoritativePlan.plan,
  visualRequirement: "required" as const,
};
const physicalVectorScene = structuredClone(validated.document!);
physicalVectorScene.source = { question: "Show friction and normal force on an incline" };
physicalVectorScene.entities = [
  { id: "surface_a", kind: "point", role: "incline endpoint" },
  { id: "surface_b", kind: "point", role: "incline endpoint" },
  { id: "incline_surface", kind: "segment", role: "inclined plane" },
  { id: "origin", kind: "point", role: "force origin" },
  { id: "normal_tip", kind: "point", role: "normal endpoint" },
  { id: "friction_tip", kind: "point", role: "friction endpoint" },
  { id: "normal_force", kind: "vector", role: "normal force" },
  { id: "friction_force", kind: "vector", role: "friction force" },
];
physicalVectorScene.constructions = [
  { id: "make_surface_a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["surface_a"] },
  { id: "make_surface_b", operator: "point", inputs: { x: 2, y: 1, coordinateSpace: "layout" }, outputs: ["surface_b"] },
  { id: "make_surface", operator: "segment", inputs: { start: "surface_a", end: "surface_b" }, outputs: ["incline_surface"] },
  { id: "make_origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["origin"] },
  { id: "make_normal_tip", operator: "point", inputs: { x: -1, y: 2, coordinateSpace: "layout" }, outputs: ["normal_tip"] },
  { id: "make_friction_tip", operator: "point", inputs: { x: -2, y: -1, coordinateSpace: "layout" }, outputs: ["friction_tip"] },
  { id: "make_normal", operator: "vector", inputs: { start: "origin", end: "normal_tip" }, outputs: ["normal_force"] },
  { id: "make_friction", operator: "vector", inputs: { start: "origin", end: "friction_tip" }, outputs: ["friction_force"] },
];
physicalVectorScene.relations = [];
physicalVectorScene.assertions = [];
physicalVectorScene.annotations = [];
physicalVectorScene.requiredEntityIds = physicalVectorScene.entities.map((entity) => entity.id);
physicalVectorScene.revealGroups = [{
  id: "setup",
  entityIds: physicalVectorScene.requiredEntityIds,
  dependsOn: [],
  narrationCue: "incline forces",
}];
physicalVectorScene.teachingTimeline = [{
  id: "show",
  action: "reveal",
  targetId: "setup",
  dependsOn: [],
  narrationIntent: "show incline forces",
}];
const layoutVectorIssues = validateTurnPlanSceneProofs(physicalVectorScene, physicalVectorPlan);
if (layoutVectorIssues.length > 0) {
  throw new Error(`a consistent layout-space vector network was not normalized for proof: ${JSON.stringify(layoutVectorIssues)}`);
}
for (const construction of physicalVectorScene.constructions) {
  if (construction.operator === "point") construction.inputs.coordinateSpace = "world";
}
if (validateTurnPlanSceneProofs(physicalVectorScene, physicalVectorPlan).length > 0) {
  throw new Error("valid incline force directions were rejected");
}
physicalVectorScene.constructions.find((construction) =>
  construction.outputs.includes("normal_tip"))!.inputs = {
    x: 2,
    y: 1,
    coordinateSpace: "world",
  };
if (!validateTurnPlanSceneProofs(physicalVectorScene, physicalVectorPlan)
  .some((issue) => issue.code === "physical_direction_relation_failed")) {
  throw new Error("a normal force parallel to its incline was not rejected");
}

const directedCycleScene = structuredClone(physicalVectorScene);
directedCycleScene.source = { question: "Draw a clockwise directed cycle" };
directedCycleScene.entities = [
  ...["a", "d", "c", "b"].map((id) => ({ id, kind: "point", role: "cycle vertex" })),
  ...["ad", "dc", "cb", "ba"].map((id) => ({ id, kind: "vector", role: "cycle direction arrow" })),
  { id: "velocity_start", kind: "point", role: "velocity origin" },
  { id: "velocity_end", kind: "point", role: "velocity endpoint" },
  { id: "velocity", kind: "vector", role: "velocity direction arrow" },
];
directedCycleScene.constructions = [
  { id: "make_a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["a"] },
  { id: "make_d", operator: "point", inputs: { x: 0, y: 1, coordinateSpace: "world" }, outputs: ["d"] },
  { id: "make_c", operator: "point", inputs: { x: 1, y: 1, coordinateSpace: "world" }, outputs: ["c"] },
  { id: "make_b", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "world" }, outputs: ["b"] },
  { id: "make_ad", operator: "vector", inputs: { start: "a", end: "d" }, outputs: ["ad"] },
  { id: "make_dc", operator: "vector", inputs: { start: "d", end: "c" }, outputs: ["dc"] },
  { id: "make_cb", operator: "vector", inputs: { start: "c", end: "b" }, outputs: ["cb"] },
  { id: "make_ba", operator: "vector", inputs: { start: "b", end: "a" }, outputs: ["ba"] },
  { id: "make_velocity_start", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["velocity_start"] },
  { id: "make_velocity_end", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["velocity_end"] },
  { id: "make_velocity", operator: "vector", inputs: { start: "velocity_start", end: "velocity_end" }, outputs: ["velocity"] },
];
directedCycleScene.requiredEntityIds = directedCycleScene.entities.map((entity) => entity.id);
directedCycleScene.revealGroups = [{
  id: "cycle",
  entityIds: directedCycleScene.requiredEntityIds,
  dependsOn: [],
  narrationCue: "clockwise cycle",
}];
directedCycleScene.teachingTimeline = [{
  id: "show_cycle",
  action: "reveal",
  targetId: "cycle",
  dependsOn: [],
  narrationIntent: "show the clockwise cycle",
}];
const clockwisePlan = {
  ...physicalVectorPlan,
  qualitativeClaims: [{
    id: "clockwise_cycle",
    claim: "the path is clockwise",
    expected: true,
  }],
};
if (validateTurnPlanSceneProofs(directedCycleScene, clockwisePlan).length > 0) {
  throw new Error("a valid clockwise cycle was rejected");
}
for (const construction of directedCycleScene.constructions) {
  if (construction.operator !== "vector") continue;
  const start = construction.inputs.start;
  construction.inputs.start = construction.inputs.end;
  construction.inputs.end = start;
}
if (!validateTurnPlanSceneProofs(directedCycleScene, clockwisePlan)
  .some((issue) => issue.code === "directed_cycle_orientation_failed")) {
  throw new Error("a counterclockwise cycle satisfied a clockwise TurnPlan claim");
}

const closedRoutePlan = {
  ...physicalVectorPlan,
  question: "A moving rod is one side of a rectangular conducting loop.",
  givens: [],
  assumptions: ["circuit forms rectangular loop with rod as one side"],
  qualitativeClaims: [{
    id: "route_direction",
    claim: "Current is counterclockwise in the loop (up through rod, left through top rail, down through resistor, right through bottom rail)",
    expected: "verified",
    relatedEntityHints: ["rod", "rails", "resistor"],
  }],
};
const detachedLoopMemberScene = structuredClone(directedCycleScene);
detachedLoopMemberScene.source = { question: closedRoutePlan.question };
detachedLoopMemberScene.entities = [
  ...["top_left", "top_right", "bottom_left", "bottom_right", "rod_left", "rod_right"]
    .map((id) => ({ id, kind: "point", role: "route terminal" })),
  { id: "top_rail", kind: "segment", role: "top rail" },
  { id: "bottom_rail", kind: "segment", role: "bottom rail" },
  { id: "right_rail", kind: "segment", role: "right rail" },
  { id: "resistor", kind: "component", role: "resistor" },
  { id: "rod", kind: "segment", role: "moving rod" },
];
detachedLoopMemberScene.constructions = [
  { id: "p_tl", operator: "point", inputs: { x: 0, y: 1, coordinateSpace: "world" }, outputs: ["top_left"] },
  { id: "p_tr", operator: "point", inputs: { x: 2, y: 1, coordinateSpace: "world" }, outputs: ["top_right"] },
  { id: "p_bl", operator: "point", inputs: { x: 0, y: -1, coordinateSpace: "world" }, outputs: ["bottom_left"] },
  { id: "p_br", operator: "point", inputs: { x: 2, y: -1, coordinateSpace: "world" }, outputs: ["bottom_right"] },
  { id: "p_rl", operator: "point", inputs: { x: 0.8, y: 1, coordinateSpace: "world" }, outputs: ["rod_left"] },
  { id: "p_rr", operator: "point", inputs: { x: 1.4, y: 1, coordinateSpace: "world" }, outputs: ["rod_right"] },
  { id: "make_top", operator: "segment", inputs: { start: "top_left", end: "top_right" }, outputs: ["top_rail"] },
  { id: "make_bottom", operator: "segment", inputs: { start: "bottom_left", end: "bottom_right" }, outputs: ["bottom_rail"] },
  { id: "make_right", operator: "segment", inputs: { start: "top_right", end: "bottom_right" }, outputs: ["right_rail"] },
  { id: "make_resistor", operator: "symbol", inputs: { symbol: "resistor", start: "top_left", end: "bottom_left" }, outputs: ["resistor"] },
  { id: "make_rod", operator: "segment", inputs: { start: "rod_left", end: "rod_right" }, outputs: ["rod"] },
];
detachedLoopMemberScene.requiredEntityIds = detachedLoopMemberScene.entities.map((entity) => entity.id);
detachedLoopMemberScene.revealGroups = [{
  id: "setup",
  entityIds: detachedLoopMemberScene.requiredEntityIds,
  dependsOn: [],
  narrationCue: "show the loop",
}];
detachedLoopMemberScene.teachingTimeline = [{
  id: "show_setup",
  action: "reveal",
  targetId: "setup",
  dependsOn: [],
  narrationIntent: "show the loop",
}];
const detachedLoopIssues = validateTurnPlanSceneProofs(detachedLoopMemberScene, closedRoutePlan);
if (!detachedLoopIssues.some((issue) => issue.code === "turnplan_loop_member_not_proven") ||
    !detachedLoopIssues.some((issue) => issue.code === "turnplan_route_direction_not_proven")) {
  throw new Error(`a detached, wrongly oriented named loop side was accepted: ${JSON.stringify(detachedLoopIssues)}`);
}

const validNamedLoopMemberScene = structuredClone(detachedLoopMemberScene);
validNamedLoopMemberScene.entities = validNamedLoopMemberScene.entities.filter((entity) =>
  !["rod_left", "rod_right", "right_rail"].includes(entity.id));
validNamedLoopMemberScene.constructions = validNamedLoopMemberScene.constructions
  .filter((construction) => !["p_rl", "p_rr", "make_right"].includes(construction.id));
validNamedLoopMemberScene.constructions.find((construction) =>
  construction.outputs.includes("rod"))!.inputs = { start: "bottom_right", end: "top_right" };
validNamedLoopMemberScene.requiredEntityIds = validNamedLoopMemberScene.entities.map((entity) => entity.id);
validNamedLoopMemberScene.revealGroups[0]!.entityIds = validNamedLoopMemberScene.requiredEntityIds;
if (validateTurnPlanSceneProofs(validNamedLoopMemberScene, closedRoutePlan).length > 0) {
  throw new Error("a named edge on a non-degenerate closed route was rejected");
}

const acrossClosedRoutePlan = structuredClone(closedRoutePlan);
acrossClosedRoutePlan.qualitativeClaims[0]!.claim =
  "Current is counterclockwise in the loop (up through rod, left across top rail, down through resistor, right across bottom rail)";
const compiledClosedRouteScene = normalizeClaimedClosedRouteGeometry(
  detachedLoopMemberScene,
  acrossClosedRoutePlan,
);
const compiledClosedRouteValidation = validateSceneDocument(compiledClosedRouteScene);
const compiledClosedRouteIssues = compiledClosedRouteValidation.document
  ? validateTurnPlanSceneProofs(compiledClosedRouteValidation.document, acrossClosedRoutePlan)
  : compiledClosedRouteValidation.report.issues;
if (
  compiledClosedRouteIssues.some((issue) => issue.severity === "fatal") ||
  compiledClosedRouteScene.constructions.find((construction) =>
    construction.outputs.includes("rod"))?.operator !== "segment" ||
  compiledClosedRouteScene.constructions.find((construction) =>
    construction.outputs.includes("resistor"))?.operator !== "symbol" ||
  compiledClosedRouteScene.entities.some((entity) => entity.id === "right_rail")
) {
  throw new Error(
    `an authoritative ordered route was not compiled into one minimal semantic cycle: ${JSON.stringify(compiledClosedRouteIssues)}`,
  );
}
const partialClosedRoutePlan = structuredClone(closedRoutePlan);
partialClosedRoutePlan.qualitativeClaims[0] = {
  id: "partial_route",
  claim: "Current direction is counterclockwise in the loop (upward through the rod)",
  expected: true,
  relatedEntityHints: ["rod", "resistor", "rails"],
};
const partialRouteWithDecoration = structuredClone(detachedLoopMemberScene);
partialRouteWithDecoration.entities.push({ id: "loop_outline", kind: "polygon", role: "circuit loop" });
partialRouteWithDecoration.constructions.push({
  id: "make_loop_outline",
  operator: "polygon",
  inputs: { points: ["top_left", "top_right", "bottom_right", "bottom_left"] },
  outputs: ["loop_outline"],
});
partialRouteWithDecoration.requiredEntityIds.push("loop_outline");
partialRouteWithDecoration.revealGroups[0]!.entityIds.push("loop_outline");
const compiledPartialRouteScene = normalizeClaimedClosedRouteGeometry(
  partialRouteWithDecoration,
  partialClosedRoutePlan,
);
const compiledPartialRouteValidation = validateSceneDocument(compiledPartialRouteScene);
const compiledPartialRouteIssues = compiledPartialRouteValidation.document
  ? validateTurnPlanSceneProofs(compiledPartialRouteValidation.document, partialClosedRoutePlan)
  : compiledPartialRouteValidation.report.issues;
if (
  compiledPartialRouteIssues.some((issue) => issue.severity === "fatal") ||
  compiledPartialRouteScene.entities.some((entity) => entity.id === "loop_outline")
) {
  throw new Error(
    `a four-edge loop was not synthesized from a directed anchor and semantic members: ${JSON.stringify(compiledPartialRouteIssues)}`,
  );
}

const assertedDimensionBinding = structuredClone(validNamedLoopMemberScene) as Record<string, any>;
assertedDimensionBinding.entities.push({ id: "rod_dimension", kind: "dimension", role: "rod length" });
assertedDimensionBinding.constructions.push({
  id: "make_rod_dimension",
  operator: "dimension",
  inputs: { start: "top_left", end: "top_right" },
  outputs: ["rod_dimension"],
});
assertedDimensionBinding.assertions.push({
  id: "dimension_matches_rod",
  predicate: "equal_length",
  entities: ["rod", "rod_dimension"],
  expected: true,
  severity: "fatal",
});
assertedDimensionBinding.requiredEntityIds.push("rod_dimension");
assertedDimensionBinding.revealGroups[0].entityIds.push("rod_dimension");
const normalizedDimensionBinding = pruneDeadSceneEntities(assertedDimensionBinding);
const normalizedDimensionConstruction = (
  normalizedDimensionBinding.constructions as Array<Record<string, any>>
).find((construction) => construction.outputs?.includes("rod_dimension"));
if (
  normalizedDimensionConstruction?.inputs?.start !== "bottom_right" ||
  normalizedDimensionConstruction.inputs.end !== "top_right"
) {
  throw new Error("an asserted dimension was not bound to its owning path endpoints");
}

const unhintedClosedRoutePlan = structuredClone(closedRoutePlan);
unhintedClosedRoutePlan.assumptions = [];
delete unhintedClosedRoutePlan.qualitativeClaims[0]!.relatedEntityHints;
const unhintedDetachedLoopIssues = validateTurnPlanSceneProofs(
  detachedLoopMemberScene,
  unhintedClosedRoutePlan,
);
if (!unhintedDetachedLoopIssues.some((issue) => issue.code === "turnplan_loop_member_not_proven")) {
  throw new Error(
    `a route member named only in the claim text escaped loop validation: ${JSON.stringify(unhintedDetachedLoopIssues)}`,
  );
}
const naturalCurrentDirectionPlan = structuredClone(unhintedClosedRoutePlan);
naturalCurrentDirectionPlan.qualitativeClaims[0]!.claim =
  "Current direction in rod is upward from the bottom rail to the top rail, counterclockwise in the loop";
const naturalCurrentDirectionIssues = validateTurnPlanSceneProofs(
  detachedLoopMemberScene,
  naturalCurrentDirectionPlan,
);
if (!naturalCurrentDirectionIssues.some((issue) => issue.code === "turnplan_loop_member_not_proven")) {
  throw new Error(
    `natural current-direction language did not bind its named loop member: ${JSON.stringify(naturalCurrentDirectionIssues)}`,
  );
}

const bypassedLoopMemberScene = structuredClone(validNamedLoopMemberScene);
bypassedLoopMemberScene.entities.push({
  id: "resistor_bypass",
  kind: "segment",
  role: "plain wire bypassing resistor",
});
bypassedLoopMemberScene.constructions.push({
  id: "make_resistor_bypass",
  operator: "segment",
  inputs: { start: "top_left", end: "bottom_left" },
  outputs: ["resistor_bypass"],
});
bypassedLoopMemberScene.requiredEntityIds.push("resistor_bypass");
bypassedLoopMemberScene.revealGroups[0]!.entityIds.push("resistor_bypass");
const bypassedLoopIssues = validateTurnPlanSceneProofs(bypassedLoopMemberScene, closedRoutePlan);
if (!bypassedLoopIssues.some((issue) => issue.code === "turnplan_loop_member_bypassed")) {
  throw new Error(`a component overlaid by a plain route edge was accepted: ${JSON.stringify(bypassedLoopIssues)}`);
}

const connectorMasqueradingAsComponent = structuredClone(validNamedLoopMemberScene);
connectorMasqueradingAsComponent.constructions.find((construction) =>
  construction.outputs.includes("resistor"))!.operator = "connect";
const connectorComponentValidation = validateSceneDocument(connectorMasqueradingAsComponent);
if (!connectorComponentValidation.report.issues.some((issue) =>
  issue.code === "component_requires_symbol_operator")) {
  throw new Error("a plain connector masquerading as a component passed schema validation");
}
const normalizedConnectorComponent = pruneDeadSceneEntities(connectorMasqueradingAsComponent);
const normalizedResistorConstruction = (
  normalizedConnectorComponent.constructions as Array<Record<string, any>>
).find((construction) =>
  Array.isArray(construction.outputs) && construction.outputs.includes("resistor"));
if (
  normalizedResistorConstruction?.operator !== "symbol" ||
  normalizedResistorConstruction.inputs?.symbol !== "resistor"
) {
  throw new Error("an unambiguous resistor connector was not normalized to the symbol operator");
}
if (!validateSceneDocument(normalizedConnectorComponent).document) {
  throw new Error("component operator normalization invalidated an otherwise coherent scene");
}

const pageNormalPlan = {
  ...closedRoutePlan,
  givens: [{
    id: "B",
    symbol: "B",
    value: 0.5,
    unit: "T",
    provenance: "given" as const,
    sourceText: "uniform magnetic field B is directed into the page",
  }],
};
const inPlaneFieldScene = structuredClone(validNamedLoopMemberScene);
inPlaneFieldScene.entities.push(
  { id: "field_anchor", kind: "point", role: "field anchor" },
  { id: "field_tip", kind: "point", role: "field endpoint" },
  { id: "B_field", kind: "vector", role: "magnetic field", label: "B" },
);
inPlaneFieldScene.constructions.push(
  { id: "p_field", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "world" }, outputs: ["field_anchor"] },
  { id: "p_field_tip", operator: "point", inputs: { x: 1, y: -0.5, coordinateSpace: "world" }, outputs: ["field_tip"] },
  { id: "make_field", operator: "vector", inputs: { start: "field_anchor", end: "field_tip", direction: [0, -1] }, outputs: ["B_field"] },
);
inPlaneFieldScene.requiredEntityIds.push("field_anchor", "field_tip", "B_field");
inPlaneFieldScene.revealGroups[0]!.entityIds = inPlaneFieldScene.requiredEntityIds;
if (!validateTurnPlanSceneProofs(inPlaneFieldScene, pageNormalPlan)
  .some((issue) => issue.code === "physical_page_normal_rendered_in_plane")) {
  throw new Error("an into-page field was accepted as an ordinary in-plane arrow");
}
const markedFieldScene = structuredClone(inPlaneFieldScene);
markedFieldScene.entities.find((entity) => entity.id === "B_field")!.kind = "label";
markedFieldScene.constructions.find((construction) =>
  construction.outputs.includes("B_field"))!.operator = "label";
markedFieldScene.constructions.find((construction) =>
  construction.outputs.includes("B_field"))!.inputs = { target: "field_anchor", text: "×" };
if (validateTurnPlanSceneProofs(markedFieldScene, pageNormalPlan).length > 0) {
  throw new Error("a deterministic into-page cross marker was rejected");
}
markedFieldScene.constructions.find((construction) =>
  construction.outputs.includes("B_field"))!.inputs = { target: "field_anchor", text: "•" };
if (!validateTurnPlanSceneProofs(markedFieldScene, pageNormalPlan)
  .some((issue) => issue.code === "physical_page_normal_direction_not_proven")) {
  throw new Error("an out-of-page dot satisfied an into-page field requirement");
}

const twoLoopEntities = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({
  id,
  kind: "point",
  role: "terminal",
}));
const twoLoopEdges = ["ab", "bc", "cd", "da", "ef", "fg", "gh", "he"].map((id) => ({
  id,
  kind: "component",
  role: "resistor",
}));
const twoLoops = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "two independent circuit views" },
  source: { question: "draw two separate loops" },
  quantities: [],
  entities: [...twoLoopEntities, ...twoLoopEdges],
  constructions: [
    { id: "pa", operator: "point", inputs: { x: 0, y: 4, coordinateSpace: "layout" }, outputs: ["a"] },
    { id: "pb", operator: "point", inputs: { x: 4, y: 4, coordinateSpace: "layout" }, outputs: ["b"] },
    { id: "pc", operator: "point", inputs: { x: 4, y: 1, coordinateSpace: "layout" }, outputs: ["c"] },
    { id: "pd", operator: "point", inputs: { x: 0, y: 1, coordinateSpace: "layout" }, outputs: ["d"] },
    { id: "pe", operator: "point", inputs: { x: 0, y: -1, coordinateSpace: "layout" }, outputs: ["e"] },
    { id: "pf", operator: "point", inputs: { x: 4, y: -1, coordinateSpace: "layout" }, outputs: ["f"] },
    { id: "pg", operator: "point", inputs: { x: 4, y: -4, coordinateSpace: "layout" }, outputs: ["g"] },
    { id: "ph", operator: "point", inputs: { x: 0, y: -4, coordinateSpace: "layout" }, outputs: ["h"] },
    ...[["a", "b", "ab"], ["b", "c", "bc"], ["c", "d", "cd"], ["d", "a", "da"],
      ["e", "f", "ef"], ["f", "g", "fg"], ["g", "h", "gh"], ["h", "e", "he"]]
      .map(([start, end, output]) => ({
        id: `make_${output}`,
        operator: "symbol",
        inputs: { symbol: "resistor", start, end },
        outputs: [output],
      })),
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: [...twoLoopEntities, ...twoLoopEdges].map((entity) => entity.id),
  revealGroups: [{
    id: "views",
    entityIds: [...twoLoopEntities, ...twoLoopEdges].map((entity) => entity.id),
    dependsOn: [],
    narrationCue: "two views",
  }],
  teachingTimeline: [{
    id: "show_views",
    action: "reveal",
    targetId: "views",
    dependsOn: [],
    narrationIntent: "show two views",
  }],
};
const twoLoopsDocument = validateSceneDocument(twoLoops).document;
const twoLoopsCompiled = twoLoopsDocument ? compileSceneDocument(twoLoopsDocument) : null;
if (!twoLoopsCompiled?.ok || !twoLoopsCompiled.renderScene) {
  throw new Error(`two independent loops did not compile: ${JSON.stringify(twoLoopsCompiled?.report.issues)}`);
}
const upperY = ["a", "b", "c", "d"].reduce((sum, id) =>
  sum + twoLoopsCompiled.renderScene!.primitives.find((primitive) => primitive.entityId === id)!.points[0]!.y, 0) / 4;
const lowerY = ["e", "f", "g", "h"].reduce((sum, id) =>
  sum + twoLoopsCompiled.renderScene!.primitives.find((primitive) => primitive.entityId === id)!.points[0]!.y, 0) / 4;
if (Math.abs(upperY - lowerY) < 120) {
  throw new Error("independent closed views collapsed onto one shared polygon");
}

const packedViews = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "separate series and parallel views" },
  source: { question: "compare series and parallel" },
  quantities: [],
  entities: [
    ...["s0", "s1", "s2", "s3", "pl", "pr"].map((id) => ({ id, kind: "point", role: "terminal" })),
    ...["sr1", "sr2", "sr3", "pr1", "pr2", "pr3"].map((id, index) => ({
      id,
      kind: "component",
      role: "resistor",
      label: `R${index % 3 + 1}`,
    })),
  ],
  constructions: [
    ...[["s0", 0], ["s1", 2], ["s2", 4], ["s3", 6]].map(([id, x]) => ({
      id: `make_${id}`,
      operator: "point",
      inputs: { x, y: 5, coordinateSpace: "layout" },
      outputs: [id],
    })),
    ...[["pl", 0], ["pr", 6]].map(([id, x]) => ({
      id: `make_${id}`,
      operator: "point",
      inputs: { x, y: 5, coordinateSpace: "layout" },
      outputs: [id],
    })),
    ...[["sr1", "s0", "s1"], ["sr2", "s1", "s2"], ["sr3", "s2", "s3"],
      ["pr1", "pl", "pr"], ["pr2", "pl", "pr"], ["pr3", "pl", "pr"]]
      .map(([output, start, end]) => ({
        id: `make_${output}`,
        operator: "symbol",
        inputs: { symbol: "resistor", start, end },
        outputs: [output],
      })),
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["s0", "s1", "s2", "s3", "pl", "pr", "sr1", "sr2", "sr3", "pr1", "pr2", "pr3"],
  revealGroups: [
    { id: "series", entityIds: ["s0", "s1", "s2", "s3", "sr1", "sr2", "sr3"] },
    { id: "parallel", entityIds: ["pl", "pr", "pr1", "pr2", "pr3"] },
  ],
  teachingTimeline: [
    { action: "reveal", targetId: "series" },
    { action: "reveal", targetId: "parallel" },
  ],
};
const packedViewsDocument = validateSceneDocument(packedViews).document;
const packedViewsCompiled = packedViewsDocument ? compileSceneDocument(packedViewsDocument) : null;
if (!packedViewsCompiled?.ok || !packedViewsCompiled.renderScene) {
  throw new Error(`disconnected view packing failed: ${JSON.stringify(packedViewsCompiled?.report.issues)}`);
}
const packedViewProofIssues = packedViewsDocument
  ? validateTurnPlanSceneProofs(packedViewsDocument, parallelTurnPlan)
  : [];
if (packedViewProofIssues.length > 0) {
  throw new Error(`valid series/parallel views failed TurnPlanV3 proofs: ${JSON.stringify(packedViewProofIssues)}`);
}
const primitiveYBounds = (groupId: string) => {
  const points = packedViewsCompiled.renderScene!.primitives
    .filter((primitive) => primitive.groupId === groupId && primitive.kind !== "label")
    .flatMap((primitive) => primitive.points);
  return { min: Math.min(...points.map((point) => point.y)), max: Math.max(...points.map((point) => point.y)) };
};
const seriesBounds = primitiveYBounds("series");
const parallelBounds = primitiveYBounds("parallel");
if (parallelBounds.min - seriesBounds.max < 32) {
  throw new Error(`packed views overlap: ${JSON.stringify({ seriesBounds, parallelBounds })}`);
}
for (const entityId of ["sr1", "sr2", "sr3", "pr1", "pr2", "pr3"]) {
  const ownerInk = packedViewsCompiled.renderScene.primitives
    .filter((primitive) => primitive.entityId === entityId && primitive.kind !== "label")
    .flatMap((primitive) => primitive.points);
  const labelPoint = packedViewsCompiled.renderScene.primitives
    .find((primitive) => primitive.entityId === entityId && primitive.kind === "label")?.points[0];
  if (!labelPoint || ownerInk.length === 0) throw new Error(`missing owner-bound label for ${entityId}`);
  const ownerBounds = {
    minX: Math.min(...ownerInk.map((point) => point.x)),
    maxX: Math.max(...ownerInk.map((point) => point.x)),
    minY: Math.min(...ownerInk.map((point) => point.y)),
    maxY: Math.max(...ownerInk.map((point) => point.y)),
  };
  if (
    labelPoint.x >= ownerBounds.minX && labelPoint.x <= ownerBounds.maxX &&
    labelPoint.y >= ownerBounds.minY && labelPoint.y <= ownerBounds.maxY
  ) {
    throw new Error(`label for ${entityId} was placed on its resistor`);
  }
}

const helperLabelScene = structuredClone(packedViews) as Record<string, any>;
let helperPointIndex = 0;
helperLabelScene.entities = helperLabelScene.entities.map((entity: Record<string, unknown>) =>
  entity.kind === "point"
    ? { ...entity, label: helperPointIndex++ === 0 ? "A" : String(entity.id).toUpperCase() }
    : entity,
);
const normalizedHelperLabels = pruneDeadSceneEntities(helperLabelScene);
const remainingHelperLabels = (normalizedHelperLabels.entities as Array<Record<string, unknown>>)
  .filter((entity) => entity.kind === "point" && typeof entity.label === "string");
if (remainingHelperLabels.length > 0) {
  throw new Error(`construction-only point labels were not stripped: ${JSON.stringify(remainingHelperLabels)}`);
}
const normalizedHelperDocument = validateSceneDocument(normalizedHelperLabels).document;
const normalizedHelperCompiled = normalizedHelperDocument
  ? compileSceneDocument(normalizedHelperDocument)
  : null;
if (!normalizedHelperCompiled?.ok || !normalizedHelperCompiled.renderScene) {
  throw new Error(`helper-label normalization did not compile: ${JSON.stringify(normalizedHelperCompiled?.report.issues)}`);
}
if (normalizedHelperCompiled.renderScene.primitives.some((primitive) =>
  primitive.kind === "label" && ["s0", "s1", "s2", "s3", "pl", "pr"].includes(primitive.entityId))) {
  throw new Error("a stripped helper point label reached the render scene");
}

const preservedNamedGeometry = pruneDeadSceneEntities(candidate);
for (const id of ["a", "b", "c", "m"]) {
  const entity = (preservedNamedGeometry.entities as Array<Record<string, unknown>>)
    .find((item) => item.id === id);
  if (typeof entity?.label !== "string") {
    throw new Error(`semantic geometry label ${id} was stripped`);
  }
}

const mechanicalPlannerNoise = structuredClone(candidate) as Record<string, any>;
mechanicalPlannerNoise.constructions[0].outputs = "a";
mechanicalPlannerNoise.constructions.push({
  id: "planner_noop",
  operator: "segment",
  inputs: { start: "a", end: "b" },
  outputs: [],
});
const mechanicallyNormalized = pruneDeadSceneEntities(mechanicalPlannerNoise);
if ((mechanicallyNormalized.constructions as Array<Record<string, unknown>>).some((item) => item.id === "planner_noop")) {
  throw new Error("outputless planner construction was not removed");
}
const normalizedFirstOutputs = (mechanicallyNormalized.constructions as Array<Record<string, unknown>>)[0]?.outputs;
if (!Array.isArray(normalizedFirstOutputs) || normalizedFirstOutputs[0] !== "a") {
  throw new Error("scalar construction output was not normalized");
}
const mechanicalDocument = validateSceneDocument(mechanicallyNormalized).document;
if (!mechanicalDocument || !compileSceneDocument(mechanicalDocument).ok) {
  throw new Error("mechanically normalized scene did not compile");
}

const groupedAnnotations = structuredClone(packedViews) as Record<string, any>;
groupedAnnotations.entities.push(
  { id: "series_group", kind: "group", role: "comparison group" },
  { id: "parallel_group", kind: "group", role: "comparison group" },
);
groupedAnnotations.requiredEntityIds.push("series_group", "parallel_group");
groupedAnnotations.revealGroups[0].entityIds.push("series_group");
groupedAnnotations.revealGroups[1].entityIds.push("parallel_group");
groupedAnnotations.annotations = [
  { id: "series_result", kind: "label", text: "Req = 36 ohm", targetIds: ["series_group"] },
  { id: "parallel_result", kind: "label", text: "Req = 4 ohm", targetIds: ["parallel_group"] },
  { id: "series_narration", kind: "narration", text: "series explanation", targetIds: ["series_group"] },
  { id: "parallel_narration", kind: "narration", text: "parallel explanation", targetIds: ["parallel_group"] },
];
const groupedDocument = validateSceneDocument(groupedAnnotations).document;
const groupedCompiled = groupedDocument ? compileSceneDocument(groupedDocument) : null;
if (!groupedCompiled?.ok || !groupedCompiled.renderScene) {
  throw new Error(`group annotations did not compile: ${JSON.stringify(groupedCompiled?.report.issues)}`);
}
if (groupedCompiled.report.issues.some((issue) => issue.code === "annotation_target_unrendered")) {
  throw new Error("non-drawable narration was treated as diagram ink");
}
const seriesResult = groupedCompiled.renderScene.primitives.find((primitive) => primitive.id === "series_result");
const parallelResult = groupedCompiled.renderScene.primitives.find((primitive) => primitive.id === "parallel_result");
if (!seriesResult || !parallelResult || seriesResult.groupId === parallelResult.groupId) {
  throw new Error("group result labels were not attached to distinct reveal views");
}
if (Math.abs(seriesResult.points[0]!.y - parallelResult.points[0]!.y) < 32) {
  throw new Error("group result labels share the same global anchor");
}

const mixedTopologyArguments = structuredClone(packedViews) as Record<string, any>;
mixedTopologyArguments.assertions = [{
  id: "series_path",
  predicate: "path",
  entities: ["s0", "sr1", "s1", "sr2", "s2", "sr3", "s3"],
  expected: true,
  severity: "fatal",
}];
const normalizedTopologyArguments = pruneDeadSceneEntities(mixedTopologyArguments);
const normalizedPathEntities = (normalizedTopologyArguments.assertions as Array<Record<string, any>>)[0]?.entities;
const normalizedTopologyDocument = validateSceneDocument(normalizedTopologyArguments).document;
if (
  JSON.stringify(normalizedPathEntities) !== JSON.stringify(["sr1", "sr2", "sr3"]) ||
  !normalizedTopologyDocument ||
  !compileSceneDocument(normalizedTopologyDocument).ok
) {
  throw new Error(`node-interleaved topology operands were not normalized: ${JSON.stringify(normalizedPathEntities)}`);
}
const explicitTopologyArguments = structuredClone(mixedTopologyArguments) as Record<string, any>;
explicitTopologyArguments.assertions[0].entities = ["sr1", "sr2", "sr3"];
const explicitTopologyDocument = validateSceneDocument(explicitTopologyArguments).document;
if (!explicitTopologyDocument || !compileSceneDocument(explicitTopologyDocument).ok) {
  throw new Error("an explicit component-only topology path did not compile");
}

const renderedGeometryInTopologyPath = structuredClone(wiredSeriesPath) as Record<string, any>;
renderedGeometryInTopologyPath.entities.push({
  id: "drawn_rail",
  kind: "segment",
  role: "rendered rail",
});
renderedGeometryInTopologyPath.constructions.push({
  id: "make_drawn_rail",
  operator: "segment",
  inputs: { start: "n0", end: "n3" },
  outputs: ["drawn_rail"],
});
renderedGeometryInTopologyPath.assertions = [{
  id: "mixed_series_path",
  predicate: "path",
  entities: ["r1", "w12", "r2", "w23", "r3", "drawn_rail"],
  expected: true,
  severity: "fatal",
}];
renderedGeometryInTopologyPath.requiredEntityIds.push("drawn_rail");
renderedGeometryInTopologyPath.revealGroups[0].entityIds.push("drawn_rail");
const normalizedRenderedGeometryPath = pruneDeadSceneEntities(renderedGeometryInTopologyPath);
const normalizedRenderedPathEntities = (
  normalizedRenderedGeometryPath.assertions as Array<Record<string, any>>
)[0]?.entities;
if (JSON.stringify(normalizedRenderedPathEntities) !== JSON.stringify(["r1", "w12", "r2", "w23", "r3"])) {
  throw new Error(
    `non-topology geometry was not removed from a topology path: ${JSON.stringify(normalizedRenderedPathEntities)}`,
  );
}
const explicitRenderedGeometryPath = structuredClone(renderedGeometryInTopologyPath) as Record<string, any>;
explicitRenderedGeometryPath.assertions[0].entities = ["r1", "w12", "r2", "w23", "r3"];
const normalizedRenderedGeometryDocument = validateSceneDocument(explicitRenderedGeometryPath).document;
if (
  !normalizedRenderedGeometryDocument ||
  !compileSceneDocument(normalizedRenderedGeometryDocument).ok
) {
  throw new Error("topology path mixed with rendered geometry did not compile after normalization");
}

const emptyOptionalFunctionAssertion = structuredClone(candidate) as Record<string, any>;
emptyOptionalFunctionAssertion.assertions.push({
  id: "empty_optional_function_check",
  predicate: "function_value",
  entities: [],
  expected: { x: 0, y: 0 },
  severity: "info",
});
const normalizedOptionalFunctionAssertion = pruneDeadSceneEntities(emptyOptionalFunctionAssertion);
if (
  !(normalizedOptionalFunctionAssertion.assertions as Array<Record<string, unknown>>)
    .some((assertion) => assertion.id === "empty_optional_function_check")
) {
  throw new Error("empty optional function assertion was silently removed");
}
const normalizedOptionalFunctionDocument = validateSceneDocument(normalizedOptionalFunctionAssertion).document;
if (
  normalizedOptionalFunctionDocument &&
  compileSceneDocument(normalizedOptionalFunctionDocument).ok
) {
  throw new Error("empty optional function assertion did not fail closed");
}

const emptyRequiredFunctionAssertion = structuredClone(candidate) as Record<string, any>;
emptyRequiredFunctionAssertion.assertions.push({
  id: "empty_required_function_check",
  predicate: "function_value",
  entities: [],
  expected: { x: 0, y: 0 },
  severity: "fatal",
});
const retainedRequiredFunctionAssertion = pruneDeadSceneEntities(emptyRequiredFunctionAssertion);
if (
  !(retainedRequiredFunctionAssertion.assertions as Array<Record<string, unknown>>)
    .some((assertion) => assertion.id === "empty_required_function_check")
) {
  throw new Error("required function assertion was weakened during mechanical normalization");
}

const mismatchedConstructedLabel = structuredClone(candidate) as Record<string, any>;
mismatchedConstructedLabel.entities.push({
  id: "power_label",
  kind: "label",
  role: "power",
  label: "P_ext = 1.92 W",
});
mismatchedConstructedLabel.constructions.push({
  id: "make_power_label",
  operator: "label",
  inputs: { target: "a", text: "P = 1.92 W" },
  outputs: ["power_label"],
});
mismatchedConstructedLabel.requiredEntityIds.push("power_label");
mismatchedConstructedLabel.revealGroups[0].entityIds.push("power_label");
const normalizedConstructedLabel = pruneDeadSceneEntities(mismatchedConstructedLabel);
const normalizedPowerLabel = (
  normalizedConstructedLabel.entities as Array<Record<string, unknown>>
).find((entity) => entity.id === "power_label");
if (normalizedPowerLabel?.label !== "P = 1.92 W") {
  throw new Error(`constructed label text was not synchronized: ${String(normalizedPowerLabel?.label)}`);
}
const normalizedConstructedLabelDocument = validateSceneDocument(normalizedConstructedLabel).document;
if (
  !normalizedConstructedLabelDocument ||
  !compileSceneDocument(normalizedConstructedLabelDocument).ok
) {
  throw new Error("scene did not compile after synchronizing constructed label text");
}

const pathBackedSameSide = structuredClone(candidate) as Record<string, any>;
pathBackedSameSide.assertions.push({
  id: "a_direction",
  predicate: "same_side",
  entities: ["a", "ca", "m"],
  expected: true,
  severity: "fatal",
});
const normalizedPathBackedSameSide = pruneDeadSceneEntities(pathBackedSameSide);
const normalizedDirectionEntities = (
  normalizedPathBackedSameSide.assertions as Array<Record<string, any>>
).find((assertion) => assertion.id === "a_direction")?.entities;
if (JSON.stringify(normalizedDirectionEntities) !== JSON.stringify(["a", "ca", "m"])) {
  throw new Error(
    `same_side operands were silently rewritten: ${JSON.stringify(normalizedDirectionEntities)}`,
  );
}
const normalizedPathBackedSameSideDocument = validateSceneDocument(normalizedPathBackedSameSide).document;
if (
  normalizedPathBackedSameSideDocument &&
  compileSceneDocument(normalizedPathBackedSameSideDocument).ok
) {
  throw new Error("same_side with a path operand did not fail closed");
}

const shorthandInlineLabel = structuredClone(candidate) as Record<string, any>;
shorthandInlineLabel.entities.push({
  id: "field_mark",
  kind: "label",
  role: "field marker",
  label: "x",
});
shorthandInlineLabel.constructions.push({
  id: "field_mark",
  operator: "label",
  inputs: {
    target: { x: 1, y: 1, coordinateSpace: "layout" },
    text: "x",
  },
});
shorthandInlineLabel.requiredEntityIds.push("field_mark");
shorthandInlineLabel.revealGroups[0].entityIds.push("field_mark");
const normalizedShorthandInlineLabel = pruneDeadSceneEntities(shorthandInlineLabel);
const normalizedFieldConstruction = (
  normalizedShorthandInlineLabel.constructions as Array<Record<string, any>>
).find((construction) => construction.outputs?.[0] === "field_mark");
if (
  !normalizedFieldConstruction ||
  normalizedFieldConstruction.id === "field_mark" ||
  typeof normalizedFieldConstruction.inputs?.target !== "string"
) {
  throw new Error(
    `construction shorthand was not normalized: ${JSON.stringify(normalizedFieldConstruction)}`,
  );
}
const normalizedShorthandInlineLabelDocument = validateSceneDocument(
  normalizedShorthandInlineLabel,
).document;
if (
  !normalizedShorthandInlineLabelDocument ||
  !compileSceneDocument(normalizedShorthandInlineLabelDocument).ok
) {
  throw new Error("scene did not compile after normalizing shorthand output and inline point");
}

const degenerateSameSide = structuredClone(candidate) as Record<string, any>;
degenerateSameSide.assertions.push({
  id: "impossible_direction",
  predicate: "same_side",
  entities: ["a", "b", "a"],
  expected: true,
  severity: "fatal",
});
const normalizedDegenerateSameSide = pruneDeadSceneEntities(degenerateSameSide);
if (
  !(normalizedDegenerateSameSide.assertions as Array<Record<string, unknown>>)
    .some((assertion) => assertion.id === "impossible_direction")
) {
  throw new Error("mathematically degenerate same_side assertion was silently removed");
}
const degenerateSameSideDocument = validateSceneDocument(normalizedDegenerateSameSide).document;
if (degenerateSameSideDocument && compileSceneDocument(degenerateSameSideDocument).ok) {
  throw new Error("mathematically degenerate same_side assertion did not fail closed");
}

const crossViewArtifacts = structuredClone(packedViews) as Record<string, any>;
crossViewArtifacts.entities.push(
  { id: "unused_terminal", kind: "point", role: "terminal" },
  { id: "cross_view_wire", kind: "connector", role: "connector" },
);
crossViewArtifacts.constructions.push(
  { id: "make_unused", operator: "point", inputs: { x: 9, y: 1, coordinateSpace: "layout" }, outputs: ["unused_terminal"] },
  { id: "make_cross", operator: "connect", inputs: { start: "s3", end: "pl" }, outputs: ["cross_view_wire"] },
);
crossViewArtifacts.requiredEntityIds.push("unused_terminal", "cross_view_wire");
crossViewArtifacts.revealGroups[0].entityIds.push("cross_view_wire");
crossViewArtifacts.revealGroups[1].entityIds.push("unused_terminal");
const normalizedCrossView = pruneDeadSceneEntities(crossViewArtifacts);
const normalizedCrossViewIds = new Set(
  (normalizedCrossView.entities as Array<Record<string, unknown>>).map((entity) => entity.id),
);
if (normalizedCrossViewIds.has("unused_terminal") || normalizedCrossViewIds.has("cross_view_wire")) {
  throw new Error("independent-view planner artifacts were not pruned");
}
const crossViewDocument = validateSceneDocument(normalizedCrossView).document;
if (!crossViewDocument || !compileSceneDocument(crossViewDocument).ok) {
  throw new Error("scene did not compile after cross-view artifact pruning");
}

const pointBackedResultLabel = structuredClone(candidate) as Record<string, any>;
pointBackedResultLabel.entities.push({ id: "result", kind: "label", role: "result", label: "36 Ω" });
pointBackedResultLabel.constructions.push({
  id: "make_result_anchor",
  operator: "point",
  inputs: { x: 0, y: 4, coordinateSpace: "layout" },
  outputs: ["result"],
});
pointBackedResultLabel.annotations.push({
  id: "result_callout",
  kind: "callout",
  text: "R_eq,series = 36 Ω",
  targetIds: ["result"],
  placementIntent: "above",
});
pointBackedResultLabel.requiredEntityIds.push("result");
pointBackedResultLabel.revealGroups[0].entityIds.push("result");
const resultLabelDocument = validateSceneDocument(pointBackedResultLabel).document;
const resultLabelCompiled = resultLabelDocument ? compileSceneDocument(resultLabelDocument) : null;
if (!resultLabelCompiled?.ok || !resultLabelCompiled.renderScene) {
  throw new Error(`point-backed result label failed: ${JSON.stringify(resultLabelCompiled?.report.issues)}`);
}
const resultPrimitives = resultLabelCompiled.renderScene.primitives.filter((primitive) => primitive.entityId === "result");
const resultLabels = resultPrimitives.filter((primitive) => primitive.kind === "label");
if (
  resultLabels.length !== 1 ||
  resultLabels[0]?.text !== "R_eq = 36 Ω" ||
  resultPrimitives.some((primitive) => primitive.kind === "point" || primitive.id.endsWith("_leader"))
) {
  throw new Error(`result annotation was not the single ink owner: ${JSON.stringify(resultPrimitives)}`);
}

const mergedComponentLabel = structuredClone(packedViews) as Record<string, any>;
mergedComponentLabel.entities.find((entity: Record<string, unknown>) => entity.id === "sr1").label = "R1";
mergedComponentLabel.annotations = [{
  id: "sr1_value",
  kind: "label",
  text: "12 Ω",
  targetIds: ["sr1"],
}];
const mergedComponentDocument = validateSceneDocument(mergedComponentLabel).document;
const mergedComponentCompiled = mergedComponentDocument ? compileSceneDocument(mergedComponentDocument) : null;
if (!mergedComponentCompiled?.ok || !mergedComponentCompiled.renderScene) {
  throw new Error(`component label merge failed: ${JSON.stringify(mergedComponentCompiled?.report.issues)}`);
}
const sr1Labels = mergedComponentCompiled.renderScene.primitives
  .filter((primitive) => primitive.entityId === "sr1" && primitive.kind === "label");
if (sr1Labels.length !== 1 || sr1Labels[0]?.text !== "R1 12 Ω") {
  throw new Error(`component designator and value were not merged: ${JSON.stringify(sr1Labels)}`);
}
if (mergedComponentCompiled.renderScene.primitives.some((primitive) => primitive.id === "sr1_value_leader")) {
  throw new Error("a compact component label emitted a geometry-like leader stroke");
}

const quantityBackedComponentLabels = structuredClone(packedViews) as Record<string, any>;
quantityBackedComponentLabels.quantities = [
  { id: "R1", value: 12, unit: "Ω", label: "12 Ω" },
  { id: "R2", value: 12, unit: "Ω", label: "12 Ω" },
  { id: "R3", value: 12, unit: "Ω", label: "12 Ω" },
];
quantityBackedComponentLabels.annotations = [
  { id: "series_summary", kind: "callout", targetIds: ["sr1"], text: "Rs = 36 Ω", placementIntent: "above" },
  { id: "parallel_summary", kind: "callout", targetIds: ["pr1"], text: "Rp = 4 Ω", placementIntent: "above" },
];
const quantityBackedDocument = validateSceneDocument(quantityBackedComponentLabels).document;
const quantityBackedCompiled = quantityBackedDocument ? compileSceneDocument(quantityBackedDocument) : null;
if (!quantityBackedCompiled?.ok || !quantityBackedCompiled.renderScene) {
  throw new Error(`quantity-backed component labels failed: ${JSON.stringify(quantityBackedCompiled?.report.issues)}`);
}
for (const entityId of ["sr1", "sr2", "sr3", "pr1", "pr2", "pr3"]) {
  const expectedDesignator = entityId.slice(-1);
  const label = quantityBackedCompiled.renderScene.primitives.find((primitive) =>
    primitive.id === `primitive_${entityId}_label`);
  if (label?.text !== `R${expectedDesignator} 12 Ω`) {
    throw new Error(`quantity ${expectedDesignator} was not bound to ${entityId}: ${JSON.stringify(label)}`);
  }
}
for (const [summaryId, componentId] of [["series_summary", "sr1"], ["parallel_summary", "pr1"]] as const) {
  const summary = quantityBackedCompiled.renderScene.primitives.find((primitive) => primitive.id === summaryId);
  const componentLabel = quantityBackedCompiled.renderScene.primitives.find((primitive) =>
    primitive.id === `primitive_${componentId}_label`);
  if (!summary?.text || !componentLabel?.text) throw new Error(`missing summary-band labels for ${summaryId}`);
  const bounds = (primitive: typeof summary) => ({
    x: primitive!.points[0]!.x - (primitive!.text!.length * 13 + 8) / 2,
    y: primitive!.points[0]!.y - 16,
    width: primitive!.text!.length * 13 + 8,
    height: 32,
  });
  const a = bounds(summary);
  const b = bounds(componentLabel);
  const componentInk = quantityBackedCompiled.renderScene.primitives
    .filter((primitive) => primitive.entityId === componentId && primitive.kind !== "label")
    .flatMap((primitive) => primitive.points);
  const componentCenterX = (Math.min(...componentInk.map((point) => point.x)) + Math.max(...componentInk.map((point) => point.x))) / 2;
  if (summaryId === "series_summary" && Math.abs(componentLabel.points[0]!.x - componentCenterX) > 100) {
    throw new Error(`${componentId} label was displaced away from its owning symbol`);
  }
  if (summary.points[0]!.y >= componentLabel.points[0]!.y) {
    throw new Error(`${summaryId} was not placed in the reserved band above component labels`);
  }
  if (!(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)) {
    throw new Error(`${summaryId} overlaps its first component label`);
  }
}

const paraxialScene = structuredClone(curvedSurfaceCandidate) as Record<string, any>;
paraxialScene.source = { question: "Concave mirror, f = 15 cm, object at 20 cm" };
paraxialScene.quantities = [{ id: "m_val", symbol: "m", value: -3, unit: "dimensionless" }];
paraxialScene.entities.push(
  { id: "pole", kind: "point", role: "pole" },
  { id: "focus", kind: "point", role: "focus" },
  { id: "object_base", kind: "point", role: "object position" },
  { id: "object_tip", kind: "point", role: "object tip" },
  { id: "image_base", kind: "point", role: "image position" },
  { id: "image_tip", kind: "point", role: "image tip" },
);
paraxialScene.constructions.push(
  { id: "make_pole", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["pole"] },
  { id: "make_focus", operator: "point", inputs: { x: -15, y: 0, coordinateSpace: "world" }, outputs: ["focus"] },
  { id: "make_object_base", operator: "point", inputs: { x: -20, y: 0, coordinateSpace: "world" }, outputs: ["object_base"] },
  { id: "make_object_tip", operator: "point", inputs: { x: -20, y: 4, coordinateSpace: "world" }, outputs: ["object_tip"] },
  { id: "make_image_base", operator: "point", inputs: { x: -60, y: 0, coordinateSpace: "world" }, outputs: ["image_base"] },
  { id: "make_image_tip", operator: "intersection", inputs: { first: "reflected", second: "incident" }, outputs: ["image_tip"] },
);
paraxialScene.requiredEntityIds.push("pole", "focus", "object_base", "object_tip", "image_base", "image_tip");
paraxialScene.revealGroups[0].entityIds.push("pole", "focus", "object_base", "object_tip", "image_base", "image_tip");
paraxialScene.assertions.push({
  id: "obj_between_f_c",
  predicate: "between",
  entities: ["object_base", "focus", "center"],
  expected: true,
  severity: "fatal",
});
const normalizedParaxial = pruneDeadSceneEntities(paraxialScene);
const normalizedPointY = (output: string) => {
  const construction = (normalizedParaxial.constructions as Array<Record<string, any>>)
    .find((item) => Array.isArray(item.outputs) && item.outputs.includes(output));
  return construction?.inputs?.y;
};
if (Math.abs(normalizedPointY("object_tip") - 1.2) > 1e-9 || Math.abs(normalizedPointY("image_tip") + 3.6) > 1e-9) {
  throw new Error("ungiven optical illustration height was not normalized to a readable paraxial size");
}
const renderableParaxial = structuredClone(normalizedParaxial) as Record<string, any>;
renderableParaxial.assertions = (renderableParaxial.assertions as Array<Record<string, any>>)
  .filter((assertion) => assertion.id !== "obj_between_f_c");
const compiledParaxial = compileSceneDocument(renderableParaxial as any);
if (!compiledParaxial.ok || !compiledParaxial.renderScene) {
  throw new Error(`normalized paraxial scene did not compile: ${JSON.stringify(compiledParaxial.report.issues)}`);
}
const renderedCenter = (id: string) => {
  const bounds = compiledParaxial.renderScene!.entityBounds[id];
  if (!bounds) throw new Error(`missing rendered bounds for ${id}`);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
};
const renderedObjectBase = renderedCenter("object_base");
const renderedObjectTip = renderedCenter("object_tip");
const renderedImageBase = renderedCenter("image_base");
const renderedImageTip = renderedCenter("image_tip");
if (Math.hypot(renderedObjectTip.x - renderedObjectBase.x, renderedObjectTip.y - renderedObjectBase.y) < 10) {
  throw new Error("normalized paraxial object is too small to read on the default viewport");
}
if (Math.hypot(renderedImageTip.x - renderedImageBase.x, renderedImageTip.y - renderedImageBase.y) < 30) {
  throw new Error("normalized magnified image is too small to read on the default viewport");
}
const normalizedImageTipConstruction = (normalizedParaxial.constructions as Array<Record<string, any>>)
  .find((construction) => Array.isArray(construction.outputs) && construction.outputs.includes("image_tip"));
if (normalizedImageTipConstruction?.operator !== "point") {
  throw new Error("paraxial image tip was not grounded in signed magnification");
}
const normalizedBetween = (normalizedParaxial.assertions as Array<Record<string, any>>)
  .find((assertion) => assertion.id === "obj_between_f_c");
if (normalizedBetween?.entities?.[0] !== "object_base") {
  throw new Error("explicit between assertion changed its declared subject");
}
const specifiedHeight = structuredClone(paraxialScene) as Record<string, any>;
specifiedHeight.source.question += " with object height 4 cm";
if (normalizedPointYFor(pruneDeadSceneEntities(specifiedHeight), "object_tip") !== 4) {
  throw new Error("an explicitly given object height was modified");
}

const semanticMirrorCandidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "semantic paraxial mirror" },
  source: { question: "Concave mirror, f = 15 cm, object at 20 cm" },
  quantities: [
    { id: "f", value: 15, unit: "cm" },
    { id: "d_o", value: 20, unit: "cm" },
    { id: "d_i", value: 60, unit: "cm" },
    { id: "m", value: -3, unit: "dimensionless" },
  ],
  entities: [
    { id: "axis_left", kind: "point", role: "axis left" },
    { id: "axis_right", kind: "point", role: "axis right" },
    { id: "vertex", kind: "point", role: "mirror vertex" },
    { id: "focus", kind: "point", role: "focal point" },
    { id: "center", kind: "point", role: "center of curvature" },
    { id: "object_base", kind: "point", role: "object base" },
    { id: "object_tip", kind: "point", role: "object tip" },
    { id: "image_base", kind: "point", role: "image base" },
    { id: "image_tip", kind: "point", role: "image tip" },
    { id: "ray1_hit", kind: "point", role: "ray1 hit" },
    { id: "ray2_hit", kind: "point", role: "ray2 hit" },
    { id: "axis", kind: "line", role: "principal axis" },
    { id: "mirror", kind: "arc", role: "concave mirror" },
    { id: "object_arrow", kind: "vector", role: "object arrow" },
    { id: "image_arrow", kind: "vector", role: "image arrow" },
    { id: "ray1_in", kind: "ray", role: "ray1 incident" },
    { id: "ray1_out", kind: "ray", role: "ray1 out through focus" },
    { id: "ray2_in", kind: "ray", role: "ray2 incident" },
    { id: "ray2_out", kind: "ray", role: "ray2 out parallel" },
  ],
  constructions: [
    { id: "p_axis_left", operator: "point", inputs: { x: -80, y: 0, coordinateSpace: "world" }, outputs: ["axis_left"] },
    { id: "p_axis_right", operator: "point", inputs: { x: 80, y: 0, coordinateSpace: "world" }, outputs: ["axis_right"] },
    { id: "p_vertex", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["vertex"] },
    { id: "p_focus", operator: "point", inputs: { x: 15, y: 0, coordinateSpace: "world" }, outputs: ["focus"] },
    { id: "p_center", operator: "point", inputs: { x: 30, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
    { id: "p_object_base", operator: "point", inputs: { x: -20, y: 0, coordinateSpace: "world" }, outputs: ["object_base"] },
    { id: "p_object_tip", operator: "point", inputs: { x: -20, y: 10, coordinateSpace: "world" }, outputs: ["object_tip"] },
    { id: "p_image_base", operator: "point", inputs: { x: 60, y: 0, coordinateSpace: "world" }, outputs: ["image_base"] },
    { id: "p_image_tip", operator: "point", inputs: { x: 60, y: -30, coordinateSpace: "world" }, outputs: ["image_tip"] },
    { id: "p_hit1", operator: "point", inputs: { x: 0, y: 10, coordinateSpace: "world" }, outputs: ["ray1_hit"] },
    { id: "p_hit2", operator: "point", inputs: { x: 0, y: -10, coordinateSpace: "world" }, outputs: ["ray2_hit"] },
    { id: "make_axis", operator: "line", inputs: { start: "axis_left", end: "axis_right" }, outputs: ["axis"] },
    { id: "make_mirror", operator: "arc", inputs: { center: "center", radius: 30, startAngle: -90, endAngle: 90, angleUnit: "degrees" }, outputs: ["mirror"] },
    { id: "make_object", operator: "vector", inputs: { start: "object_base", end: "object_tip" }, outputs: ["object_arrow"] },
    { id: "make_image", operator: "vector", inputs: { start: "image_base", end: "image_tip" }, outputs: ["image_arrow"] },
    { id: "make_ray1_in", operator: "ray", inputs: { start: "object_tip", end: "ray1_hit" }, outputs: ["ray1_in"] },
    { id: "make_ray1_out", operator: "ray", inputs: { start: "ray1_hit", end: "focus" }, outputs: ["ray1_out"] },
    { id: "make_ray2_in", operator: "ray", inputs: { start: "object_tip", end: "ray2_hit" }, outputs: ["ray2_in"] },
    { id: "make_ray2_out", operator: "ray", inputs: { start: "ray2_hit", end: "image_tip" }, outputs: ["ray2_out"] },
  ],
  relations: [],
  assertions: [{ id: "rays_converge", predicate: "converges", entities: ["ray1_out", "ray2_out", "image_tip"], expected: true, severity: "fatal" }],
  annotations: [],
  requiredEntityIds: ["axis_left", "axis_right", "vertex", "focus", "center", "object_base", "object_tip", "image_base", "image_tip", "ray1_hit", "ray2_hit", "axis", "mirror", "object_arrow", "image_arrow", "ray1_in", "ray1_out", "ray2_in", "ray2_out"],
  revealGroups: [{ id: "setup", entityIds: ["axis_left", "axis_right", "vertex", "focus", "center", "object_base", "object_tip", "image_base", "image_tip", "ray1_hit", "ray2_hit", "axis", "mirror", "object_arrow", "image_arrow", "ray1_in", "ray1_out", "ray2_in", "ray2_out"], dependsOn: [], narrationCue: "show mirror" }],
  teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show mirror" }],
} as const;
const semanticMirrorValidation = validateSceneDocument(semanticMirrorCandidate);
const semanticMirrorDocument = semanticMirrorValidation.document;
if (!semanticMirrorDocument) {
  throw new Error(`semantic mirror candidate did not validate before constraint compilation: ${JSON.stringify(semanticMirrorValidation.report.issues)}`);
}
const semanticMirrorPlan = {
  schemaVersion: "turn-plan/v3",
  question: semanticMirrorCandidate.source.question,
  givens: [
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given" },
    { id: "d_o", symbol: "d_o", value: 20, unit: "cm", provenance: "given" },
  ],
  unknowns: [{ id: "d_i", symbol: "d_i", unit: "cm" }],
  derived: [
    { id: "d_i", symbol: "d_i", value: 60, unit: "cm", provenance: "derived" },
    { id: "m", symbol: "m", value: -3, unit: "dimensionless", provenance: "derived" },
  ],
  qualitativeClaims: [
    { id: "real", claim: "Image is real", expected: true },
    { id: "ray1", claim: "Ray parallel to principal axis reflects through focal point", expected: true },
    { id: "ray2", claim: "Ray through focal point reflects parallel to principal axis", expected: true },
  ],
  lawIds: ["mirror_equation"],
  assumptions: ["paraxial rays"],
  visualRequirement: "required",
} as const;
const normalizedSemanticMirror = normalizeClaimedParaxialReflectionGeometry(
  semanticMirrorDocument,
  semanticMirrorPlan,
);
const finalSemanticMirror = validateSceneDocument(
  pruneDeadSceneEntities(normalizedSemanticMirror as unknown as Record<string, unknown>),
).document;
const compiledSemanticMirror = finalSemanticMirror ? compileSceneDocument(finalSemanticMirror) : null;
const semanticMirrorPoint = (id: string) => finalSemanticMirror?.constructions.find((construction) =>
  construction.outputs.includes(id))?.inputs;
if (
  !compiledSemanticMirror?.ok ||
  semanticMirrorPoint("focus")?.x !== -15 ||
  semanticMirrorPoint("center")?.x !== -30 ||
  semanticMirrorPoint("image_base")?.x !== -60 ||
  Math.abs(Number(semanticMirrorPoint("image_tip")?.y) + 3.6) > 1e-9 ||
  Math.abs(Number(semanticMirrorPoint("ray2_hit")?.y) + 3.6) > 1e-9
) {
  throw new Error(`semantic paraxial reflection was not compiled from audited constraints: ${JSON.stringify(compiledSemanticMirror?.report.issues)}`);
}

if (Math.abs(evaluateMathExpression("sin(pi / 2) + 2^3^2", 0) - 513) > 1e-9) {
  throw new Error("audited expression evaluator lost function or right-associative power semantics");
}
if (Math.abs(evaluateMathExpression("x² − 4", 3) - 5) > 1e-9) {
  throw new Error("audited expression evaluator lost superscript or minus-sign aliases");
}
for (const expression of ["2x", "globalThis.process", "sqrt(-1)", "1 / 0"]) {
  let rejected = false;
  try {
    evaluateMathExpression(expression, 1);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`unsafe or non-finite expression was accepted: ${expression}`);
}

const functionCurveCandidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "graph the stated function" },
  source: { question: "Graph y = x^2 - 4 from -4 to 4" },
  quantities: [],
  entities: [{ id: "curve", kind: "polyline", role: "function graph", label: "y=x^2-4" }],
  constructions: [{
    id: "make_curve",
    operator: "function_curve",
    inputs: { expression: "x^2 - 4", variable: "x", xMin: -4, xMax: 4, samples: 65 },
    outputs: ["curve"],
  }],
  relations: [],
  assertions: [
    { id: "value_at_three", predicate: "function_value", entities: ["curve"], expected: { x: 3, y: 5 }, severity: "fatal" },
    { id: "negative_root", predicate: "root", entities: ["curve"], expected: -2, severity: "fatal" },
    { id: "positive_root", predicate: "root", entities: ["curve"], expected: { x: 2 }, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["curve"],
  revealGroups: [{ id: "graph", entityIds: ["curve"], dependsOn: [], narrationCue: "show the curve" }],
  teachingTimeline: [{ id: "show_graph", action: "reveal", targetId: "graph", dependsOn: [], narrationIntent: "graph the function" }],
};
const functionCurveValidation = validateSceneDocument(functionCurveCandidate);
const functionCurveCompiled = functionCurveValidation.document
  ? compileSceneDocument(functionCurveValidation.document)
  : null;
if (!functionCurveCompiled?.ok || !functionCurveCompiled.renderScene) {
  throw new Error(`valid function curve failed: ${JSON.stringify(functionCurveCompiled?.report.issues ?? functionCurveValidation.report.issues)}`);
}
const curvePrimitive = functionCurveCompiled.renderScene.primitives.find((primitive) => primitive.entityId === "curve");
if (curvePrimitive?.kind !== "polyline" || curvePrimitive.points.length !== 65) {
  throw new Error(`function curve did not render as a deterministic 65-point polyline: ${JSON.stringify(curvePrimitive)}`);
}

const functionRegionCandidate = structuredClone(functionCurveCandidate) as Record<string, any>;
functionRegionCandidate.constructions[0].inputs.expression = "x^2";
functionRegionCandidate.constructions[0].inputs.xMin = -2.5;
functionRegionCandidate.constructions[0].inputs.xMax = 2.5;
functionRegionCandidate.assertions = [];
functionRegionCandidate.entities.push(
  { id: "ceiling", kind: "function_curve", role: "function graph", label: "y=4" },
  { id: "enclosed_region", kind: "function_region", role: "enclosed region" },
);
functionRegionCandidate.constructions.push(
  { id: "make_ceiling", operator: "function_curve", inputs: { expression: "4", variable: "x", xMin: -2.5, xMax: 2.5, samples: 65 }, outputs: ["ceiling"] },
  { id: "make_region", operator: "function_region", inputs: { upper: "ceiling", lower: "curve", xMin: -2, xMax: 2, samples: 65 }, outputs: ["enclosed_region"] },
);
functionRegionCandidate.assertions.push(
  { id: "region_left", predicate: "function_value", entities: ["curve"], expected: { x: -2, y: 4 }, severity: "fatal" },
  { id: "region_right", predicate: "function_value", entities: ["curve"], expected: { x: 2, y: 4 }, severity: "fatal" },
);
functionRegionCandidate.requiredEntityIds.push("ceiling", "enclosed_region");
functionRegionCandidate.revealGroups[0].entityIds.push("ceiling", "enclosed_region");
const functionRegionValidation = validateSceneDocument(functionRegionCandidate);
const functionRegionDocument = functionRegionValidation.document;
const functionRegionCompiled = functionRegionDocument ? compileSceneDocument(functionRegionDocument) : null;
if (!functionRegionCompiled?.ok || !functionRegionCompiled.renderScene) {
  throw new Error(`function region failed deterministic compilation: ${JSON.stringify(functionRegionCompiled?.report.issues ?? functionRegionValidation.report.issues)}`);
}
const regionPrimitive = functionRegionCompiled.renderScene.primitives.find((primitive) => primitive.entityId === "enclosed_region");
if (regionPrimitive?.kind !== "polygon" || regionPrimitive.points.length !== 130) {
  throw new Error(`function region did not follow both sampled curves: ${JSON.stringify(regionPrimitive)}`);
}

const swappedFunctionRegion = structuredClone(functionRegionCandidate) as Record<string, any>;
const swappedRegionConstruction = swappedFunctionRegion.constructions.find(
  (construction: Record<string, any>) => construction.operator === "function_region",
);
[swappedRegionConstruction.inputs.upper, swappedRegionConstruction.inputs.lower] = [
  swappedRegionConstruction.inputs.lower,
  swappedRegionConstruction.inputs.upper,
];
const swappedFunctionRegionValidation = validateSceneDocument(swappedFunctionRegion);
if (
  swappedFunctionRegionValidation.document ||
  !swappedFunctionRegionValidation.report.issues.some((issue) => issue.code === "invalid_function_region_order")
) {
  throw new Error("function_region accepted upper and lower boundaries in the wrong order");
}

const guessedRegion = structuredClone(functionRegionCandidate) as Record<string, any>;
guessedRegion.constructions = guessedRegion.constructions.map((construction: Record<string, any>) =>
  construction.id === "make_region"
    ? { ...construction, operator: "polygon", inputs: { points: ["root_negative", "root_positive", "curve"] } }
    : construction,
);
const guessedRegionValidation = validateSceneDocument(guessedRegion);
if (!guessedRegionValidation.report.issues.some((issue) => issue.code === "function_region_requires_deterministic_operator")) {
  throw new Error("function-bounded regions accepted a guessed polygon instead of requiring deterministic sampling");
}

const markedFunctionRoots = structuredClone(functionCurveCandidate) as Record<string, any>;
markedFunctionRoots.entities.push(
  { id: "root_negative", kind: "point", role: "root", label: "-2" },
  { id: "root_positive", kind: "point", role: "root", label: "2" },
);
markedFunctionRoots.constructions.push(
  { id: "make_root_negative", operator: "point", inputs: { x: -2, y: 0 }, outputs: ["root_negative"] },
  { id: "make_root_positive", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["root_positive"] },
);
markedFunctionRoots.assertions.push(
  { id: "negative_on_curve", predicate: "on", entities: ["root_negative", "curve"], expected: true, tolerance: 1e-6, severity: "fatal" },
  { id: "positive_on_curve", predicate: "on", entities: ["root_positive", "curve"], expected: true, tolerance: 1e-6, severity: "fatal" },
);
markedFunctionRoots.requiredEntityIds.push("root_negative", "root_positive");
markedFunctionRoots.revealGroups[0].entityIds.push("root_negative", "root_positive");
const markedRootsDocument = validateSceneDocument(markedFunctionRoots).document;
const markedRootsCompiled = markedRootsDocument ? compileSceneDocument(markedRootsDocument) : null;
if (!markedRootsCompiled?.ok) {
  throw new Error(`points on a sampled function curve were not recognized: ${JSON.stringify(markedRootsCompiled?.report.issues)}`);
}

const maliciousFunctionCurve = structuredClone(functionCurveCandidate) as Record<string, any>;
maliciousFunctionCurve.constructions[0].inputs.expression = "globalThis.process.exit()";
const maliciousFunctionResult = validateSceneDocument(maliciousFunctionCurve);
if (maliciousFunctionResult.document || !maliciousFunctionResult.report.issues.some((issue) => issue.code === "invalid_function_expression")) {
  throw new Error("unsafe function_curve expression passed early validation");
}

const discontinuousFunctionCurve = structuredClone(functionCurveCandidate) as Record<string, any>;
discontinuousFunctionCurve.constructions[0].inputs.expression = "1 / (x - 0.12345)";
const discontinuousResult = validateSceneDocument(discontinuousFunctionCurve);
if (discontinuousResult.document || !discontinuousResult.report.issues.some((issue) => issue.code === "invalid_function_domain")) {
  throw new Error(`an off-sample function discontinuity passed interval validation: ${JSON.stringify(discontinuousResult.report.issues)}`);
}

const invalidFunctionSamples = structuredClone(functionCurveCandidate) as Record<string, any>;
invalidFunctionSamples.constructions[0].inputs.samples = 64;
const invalidSamplesResult = validateSceneDocument(invalidFunctionSamples);
if (invalidSamplesResult.document || !invalidSamplesResult.report.issues.some((issue) => issue.code === "invalid_function_samples")) {
  throw new Error("invalid function_curve sample count passed early validation");
}

const parametricCandidate = structuredClone(functionCurveCandidate) as Record<string, any>;
parametricCandidate.source.question = "Plot x=cos(t), y=sin(t), with its tangent and normal at t=pi/2";
parametricCandidate.entities[0] = { id: "curve", kind: "polyline", role: "parametric curve", label: "circle(t)" };
parametricCandidate.entities.push(
  { id: "tangent", kind: "line", role: "tangent line" },
  { id: "normal", kind: "line", role: "normal line" },
);
parametricCandidate.constructions = [
  {
    id: "make_curve",
    operator: "parametric_curve",
    inputs: { xExpression: "cos(t)", yExpression: "sin(t)", parameter: "t", tMin: 0, tMax: Math.PI * 2, samples: 65 },
    outputs: ["curve"],
  },
  { id: "make_tangent", operator: "tangent_line", inputs: { curve: "curve", at: Math.PI / 2, span: 2 }, outputs: ["tangent"] },
  { id: "make_normal", operator: "normal_line", inputs: { curve: "curve", at: Math.PI / 2, span: 2 }, outputs: ["normal"] },
];
parametricCandidate.assertions = [
  { id: "tangent_normal", predicate: "perpendicular", entities: ["tangent", "normal"], expected: true, severity: "fatal" },
];
parametricCandidate.requiredEntityIds = ["curve", "tangent", "normal"];
parametricCandidate.revealGroups[0].entityIds = ["curve", "tangent", "normal"];
const parametricValidation = validateSceneDocument(parametricCandidate);
const parametricCompiled = parametricValidation.document ? compileSceneDocument(parametricValidation.document) : null;
if (!parametricCompiled?.ok || !parametricCompiled.renderScene) {
  throw new Error(`parametric curve with derived lines failed: ${JSON.stringify(parametricCompiled?.report.issues ?? parametricValidation.report.issues)}`);
}
const parametricPrimitive = parametricCompiled.renderScene.primitives.find((primitive) => primitive.entityId === "curve");
if (parametricPrimitive?.kind !== "polyline" || parametricPrimitive.points.length !== 65) {
  throw new Error("parametric_curve did not render a deterministic sampled path");
}

const plannerParametricCandidate = structuredClone(functionCurveCandidate) as Record<string, any>;
plannerParametricCandidate.source.question =
  "For x = t^2 - 1 and y = t^3 - t, sketch the curve near t = 2 and draw the tangent at that parameter value.";
plannerParametricCandidate.entities = [
  { id: "axes", kind: "axes", role: "coordinate axes" },
  { id: "curve", kind: "line", role: "parametric curve", label: "r(t)" },
  { id: "tangent", kind: "line", role: "tangent line" },
];
plannerParametricCandidate.constructions = [
  { id: "make_axes", operator: "axes", inputs: { xMin: -1, xMax: 5, yMin: -2, yMax: 8 }, outputs: ["axes"] },
  {
    id: "make_curve",
    operator: "parametric_curve",
    inputs: { xExpression: "t^2 - 1", yExpression: "t^3 - t", tMin: 0, tMax: 3, samples: 65 },
    outputs: ["curve"],
  },
  { id: "make_tangent", operator: "tangent_line", inputs: { curve: "curve", at: 2 }, outputs: ["tangent"] },
];
plannerParametricCandidate.assertions = [
  { id: "point_at_t2", predicate: "function_value", entities: ["curve"], expected: { x: 3, y: 6 }, severity: "fatal" },
];
plannerParametricCandidate.requiredEntityIds = ["axes", "curve", "tangent"];
plannerParametricCandidate.revealGroups = [{
  id: "graph",
  entityIds: ["axes", "curve", "tangent"],
  dependsOn: [],
  narrationCue: "show the curve and tangent",
}];
plannerParametricCandidate.teachingTimeline = [{
  id: "show_graph",
  action: "reveal",
  targetId: "graph",
  dependsOn: [],
  narrationIntent: "graph the parametric curve",
}];
const plannerParametricPruned = pruneDeadSceneEntities(plannerParametricCandidate);
const plannerParametricValidation = validateSceneDocument(plannerParametricPruned);
const plannerParametricCompiled = plannerParametricValidation.document
  ? compileSceneDocument(plannerParametricValidation.document)
  : null;
if (!plannerParametricCompiled?.ok || !plannerParametricCompiled.renderScene) {
  throw new Error(
    `planner-shaped parametric tangent failed: ${JSON.stringify(
      plannerParametricCompiled?.report.issues ?? plannerParametricValidation.report.issues,
    )}`,
  );
}
const wrongParametricValue = structuredClone(plannerParametricCandidate);
wrongParametricValue.assertions[0].expected = { x: 0, y: 1 };
const wrongParametricCompiled = (() => {
  const validated = validateSceneDocument(pruneDeadSceneEntities(wrongParametricValue));
  return validated.document ? compileSceneDocument(validated.document) : null;
})();
if (
  wrongParametricCompiled?.ok ||
  !wrongParametricCompiled?.report.issues.some((issue) => issue.code === "assertion_failed")
) {
  throw new Error("parametric function_value accepted a cartesian point off the curve");
}

const unicodeParametricCandidate = structuredClone(plannerParametricCandidate);
unicodeParametricCandidate.constructions[1].inputs.xExpression = "t² − 1";
unicodeParametricCandidate.constructions[1].inputs.yExpression = "t³ − t";
const unicodeParametricCompiled = (() => {
  const validated = validateSceneDocument(pruneDeadSceneEntities(unicodeParametricCandidate));
  return validated.document ? compileSceneDocument(validated.document) : null;
})();
if (!unicodeParametricCompiled?.ok) {
  throw new Error(
    `unicode parametric expressions failed: ${JSON.stringify(
      unicodeParametricCompiled?.report.issues
      ?? validateSceneDocument(pruneDeadSceneEntities(unicodeParametricCandidate)).report.issues,
    )}`,
  );
}

const operatorNamedCurveKind = structuredClone(plannerParametricCandidate) as Record<string, any>;
operatorNamedCurveKind.entities.find((entity: { id: string }) => entity.id === "curve").kind = "parametric_curve";
const operatorNamedCurveValidation = validateSceneDocument(pruneDeadSceneEntities(operatorNamedCurveKind));
const operatorNamedCurveCompiled = operatorNamedCurveValidation.document
  ? compileSceneDocument(operatorNamedCurveValidation.document)
  : null;
if (!operatorNamedCurveCompiled?.ok) {
  throw new Error(
    `parametric_curve entity kind was not coerced to polyline: ${JSON.stringify(
      operatorNamedCurveCompiled?.report.issues ?? operatorNamedCurveValidation.report.issues,
    )}`,
  );
}

const livePlannerIncident = structuredClone(operatorNamedCurveKind) as Record<string, any>;
livePlannerIncident.entities.push({ id: "point_t2", kind: "point", role: "point at t = 2" });
livePlannerIncident.constructions.push({
  id: "make_point",
  operator: "point",
  inputs: { x: 3, y: 6, coordinateSpace: "world" },
  outputs: ["point_t2"],
});
livePlannerIncident.assertions = [
  {
    id: "incident_tangent_point",
    predicate: "incident",
    entities: ["tangent", "point_t2"],
    expected: true,
    severity: "critical",
  },
  {
    id: "slope_vs_axes",
    predicate: "angle_between",
    entities: ["tangent", "axes"],
    expected: { value: 2.75, unit: "dimensionless" },
    severity: "error",
  },
];
livePlannerIncident.requiredEntityIds = ["axes", "curve", "tangent", "point_t2"];
livePlannerIncident.revealGroups[0].entityIds = ["axes", "curve", "tangent", "point_t2"];
const livePlannerIncidentValidation = validateSceneDocument(pruneDeadSceneEntities(livePlannerIncident));
const livePlannerIncidentCompiled = livePlannerIncidentValidation.document
  ? compileSceneDocument(livePlannerIncidentValidation.document)
  : null;
if (!livePlannerIncidentCompiled?.ok) {
  throw new Error(
    `live planner parametric tangent/point proofs failed closed: ${JSON.stringify(
      livePlannerIncidentCompiled?.report.issues ?? livePlannerIncidentValidation.report.issues,
    )}`,
  );
}

const polarCandidate = structuredClone(functionCurveCandidate) as Record<string, any>;
polarCandidate.source.question = "Plot the polar curve r=2cos(3theta)";
polarCandidate.entities[0] = { id: "curve", kind: "polyline", role: "polar curve", label: "r=2cos(3theta)" };
polarCandidate.constructions[0] = {
  id: "make_curve",
  operator: "polar_curve",
  inputs: { radiusExpression: "2*cos(3*theta)", parameter: "theta", thetaMin: 0, thetaMax: Math.PI * 2, samples: 129 },
  outputs: ["curve"],
};
polarCandidate.assertions = [];
const polarValidation = validateSceneDocument(polarCandidate);
const polarCompiled = polarValidation.document ? compileSceneDocument(polarValidation.document) : null;
const polarPrimitive = polarCompiled?.renderScene?.primitives.find((primitive) => primitive.entityId === "curve");
if (!polarCompiled?.ok || polarPrimitive?.kind !== "polyline" || polarPrimitive.points.length !== 129) {
  throw new Error(`polar_curve failed deterministic compilation: ${JSON.stringify(polarCompiled?.report.issues ?? polarValidation.report.issues)}`);
}

const implicitCandidate = structuredClone(functionCurveCandidate) as Record<string, any>;
implicitCandidate.source.question = "Plot the implicit relation x^2 + y^2 = 4";
implicitCandidate.entities[0] = { id: "curve", kind: "polyline", role: "implicit curve", label: "x^2+y^2=4" };
implicitCandidate.constructions[0] = {
  id: "make_curve",
  operator: "implicit_curve",
  inputs: { expression: "x^2+y^2-4", xMin: -3, xMax: 3, yMin: -3, yMax: 3, xSamples: 65, ySamples: 65 },
  outputs: ["curve"],
};
implicitCandidate.assertions = [];
const implicitValidation = validateSceneDocument(implicitCandidate);
const implicitCompiled = implicitValidation.document ? compileSceneDocument(implicitValidation.document) : null;
const implicitPrimitives = implicitCompiled?.renderScene?.primitives.filter((primitive) =>
  primitive.entityId === "curve" && primitive.kind === "polyline",
) ?? [];
if (
  !implicitCompiled?.ok ||
  implicitPrimitives.length === 0 ||
  implicitPrimitives.some((primitive) => primitive.points.length < 8)
) {
  throw new Error(`implicit_curve failed deterministic contour compilation: ${JSON.stringify(implicitCompiled?.report.issues ?? implicitValidation.report.issues)}`);
}
if (!implicitPrimitives.every((primitive) => primitive.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))) {
  throw new Error("implicit_curve emitted non-finite render coordinates");
}

const disconnectedImplicit = structuredClone(implicitCandidate) as Record<string, any>;
disconnectedImplicit.source.question = "Plot the implicit hyperbola xy=1";
disconnectedImplicit.constructions[0].inputs = {
  expression: "x*y-1",
  xMin: -3,
  xMax: 3,
  yMin: -3,
  yMax: 3,
  xSamples: 81,
  ySamples: 81,
};
const disconnectedDocument = validateSceneDocument(disconnectedImplicit).document;
const disconnectedCompiled = disconnectedDocument ? compileSceneDocument(disconnectedDocument) : null;
const disconnectedPrimitives = disconnectedCompiled?.renderScene?.primitives.filter((primitive) =>
  primitive.entityId === "curve" && primitive.kind === "polyline",
) ?? [];
if (!disconnectedCompiled?.ok || disconnectedPrimitives.length !== 2) {
  throw new Error(`implicit_curve joined disconnected hyperbola branches: ${JSON.stringify(disconnectedCompiled?.report.issues ?? disconnectedPrimitives)}`);
}

const invalidImplicitIdentifier = structuredClone(implicitCandidate) as Record<string, any>;
invalidImplicitIdentifier.constructions[0].inputs.expression = "x^2+z^2-4";
const invalidImplicitIdentifierResult = validateSceneDocument(invalidImplicitIdentifier);
if (
  invalidImplicitIdentifierResult.document ||
  !invalidImplicitIdentifierResult.report.issues.some((issue) => issue.code === "invalid_implicit_curve_expression")
) {
  throw new Error("implicit_curve accepted an identifier outside the safe x/y expression language");
}

const discontinuousImplicit = structuredClone(implicitCandidate) as Record<string, any>;
discontinuousImplicit.constructions[0].inputs.expression = "1/(x-y)";
const discontinuousImplicitResult = validateSceneDocument(discontinuousImplicit);
if (
  discontinuousImplicitResult.document ||
  !discontinuousImplicitResult.report.issues.some((issue) => issue.code === "invalid_implicit_curve_expression")
) {
  throw new Error("implicit_curve accepted a discontinuity inside its rectangular domain");
}

const invalidImplicitGrid = structuredClone(implicitCandidate) as Record<string, any>;
invalidImplicitGrid.constructions[0].inputs.xSamples = 12;
const invalidImplicitGridResult = validateSceneDocument(invalidImplicitGrid);
if (
  invalidImplicitGridResult.document ||
  !invalidImplicitGridResult.report.issues.some((issue) => issue.code === "invalid_implicit_curve_grid")
) {
  throw new Error("implicit_curve accepted an out-of-bounds sampling grid");
}

const emptyImplicit = structuredClone(implicitCandidate) as Record<string, any>;
emptyImplicit.constructions[0].inputs.expression = "x^2+y^2+1";
const emptyImplicitDocument = validateSceneDocument(emptyImplicit).document;
const emptyImplicitCompiled = emptyImplicitDocument ? compileSceneDocument(emptyImplicitDocument) : null;
if (emptyImplicitCompiled?.ok || !emptyImplicitCompiled?.report.issues.some((issue) => issue.code === "construction_failed")) {
  throw new Error("implicit_curve accepted an empty contour as a successful diagram");
}

const underResolvedImplicit = structuredClone(implicitCandidate) as Record<string, any>;
underResolvedImplicit.constructions[0].inputs = {
  expression: "sin(80*x)+y*0",
  xMin: -1,
  xMax: 1,
  yMin: -1,
  yMax: 1,
  xSamples: 17,
  ySamples: 17,
};
const underResolvedDocument = validateSceneDocument(underResolvedImplicit).document;
const underResolvedCompiled = underResolvedDocument ? compileSceneDocument(underResolvedDocument) : null;
if (underResolvedCompiled?.ok || !underResolvedCompiled?.report.issues.some((issue) => issue.code === "construction_failed")) {
  throw new Error("implicit_curve silently aliased a multiply-crossing grid edge");
}

const representativeSliceCandidate = structuredClone(functionCurveCandidate) as Record<string, any>;
representativeSliceCandidate.source.question = "Show a representative vertical slice between y=4 and y=x^2";
representativeSliceCandidate.entities[0] = { id: "lower", kind: "polyline", role: "function graph", label: "y=x^2" };
representativeSliceCandidate.entities.push(
  { id: "upper", kind: "polyline", role: "function graph", label: "y=4" },
  { id: "slice", kind: "segment", role: "representative slice" },
);
representativeSliceCandidate.constructions = [
  { id: "make_lower", operator: "function_curve", inputs: { expression: "x^2", xMin: -2, xMax: 2, samples: 65 }, outputs: ["lower"] },
  { id: "make_upper", operator: "function_curve", inputs: { expression: "4", xMin: -2, xMax: 2, samples: 65 }, outputs: ["upper"] },
  { id: "make_slice", operator: "representative_slice", inputs: { upper: "upper", lower: "lower", atX: 0 }, outputs: ["slice"] },
];
representativeSliceCandidate.assertions = [];
representativeSliceCandidate.requiredEntityIds = ["lower", "upper", "slice"];
representativeSliceCandidate.revealGroups[0].entityIds = ["lower", "upper", "slice"];
const sliceValidation = validateSceneDocument(representativeSliceCandidate);
const sliceCompiled = sliceValidation.document ? compileSceneDocument(sliceValidation.document) : null;
const slicePrimitive = sliceCompiled?.renderScene?.primitives.find((primitive) => primitive.entityId === "slice");
if (!sliceCompiled?.ok || slicePrimitive?.kind !== "line" || slicePrimitive.points.length !== 2) {
  throw new Error(`representative_slice failed deterministic compilation: ${JSON.stringify(sliceCompiled?.report.issues ?? sliceValidation.report.issues)}`);
}

const diskMethodCandidate = structuredClone(functionCurveCandidate) as Record<string, any>;
diskMethodCandidate.source.question = "The region under y = sqrt(x) from x = 0 to x = 4 is revolved about the x-axis. Sketch the region and representative disk.";
diskMethodCandidate.entities = [
  { id: "curve", kind: "polyline", role: "function graph", label: "y=sqrt(x)" },
  { id: "axis", kind: "polyline", role: "function graph", label: "y=0" },
  { id: "region", kind: "polygon", role: "region under the curve" },
  { id: "disk", kind: "polyline", role: "representative disk" },
  { id: "solid", kind: "polygon", role: "solid of revolution" },
];
diskMethodCandidate.constructions = [
  { id: "make_curve", operator: "function_curve", inputs: { expression: "sqrt(x)", xMin: 0, xMax: 4, samples: 65 }, outputs: ["curve"] },
  { id: "make_axis", operator: "function_curve", inputs: { expression: "0", xMin: 0, xMax: 4, samples: 65 }, outputs: ["axis"] },
  { id: "make_region", operator: "function_region", inputs: { upper: "curve", lower: "axis", xMin: 0, xMax: 4, samples: 65 }, outputs: ["region"] },
  { id: "make_disk", operator: "representative_slice", inputs: { upper: "curve", lower: "axis", atX: 1, method: "disk", axisY: 0 }, outputs: ["disk"] },
  { id: "make_solid", operator: "solid_of_revolution", inputs: { profile: "curve", axisY: 0, xMin: 0, xMax: 4, samples: 65 }, outputs: ["solid"] },
];
diskMethodCandidate.assertions = [
  { id: "curve_at_four", predicate: "function_value", entities: ["curve"], expected: { x: 4, y: 2 }, severity: "fatal" },
];
diskMethodCandidate.requiredEntityIds = ["curve", "axis", "region", "disk", "solid"];
diskMethodCandidate.revealGroups = [{ id: "graph", entityIds: ["curve", "axis", "region", "disk", "solid"], dependsOn: [], narrationCue: "show the disk method" }];
const diskValidation = validateSceneDocument(diskMethodCandidate);
const diskCompiled = diskValidation.document ? compileSceneDocument(diskValidation.document) : null;
const diskPrimitives = diskCompiled?.renderScene?.primitives.filter((primitive) => primitive.entityId === "disk") ?? [];
const diskEllipse = diskPrimitives.find((primitive) => primitive.points.length > 8);
const diskSpanY = diskEllipse
  ? Math.max(...diskEllipse.points.map((point) => point.y)) - Math.min(...diskEllipse.points.map((point) => point.y))
  : 0;
const diskSpanX = diskEllipse
  ? Math.max(...diskEllipse.points.map((point) => point.x)) - Math.min(...diskEllipse.points.map((point) => point.x))
  : 0;
if (
  !diskCompiled?.ok ||
  !diskEllipse ||
  diskSpanY < 1.5 ||
  diskSpanX < 0.1 ||
  diskSpanX >= diskSpanY
) {
  throw new Error(`representative disk compiled as a strip instead of a foreshortened circular face: ${JSON.stringify({
    issues: diskCompiled?.report.issues ?? diskValidation.report.issues,
    primitiveCount: diskPrimitives.length,
    kinds: diskPrimitives.map((primitive) => [primitive.kind, primitive.points.length]),
    diskSpanX,
    diskSpanY,
  })}`);
}
const solidPrimitives = diskCompiled.renderScene?.primitives.filter((primitive) => primitive.entityId === "solid") ?? [];
const curveScreen = diskCompiled.renderScene?.primitives.find((primitive) => primitive.entityId === "curve");
const curveMaxX = curveScreen ? Math.max(...curveScreen.points.map((point) => point.x)) : Number.NaN;
const solidEndCap = solidPrimitives.find((primitive) => {
  if (primitive.points.length < 8) return false;
  const xs = primitive.points.map((point) => point.x);
  const ys = primitive.points.map((point) => point.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
  return Number.isFinite(curveMaxX) && Math.abs(midX - curveMaxX) < 40 && spanY > spanX && spanX > 8;
});
if (!solidEndCap) {
  throw new Error(`solid_of_revolution omitted the circular end cap of the disk solid: ${JSON.stringify(solidPrimitives.map((primitive) => [primitive.kind, primitive.points.length]))}`);
}

const omittedDiskMethod = structuredClone(diskMethodCandidate) as Record<string, any>;
delete omittedDiskMethod.constructions.find((construction: Record<string, any>) => construction.operator === "representative_slice").inputs.method;
const omittedDiskValidation = validateSceneDocument(omittedDiskMethod);
const omittedDiskCompiled = omittedDiskValidation.document ? compileSceneDocument(omittedDiskValidation.document) : null;
const omittedDiskEllipse = omittedDiskCompiled?.renderScene?.primitives.find((primitive) =>
  primitive.entityId === "disk" && primitive.points.length > 8,
);
if (!omittedDiskCompiled?.ok || !omittedDiskEllipse) {
  throw new Error(`revolution stem with a strip slice was not repaired to a disk: ${JSON.stringify(omittedDiskCompiled?.report.issues ?? omittedDiskValidation.report.issues)}`);
}

const washerSliceCandidate = structuredClone(representativeSliceCandidate) as Record<string, any>;
washerSliceCandidate.source.question = "Draw a representative washer between y=4 and y=x^2";
washerSliceCandidate.constructions.find((construction: Record<string, any>) => construction.operator === "representative_slice").inputs = {
  upper: "upper",
  lower: "lower",
  atX: 1,
  method: "washer",
  axisY: 0,
};
washerSliceCandidate.entities.find((entity: Record<string, any>) => entity.id === "slice").kind = "polyline";
const washerValidation = validateSceneDocument(washerSliceCandidate);
const washerCompiled = washerValidation.document ? compileSceneDocument(washerValidation.document) : null;
const washerEllipses = (washerCompiled?.renderScene?.primitives.filter((primitive) => primitive.entityId === "slice") ?? [])
  .filter((primitive) => primitive.points.length > 8);
if (!washerCompiled?.ok || washerEllipses.length < 2) {
  throw new Error(`representative washer did not compile as two foreshortened circular faces: ${JSON.stringify(washerCompiled?.report.issues ?? washerValidation.report.issues)}`);
}

const diskOffAxis = structuredClone(washerSliceCandidate) as Record<string, any>;
diskOffAxis.constructions.find((construction: Record<string, any>) => construction.operator === "representative_slice").inputs.method = "disk";
const diskOffAxisResult = validateSceneDocument(diskOffAxis);
if (diskOffAxisResult.document || !diskOffAxisResult.report.issues.some((issue) => issue.code === "invalid_representative_slice_disk")) {
  throw new Error("representative_slice method disk accepted a washer (inner radius off the axis)");
}

const solidProfileCandidate = structuredClone(functionCurveCandidate) as Record<string, any>;
solidProfileCandidate.source.question = "Show the profile made by revolving y=4-x^2 about the x-axis from -2 to 2";
solidProfileCandidate.entities[0] = { id: "profile", kind: "polyline", role: "function graph", label: "y=4-x^2" };
solidProfileCandidate.entities.push({ id: "solid", kind: "polygon", role: "solid of revolution" });
solidProfileCandidate.constructions = [
  { id: "make_profile", operator: "function_curve", inputs: { expression: "4-x^2", xMin: -2, xMax: 2, samples: 65 }, outputs: ["profile"] },
  { id: "make_solid", operator: "solid_of_revolution", inputs: { profile: "profile", axisY: 0, xMin: -2, xMax: 2, samples: 65 }, outputs: ["solid"] },
];
solidProfileCandidate.assertions = [];
solidProfileCandidate.requiredEntityIds = ["profile", "solid"];
solidProfileCandidate.revealGroups[0].entityIds = ["profile", "solid"];
const solidValidation = validateSceneDocument(solidProfileCandidate);
const solidCompiled = solidValidation.document ? compileSceneDocument(solidValidation.document) : null;
const solidProfilePrimitive = solidCompiled?.renderScene?.primitives.filter((primitive) => primitive.entityId === "solid" && primitive.kind !== "label") ?? [];
if (
  !solidCompiled?.ok ||
  solidProfilePrimitive.length < 2 ||
  !solidProfilePrimitive.some((primitive) => primitive.kind === "polyline" && primitive.points.length === 65)
) {
  throw new Error(`solid_of_revolution failed deterministic profile compilation: ${JSON.stringify(solidCompiled?.report.issues ?? solidValidation.report.issues)}`);
}

const discontinuousParametric = structuredClone(parametricCandidate) as Record<string, any>;
discontinuousParametric.constructions[0].inputs.xExpression = "1/(t-0.12345)";
const discontinuousParametricResult = validateSceneDocument(discontinuousParametric);
if (discontinuousParametricResult.document || !discontinuousParametricResult.report.issues.some((issue) => issue.code === "invalid_parametric_curve_expression")) {
  throw new Error("discontinuous parametric_curve passed early validation");
}

const boundaryTangent = structuredClone(parametricCandidate) as Record<string, any>;
boundaryTangent.constructions.find((construction: Record<string, any>) => construction.operator === "tangent_line").inputs.at = 0;
const boundaryTangentResult = validateSceneDocument(boundaryTangent);
if (boundaryTangentResult.document || !boundaryTangentResult.report.issues.some((issue) => issue.code === "invalid_tangent_line_parameter")) {
  throw new Error("tangent_line accepted a parameter at the domain boundary");
}

const nondifferentiableTangent = structuredClone(functionCurveCandidate) as Record<string, any>;
nondifferentiableTangent.entities.push({ id: "tangent", kind: "line", role: "tangent line" });
nondifferentiableTangent.constructions[0].inputs = { expression: "abs(x)", xMin: -1, xMax: 1, samples: 65 };
nondifferentiableTangent.constructions.push({ id: "make_tangent", operator: "tangent_line", inputs: { curve: "curve", at: 0 }, outputs: ["tangent"] });
nondifferentiableTangent.assertions = [];
nondifferentiableTangent.requiredEntityIds.push("tangent");
nondifferentiableTangent.revealGroups[0].entityIds.push("tangent");
const nondifferentiableDocument = validateSceneDocument(nondifferentiableTangent).document;
const nondifferentiableCompiled = nondifferentiableDocument ? compileSceneDocument(nondifferentiableDocument) : null;
if (nondifferentiableCompiled?.ok || !nondifferentiableCompiled?.report.issues.some((issue) => issue.code === "construction_failed")) {
  throw new Error("tangent_line accepted a nondifferentiable cusp");
}

const spaceCandidate = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "two lines in space" },
  source: { question: "Find the shortest distance between two skew lines." },
  quantities: [],
  entities: [
    { id: "origin2d", kind: "point", role: "frame origin" },
    { id: "frame", kind: "polyline", role: "space frame" },
    { id: "A", kind: "point", role: "space point", label: "A" },
    { id: "l1", kind: "line", role: "space line" },
    { id: "pi", kind: "polygon", role: "plane patch" },
  ],
  constructions: [
    { id: "make_origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["origin2d"] },
    { id: "make_frame", operator: "space_frame", inputs: { origin: "origin2d", scale: 1, axisLength: 2 }, outputs: ["frame"] },
    { id: "make_A", operator: "space_point", inputs: { frame: "frame", x: 1, y: 2, z: 3 }, outputs: ["A"] },
    { id: "make_l1", operator: "space_line", inputs: { frame: "frame", point: "A", direction: [2, 3, 6], tMin: -1, tMax: 1 }, outputs: ["l1"] },
    { id: "make_plane", operator: "plane", inputs: { frame: "frame", a: 1, b: 0, c: 1, d: 2, span: 2 }, outputs: ["pi"] },
  ],
  relations: [],
  assertions: [
    { id: "l1_exists", predicate: "exists", entities: ["l1"], expected: true, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["origin2d", "frame", "A", "l1", "pi"],
  revealGroups: [{ id: "space", entityIds: ["origin2d", "frame", "A", "l1", "pi"], dependsOn: [], narrationCue: "show the frame" }],
  teachingTimeline: [{ id: "show_space", action: "reveal", targetId: "space", dependsOn: [], narrationIntent: "3D setup" }],
};
const spaceValidation = validateSceneDocument(spaceCandidate);
const spaceCompiled = spaceValidation.document ? compileSceneDocument(spaceValidation.document) : null;
if (!spaceCompiled?.ok || !spaceCompiled.renderScene) {
  throw new Error(`space operators failed to compile: ${JSON.stringify(spaceCompiled?.report.issues ?? spaceValidation.report.issues)}`);
}
if (!spaceCompiled.renderScene.primitives.some((primitive) => primitive.entityId === "l1")) {
  throw new Error("space_line did not emit visible primitives");
}
if (!spaceCompiled.renderScene.primitives.some((primitive) => primitive.entityId === "pi")) {
  throw new Error("plane did not emit a visible patch");
}

const zeroNormalPlane = structuredClone(spaceCandidate) as Record<string, any>;
zeroNormalPlane.constructions[4].inputs = { frame: "frame", a: 0, b: 0, c: 0, d: 1, span: 2 };
const zeroNormalResult = validateSceneDocument(zeroNormalPlane);
if (zeroNormalResult.document || !zeroNormalResult.report.issues.some((issue) => issue.code === "invalid_plane_cartesian")) {
  throw new Error("plane accepted a zero normal");
}

const reversedSlice = structuredClone(representativeSliceCandidate) as Record<string, any>;
const reversedSliceConstruction = reversedSlice.constructions.find((construction: Record<string, any>) => construction.operator === "representative_slice");
[reversedSliceConstruction.inputs.upper, reversedSliceConstruction.inputs.lower] = [reversedSliceConstruction.inputs.lower, reversedSliceConstruction.inputs.upper];
const reversedSliceResult = validateSceneDocument(reversedSlice);
if (reversedSliceResult.document || !reversedSliceResult.report.issues.some((issue) => issue.code === "invalid_representative_slice_order")) {
  throw new Error("representative_slice accepted reversed curve ordering");
}

const crossingSolid = structuredClone(solidProfileCandidate) as Record<string, any>;
crossingSolid.constructions[0].inputs = { expression: "x", xMin: -1, xMax: 1, samples: 65 };
crossingSolid.constructions[1].inputs.xMin = -1;
crossingSolid.constructions[1].inputs.xMax = 1;
const crossingSolidResult = validateSceneDocument(crossingSolid);
if (crossingSolidResult.document || !crossingSolidResult.report.issues.some((issue) => issue.code === "invalid_solid_of_revolution_profile")) {
  throw new Error("solid_of_revolution accepted a profile crossing its axis");
}

const invalidPolarSamples = structuredClone(polarCandidate) as Record<string, any>;
invalidPolarSamples.constructions[0].inputs.samples = 64;
const invalidPolarResult = validateSceneDocument(invalidPolarSamples);
if (invalidPolarResult.document || !invalidPolarResult.report.issues.some((issue) => issue.code === "invalid_polar_curve_samples")) {
  throw new Error("polar_curve accepted an invalid even sample count");
}

const reversedConvergence = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "reject rays that point away from the asserted target" },
  source: { question: "Two backward rays do not converge on the marked point." },
  quantities: [],
  entities: [
    { id: "target", kind: "point", role: "claimed convergence point", label: "P" },
    { id: "ray1_start", kind: "point", role: "ray start" },
    { id: "ray1_end", kind: "point", role: "ray direction point" },
    { id: "ray2_start", kind: "point", role: "ray start" },
    { id: "ray2_end", kind: "point", role: "ray direction point" },
    { id: "ray1", kind: "ray", role: "ray" },
    { id: "ray2", kind: "ray", role: "ray" },
  ],
  constructions: [
    { id: "make_target", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["target"] },
    { id: "make_ray1_start", operator: "point", inputs: { x: 1000, y: 0 }, outputs: ["ray1_start"] },
    { id: "make_ray1_end", operator: "point", inputs: { x: 2000, y: 0 }, outputs: ["ray1_end"] },
    { id: "make_ray2_start", operator: "point", inputs: { x: 0, y: 1000 }, outputs: ["ray2_start"] },
    { id: "make_ray2_end", operator: "point", inputs: { x: 0, y: 2000 }, outputs: ["ray2_end"] },
    { id: "make_ray1", operator: "ray", inputs: { start: "ray1_start", end: "ray1_end" }, outputs: ["ray1"] },
    { id: "make_ray2", operator: "ray", inputs: { start: "ray2_start", end: "ray2_end" }, outputs: ["ray2"] },
  ],
  relations: [],
  assertions: [
    { id: "backward_convergence", predicate: "converges", entities: ["ray1", "ray2", "target"], severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["target", "ray1_start", "ray1_end", "ray2_start", "ray2_end", "ray1", "ray2"],
  revealGroups: [{ id: "rays", entityIds: ["target", "ray1_start", "ray1_end", "ray2_start", "ray2_end", "ray1", "ray2"], dependsOn: [], narrationCue: "show the claimed convergence" }],
  teachingTimeline: [{ id: "show_rays", action: "reveal", targetId: "rays", dependsOn: [], narrationIntent: "show the claimed convergence" }],
};
const reversedConvergenceDocument = validateSceneDocument(reversedConvergence).document;
const reversedConvergenceCompiled = reversedConvergenceDocument
  ? compileSceneDocument(reversedConvergenceDocument)
  : null;
if (reversedConvergenceCompiled?.ok || !reversedConvergenceCompiled?.report.issues.some((issue) => issue.code === "assertion_failed")) {
  throw new Error("convergence assertions accepted rays whose directions point away from the target");
}

const outOfBoundsSurfaceIntersection = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "reject line-only hits outside a finite surface" },
  source: { question: "A ray missing a finite mirror segment must not register a hit." },
  quantities: [],
  entities: [
    { id: "segment_start", kind: "point", role: "surface endpoint" },
    { id: "segment_end", kind: "point", role: "surface endpoint" },
    { id: "ray_origin", kind: "point", role: "ray origin" },
    { id: "ray_through", kind: "point", role: "ray direction point" },
    { id: "surface", kind: "segment", role: "mirror segment" },
    { id: "hit", kind: "point", role: "intersection point" },
  ],
  constructions: [
    { id: "make_segment_start", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["segment_start"] },
    { id: "make_segment_end", operator: "point", inputs: { x: 1, y: 0 }, outputs: ["segment_end"] },
    { id: "make_origin", operator: "point", inputs: { x: 2, y: 1 }, outputs: ["ray_origin"] },
    { id: "make_through", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["ray_through"] },
    { id: "make_surface", operator: "segment", inputs: { start: "segment_start", end: "segment_end" }, outputs: ["surface"] },
    { id: "make_hit", operator: "surface_intersection", inputs: { origin: "ray_origin", through: "ray_through", surface: "surface" }, outputs: ["hit"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["segment_start", "segment_end", "ray_origin", "ray_through", "surface", "hit"],
  revealGroups: [{ id: "setup", entityIds: ["segment_start", "segment_end", "ray_origin", "ray_through", "surface", "hit"], dependsOn: [], narrationCue: "show the attempted hit" }],
  teachingTimeline: [{ id: "show_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show the attempted hit" }],
};
const outOfBoundsSurfaceDocument = validateSceneDocument(outOfBoundsSurfaceIntersection).document;
const outOfBoundsSurfaceCompiled = outOfBoundsSurfaceDocument
  ? compileSceneDocument(outOfBoundsSurfaceDocument)
  : null;
if (outOfBoundsSurfaceCompiled?.ok || !outOfBoundsSurfaceCompiled?.report.issues.some((issue) => issue.code === "construction_failed")) {
  throw new Error("surface_intersection accepted a hit outside the finite segment bounds");
}

const densePathCountDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "guard pathCount against dense-graph explosion" },
  source: { question: "Count every simple path in a dense graph." },
  quantities: [],
  entities: [] as Array<Record<string, unknown>>,
  constructions: [] as Array<Record<string, unknown>>,
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: [],
  revealGroups: [],
  teachingTimeline: [],
};
for (let index = 0; index < 11; index += 1) {
  densePathCountDocument.entities.push({ id: `n${index}`, kind: "point", role: "graph node" });
  densePathCountDocument.constructions.push({
    id: `make_n${index}`,
    operator: "point",
    inputs: { x: index, y: index % 3 },
    outputs: [`n${index}`],
  });
}
for (let start = 0; start < 11; start += 1) {
  for (let end = start + 1; end < 11; end += 1) {
    densePathCountDocument.entities.push({ id: `e_${start}_${end}`, kind: "component", role: "edge" });
    densePathCountDocument.constructions.push({
      id: `make_e_${start}_${end}`,
      operator: "symbol",
      inputs: { symbol: "resistor", start: `n${start}`, end: `n${end}` },
      outputs: [`e_${start}_${end}`],
    });
  }
}
const denseIssues: SceneIssue[] = [];
const densePathCountPassed = evaluateTopologyAssertion(
  { id: "dense_paths", predicate: "pathCount", entities: ["n0", "n10"], expected: 1, severity: "fatal" },
  densePathCountDocument as any,
  denseIssues,
);
if (
  densePathCountPassed !== false ||
  !denseIssues.some((issue) =>
    issue.code === "assertion_failed" &&
    /too complex|capped|limit/i.test(issue.message))
) {
  throw new Error(`pathCount did not fail closed on dense graphs: ${JSON.stringify(denseIssues)}`);
}

for (const symbol of [
  "resistor",
  "battery",
  "cell",
  "capacitor",
  "inductor",
  "lamp",
  "galvanometer",
  "ammeter",
  "voltmeter",
  "ac_source",
  "diode",
  "zener",
  "switch",
]) {
  const symbolCandidate = {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: `verify ${symbol}` },
    source: { question: `draw a ${symbol}` },
    quantities: [],
    entities: [
      { id: "left", kind: "point", role: "terminal" },
      { id: "right", kind: "point", role: "terminal" },
      { id: "component", kind: "component", role: symbol, label: symbol === "galvanometer" ? "G" : undefined },
    ],
    constructions: [
      { id: "make_left", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["left"] },
      { id: "make_right", operator: "point", inputs: { x: 4, y: 0, coordinateSpace: "layout" }, outputs: ["right"] },
      { id: "make_component", operator: "symbol", inputs: { symbol, start: "left", end: "right" }, outputs: ["component"] },
    ],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ["component"],
    revealGroups: [{ id: "setup", entityIds: ["component"], dependsOn: [], narrationCue: `show ${symbol}` }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: `draw ${symbol}` }],
  };
  const symbolValidation = validateSceneDocument(symbolCandidate);
  const symbolCompiled = symbolValidation.document
    ? compileSceneDocument(symbolValidation.document)
    : null;
  if (
    !symbolCompiled?.ok ||
    !symbolCompiled.renderScene?.primitives.some((primitive) => primitive.entityId === "component")
  ) {
    throw new Error(
      `${symbol} symbol did not compile: ${JSON.stringify(symbolCompiled?.report.issues ?? symbolValidation.report.issues)}`,
    );
  }
}

const pulleyApparatus = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "pulley incline apparatus" },
  source: { question: "A 2 kg block on a 37 degree incline is connected over a pulley to a 3 kg hanging block. Draw the apparatus." },
  quantities: [],
  entities: [
    { id: "origin", kind: "point", role: "layout origin" },
    { id: "incline_base", kind: "point", role: "incline foot" },
    { id: "incline_top", kind: "point", role: "incline head" },
    { id: "pulley_center", kind: "point", role: "pulley axis" },
    { id: "m1_center", kind: "point", role: "block center" },
    { id: "m2_center", kind: "point", role: "hanging center" },
    { id: "incline_surface", kind: "line", role: "inclined plane" },
    { id: "incline_ground", kind: "segment", role: "ground" },
    { id: "ground_line", kind: "line", role: "ground line" },
    { id: "pulley_circle", kind: "circle", role: "pulley" },
    { id: "m1_block", kind: "polygon", role: "incline block" },
    { id: "m2_block", kind: "polygon", role: "hanging block" },
    { id: "string_incline", kind: "segment", role: "string" },
    { id: "string_hang", kind: "segment", role: "string" },
  ],
  constructions: [
    { id: "make_origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["origin"] },
    { id: "make_base", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["incline_base"] },
    { id: "make_top", operator: "point", inputs: { x: 6, y: 3, coordinateSpace: "layout" }, outputs: ["incline_top"] },
    { id: "make_pulley", operator: "point", inputs: { x: 6, y: 5, coordinateSpace: "layout" }, outputs: ["pulley_center"] },
    { id: "make_m1", operator: "point", inputs: { x: 4, y: 2, coordinateSpace: "layout" }, outputs: ["m1_center"] },
    { id: "make_m2", operator: "point", inputs: { x: 8, y: 2, coordinateSpace: "layout" }, outputs: ["m2_center"] },
    { id: "make_incline", operator: "line", inputs: { start: "incline_base", end: "incline_top" }, outputs: ["incline_surface"] },
    { id: "make_ground", operator: "segment", inputs: { start: "origin", end: "incline_base" }, outputs: ["incline_ground"] },
    { id: "make_ground_line", operator: "line", inputs: { start: "origin", end: "incline_base" }, outputs: ["ground_line"] },
    { id: "make_pulley_circle", operator: "circle", inputs: { center: "pulley_center", radius: 0.5 }, outputs: ["pulley_circle"] },
    { id: "make_m1_block", operator: "rectangle", inputs: { center: "m1_center", width: 0.8, height: 0.6 }, outputs: ["m1_block"] },
    { id: "make_m2_block", operator: "rectangle", inputs: { center: "m2_center", width: 0.8, height: 0.6 }, outputs: ["m2_block"] },
    { id: "make_string_1", operator: "segment", inputs: { start: "m1_center", end: "pulley_center" }, outputs: ["string_incline"] },
    { id: "make_string_2", operator: "segment", inputs: { start: "pulley_center", end: "m2_center" }, outputs: ["string_hang"] },
  ],
  relations: [],
  assertions: [
    { id: "incline_angle", predicate: "angle_between", entities: ["ground_line", "incline_surface"], expected: { value: 37, unit: "degree" }, severity: "fatal" },
    { id: "m1_on_incline", predicate: "on", entities: ["m1_center", "incline_surface"], expected: true, severity: "fatal" },
    { id: "string_to_m1", predicate: "connected", entities: ["string_incline", "m1_block", "pulley_circle"], expected: true, severity: "fatal" },
    { id: "string_to_m2", predicate: "connected", entities: ["string_hang", "pulley_circle", "m2_block"], expected: true, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: [
    "origin", "incline_base", "incline_top", "pulley_center", "m1_center", "m2_center",
    "incline_surface", "incline_ground", "ground_line", "pulley_circle", "m1_block", "m2_block",
    "string_incline", "string_hang",
  ],
  revealGroups: [
    {
      id: "apparatus",
      entityIds: [
        "incline_base", "incline_top", "pulley_center", "m1_center", "m2_center",
        "incline_surface", "incline_ground", "ground_line", "pulley_circle", "m1_block", "m2_block",
        "string_incline", "string_hang",
      ],
    },
    { id: "fbd", entityIds: [] },
  ],
  teachingTimeline: [
    { action: "reveal", targetIds: ["apparatus"] },
    { action: "annotate", targetIds: ["a", "T"] },
  ],
};
const pulleyValidated = validateSceneDocument(pruneDeadSceneEntities(pulleyApparatus));
const pulleyCompiled = pulleyValidated.document ? compileSceneDocument(pulleyValidated.document) : null;
if (!pulleyValidated.document || !pulleyCompiled?.ok) {
  throw new Error(`pulley apparatus scene did not compile: ${JSON.stringify({
    validation: pulleyValidated.report.issues,
    compile: pulleyCompiled?.report.issues,
    groupedOrigin: pulleyValidated.document?.revealGroups.some((group) => group.entityIds.includes("origin")),
  })}`);
}
if (pulleyValidated.document.teachingTimeline.some((action) => action.targetId === "a")) {
  throw new Error("quantity-only timeline actions must be dropped");
}

const farOnPoint = structuredClone(pulleyApparatus) as Record<string, any>;
farOnPoint.entities = [
  { id: "p", kind: "point", role: "isolated point" },
  { id: "axis", kind: "line", role: "axis" },
];
farOnPoint.constructions = [
  { id: "make_p", operator: "point", inputs: { x: 0, y: 4, coordinateSpace: "layout" }, outputs: ["p"] },
  { id: "make_axis", operator: "line", inputs: { start: { x: 0, y: 0, coordinateSpace: "layout" }, end: { x: 4, y: 0, coordinateSpace: "layout" } }, outputs: ["axis"] },
];
farOnPoint.assertions = [
  { id: "false_on", predicate: "on", entities: ["p", "axis"], expected: true, severity: "fatal" },
];
farOnPoint.requiredEntityIds = ["p", "axis"];
farOnPoint.revealGroups = [{ id: "setup", entityIds: ["p", "axis"] }];
farOnPoint.teachingTimeline = [{ action: "reveal", targetId: "setup" }];
const farOnCompiled = compileSceneDocument(validateSceneDocument(pruneDeadSceneEntities(farOnPoint)).document!);
if (farOnCompiled.ok || !farOnCompiled.report.issues.some((issue) => issue.code === "assertion_failed")) {
  throw new Error("a point far from a line must still fail on");
}

const pvCycleSiUnits = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "clockwise rectangular P-V cycle" },
  source: {
    question: "A gas executes the clockwise rectangular cycle A(V0,P0) to D(V0,2P0) to C(2V0,2P0) to B(2V0,P0) to A. Draw the directed P-V cycle.",
  },
  quantities: [
    { id: "P0", value: 1e5, unit: "Pa" },
    { id: "V0", value: 2e-3, unit: "m^3" },
  ],
  entities: [
    { id: "A", kind: "point", role: "corner", label: "A" },
    { id: "D", kind: "point", role: "corner", label: "D" },
    { id: "C", kind: "point", role: "corner", label: "C" },
    { id: "B", kind: "point", role: "corner", label: "B" },
    { id: "AD", kind: "segment", role: "isochoric" },
    { id: "DC", kind: "segment", role: "isobaric" },
    { id: "CB", kind: "segment", role: "isochoric" },
    { id: "BA", kind: "segment", role: "isobaric" },
    { id: "cycle", kind: "polyline", role: "P-V cycle" },
    { id: "Paxis", kind: "line", role: "P axis", label: "P" },
    { id: "Vaxis", kind: "line", role: "V axis" },
    { id: "V_label", kind: "label", role: "axis label" },
  ],
  constructions: [
    { id: "make_A", operator: "point", inputs: { x: 0.002, y: 1e5, coordinateSpace: "world" }, outputs: ["A"] },
    { id: "make_D", operator: "point", inputs: { x: 0.002, y: 2e5, coordinateSpace: "world" }, outputs: ["D"] },
    { id: "make_C", operator: "point", inputs: { x: 0.004, y: 2e5, coordinateSpace: "world" }, outputs: ["C"] },
    { id: "make_B", operator: "point", inputs: { x: 0.004, y: 1e5, coordinateSpace: "world" }, outputs: ["B"] },
    { id: "make_AD", operator: "segment", inputs: { start: "A", end: "D" }, outputs: ["AD"] },
    { id: "make_DC", operator: "segment", inputs: { start: "D", end: "C" }, outputs: ["DC"] },
    { id: "make_CB", operator: "segment", inputs: { start: "C", end: "B" }, outputs: ["CB"] },
    { id: "make_BA", operator: "segment", inputs: { start: "B", end: "A" }, outputs: ["BA"] },
    { id: "make_cycle", operator: "polyline", inputs: { points: ["A", "D", "C", "B", "A"] }, outputs: ["cycle"] },
    { id: "make_Paxis", operator: "line", inputs: { start: "A", direction: [0, 1] }, outputs: ["Paxis"] },
    { id: "make_Vaxis", operator: "line", inputs: { start: "A", direction: [1, 0] }, outputs: ["Vaxis"] },
    { id: "lbl_V", operator: "label", inputs: { target: "Vaxis", text: "V" }, outputs: ["V_label"] },
  ],
  relations: [],
  assertions: [
    { id: "right_adc", predicate: "perpendicular", entities: ["AD", "DC"], expected: true, severity: "fatal" },
    { id: "right_dcb", predicate: "perpendicular", entities: ["DC", "CB"], expected: true, severity: "fatal" },
    { id: "closed", predicate: "connected", entities: ["A", "D", "C", "B"], expected: true, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["A", "D", "C", "B", "AD", "DC", "CB", "BA", "cycle", "Paxis", "Vaxis", "V_label"],
  revealGroups: [{
    id: "cycle_group",
    entityIds: ["A", "D", "C", "B", "AD", "DC", "CB", "BA", "cycle", "Paxis", "Vaxis", "V_label"],
    dependsOn: [],
    narrationCue: "draw the P-V cycle",
  }],
  teachingTimeline: [{ action: "reveal", targetIds: ["cycle_group"] }],
};
const pvCycleValidated = validateSceneDocument(pruneDeadSceneEntities(pvCycleSiUnits));
const pvCycleCompiled = pvCycleValidated.document
  ? compileSceneDocument(pvCycleValidated.document)
  : null;
if (!pvCycleValidated.document || !pvCycleCompiled?.ok || !pvCycleCompiled.renderScene) {
  throw new Error(`SI P-V cycle did not compile: ${JSON.stringify({
    validation: pvCycleValidated.report.issues,
    compile: pvCycleCompiled?.report.issues,
  })}`);
}
const pvCyclePrimitive = pvCycleCompiled.renderScene.primitives.find((primitive) =>
  primitive.entityId === "cycle" && primitive.kind === "polyline",
);
if (!pvCyclePrimitive) throw new Error("SI P-V cycle produced no polyline primitive");
const pvXs = [...new Set(pvCyclePrimitive.points.map((point) => point.x))];
const pvYs = [...new Set(pvCyclePrimitive.points.map((point) => point.y))];
const pvWidth = Math.max(...pvXs) - Math.min(...pvXs);
const pvHeight = Math.max(...pvYs) - Math.min(...pvYs);
if (pvXs.length < 2 || pvYs.length < 2 || pvWidth < 80 || pvHeight < 80) {
  throw new Error(`SI P-V rectangle collapsed under Euclidean fit: ${JSON.stringify({
    xs: pvXs,
    ys: pvYs,
    width: pvWidth,
    height: pvHeight,
  })}`);
}
const renderedCorner = (id: string) => {
  const primitive = pvCycleCompiled.renderScene!.primitives.find((item) =>
    item.entityId === id && item.kind === "point",
  );
  if (!primitive?.points[0]) throw new Error(`missing rendered corner ${id}`);
  return primitive.points[0];
};
const renderedA = renderedCorner("A");
const renderedC = renderedCorner("C");
if (!(renderedC.x > renderedA.x + 40) || !(renderedC.y < renderedA.y - 40)) {
  throw new Error(`SI P-V corners are not a screen-space rectangle: ${JSON.stringify({ renderedA, renderedC })}`);
}

const euclideanSquare = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "axis-aligned Euclidean square" },
  source: { question: "Draw square ABCD with side 2." },
  quantities: [],
  entities: [
    { id: "A", kind: "point", role: "vertex" },
    { id: "B", kind: "point", role: "vertex" },
    { id: "C", kind: "point", role: "vertex" },
    { id: "D", kind: "point", role: "vertex" },
    { id: "square", kind: "polygon", role: "square" },
  ],
  constructions: [
    { id: "make_A", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["A"] },
    { id: "make_B", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "layout" }, outputs: ["B"] },
    { id: "make_C", operator: "point", inputs: { x: 2, y: 2, coordinateSpace: "layout" }, outputs: ["C"] },
    { id: "make_D", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "layout" }, outputs: ["D"] },
    { id: "make_square", operator: "polygon", inputs: { points: ["A", "B", "C", "D"] }, outputs: ["square"] },
  ],
  relations: [],
  assertions: [],
  annotations: [],
  requiredEntityIds: ["A", "B", "C", "D", "square"],
  revealGroups: [{ id: "figure", entityIds: ["A", "B", "C", "D", "square"] }],
  teachingTimeline: [{ action: "reveal", targetId: "figure" }],
};
const squareCompiled = compileSceneDocument(
  validateSceneDocument(pruneDeadSceneEntities(euclideanSquare)).document!,
);
const squarePrimitive = squareCompiled.renderScene?.primitives.find((primitive) =>
  primitive.entityId === "square",
);
if (!squareCompiled.ok || !squarePrimitive) {
  throw new Error(`Euclidean square did not compile: ${JSON.stringify(squareCompiled.report.issues)}`);
}
const squareWidth = Math.max(...squarePrimitive.points.map((point) => point.x)) -
  Math.min(...squarePrimitive.points.map((point) => point.x));
const squareHeight = Math.max(...squarePrimitive.points.map((point) => point.y)) -
  Math.min(...squarePrimitive.points.map((point) => point.y));
if (Math.abs(squareWidth - squareHeight) / Math.max(squareWidth, squareHeight) > 0.15) {
  throw new Error(`Euclidean square was stretched by plot-axis scaling: ${JSON.stringify({
    squareWidth,
    squareHeight,
  })}`);
}

const skewedSiRegion = structuredClone(pvCycleSiUnits) as Record<string, any>;
skewedSiRegion.source.question = "Draw the parallelogram with vertices at incommensurable scales.";
skewedSiRegion.constructions = [
  { id: "make_A", operator: "point", inputs: { x: 0.002, y: 1e5, coordinateSpace: "world" }, outputs: ["A"] },
  { id: "make_D", operator: "point", inputs: { x: 0.0025, y: 2e5, coordinateSpace: "world" }, outputs: ["D"] },
  { id: "make_C", operator: "point", inputs: { x: 0.004, y: 2.05e5, coordinateSpace: "world" }, outputs: ["C"] },
  { id: "make_B", operator: "point", inputs: { x: 0.0035, y: 1.05e5, coordinateSpace: "world" }, outputs: ["B"] },
  { id: "make_AD", operator: "segment", inputs: { start: "A", end: "D" }, outputs: ["AD"] },
  { id: "make_DC", operator: "segment", inputs: { start: "D", end: "C" }, outputs: ["DC"] },
  { id: "make_CB", operator: "segment", inputs: { start: "C", end: "B" }, outputs: ["CB"] },
  { id: "make_BA", operator: "segment", inputs: { start: "B", end: "A" }, outputs: ["BA"] },
  { id: "make_cycle", operator: "polyline", inputs: { points: ["A", "D", "C", "B", "A"] }, outputs: ["cycle"] },
  { id: "make_Paxis", operator: "line", inputs: { start: "A", direction: [0, 1] }, outputs: ["Paxis"] },
  { id: "make_Vaxis", operator: "line", inputs: { start: "A", direction: [1, 0] }, outputs: ["Vaxis"] },
  { id: "lbl_V", operator: "label", inputs: { target: "Vaxis", text: "V" }, outputs: ["V_label"] },
];
skewedSiRegion.assertions = [];
const skewedCompiled = compileSceneDocument(
  validateSceneDocument(pruneDeadSceneEntities(skewedSiRegion)).document!,
);
if (
  skewedCompiled.ok ||
  !skewedCompiled.report.issues.some((issue) => issue.code === "degenerate_projected_geometry")
) {
  throw new Error("a non-axis-aligned 2D region that collapses on screen must fail closed");
}

const prismMinDeviationPlanner = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/regression/prism-min-deviation-planner-v1.json"),
    "utf8",
  ),
) as Record<string, unknown>;
const prismValidated = validateSceneDocument(pruneDeadSceneEntities(prismMinDeviationPlanner));
const prismCompiled = prismValidated.document
  ? compileSceneDocument(prismValidated.document)
  : null;
if (!prismValidated.document || !prismCompiled?.ok || !prismCompiled.renderScene) {
  throw new Error(`prism minimum-deviation planner scene did not compile: ${JSON.stringify({
    validation: prismValidated.report.issues,
    compile: prismCompiled?.report.issues,
  })}`);
}
const prismInternal = prismCompiled.renderScene.primitives.find((primitive) =>
  primitive.entityId === "internal_ray"
);
if (!prismInternal || prismInternal.points.length < 2) {
  throw new Error("prism internal ray was not rendered");
}
const prismInternalSpan = Math.hypot(
  prismInternal.points[0]!.x - prismInternal.points.at(-1)!.x,
  prismInternal.points[0]!.y - prismInternal.points.at(-1)!.y,
);
if (prismInternalSpan < 40) {
  throw new Error(`prism internal ray collapsed: ${JSON.stringify(prismInternal.points)}`);
}
const prismIncident = prismCompiled.renderScene.primitives.find((primitive) =>
  primitive.entityId === "incident_ray"
);
const prismEmergent = prismCompiled.renderScene.primitives.find((primitive) =>
  primitive.entityId === "emergent_ray"
);
if (!prismIncident || !prismEmergent) {
  throw new Error("prism ray path is missing an incident or emergent ray");
}

const hingedRodTwoPositions = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "hinged rod horizontal and vertical poses" },
  source: {
    question: "A thin uniform rod is hinged at one end and held horizontal. Draw the rod in the horizontal and vertical positions, mark the hinge and the weight.",
  },
  quantities: [],
  entities: [
    { id: "hinge", kind: "point", role: "hinge" },
    { id: "free_h", kind: "point", role: "free end" },
    { id: "rod_h", kind: "segment", role: "horizontal rod" },
    { id: "free_v", kind: "point", role: "free end vertical" },
    { id: "rod_v", kind: "segment", role: "vertical rod" },
    { id: "cm_v", kind: "point", role: "centre of mass" },
    { id: "weight", kind: "vector", role: "weight" },
    { id: "hinge_label", kind: "label", role: "hinge label", label: "O" },
  ],
  constructions: [
    { id: "make_hinge", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["hinge"] },
    { id: "make_free_h", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "world" }, outputs: ["free_h"] },
    { id: "make_rod_h", operator: "segment", inputs: { start: "hinge", end: "free_h" }, outputs: ["rod_h"] },
    { id: "make_free_v", operator: "rotate", inputs: { point: "free_h", center: "hinge", angle: -90, angleUnit: "degrees" }, outputs: ["free_v"] },
    { id: "make_rod_v", operator: "segment", inputs: { start: "hinge", end: "free_v" }, outputs: ["rod_v"] },
    { id: "make_cm_v", operator: "midpoint", inputs: { a: "hinge", b: "free_v" }, outputs: ["cm_v"] },
    { id: "make_weight", operator: "vector", inputs: { start: "cm_v", end: { x: 0.5, y: -1.5, coordinateSpace: "world" } }, outputs: ["weight"] },
    { id: "make_hinge_label", operator: "label", inputs: { target: "hinge", text: "O" }, outputs: ["hinge_label"] },
  ],
  relations: [],
  assertions: [
    { id: "same_length", predicate: "equal_length", entities: ["rod_h", "rod_v"], expected: true, severity: "fatal" },
    { id: "hinge_shared", predicate: "connected", entities: ["rod_h", "rod_v"], expected: true, severity: "fatal" },
    { id: "poses_perp", predicate: "perpendicular", entities: ["rod_h", "rod_v"], expected: true, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["hinge", "free_h", "rod_h", "free_v", "rod_v", "cm_v", "weight", "hinge_label"],
  revealGroups: [{
    id: "poses",
    entityIds: ["hinge", "free_h", "rod_h", "free_v", "rod_v", "cm_v", "weight", "hinge_label"],
    dependsOn: [],
    narrationCue: "rod poses",
  }],
  teachingTimeline: [{ action: "reveal", targetId: "poses", dependsOn: [], narrationIntent: "show both rod positions" }],
};
const hingedValidated = validateSceneDocument(hingedRodTwoPositions);
const hingedCompiled = hingedValidated.document ? compileSceneDocument(hingedValidated.document) : null;
if (!hingedValidated.document || !hingedCompiled?.ok || !hingedCompiled.renderScene) {
  throw new Error(`hinged rod two-position scene did not compile: ${JSON.stringify({
    validation: hingedValidated.report.issues,
    compile: hingedCompiled?.report.issues,
  })}`);
}
const verticalRod = hingedCompiled.renderScene.primitives.find((primitive) =>
  primitive.entityId === "rod_v" && primitive.kind !== "label",
);
if (!verticalRod || verticalRod.points.length < 2) {
  throw new Error("vertical rod pose was not rendered from rotate");
}

const annotationMarksScene = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "congruence ticks, sign badge, caption" },
  source: { question: "Mark congruent sides and the positive sense." },
  quantities: [],
  entities: [
    { id: "p1", kind: "point", role: "start" },
    { id: "p2", kind: "point", role: "end" },
    { id: "p3", kind: "point", role: "start" },
    { id: "p4", kind: "point", role: "end" },
    { id: "ab", kind: "segment", role: "side" },
    { id: "cd", kind: "segment", role: "side" },
    { id: "ticks", kind: "tick_mark", role: "congruence ticks" },
    { id: "sense", kind: "vector", role: "positive sense" },
  ],
  constructions: [
    { id: "make_p1", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["p1"] },
    { id: "make_p2", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["p2"] },
    { id: "make_p3", operator: "point", inputs: { x: 0, y: 1, coordinateSpace: "world" }, outputs: ["p3"] },
    { id: "make_p4", operator: "point", inputs: { x: 2, y: 1, coordinateSpace: "world" }, outputs: ["p4"] },
    { id: "make_ab", operator: "segment", inputs: { start: "p1", end: "p2" }, outputs: ["ab"] },
    { id: "make_cd", operator: "segment", inputs: { start: "p3", end: "p4" }, outputs: ["cd"] },
    { id: "make_ticks", operator: "tick_mark", inputs: { target: "ab", count: 2 }, outputs: ["ticks"] },
    { id: "make_sense", operator: "sign_badge", inputs: { target: "cd", sense: "positive" }, outputs: ["sense"] },
  ],
  relations: [],
  assertions: [
    { id: "same_len", predicate: "equal_length", entities: ["ab", "cd"], expected: true, severity: "fatal" },
  ],
  annotations: [
    { id: "fig_cap", kind: "caption", targetIds: ["ab"], text: "Congruent sides share tick marks." },
  ],
  requiredEntityIds: ["p1", "p2", "p3", "p4", "ab", "cd", "ticks", "sense"],
  revealGroups: [{
    id: "marks",
    entityIds: ["p1", "p2", "p3", "p4", "ab", "cd", "ticks", "sense"],
    dependsOn: [],
    narrationCue: "show marks",
  }],
  teachingTimeline: [{
    id: "show_marks",
    action: "reveal",
    targetId: "marks",
    dependsOn: [],
    narrationIntent: "show the congruent sides",
  }],
};
const annotationMarksValidated = validateSceneDocument(annotationMarksScene);
const annotationMarksCompiled = annotationMarksValidated.document
  ? compileSceneDocument(annotationMarksValidated.document)
  : null;
if (!annotationMarksValidated.document || !annotationMarksCompiled?.ok || !annotationMarksCompiled.renderScene) {
  throw new Error(`annotation mark scene did not compile: ${JSON.stringify({
    validation: annotationMarksValidated.report.issues,
    compile: annotationMarksCompiled?.report.issues,
  })}`);
}
const tickPrimitives = annotationMarksCompiled.renderScene.primitives.filter((primitive) =>
  primitive.entityId === "ticks" && primitive.kind !== "label",
);
if (tickPrimitives.length !== 2) {
  throw new Error(`tick_mark count 2 must emit two tick strokes, got ${tickPrimitives.length}`);
}
if (!annotationMarksCompiled.renderScene.primitives.some((primitive) => primitive.entityId === "sense")) {
  throw new Error("sign_badge did not emit owned geometry");
}
if (!annotationMarksCompiled.renderScene.caption?.includes("Congruent sides share tick marks.")) {
  throw new Error("caption annotations must appear as a figure caption, not diagram ink");
}
if (!annotationMarksCompiled.renderScene.primitives.some((primitive) =>
  primitive.entityId === "cd" && Number(primitive.provenance?.correspondingFamily) >= 1
)) {
  throw new Error("equal_length must attach corresponding-part ticks to unmarked congruent sides");
}

if (angleMarkCompiled.renderScene?.primitives.some((primitive) =>
  primitive.entityId === "angle_a" && typeof primitive.text === "string" && primitive.text.includes("°")
)) {
  throw new Error("angle_mark must not invent a degree label from geometry");
}

console.log("scene-engine verification passed");

function normalizedPointYFor(document: Record<string, unknown>, output: string): number | undefined {
  const constructions = Array.isArray(document.constructions) ? document.constructions : [];
  const construction = constructions.find((item) =>
    typeof item === "object" && item !== null &&
    Array.isArray((item as Record<string, unknown>).outputs) &&
    ((item as Record<string, unknown>).outputs as unknown[]).includes(output),
  ) as Record<string, unknown> | undefined;
  const inputs = construction && typeof construction.inputs === "object" && construction.inputs !== null
    ? construction.inputs as Record<string, unknown>
    : null;
  return typeof inputs?.y === "number" ? inputs.y : undefined;
}
