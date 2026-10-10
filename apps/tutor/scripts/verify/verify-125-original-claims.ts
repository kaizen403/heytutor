import assert from "node:assert/strict";
import { compileSceneDocument, pruneUnverifiedSceneAnnotations, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { normalizeSceneDocumentModelOutput } from "@heytutor/tutor-core";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const question = "Draw a charged particle's helical path for mass 0.5 kg, charge 1 C, velocity [1,0,1] m/s and magnetic field [0,0,1] T. Mark radius and pitch.";
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [{ id: "m", symbol: "m", value: 0.5, unit: "kg", provenance: "given" }, { id: "q", symbol: "q", value: 1, unit: "C", provenance: "given" }],
  unknowns: [{ id: "radius", symbol: "r", unit: "m" }, { id: "pitch", symbol: "p", unit: "m" }], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
const ids = ["O", "frame", "P", "H"];
const scene: SceneDocument = { schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "physical helical source model" }, quantities: [],
  entities: [{ id: "O", kind: "point", role: "frame origin" }, { id: "frame", kind: "polyline", role: "world frame" }, { id: "P", kind: "point", role: "initial state" }, { id: "H", kind: "polyline", role: "helical trajectory" }],
  constructions: [
    { id: "o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
    { id: "frame_make", operator: "space_frame", inputs: { origin: "O", axisLength: 2 }, outputs: ["frame"] },
    { id: "p", operator: "space_point", inputs: { frame: "frame", x: 0, y: 0, z: 0 }, outputs: ["P"] },
    { id: "helix", operator: "magnetic_helix", inputs: { frame: "frame", origin: "P", mass: 0.5, charge: 1, velocity: [1, 0, 1], magneticField: [0, 0, 1], turns: 2, displayScale: 1, units: { mass: "kg", charge: "C", velocity: "m/s", magneticField: "T" } }, outputs: ["H"] },
  ], relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
  revealGroups: [{ id: "g", entityIds: ids, dependsOn: [], narrationCue: "source helix" }], teachingTimeline: [] };
const production = (document: SceneDocument) => validateProductionSceneCandidate({ candidate: normalizeSceneDocumentModelOutput(document as unknown as Record<string, unknown>, question), question, turnPlan: plan });
let checks = 0;
const failures: string[] = [];
const check = (value: unknown, message: string) => { checks++; if (!value) failures.push(message); };
check(production(scene).valid, "source-derived helix survives actual production");
for (const label of ["9 m", "r=9 m", "p=9 m", "r≈9 m"]) {
  const wrong = structuredClone(scene); wrong.entities[3]!.label = label;
  check(!compileSceneDocument(wrong).ok, `direct source validation refuses ${label}`);
  check(pruneUnverifiedSceneAnnotations(wrong, plan) === wrong, `original ${label} survives pre-pruning for rejection`);
  check(!production(wrong).valid, `actual production refuses ${label} before value erasure`);
}
const rounded = structuredClone(scene); rounded.entities[3]!.label = "r≈0.5 m";
check(production(rounded).valid, "correct rounded radius passes without inventing a plan-derived value");
const callout = structuredClone(scene); callout.annotations = [{ id: "bad", kind: "callout", targetIds: ["H"], text: "p=9 m" }];
check(pruneUnverifiedSceneAnnotations(callout, plan) === callout && !production(callout).valid, "owned false helix callout cannot disappear before checking");
callout.quantities = [{ id: "pitch", symbol: "p", value: 9, unit: "m" }]; callout.annotations[0]!.quantityId = "pitch";
check(pruneUnverifiedSceneAnnotations(callout, plan) === callout && !production(callout).valid, "owned false quantity annotation checked before pruning");
const generic = structuredClone(scene); generic.annotations = [{ id: "optional", kind: "callout", targetIds: ["O"], text: "distance 999 m" }];
check(!pruneUnverifiedSceneAnnotations(generic, plan).annotations.some((annotation) => annotation.id === "optional") && production(generic).valid, "optional generic measured text still prunes without losing the valid helix");
const regionIds = ["a", "b", "c", "d", "s", "t", "region", "E"];
const zeroRegion: SceneDocument = { ...structuredClone(scene), quantities: [{ id: "Einside", symbol: "E", value: 0, unit: "N/C" }],
  entities: regionIds.map((id) => ({ id, kind: id === "region" ? "polygon" : id === "E" ? "vector" : "point", role: id === "E" ? "electric field" : "source region" })),
  constructions: [
    ...[[0, 0], [2, 0], [2, 2], [0, 2], [0.5, 1], [1.5, 1]].map(([x, y], index) => ({ id: `point_${index}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [regionIds[index]!] })),
    { id: "boundary", operator: "polygon", inputs: { points: ["a", "b", "c", "d"] }, outputs: ["region"] },
    { id: "field", operator: "vector", inputs: { start: "s", end: "t" }, outputs: ["E"] },
  ], annotations: [{ id: "zero", kind: "label", targetIds: ["region"], text: "E=0 N/C", quantityId: "Einside" }],
  requiredEntityIds: regionIds, revealGroups: [{ id: "g", entityIds: regionIds, dependsOn: [], narrationCue: "source region and field" }],
};
check(compileSceneDocument(zeroRegion).report.issues.some((issue) => issue.code === "field_in_zero_region"), "original declared zero field disagrees with the nonzero interior arrow");
check(pruneUnverifiedSceneAnnotations(zeroRegion, plan) === zeroRegion, "zero-field quantity/region association cannot be erased before checking");
check(!production(zeroRegion).valid, "production refuses the contradictory zero-region candidate");
const outsideRegion = structuredClone(zeroRegion); outsideRegion.constructions[4]!.inputs.x = 2.5; outsideRegion.constructions[5]!.inputs.x = 3.5;
check(compileSceneDocument(outsideRegion).ok, "a nonzero arrow outside the declared zero-field region remains valid");
assert.equal(failures.length, 0, failures.join("\n"));
console.log(`125 original claims: ${checks} actual-production checks passed`);
