import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument } from "../../src";
// A loop contact and its separate approach ramp are distinct supports.
import { SceneBuilder } from "../../src/archetypes/document";
import { validateTurnPlanSceneProofs, type TurnPlanV3 } from "../../src/contracts/contractsV3";
const loop = new SceneBuilder("A body moves along a curved track with a straight approach.", "contact geometry", "synthetic");
loop.point("O", { x: 0, y: 0 }, "centre");
loop.point("P", { x: 0, y: 2 }, "body");
loop.point("A", { x: -5, y: 4 }, "approach start");
loop.point("B", { x: -2, y: 0 }, "approach end");
loop.circle("track", "O", 2, "circular track");
loop.segment("incline", "A", "B", "approach incline");
loop.vector("normal", "P", { direction: { x: 0, y: -1 }, length: 1.5 }, "normal reaction", "N");
loop.vector("weight", "P", { direction: { x: 0, y: -1 }, length: 0.7 }, "weight", "mg");
loop.group("setup", ["O", "P", "A", "B", "track", "incline", "normal", "weight"], "curved contact and approach");
const loopDocument = loop.build();
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", subject: "physics", question: String(loopDocument.source.question), givens: [], derived: [], unknowns: [], lawIds: [], qualitativeClaims: [], assumptions: [], visualRequirement: "required" };
assert.deepEqual(validateTurnPlanSceneProofs(loopDocument, plan).filter(i => i.code === "physical_direction_relation_failed"), [], "the top normal is radial to the track, not perpendicular to the unrelated approach");
const loopParsed = validateSceneDocument(loopDocument);
assert(loopParsed.document);
const loopCompiled = compileSceneDocument(loopParsed.document, { figureConsistency: true });
assert(loopCompiled.ok, JSON.stringify(loopCompiled.report.issues));
console.log("recovery physics/maths: curved contact and distinct force arrows passed");

const wrongNormal = structuredClone(loopDocument);
wrongNormal.constructions.find(c => c.outputs.includes("normal"))!.inputs.direction = [1, 0];
assert(validateTurnPlanSceneProofs(wrongNormal, plan).some(i => i.code === "physical_direction_relation_failed" && i.entityIds?.includes("track")), "a tangential normal at the curved contact is false");
const offTrack = structuredClone(loopDocument);
offTrack.constructions.find(c => c.outputs.includes("P"))!.inputs.y = 1;
assert(validateTurnPlanSceneProofs(offTrack, plan).some(i => i.code === "physical_direction_relation_failed" && i.entityIds?.includes("incline")), "a nearby circle cannot release the straight support check");
const moved = loopCompiled.renderScene!.primitives.find(p => p.entityId === "weight" && p.kind === "vector")!;
const witness = loopCompiled.renderScene!.primitives.find(p => p.entityId === "weight" && p.provenance?.vectorOriginWitness)!;
assert(witness && moved.provenance?.vectorLane);
assert.deepEqual(witness.points[0], moved.provenance.physicalStart);
assert.deepEqual(witness.points[1], moved.points[0]);
assert.equal(witness.groupId, moved.groupId, "the anchor witness reveals with its arrow");
const originalStart = moved.provenance.physicalStart as { x: number; y: number };
const originalEnd = moved.provenance.physicalEnd as { x: number; y: number };
assert(Math.abs((moved.points[1]!.x - moved.points[0]!.x) - (originalEnd.x - originalStart.x)) < 1e-9);
assert(Math.abs((moved.points[1]!.y - moved.points[0]!.y) - (originalEnd.y - originalStart.y)) < 1e-9);
const namedByAnnotation = structuredClone(loopDocument);
delete namedByAnnotation.entities.find(e => e.id === "normal")!.label;
namedByAnnotation.annotations.push({ id: "normal_name", kind: "label", targetIds: ["normal"], text: "N" });
assert(compileSceneDocument(validateSceneDocument(namedByAnnotation).document!, { figureConsistency: true }).ok, "annotation-owned names receive the same layout as entity labels");
console.log("recovery physics/maths: contact proof, names and origin-witness regressions passed");

// A free arrow has a direction even after a display translation. Check the
// same invariant under rotation; witnesses and downstream angle arms matter.
import { separateSharedOriginVectors } from "../../src/compile/vectorLanes";
import type { RenderPrimitive } from "../../src/types";
for (const [dx, dy] of [[60, 0], [0, 60], [45, 45], [-45, 45], [-60, 0], [0, -60]]) {
  const marks: RenderPrimitive[] = [
    { id: "n", entityId: "normal", groupId: "setup", kind: "vector", points: [{ x: 750, y: 300 }, { x: 750 + dx!, y: 300 + dy! }] },
    { id: "w", entityId: "weight", groupId: "setup", kind: "vector", points: [{ x: 750, y: 300 }, { x: 750 + dx! / 2, y: 300 + dy! / 2 }] },
  ];
  separateSharedOriginVectors(loopDocument, marks, { x: 400, y: 0, width: 760, height: 700 });
  assert(marks[1]!.provenance?.vectorLane, "co-origin arrows receive distinct display lanes under rotation");
  assert(Math.abs(marks[1]!.points[1]!.x - marks[1]!.points[0]!.x - dx! / 2) < 1e-9);
  assert(Math.abs(marks[1]!.points[1]!.y - marks[1]!.points[0]!.y - dy! / 2) < 1e-9);
  const constrained = structuredClone(loopDocument);
  constrained.constructions.push({ id: "consumer", operator: "right_angle_mark", inputs: { a: "weight", b: "normal", vertex: "P" }, outputs: ["angle"] });
  const fresh = marks.slice(0, 2).map(p => ({ ...p, provenance: undefined, points: [{ x: 750, y: 300 }, { x: 750 + dx!, y: 300 + dy! }] }));
  separateSharedOriginVectors(constrained, fresh, { x: 400, y: 0, width: 760, height: 700 });
  assert(fresh.every(p => !p.provenance?.vectorLane), "angle-arm geometry is never relocated");
}
console.log("recovery physics/maths: rotated vector lanes and constrained-arm refusal passed");
