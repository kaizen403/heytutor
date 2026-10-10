import assert from "node:assert/strict";
import type { SceneDocument } from "../../src/types";
import { compileSceneDocument } from "../../src/compile/compiler";
let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string): void { checks++; if (!condition) failures.push(message); }
function scene(direction: number[], second: number[], secondKind = "vector"): SceneDocument {
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit direction proof" }, source: {}, quantities: [],
    entities: [{ id: "O", kind: "point", role: "origin" }, { id: "P", kind: "point", role: "origin" }, { id: "a", kind: "vector", role: "source vector" }, { id: "b", kind: secondKind, role: "source vector" }],
    constructions: [{ id: "O_make", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] }, { id: "P_make", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["P"] }, { id: "a_make", operator: "vector", inputs: { start: "O", direction }, outputs: ["a"] }, { id: "b_make", operator: secondKind, inputs: { start: "P", direction: second }, outputs: ["b"] }],
    relations: [], assertions: [{ id: "same", predicate: "same_direction", entities: ["a", "b"], expected: true, severity: "fatal" }], annotations: [],
    requiredEntityIds: ["O", "P", "a", "b"], revealGroups: [{ id: "show", entityIds: ["O", "P", "a", "b"], dependsOn: [] }], teachingTimeline: [] };
}
for (const direction of [[1, 2], [0, 0, 1], [0, 0, -1]]) {
  const positive = compileSceneDocument(scene(direction, direction));
  check(positive.ok, `matching typed directions compile: ${JSON.stringify(positive.report.issues)}`);
  check(!compileSceneDocument(scene(direction, direction.map((value) => -value))).ok, "reversed direction cannot prove same_direction");
  const opposite = scene(direction, direction.map((value) => -value)); opposite.assertions[0]!.predicate = "opposite_direction";
  check(compileSceneDocument(opposite).ok, "opposite sense is well-defined for arrows and typed page normals");
}
check(!compileSceneDocument(scene([0, 0, 1], [1, 0])).ok, "page normal and planar arrow cannot share a direction");
check(!compileSceneDocument(scene([1, 0], [1, 0], "line")).ok, "an unsensed line cannot prove same_direction");
const zero = scene([1, 0], [1, 0]); zero.constructions[3]!.operator = "vector_scale"; zero.constructions[3]!.inputs = { vector: "a", factor: 0, origin: "P" }; zero.assertions[0]!.expected = false;
check(!compileSceneDocument(zero).ok, "zero vector has no sensed direction even in a negative assertion");
const world = scene([1, 0], [1, 0]);
world.entities.push({ id: "frame", kind: "polyline", role: "world frame" }, { id: "A", kind: "point", role: "world endpoint" }, { id: "B", kind: "point", role: "world endpoint" }, { id: "Q", kind: "point", role: "world origin" }, { id: "R", kind: "point", role: "world origin" });
world.constructions = [world.constructions[0]!, { id: "frame_make", operator: "space_frame", inputs: { origin: "O", axisLength: 1 }, outputs: ["frame"] },
  ...[["Q", 0, 0, 0], ["R", 2, 0, 0], ["A", 1, 2, 3], ["B", 3, 2, 3]].map(([id, x, y, z]) => ({ id: `${id}_make`, operator: "space_point", inputs: { frame: "frame", x, y, z }, outputs: [String(id)] })),
  { id: "P_make", operator: "point", inputs: { x: 2, y: 0 }, outputs: ["P"] },
  { id: "a_make", operator: "space_vector", inputs: { frame: "frame", start: "Q", end: "A" }, outputs: ["a"] },
  { id: "b_make", operator: "space_vector", inputs: { frame: "frame", start: "R", end: "B" }, outputs: ["b"] }];
world.requiredEntityIds = world.entities.map((e) => e.id); world.revealGroups[0]!.entityIds = [...world.requiredEntityIds];
check(compileSceneDocument(world).ok, "sensed proof uses the actual shared 3D world direction");
const wrongWorld = structuredClone(world); wrongWorld.constructions.find((c) => c.id === "B_make")!.inputs = { frame: "frame", x: 1, y: -2, z: -3 };
check(!compileSceneDocument(wrongWorld).ok, "reversed world arrow cannot prove same direction");
const differentWorld = structuredClone(world); differentWorld.entities.push({ id: "other", kind: "polyline", role: "other frame" });
differentWorld.constructions.splice(2, 0, { id: "other_make", operator: "space_frame", inputs: { origin: "O", axisLength: 1 }, outputs: ["other"] });
for (const c of differentWorld.constructions.filter((c) => ["R_make", "B_make", "b_make"].includes(c.id))) c.inputs.frame = "other";
differentWorld.requiredEntityIds.push("other"); differentWorld.revealGroups[0]!.entityIds.push("other");
check(!compileSceneDocument(differentWorld).ok, "same projection from unrelated world frames cannot prove same direction");
const derivative: SceneDocument = { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "dimensionless analytic derivative composition" }, source: {}, quantities: [],
  entities: [{ id: "curve", kind: "polyline", role: "mathematical curve" }, { id: "d", kind: "vector", role: "derivative" }, { id: "s", kind: "vector", role: "scaled derivative" }],
  constructions: [{ id: "curve_make", operator: "function_curve", inputs: { expression: "x^2", xMin: -2, xMax: 2, samples: 33 }, outputs: ["curve"] }, { id: "d_make", operator: "curve_derivative", inputs: { curve: "curve", at: 1, parameterScale: 1 }, outputs: ["d"] }, { id: "s_make", operator: "vector_scale", inputs: { vector: "d", factor: -2, origin: [3, 0] }, outputs: ["s"] }],
  relations: [], assertions: [{ id: "opposite", predicate: "opposite_direction", entities: ["d", "s"], expected: true, severity: "fatal" }], annotations: [],
  requiredEntityIds: ["curve", "d", "s"], revealGroups: [{ id: "show", entityIds: ["curve", "d", "s"], dependsOn: [] }], teachingTimeline: [] };
const composed = compileSceneDocument(derivative);
check(composed.ok, `ordinary analytic derivative scales without losing provenance: ${JSON.stringify(composed.report.issues)}`);
const falseSense = structuredClone(derivative); falseSense.assertions[0]!.predicate = "same_direction";
check(!compileSceneDocument(falseSense).ok, "negative scale cannot prove same_direction");
const physical = structuredClone(derivative); physical.constructions[0]!.operator = "harmonic_wave"; physical.constructions[0]!.inputs = { amplitude: 1, waveNumber: 1, angularFrequency: 0, phase: 0, phaseUnit: "rad", time: 0, xMin: -2, xMax: 2, units: { position: "m", time: "s", amplitude: "m" } };
check(!compileSceneDocument(physical).ok, "physical wave derivative cannot become an ordinary free vector");
const dimensional = structuredClone(derivative); dimensional.quantities.push({ id: "at", value: 1, unit: "m" }); dimensional.constructions[1]!.inputs.at = "at";
check(!compileSceneDocument(dimensional).ok, "physical parameter units cannot be discarded by free-vector composition");
console.log(`H4 sensed vectors: ${checks - failures.length}/${checks} passed`);
assert.equal(failures.length, 0, failures.join("\n"));
