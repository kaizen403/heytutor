import { strict as assert } from "node:assert";
import {
  evaluateKinematicsConstruction,
  kinematicsPointResidual,
  validateKinematicsConstruction,
  type KinematicsEvaluationContext,
  type KinematicsGeometry,
} from "../../src/compile/kinematicsGeometry";
import type { RenderPoint, RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";

const quantities = new Map<string, number>([["start", 1], ["end", 5], ["count", 9], ["vx", 4]]);
const geometries = new Map<string, KinematicsGeometry>();
const context: KinematicsEvaluationContext = {
  number(value) {
    if (typeof value === "object" && value !== null && "value" in value) return context.number(value.value);
    const resolved = typeof value === "string" && quantities.has(value) ? quantities.get(value)! : Number(value);
    if (!Number.isFinite(resolved)) throw new Error("non-numeric source");
    return resolved;
  },
  point(value) {
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: Number(value.x), y: Number(value.y) };
    throw new Error("not an inline point");
  },
  geometry(value) { return typeof value === "string" ? geometries.get(value) : undefined; },
};
let checks = 0;
function close(actual: number, expected: number, message: string, tolerance = 1e-9): void {
  checks++;
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function evaluate(operator: string, inputs: Record<string, unknown>): KinematicsGeometry[] {
  return evaluateKinematicsConstruction(operator, inputs, context);
}
function reject(operator: string, inputs: Record<string, unknown>): void {
  checks++;
  assert.throws(() => evaluate(operator, inputs), undefined, `${operator} must reject ${JSON.stringify(inputs)}`);
}
function projectile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { initialPosition: [2, 3], initialVelocity: [4, 5], acceleration: [0, -2], tMin: 1, tMax: 5, samples: 9, units: { length: "m", time: "s" }, ...overrides };
}
const motion = evaluate("constant_acceleration_trajectory", projectile())[0]!;
assert.equal(motion.kind, "path");
if (motion.kind !== "path" || !motion.kinematicTrajectory) throw new Error("trajectory must preserve its computed model");
assert.equal(motion.points.length, 9);
assert.deepEqual(motion.kinematicTrajectory.sourceUnits, { length: "m", time: "s" });
const expected = [[6, 7], [8, 8.25], [10, 9], [12, 9.25], [14, 9], [16, 8.25], [18, 7], [20, 5.25], [22, 3]];
motion.points.forEach((point, index) => {
  close(point.x, expected[index]![0]!, "nonzero-start projectile x");
  close(point.y, expected[index]![1]!, "nonzero-start projectile y");
  close(kinematicsPointResidual(motion.kinematicTrajectory!, point, 1 + index / 2), 0, "analytic trajectory residual");
});
assert.deepEqual(motion.kinematicTrajectory.renderedExtent, { minX: 6, maxX: 22, minY: 3, maxY: 9.25 });
for (const form of ["id", "numeric_string", "wrapped"] as const) {
  const inputs = projectile();
  inputs.tMin = form === "id" ? "start" : form === "numeric_string" ? "1" : { value: "start" };
  inputs.tMax = form === "id" ? "end" : form === "numeric_string" ? "5" : { value: "end" };
  inputs.samples = form === "id" ? "count" : form === "numeric_string" ? "9" : { value: "count" };
  inputs.initialVelocity = { x: { value: "vx" }, y: "5" };
  const result = evaluate("constant_acceleration_trajectory", inputs)[0]!;
  assert.equal(result.kind, "path");
  if (result.kind !== "path") throw new Error("numeric references must produce a trajectory");
  close(result.points[0]!.x, 6, "reference-backed velocity x");
}
for (const [initialPosition, initialVelocity, acceleration, tMin, tMax, expectedPoints] of [
  [[1, -2], [3, 0], [0, 0], -1, 3, [[-2, -2], [1, -2], [4, -2], [7, -2], [10, -2]]],
  [[8, 1], [0, 7], [0, -3], 0, 4, [[8, 1], [8, 6.5], [8, 9], [8, 8.5], [8, 5]]],
] as const) {
  const output = evaluate("constant_acceleration_trajectory", { initialPosition, initialVelocity, acceleration, tMin, tMax, samples: 5 })[0]!;
  assert.equal(output.kind, "path");
  if (output.kind !== "path") throw new Error("horizontal/vertical motion must produce a path");
  output.points.forEach((point, index) => {
    close(point.x, expectedPoints[index]![0], "horizontal/vertical distance x");
    close(point.y, expectedPoints[index]![1], "horizontal/vertical distance y");
  });
}
const rest = evaluate("constant_acceleration_trajectory", { initialPosition: [7, 9], initialVelocity: [0, 0], acceleration: [0, 0], tMin: -1, tMax: 2 })[0]!;
assert.equal(rest.kind, "point", "stationary motion is a deterministic marker");
assert.ok(rest.kinematicTrajectory, "stationary marker retains its complete motion model");
if (rest.kind !== "point") throw new Error("rest trajectory must be a point");
assert.deepEqual(rest.point, { x: 7, y: 9 });
for (const [key, value] of [["tMin", Infinity], ["tMax", 1], ["tMax", -2], ["samples", 2], ["samples", 3.5], ["samples", 514], ["initialPosition", "projected"], ["initialVelocity", [1]], ["acceleration", [0, NaN]], ["initialPosition", [1e13, 0]]] as const) {
  reject("constant_acceleration_trajectory", projectile({ [key]: value }));
}
reject("constant_acceleration_trajectory", projectile({ gravity: 9.8 }));
reject("constant_acceleration_trajectory", projectile({ initialPosition: [1e12, 0], initialVelocity: [1e-5, 1], acceleration: [0, 0], tMin: 0, tMax: 1 }));

geometries.set("trajectory", motion);
for (const time of [1, 1.25, 2.5, 5]) {
  const state = evaluate("trajectory_state", { trajectory: "trajectory", time, kind: "position" });
  assert.equal(state.length, 1);
  assert.equal(state[0]!.kind, "point");
  if (state[0]!.kind !== "point") throw new Error("position state must be a point");
  const metadata = state[0]!.kinematicState;
  assert.ok(metadata, "state must retain its physical components and time");
  assert.equal(metadata.trajectoryId, "trajectory");
  assert.equal(metadata.time, time);
  close(metadata.velocity.x, 4, "uniform horizontal speed");
  close(metadata.velocity.y, 5 - 2 * time, "velocity changes linearly with time");
  close(kinematicsPointResidual(motion.kinematicTrajectory, state[0]!.point, time), 0, "state point analytic incidence without chord error");
  if (time === 1.25) {
    close(state[0]!.point.x, 7, "between-sample position x");
    close(state[0]!.point.y, 7.6875, "between-sample position y");
    assert.notEqual(state[0]!.point.y, 7.625, "exact state must not be interpolated along a sampled chord");
  }
}
const completeState = evaluate("trajectory_state", { trajectory: "trajectory", time: 1.25, kind: "state", timeScale: 2 });
assert.equal(completeState.length, 3);
assert.equal(completeState[0]!.kind, "point");
for (const [index, expectedTip] of [[1, { x: 15, y: 12.6875 }], [2, { x: 7, y: -0.3125 }]] as const) {
  const vector = completeState[index]!;
  assert.equal(vector.kind, "path");
  if (vector.kind !== "path") throw new Error("nonzero physical vector must be a directed path");
  assert.equal(vector.directed, true);
  close(vector.points[0]!.x, 7, "vector anchored at exact state x");
  close(vector.points[0]!.y, 7.6875, "vector anchored at exact state y");
  close(vector.points[1]!.x, expectedTip.x, "explicit time-scale vector tip x");
  close(vector.points[1]!.y, expectedTip.y, "explicit time-scale vector tip y");
}
const vertical = evaluate("constant_acceleration_trajectory", { initialPosition: [0, 0], initialVelocity: [0, 6], acceleration: [0, -2], tMin: 0, tMax: 6 })[0]!;
geometries.set("vertical", vertical);
const apex = evaluate("trajectory_state", { trajectory: "vertical", time: 3, kind: "velocity", timeScale: 1 })[0]!;
assert.equal(apex.kind, "point", "zero apex velocity is a marker without a fake arrow");
assert.equal(apex.kinematicState?.zero, true);
assert.deepEqual(apex.kinematicState?.velocity, { x: 0, y: 0 });
if (apex.kind !== "point") throw new Error("zero velocity must be a point marker");
assert.deepEqual(apex.point, { x: 0, y: 9 });
geometries.set("rest", rest);
const restState = evaluate("trajectory_state", { trajectory: "rest", time: 0, kind: "state", timeScale: 1 });
assert.equal(restState.length, 3);
assert.ok(restState.every((output) => output.kind === "point"), "rest state is position plus two zero-vector markers");
for (const [key, value] of [["time", 0], ["time", 6], ["time", Infinity], ["trajectory", "missing"], ["kind", "speed"], ["timeScale", 0], ["timeScale", -1], ["timeScale", undefined]] as const) {
  reject("trajectory_state", { trajectory: "trajectory", time: 2, kind: "velocity", timeScale: 1, [key]: value });
}
reject("trajectory_state", { trajectory: "trajectory", time: 2, kind: "position", timeScale: 1 });
reject("trajectory_state", { trajectory: "trajectory", time: 2, kind: "position", velocity: [1, 0] });

assert.ok(motion.sampledCurve?.derivative, "trajectory preserves its exact analytic derivative");
assert.deepEqual(motion.sampledCurve.derivative(1.25), { x: 4, y: 2.5 });
assert.ok(rest.sampledCurve?.derivative, "rest marker remains a valid analytic constant curve");
assert.deepEqual(rest.sampledCurve.derivative(0.5), { x: 0, y: 0 });
assert.deepEqual(rest.sampledCurve.evaluate(0.5), { x: 7, y: 9 });

function transformed(point: RenderPoint, angle: number, scale: number, origin = { x: 0, y: 0 }): RenderPoint {
  const radians = angle * Math.PI / 180;
  return { x: origin.x + scale * (point.x * Math.cos(radians) - point.y * Math.sin(radians)), y: origin.y + scale * (point.x * Math.sin(radians) + point.y * Math.cos(radians)) };
}
for (const angle of [0, 37, -126]) {
  for (const scale of [0.1, 1, 100]) {
    for (const origin of [{ x: 0, y: 0 }, { x: 19, y: -31 }]) {
      const result = evaluate("constant_acceleration_trajectory", projectile({
        initialPosition: transformed({ x: 2, y: 3 }, angle, scale, origin),
        initialVelocity: transformed({ x: 4, y: 5 }, angle, scale), acceleration: transformed({ x: 0, y: -2 }, angle, scale),
      }))[0]!;
      assert.equal(result.kind, "path");
      if (result.kind !== "path") throw new Error("rigid world transformation must preserve a trajectory");
      result.points.forEach((point, index) => {
        const independent = transformed({ x: expected[index]![0]!, y: expected[index]![1]! }, angle, scale, origin);
        close(point.x, independent.x, "transformed trajectory x");
        close(point.y, independent.y, "transformed trajectory y");
      });
      const acceleration = transformed({ x: 0, y: -2 }, angle, scale);
      for (let index = 1; index < result.points.length - 1; index++) {
        const [previous, current, next] = [result.points[index - 1]!, result.points[index]!, result.points[index + 1]!];
        close((next.x - 2 * current.x + previous.x) / 0.25, acceleration.x, "independent central-difference acceleration x", 1e-7);
        close((next.y - 2 * current.y + previous.y) / 0.25, acceleration.y, "independent central-difference acceleration y", 1e-7);
      }
    }
  }
}
for (const inputs of [
  projectile({ initialPosition: [{ value: 2, unit: "m" }, 3], initialVelocity: [{ value: 4, unit: "Meters/Second" }, 5], acceleration: [0, { value: -2, unit: "m/s²" }], tMin: { value: 1, unit: "Seconds" } }),
  projectile({ units: { length: "Centimeters", time: "Milliseconds" }, initialVelocity: [{ value: 4, unit: "cm/ms" }, 5], acceleration: [0, { value: -2, unit: "cm/ms2" }] }),
]) evaluate("constant_acceleration_trajectory", inputs);
for (const inputs of [
  projectile({ units: { length: "Mm", time: "s" } }),
  projectile({ units: { length: "m", time: "Ms" } }),
  projectile({ units: { length: "mm", time: "s" }, initialVelocity: [{ value: 4, unit: "Mm/s" }, 5] }),
  projectile({ units: undefined, tMin: { value: 1, unit: "s" } }),
  projectile({ initialPosition: [{ value: 2, unit: "cm" }, 3] }),
  projectile({ initialVelocity: [{ value: 4, unit: "m" }, 5] }),
  projectile({ initialVelocity: [{ value: 4, unit: "m/ms" }, 5] }),
  projectile({ acceleration: [0, { value: -2, unit: "m/s" }] }),
  projectile({ samples: { value: 9, unit: "s" } }),
  projectile({ units: { length: "m", time: "s", gravity: 9.8 } }),
  projectile({ initialPosition: { x: 2, y: 3, z: 0 } }),
]) reject("constant_acceleration_trajectory", inputs);
reject("trajectory_state", { trajectory: "trajectory", time: { value: 2, unit: "ms" }, kind: "position" });
reject("trajectory_state", { trajectory: "trajectory", time: 2, kind: "velocity", timeScale: { value: 1, unit: "m" } });
geometries.set("contradictory", { ...motion, kinematicTrajectory: { ...motion.kinematicTrajectory, renderedExtent: { ...motion.kinematicTrajectory.renderedExtent, maxX: 99 } } });
reject("trajectory_state", { trajectory: "contradictory", time: 2, kind: "position" });

function documentFor(constructions: SceneConstruction[]): SceneDocument {
  const ids = constructions.flatMap((construction) => construction.outputs);
  return {
    schemaVersion: "scene-document/v2", source: { question: "Construct the motion from explicit initial conditions." },
    visualDecision: { mode: "scene", reason: "source-grounded constant acceleration" }, quantities: [],
    entities: constructions.flatMap((construction) => construction.outputs.map((id, index) => ({ id,
      kind: construction.operator === "constant_acceleration_trajectory" ? "polyline" : construction.inputs.kind === "position" || construction.inputs.kind === "state" && index === 0 ? "point" : "vector", role: "computed motion geometry" }))),
    constructions, relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show motion" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show verified trajectory and state" }],
  };
}
function motionDocument(): SceneDocument {
  return documentFor([
    { id: "construct_motion", operator: "constant_acceleration_trajectory", inputs: projectile(), outputs: ["motion"] },
    { id: "construct_state", operator: "trajectory_state", inputs: { trajectory: "motion", time: 1.25, kind: "state", timeScale: 2 }, outputs: ["position", "velocity", "acceleration"] },
  ]);
}
function validationIssues(scene: SceneDocument): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const byOutput = new Map(scene.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
  scene.constructions.forEach((construction, index) => validateKinematicsConstruction(construction, index, scene, byOutput, issues));
  return issues;
}
function rejectDocument(scene: SceneDocument, code: string): void {
  const issues = validationIssues(scene);
  checks++;
  assert.ok(issues.some((issue) => issue.code === code && issue.severity === "fatal"), `document must reject with ${code}: ${JSON.stringify(issues)}`);
}
assert.deepEqual(validationIssues(motionDocument()), []);
for (const [key, value, code] of [["trajectory", "position", "trajectory"], ["time", 6, "time"], ["timeScale", -1, "timeScale"], ["kind", "speed", "kind"]] as const) {
  const scene = motionDocument();
  scene.constructions[1]!.inputs[key] = value;
  rejectDocument(scene, `invalid_trajectory_state_${code}`);
}
for (const constructionIndex of [0, 1]) {
  const scene = motionDocument();
  scene.constructions[constructionIndex]!.outputs.pop();
  rejectDocument(scene, `invalid_${scene.constructions[constructionIndex]!.operator}_outputs`);
}
const wrongKind = motionDocument();
wrongKind.entities.find((entity) => entity.id === "velocity")!.kind = "point";
rejectDocument(wrongKind, "invalid_trajectory_state_output_kind");
for (const compatible of [true, false]) {
  const scene = motionDocument();
  scene.quantities = [{ id: "speed", value: 4, unit: compatible ? "m/s" : "cm/s" }, { id: "state_time", value: 1.25, unit: "seconds" }];
  scene.constructions[0]!.inputs.initialVelocity = { x: "speed", y: 5 };
  scene.constructions[1]!.inputs.time = { value: "state_time" };
  if (compatible) assert.deepEqual(validationIssues(scene), []);
  else rejectDocument(scene, "invalid_constant_acceleration_trajectory_units");
}
const wrongScaleUnit = motionDocument();
wrongScaleUnit.quantities = [{ id: "display_time", value: 2, unit: "ms" }];
wrongScaleUnit.constructions[1]!.inputs.timeScale = "display_time";
rejectDocument(wrongScaleUnit, "invalid_trajectory_state_units");
const cycle = motionDocument();
cycle.quantities = [{ id: "cycle_a", value: "cycle_b" }, { id: "cycle_b", value: "cycle_a" }];
cycle.constructions[1]!.inputs.time = "cycle_a";
rejectDocument(cycle, "invalid_trajectory_state_time");
const prefixScenes: SceneDocument[] = [];
for (const units of [{ length: "Mm", time: "s" }, { length: "m", time: "Ms" }]) {
  const candidate = motionDocument(); candidate.constructions[0]!.inputs.units = units;
  rejectDocument(candidate, "invalid_constant_acceleration_trajectory_units"); prefixScenes.push(candidate);
}
const prefixQuantity = motionDocument(); prefixQuantity.constructions[0]!.inputs.units = { length: "mm", time: "s" };
prefixQuantity.quantities = [{ id: "mega_velocity", value: 4, unit: "Mm/s" }]; prefixQuantity.constructions[0]!.inputs.initialVelocity = ["mega_velocity", 5];
rejectDocument(prefixQuantity, "invalid_constant_acceleration_trajectory_units"); prefixScenes.push(prefixQuantity);

// The chapter's numeric gate can run while other live compiler modules are being
// integrated; default invocation also verifies the atomic render boundary.
if (!process.argv.includes("--unit-only")) {
  const { compileSceneDocument } = await import("../../src/compile/compiler");
  const { validateSceneDocument } = await import("../../src/document/validation");
  for (const candidate of prefixScenes) {
    const result = compileSceneDocument(candidate); checks++;
    assert.ok(!result.ok && result.renderScene === null, "SI prefix case mismatch must reject atomically rather than relabel physical length/time");
  }
  function compile(scene: SceneDocument): RenderPrimitive[] {
    const validated = validateSceneDocument(scene);
    assert.ok(validated.document, `motion document validation failed: ${JSON.stringify(validated.report.issues)}`);
    const result = compileSceneDocument(validated.document);
    assert.ok(result.ok && result.renderScene, `motion compile failed: ${JSON.stringify(result.report.issues)}`);
    assert.ok(result.renderScene.primitives.every((primitive) => primitive.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))), "all motion marks must have finite coordinates");
    checks++;
    return result.renderScene.primitives;
  }
  function primitiveFor(primitives: RenderPrimitive[], id: string): RenderPrimitive {
    const primitive = primitives.find((candidate) => candidate.entityId === id);
    assert.ok(primitive, `missing rendered motion entity ${id}`);
    return primitive;
  }
  for (const timeForm of [1.25, "1.25", { value: 1.25 }]) {
    const scene = motionDocument();
    scene.constructions[1]!.inputs.time = timeForm;
    scene.constructions.reverse();
    scene.assertions.push({ id: "position_on_motion", predicate: "incident", entities: ["position", "motion"], tolerance: 1e-8, severity: "fatal" });
    const primitives = compile(scene);
    const path = primitiveFor(primitives, "motion");
    assert.equal(path.points.length, 9, "motion renders its sampled path");
    const position = primitiveFor(primitives, "position").points[0]!;
    const first = path.points[0]!;
    const scale = (path.points[8]!.x - first.x) / 16;
    close(position.x - first.x, scale, "compiled between-sample position x", 0.001);
    close(position.y - first.y, -0.6875 * scale, "compiled analytic position y", 0.001);
    for (const [id, expectedDelta] of [["velocity", { x: 8, y: -5 }], ["acceleration", { x: 0, y: 8 }]] as const) {
      const vector = primitiveFor(primitives, id);
      assert.equal(vector.kind, "vector");
      close(vector.points[0]!.x - position.x, 0, "compiled vector tail x", 0.015);
      close(vector.points[0]!.y - position.y, 0, "compiled vector tail y", 0.015);
      close(vector.points[1]!.x - position.x - expectedDelta.x * scale, 0, "compiled dimensionally scaled vector x", 0.025);
      close(vector.points[1]!.y - position.y - expectedDelta.y * scale, 0, "compiled dimensionally scaled vector y", 0.025);
    }
  }
  const restScene = motionDocument();
  restScene.constructions[0]!.inputs = { initialPosition: [7, 9], initialVelocity: [0, 0], acceleration: [0, 0], tMin: -1, tMax: 2 };
  restScene.constructions[1]!.inputs = { trajectory: "motion", time: 0, kind: "state", timeScale: 1 };
  restScene.assertions.push({ id: "rest_position_on_motion", predicate: "incident", entities: ["position", "motion"], tolerance: 1e-8, severity: "fatal" });
  const stationaryPrimitives = compile(restScene);
  assert.ok(stationaryPrimitives.every((primitive) => primitive.kind === "point"), "stationary trajectory/state renders markers without fake directions");
  for (const [key, value] of [["time", 6], ["timeScale", -1], ["trajectory", "velocity"]] as const) {
    const invalid = motionDocument();
    invalid.constructions[1]!.inputs[key] = value;
    const result = compileSceneDocument(invalid);
    assert.equal(result.ok, false, "invalid motion state must fail the live compile");
    assert.equal(result.renderScene, null, "invalid motion candidate must never partially render");
    checks++;
  }
  const forgedPosition = motionDocument();
  forgedPosition.constructions[1]!.inputs.kind = "position";
  forgedPosition.constructions[1]!.outputs = ["position"];
  forgedPosition.entities = forgedPosition.entities.filter((entity) => entity.id !== "velocity" && entity.id !== "acceleration");
  forgedPosition.requiredEntityIds = ["motion", "position"];
  forgedPosition.revealGroups[0]!.entityIds = ["motion", "position"];
  forgedPosition.entities.push({ id: "offMotion", kind: "point", role: "off-trajectory source point" });
  forgedPosition.constructions.push({ id: "construct_off_motion", operator: "point", inputs: { x: 7, y: 7.625 }, outputs: ["offMotion"] });
  forgedPosition.requiredEntityIds.push("offMotion");
  forgedPosition.revealGroups[0]!.entityIds.push("offMotion");
  forgedPosition.assertions.push({ id: "reject_sample_chord_as_exact_motion", predicate: "incident", entities: ["offMotion", "motion"], tolerance: 1e-5, severity: "fatal" });
  const invalidIncidence = compileSceneDocument(forgedPosition);
  assert.equal(invalidIncidence.ok, false, "a point on a display chord cannot pass an exact trajectory assertion");
  assert.equal(invalidIncidence.renderScene, null, "false analytic incidence cannot partially render");
  checks++;
}

console.log(`kinematics operators verified: ${checks} independent source-math and rejection checks`);
