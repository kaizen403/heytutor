import assert from "node:assert/strict";
import { evaluateRotationConstruction, rotationGeometryLabel, validateEvaluatedRotationLabels, type RotationEvaluationContext } from "../../src/compile/rotationGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

let checks = 0;
const context: RotationEvaluationContext = { number: Number, point() { throw Error("foreign coordinates"); }, geometry() { throw Error("foreign geometry"); } };
const torque = (force: number) => evaluateRotationConstruction("planar_torque", { leverArm: [2, 0], force: [0, force], lengthUnit: "m", forceUnit: "N", displayLength: 2 }, context)[0]!;
const motion = evaluateRotationConstruction("rotational_motion", { radius: 2, angle: 0.5, angleUnit: "rad", angularVelocity: 3, angularVelocityUnit: "rad/s", angularAcceleration: 4, angularAccelerationUnit: "rad/s^2", units: { length: "m", time: "s" }, displayScale: 1 }, context)[0]!;
function equal(geometry: unknown, label: string, expected: string): void { assert.equal(rotationGeometryLabel(geometry, label), expected, label); checks++; }
function reject(geometry: unknown, label: string): void { assert.throws(() => rotationGeometryLabel(geometry, label), undefined, label); checks++; }
for (const alias of ["τ", "τ_z", "τz", "tau_z", "tauz"]) {
  equal(torque(3), alias, alias);
  equal(torque(3), `${alias}=6 N*m`, "tau=6 N*m");
  equal(torque(-3), `${alias}=−6 N*m`, "tau=-6 N*m");
  equal(torque(3), `${alias}=600 N*cm`, "tau=600 N*cm");
  equal(torque(3), `${alias}=6 N·m`, "tau=6 N*m");
  equal(torque(0), `${alias}=0 N*m`, "tau=0 N*m");
  for (const label of [`${alias}=-6 N*m`, `${alias}=2 N*m`, `${alias}=6 m`, `${alias}=6 N*m/s`, `${alias}=1e-999 N*m`]) reject(torque(3), label);
}
for (const label of ["τ_x", "τ_y", "τₖ", "τ: −z", "τ_z=6", "6 N*m", "tau_z_extra", "tau_x=6 N*m", "τ=6 N*m more"]) reject(torque(3), label);
for (const [alias, canonical, value, unit] of [["ω", "omega", 3, "rad/s"], ["α", "alpha", 4, "rad/s^2"], ["θ", "theta", 0.5, "rad"]] as const) {
  equal(motion, alias, alias);
  equal(motion, `${alias}=${value} ${unit}`, `${canonical}=${value} ${unit}`);
  reject(motion, `${alias}=${value + 1} ${unit}`);
  reject(torque(3), alias);
}
function annotationIssues(text: string, value: number, unit: string): SceneIssue[] {
  const document: SceneDocument = { schemaVersion: "scene-document/v2", source: {}, quantities: [{ id: "q", value, unit }], entities: [{ id: "p", kind: "point", role: "circular state" }], constructions: [{ id: "state", operator: "rotational_motion", inputs: {}, outputs: ["p"] }], relations: [], assertions: [], annotations: [{ id: "a", kind: "label", text, quantityId: "q", targetIds: ["p"] }], requiredEntityIds: ["p"], revealGroups: [], teachingTimeline: [] };
  const issues: SceneIssue[] = [];
  validateEvaluatedRotationLabels(document.constructions[0]!, 0, document, [motion], issues);
  return issues;
}
for (const [symbol, value, unit] of [["ω", 3, "rad/s"], ["α", 4, "rad/s^2"], ["θ", 0.5, "rad"]] as const) {
  assert.deepEqual(annotationIssues(symbol, value, unit), []); checks++;
  assert.ok(annotationIssues(symbol, value + 1, unit).some(i => i.severity === "fatal")); checks++;
}
// A Greek omega must select angular velocity, never fall back to theta merely
// because the annotation supplies radians and a matching phase value.
assert.ok(annotationIssues("ω", 0.5, "rad").some(i => i.severity === "fatal")); checks++;
assert.ok(annotationIssues("α", 3, "rad/s").some(i => i.severity === "fatal")); checks++;
const rounded = torque(1 / 3);
equal(rounded, "τ=0.6667 N*m", "tau=0.6667 N*m");
reject(rounded, "τ=0.6668 N*m");
reject(torque(1e-100), "τ=0 N*m");
console.log(`Rotation label aliases: ${checks} checks passed.`);
