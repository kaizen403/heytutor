import assert from "node:assert/strict";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import { evaluateChargedRing } from "../../src/compile/chargedRingGeometry";
import { isometricProject } from "../../src/math/space";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
let checks = 0; const failures: string[] = [];
function check(value: unknown, message: string): void { checks++; if (!value) failures.push(message); }
function scene(charge = 1, axialDistance = 1): SceneDocument {
  const ids = ["O", "frame", "center", "ring", "at", "E"];
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-grounded charged ring on its axis" }, source: {}, quantities: [],
    entities: ids.map((id, i) => ({ id, kind: ["point", "polyline", "point", "polyline", "point", "vector"][i]!, role: ["origin", "world frame", "ring center", "charged ring", "axial observation", "electric field"][i]! })),
    constructions: [{ id: "origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] }, { id: "frame_make", operator: "space_frame", inputs: { origin: "O", axisLength: 2 }, outputs: ["frame"] }, { id: "center_make", operator: "space_point", inputs: { frame: "frame", x: 0, y: 0, z: 0 }, outputs: ["center"] },
      { id: "ring_make", operator: "charged_ring_axial_field", inputs: { frame: "frame", center: "center", radius: 1, charge, axialDistance, k: 1, displayLength: 0.5, units: { charge: "C", length: "m" } }, outputs: ["ring", "at", "E"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids, revealGroups: [{ id: "show", entityIds: ids, dependsOn: [] }], teachingTimeline: [] };
}
for (const [q, z] of [[1, 1], [-1, 1], [1, -1], [1, 0], [0, 1]]) {
  const result = compileSceneDocument(scene(q, z)); check(result.ok, `signed/zero axial case ${q},${z}: ${JSON.stringify(result.report.issues)}`);
  check(result.renderScene?.primitives.some((p) => p.kind === "polyline" && p.entityId === "ring" && p.points.length >= 65), "whole projected ring is drawn");
}
const micro = scene(2, 0.2); micro.constructions[3]!.inputs = { ...micro.constructions[3]!.inputs, radius: 0.1, k: 9e9, units: { charge: "µC", length: "m" } };
check(compileSceneDocument(micro).ok, "explicit physical charge prefix is converted");
for (const [key, value] of [["radius", 0], ["radius", -1], ["k", 0], ["displayLength", -1], ["units", { charge: "m", length: "m" }], ["charge", { value: 1, unit: "m" }], ["axialDistance", { value: 1, unit: "cm" }], ["model", "point-charge-approximation"]]) {
  const bad = scene(); bad.constructions[3]!.inputs[String(key)] = value; check(!compileSceneDocument(bad).ok, `unsupported/mismatched ${String(key)} refuses`);
}
const claim = scene(); claim.entities[5]!.label = "E=999 N/C"; check(!compileSceneDocument(claim).ok, "incorrect derived field ink refuses");
const right = scene(); right.entities[5]!.label = "E≈0.354 N/C"; check(compileSceneDocument(right).ok, "rounded field claim independently checked");
const dimensional = scene(); dimensional.quantities.push({ id: "radius", value: 1, unit: "C" }); dimensional.constructions[3]!.inputs.radius = "radius";
check(!compileSceneDocument(dimensional).ok, "dimensionally wrong radius quantity refuses");
const wrongCenter = scene(); wrongCenter.constructions[2]!.inputs.x = { value: 0, unit: "cm" }; check(!compileSceneDocument(wrongCenter).ok, "translated center provenance must match length units, including zero");
const mixedFrame = scene(); mixedFrame.entities.push({ id: "other", kind: "polyline", role: "other world frame" }); mixedFrame.constructions.splice(2, 0, { id: "other_make", operator: "space_frame", inputs: { origin: "O", axisLength: 2 }, outputs: ["other"] }); mixedFrame.constructions[3]!.inputs.frame = "other"; mixedFrame.requiredEntityIds.push("other"); mixedFrame.revealGroups[0]!.entityIds.push("other"); check(!compileSceneDocument(mixedFrame).ok, "center must belong to the exact declared world frame");
const metric = scene(); metric.assertions = [{ id: "metric", predicate: "equal_length", entities: ["E", "E"], expected: true, severity: "fatal" }]; check(!compileSceneDocument(metric).ok, "normalized field arrow cannot certify physical length");
const derivative = scene(); derivative.entities.push({ id: "d", kind: "vector", role: "unsupported ring derivative" }); derivative.constructions.push({ id: "derivative", operator: "curve_derivative", inputs: { curve: "ring", at: 1, parameterScale: 1 }, outputs: ["d"] }); derivative.requiredEntityIds.push("d"); derivative.revealGroups[0]!.entityIds.push("d"); check(!compileSceneDocument(derivative).ok, "ring geometry is not a physical field-ratio derivative curve");

function evaluated(document: SceneDocument) {
  const centerInputs = document.constructions[2]!.inputs;
  return evaluateChargedRing(document.constructions[3]!.inputs, { number: (value) => Number(value), geometry: (id) => id === "frame" ? { kind: "compound", spaceFrame: { origin: { x: 0, y: 0 }, scale: 1 } } : id === "center" ? { kind: "point", space: { x: Number(centerInputs.x), y: Number(centerInputs.y), z: Number(centerInputs.z) }, spaceFrameId: centerInputs.frame } : undefined }, document);
}
const analytic = scene(2, 4); analytic.constructions[3]!.inputs.radius = 3; analytic.constructions[3]!.inputs.k = 5;
check(Math.abs(evaluated(analytic)[2]!.chargedRing.axialField - 0.32) < 1e-15, "independent 3-4-5 analytic oracle gives E=0.32 N/C");
const oppositeCharge = scene(-2, 4); oppositeCharge.constructions[3]!.inputs.radius = 3; oppositeCharge.constructions[3]!.inputs.k = 5;
check(Math.abs(evaluated(oppositeCharge)[2]!.chargedRing.axialField + 0.32) < 1e-15, "charge reversal reverses the signed physical field");
const reflectedAxis = scene(2, -4); reflectedAxis.constructions[3]!.inputs.radius = 3; reflectedAxis.constructions[3]!.inputs.k = 5;
check(Math.abs(evaluated(reflectedAxis)[2]!.chargedRing.axialField + 0.32) < 1e-15, "axis reflection reverses the signed physical field");
const tiny = scene(1e-20, 1); const tinyResult = compileSceneDocument(tiny);
check(tinyResult.ok && tinyResult.renderScene?.primitives.some((p) => p.entityId === "E" && p.text?.includes("e-21 N/C")), "tiny nonzero field is not printed as zero");
const translated = scene(); translated.constructions[2]!.inputs = { frame: "frame", x: 7, y: -3, z: 8 };
const transGeometry = evaluated(translated), atGeometry = transGeometry[1]!;
check(atGeometry.kind === "point" && atGeometry.space.x === 7 && atGeometry.space.y === -3 && atGeometry.space.z === 9, "observation remains associated with translated center and signed axis");
const ringGeometry = transGeometry[0]!, firstWorld = isometricProject({ x: 8, y: -3, z: 8 }, { origin: { x: 0, y: 0 }, scale: 1 });
check(ringGeometry.kind === "path" && ringGeometry.points[0]!.x === firstWorld.x && ringGeometry.points[0]!.y === firstWorld.y, "native ring projection matches its own center, radius and plane");
const offAxis = scene(); offAxis.constructions[3]!.inputs.at = [1, 0, 1]; check(!compileSceneDocument(offAxis).ok, "off-axis field request is unsupported rather than approximated");
const sourceConstant = scene(); sourceConstant.quantities.push({ id: "k", value: 1, unit: "N m²/C²" }); sourceConstant.constructions[3]!.inputs.k = "k"; check(compileSceneDocument(sourceConstant).ok, "Coulomb constant quantity retains explicit physical units");
sourceConstant.quantities[0]!.unit = "1"; check(!compileSceneDocument(sourceConstant).ok, "dimensionless normalization cannot certify a physical N/C field");
const boundaryProof = scene(); boundaryProof.assertions = [{ id: "fake", predicate: "equal_length", entities: ["ring", "ring"], expected: true, severity: "fatal" }]; check(!compileSceneDocument(boundaryProof).ok, "unsupported projected-ring predicates refuse screen-length proof");

const production = validateSceneDocument(pruneDeadSceneEntities({ ...scene() }));
check(production.document && compileSceneDocument(production.document).ok, `actual normalized production ring path compiles: ${JSON.stringify(production.report.issues)}`);
const symbolic = scene(); symbolic.source = { nonMetric: true, representationTier: "qualitative_verified" }; symbolic.entities[5]!.label = "E1";
const symbolicResult = compileSceneDocument(symbolic); check(symbolicResult.ok && symbolicResult.renderScene?.primitives.some((p) => p.entityId === "E" && p.text === "E1"), "source-only symbolic ring field identity follows numeric validation");
const symbolicFalse = structuredClone(symbolic); symbolicFalse.entities[5]!.label = "E=999 N/C"; check(!compileSceneDocument(symbolicFalse).ok, "symbolic ring mode cannot bypass wrong numeric field ink");
const tinyZero = scene(1e-20, 1); tinyZero.entities[5]!.label = "E≈0 N/C"; check(!compileSceneDocument(tinyZero).ok, "nonzero field cannot be certified as rounded zero");

const farCenter = scene(); farCenter.constructions[2]!.inputs = { frame: "frame", x: 1e8, y: -1e8, z: 1e8 };
check(compileSceneDocument(farCenter).ok, "normal local ring and axial offsets remain valid after a large translation");
const lostOffset = scene(1, 1e-10); lostOffset.constructions[2]!.inputs.z = 8e8;
check(!compileSceneDocument(lostOffset).ok, "nonzero axial source offset lost under translation refuses");
const distortedOffset = scene(1, 1e-7); distortedOffset.constructions[2]!.inputs.z = 8e8;
check(!compileSceneDocument(distortedOffset).ok, "materially distorted axial source offset refuses");
const lostRadius = scene(); lostRadius.constructions[2]!.inputs.x = 1e9; lostRadius.constructions[3]!.inputs.radius = 1e-10;
check(!compileSceneDocument(lostRadius).ok, "ring radius lost under translation refuses");

for (const [name, candidate] of [["lost axial offset", lostOffset], ["distorted axial offset", distortedOffset], ["lost radius", lostRadius]] as const) {
  let refused = false; try { evaluated(candidate); } catch { refused = true; }
  check(refused, `source evaluator independently refuses ${name} before unrelated layout checks`);
}
console.log(`H4 charged ring: ${checks - failures.length}/${checks} passed`); assert.equal(failures.length, 0, failures.join("\n"));
