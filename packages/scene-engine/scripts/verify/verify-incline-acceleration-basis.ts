import assert from "node:assert/strict";
import { evaluateChapterInstrumentConstruction, type InstrumentGeometry } from "../../src/compile/chapterInstrumentGeometry";
import { validationNumber, type SourceContext } from "../../src/compile/sourceScalars";
import type { RenderPoint, SceneDocument } from "../../src/types";

const compiled = process.argv.includes("--compiled-boundary");
const engine = compiled ? await import("../../dist/index.js") : await import("../../src/index");
let passed = 0;
const failures: Array<{ name: string; error: string }> = [];
function test(name: string, run: () => void): void {
  try { run(); passed++; }
  catch (error) { failures.push({ name, error: error instanceof Error ? error.message : String(error) }); }
}
function close(actual: number, expected: number, name: string, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${name}: ${actual} != ${expected}`);
}
type Motion = "rest" | "down" | "up";
function document(motion: Motion, mu: number, mass = 1, gravity = 10, angleDeg = 30): SceneDocument {
  const ids = ["incline", "body", "weight", "normal", "friction", "acceleration"];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "incline force and acceleration authority" },
    source: {}, quantities: [],
    entities: ids.map((id, index) => ({ id, kind: index === 0 ? "segment" : index === 1 ? "point" : "vector", role: id })),
    constructions: [{ id: "inclineForces", operator: "incline_friction", inputs: { mass, gravity, angleDeg, mu, motion, origin: [0, 0], displayScale: 2, forceScale: 0.1, accelScale: 0.2, units: { mass: "kg", gravity: "m/s^2" } }, outputs: ids }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "inclineReveal", entityIds: ids, dependsOn: [], narrationCue: "incline forces" }], teachingTimeline: [],
  };
}
function context(doc: SceneDocument): SourceContext {
  return { number: (value) => validationNumber(value, doc), point: () => { throw new Error("unresolved point"); }, geometry: () => undefined };
}
function evaluate(doc: SceneDocument): InstrumentGeometry[] {
  return evaluateChapterInstrumentConstruction("incline_friction", doc.constructions[0]!.inputs, context(doc), doc);
}
function directClosure(doc: SceneDocument): void {
  const outputs = evaluate(doc);
  const mass = outputs[1]!.instrument.components.x;
  const forces = outputs.slice(2, 5).map((output) => output.instrument.components);
  const acceleration = outputs[5]!.instrument.components;
  for (const axis of ["x", "y"] as const) close(acceleration[axis], forces.reduce((sum, force) => sum + force[axis], 0) / mass, `a.${axis} = ΣF.${axis}/m`);
}
function accepted(doc: SceneDocument) {
  const result = engine.compileSceneDocument(doc);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  return result.renderScene;
}
function compiledClosure(doc: SceneDocument, mass: number): void {
  const rendered = accepted(doc);
  function delta(id: string): RenderPoint {
    const primitive = rendered.primitives.find((item) => item.entityId === id && (item.kind === "vector" || item.kind === "point"));
    if (!primitive && id === "acceleration" && doc.constructions[0]!.inputs.motion === "rest") {
      assert.ok(rendered.primitives.some((item) => item.entityId === id && item.kind === "label"), "zero acceleration retains its existing label-only rendering");
      return { x: 0, y: 0 };
    }
    assert.ok(primitive, `rendered ${id} survives compilation`);
    if (primitive.kind === "point") return { x: 0, y: 0 };
    assert.equal(primitive.points.length, 2);
    return { x: primitive.points[1]!.x - primitive.points[0]!.x, y: primitive.points[1]!.y - primitive.points[0]!.y };
  }
  const forces = ["weight", "normal", "friction"].map(delta);
  const acceleration = delta("acceleration");
  // All deltas share the compiler's affine viewport transform. Undo only the
  // explicitly independent physical arrow display scales, including rounding.
  for (const axis of ["x", "y"] as const) close(acceleration[axis] / 0.2, forces.reduce((sum, force) => sum + force[axis], 0) / (0.1 * mass), `rendered a.${axis} = rendered ΣF.${axis}/m`, 0.1);
}
for (const [motion, mu] of [["rest", 1], ["down", 0.1], ["up", 0.1]] as const) {
  for (const mass of [1, 3]) {
    test(`${motion}, m=${mass}: direct force closure`, () => directClosure(document(motion, mu, mass)));
    test(`${motion}, m=${mass}: compiler force closure`, () => compiledClosure(document(motion, mu, mass), mass));
  }
}
// Independently worked 30°/g=10/mu=0.1 examples in the builder's uphill basis.
for (const [motion, x, y] of [
  ["down", -3.580127018922193, -2.0669872981077803],
  ["up", -5.080127018922193, -2.933012701892219],
] as const) {
  test(`${motion}: independent acceleration components`, () => {
    const acceleration = evaluate(document(motion, 0.1))[5]!.instrument.components;
    close(acceleration.x, x, "acceleration x");
    close(acceleration.y, y, "acceleration y");
  });
}
for (const angle of [15, 45, 60]) {
  test(`downhill at ${angle}°: direct and compiler force closure`, () => {
    const doc = document("down", 0.05, 2, 9.8, angle);
    directClosure(doc);
    compiledClosure(doc, 2);
  });
}
test("source-bound mass/gravity retain the same force basis", () => {
  const doc = document("down", 0.1);
  doc.quantities = [{ id: "m", value: 1, unit: "kg" }, { id: "g", value: 10, unit: "m/s^2" }];
  Object.assign(doc.constructions[0]!.inputs, { mass: "m", gravity: "g" });
  directClosure(doc);
  compiledClosure(doc, 1);
  assert.deepEqual(accepted(doc), accepted(document("down", 0.1)));
});
test("zero acceleration keeps its source point and existing label-only rendering", () => {
  const doc = document("down", 1 / Math.sqrt(3));
  const acceleration = evaluate(doc)[5]!;
  assert.equal(acceleration.kind, "point");
  assert.equal(acceleration.instrument.zero, true);
  const rendered = accepted(doc);
  assert.ok(rendered.primitives.some((primitive) => primitive.entityId === "acceleration" && primitive.kind === "label"));
  assert.ok(!rendered.primitives.some((primitive) => primitive.entityId === "acceleration" && primitive.kind === "vector"));
});
for (const [motion, mu] of [["down", 1], ["rest", 0.1]] as const) {
  test(`${motion}: unsupported friction state remains atomic`, () => {
    const doc = document(motion, mu);
    assert.throws(() => evaluate(doc));
    const result = engine.compileSceneDocument(doc);
    assert.equal(result.ok, false);
    assert.equal(result.renderScene, null);
  });
}
test("zero and negative masses remain rejected", () => {
  for (const mass of [0, -1]) {
    const doc = document("down", 0.1, mass);
    assert.throws(() => evaluate(doc));
    const result = engine.compileSceneDocument(doc);
    assert.equal(result.ok, false);
    assert.equal(result.renderScene, null);
  }
});
console.log(JSON.stringify({ gate: "incline-acceleration-basis", compilerBoundary: compiled ? "built-package" : "source", passed, failed: failures.length, failures }));
if (failures.length) process.exitCode = 1;
