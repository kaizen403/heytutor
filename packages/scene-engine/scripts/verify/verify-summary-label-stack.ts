/**
 * A figure's quantity summaries ("v_i = +3.0 m/s", "m = 2.0 kg") are one block
 * of givens, stacked in rows, not four labels fanned around a shared anchor
 * with a leader pointing at empty paper.
 */
import assert from "node:assert/strict";
import { compileSceneDocument, type SceneDocument } from "../../src/index";

const question = "A 2.0 kg particle's velocity changes from 3.0 m/s east to 3.0 m/s west in 0.50 s.";
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "velocity reversal" },
  source: { question },
  quantities: [],
  entities: [
    { id: "particle", kind: "point", role: "body", label: "m" },
    { id: "vi_end", kind: "point", role: "construction helper" },
    { id: "vf_end", kind: "point", role: "construction helper" },
    { id: "vi_vec", kind: "vector", role: "initial_velocity", label: "v_i" },
    { id: "vf_vec", kind: "vector", role: "final_velocity", label: "v_f" },
  ],
  constructions: [
    { id: "c_particle", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["particle"] },
    { id: "c_vi_end", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["vi_end"] },
    { id: "c_vf_end", operator: "point", inputs: { x: -3, y: 0, coordinateSpace: "world" }, outputs: ["vf_end"] },
    { id: "c_vi_vec", operator: "vector", inputs: { start: "particle", end: "vi_end" }, outputs: ["vi_vec"] },
    { id: "c_vf_vec", operator: "vector", inputs: { start: "particle", end: "vf_end" }, outputs: ["vf_vec"] },
  ],
  relations: [],
  assertions: [],
  annotations: [
    { id: "ann_vi", kind: "label", text: "v_i = +3.0 m/s", targetIds: ["vi_vec"], quantityId: "vi" },
    { id: "ann_vf", kind: "label", text: "v_f = -3.0 m/s", targetIds: ["vf_vec"], quantityId: "vf" },
    { id: "ann_m", kind: "label", text: "m = 2.0 kg", targetIds: ["particle"], quantityId: "m" },
    { id: "ann_dt", kind: "callout", text: "Δt = 0.50 s", targetIds: ["particle"], quantityId: "dt", placementIntent: "above" },
  ],
  requiredEntityIds: ["particle", "vi_vec", "vf_vec"],
  revealGroups: [{ id: "setup", entityIds: ["particle", "vi_vec", "vf_vec"], dependsOn: [], narrationCue: "reveal scene" }],
  teachingTimeline: [{ id: "t1", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "reveal setup" }],
};

const compiled = compileSceneDocument(document);
assert.ok(compiled.ok && compiled.renderScene, `fixture must compile: ${compiled.report.issues.map((issue) => issue.code).join(", ")}`);
const primitives = compiled.renderScene.primitives;
const summaryIds = ["ann_vi", "ann_vf", "ann_m", "ann_dt"];
const summaries = summaryIds.map((id) => {
  const primitive = primitives.find((candidate) => candidate.id === id);
  assert.ok(primitive, `${id} is drawn`);
  const bounds = primitive.provenance?.labelBounds as { x: number; y: number; width: number; height: number };
  assert.ok(bounds, `${id} carries its reserved box`);
  return { id, bounds, usesLeader: primitive.provenance?.usesLeader === true };
});

assert.ok(
  summaries.every((summary) => Math.abs(summary.bounds.x - summaries[0]!.bounds.x) < 1),
  "the givens share one left edge",
);
for (let index = 1; index < summaries.length; index++) {
  const above = summaries[index - 1]!.bounds;
  const row = summaries[index]!.bounds;
  assert.ok(row.y >= above.y + above.height, `${summaries[index]!.id} sits on its own row under ${summaries[index - 1]!.id}`);
}
assert.ok(summaries.every((summary) => !summary.usesLeader), "a stacked given needs no leader");
assert.ok(
  !primitives.some((primitive) => summaryIds.some((id) => primitive.id === `${id}_leader`)),
  "no leader line is drawn for a stacked given",
);

// FOCUS resolves a part to its box. The givens block is not where the
// particle is, so it must not stretch the particle's box up to it.
const particleBox = compiled.renderScene.entityBounds.particle;
const particlePoint = primitives.find((primitive) => primitive.id === "primitive_particle")?.points[0];
assert.ok(particleBox && particlePoint, "the particle has a box and a point");
const givensBottom = Math.max(...summaries.map((summary) => summary.bounds.y + summary.bounds.height));
assert.ok(
  particleBox.y > givensBottom,
  `the particle's box (top ${Math.round(particleBox.y)}) must not reach the givens block (bottom ${Math.round(givensBottom)})`,
);

console.log("verify-summary-label-stack: quantity summaries stack as one block of givens");
