import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
const document: SceneDocument = {
  schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "Show explicit coordinate axes" }, quantities: [],
  entities: [{ id: "axes", kind: "axes", role: "source coordinate axes" }],
  constructions: [{ id: "make_axes", operator: "axes", inputs: { xMin: -2, xMax: 3, yMin: -2, yMax: 3, xLabel: "Re", yLabel: "Im" }, outputs: ["axes"] }],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ["axes"], revealGroups: [{ id: "setup", entityIds: ["axes"], dependsOn: [], narrationCue: "Reveal named axes" }], teachingTimeline: [],
};
const result = compileSceneDocument(document);
assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
assert.deepEqual(result.renderScene.primitives.filter(p => p.kind === "label").map(p => p.text).sort(), ["Im", "Re"]);
for (const primitive of result.renderScene.primitives.filter(p => p.kind === "label")) {
  assert.equal(primitive.entityId, "axes"); assert.equal(primitive.groupId, "setup");
  assert.equal(primitive.provenance?.usesLeader, false);
}
for (const bad of ["V=3", "a very long axis name", "3"]) {
  const changed = structuredClone(document); changed.constructions[0]!.inputs.xLabel = bad;
  const rejected = compileSceneDocument(changed);
  assert.equal(rejected.ok, false); assert.equal(rejected.renderScene, null);
}
console.log("H4 axes: named endpoints render with checked symbolic names; invalid claims reject");
