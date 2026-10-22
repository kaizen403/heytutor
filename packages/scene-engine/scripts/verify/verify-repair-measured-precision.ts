import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneAssertion, SceneConstruction, SceneDocument } from "../../src/types";

const construction = (id: string, operator: string, inputs: Record<string, unknown>): SceneConstruction => ({
  id: `make-${id}`, operator, inputs, outputs: [id],
});
const constructions = [
  construction("O", "point", { x: 0, y: 0 }),
  construction("F", "space_frame", { origin: "O", scale: 1 }),
  construction("A", "space_point", { frame: "F", x: 0, y: 0, z: 0 }),
  construction("B", "space_point", { frame: "F", x: 1.0004, y: 0, z: 0 }),
  construction("C", "space_point", { frame: "F", x: 0, y: 0, z: 1 }),
  construction("D", "space_point", { frame: "F", x: 1, y: 0, z: 1 }),
];
const ids = constructions.flatMap((item) => item.outputs);
const assertion: SceneAssertion = {
  id: "almost-one", predicate: "distance_ratio", entities: ["A", "B", "C", "D"], expected: 1, severity: "fatal",
};
const document: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "Verify a near-miss ratio stays visible" },
  source: {}, quantities: [],
  entities: constructions.map((item) => ({
    id: item.outputs[0]!,
    kind: item.operator === "space_frame" ? "polyline" : "point",
    role: "explicit geometry",
  })),
  constructions, relations: [], assertions: [assertion], annotations: [], requiredEntityIds: ids,
  revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Reveal the lengths" }],
  teachingTimeline: [],
};
const compiled = compileSceneDocument(document);
const failed = compiled.report.issues.find((issue) => issue.code === "assertion_failed");
assert.equal(compiled.ok, false, JSON.stringify(compiled.report.issues));
assert.ok(failed, "the 1.0004 ratio must fail the default 0.0001 check");
const message = failed?.message ?? "";
assert.match(message, /1\.0004/, `rounded measured value must not hide the failed ratio: ${message}`);
assert.match(message, /Difference 0\.0004/, `unrounded difference must be visible: ${message}`);
assert.match(message, /required under 0\.0001/, `the tolerance must be visible: ${message}`);
console.log("verify-repair-measured-precision: 4 checks passed");
