import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const KINEMATICS_OPERATORS = ["constant_acceleration_trajectory", "trajectory_state"] as const;
export type KinematicsOperator = (typeof KINEMATICS_OPERATORS)[number];
export interface KinematicTrajectoryDefinition {
  kind: "constant_acceleration_2d";
  initialPosition: RenderPoint;
  initialVelocity: RenderPoint;
  acceleration: RenderPoint;
  tMin: number;
  tMax: number;
  samples: number;
  sourceUnits: { length: string | null; time: string | null };
  renderedExtent: { minX: number; maxX: number; minY: number; maxY: number };
}
export interface KinematicStateDefinition {
  trajectoryId: string;
  time: number;
  position: RenderPoint;
  velocity: RenderPoint;
  acceleration: RenderPoint;
  quantity: "position" | "velocity" | "acceleration";
  sourceUnits: KinematicTrajectoryDefinition["sourceUnits"];
  timeScale?: number;
  zero: boolean;
}
export interface KinematicSampledCurve {
  curveKind: "parametric";
  parameterMin: number;
  parameterMax: number;
  evaluate(time: number): RenderPoint;
  derivative(time: number): RenderPoint;
}
export type KinematicsGeometry =
  | { kind: "point"; point: RenderPoint; kinematicTrajectory?: KinematicTrajectoryDefinition; kinematicState?: KinematicStateDefinition; sampledCurve?: KinematicSampledCurve }
  | { kind: "path"; points: RenderPoint[]; directed?: true; kinematicTrajectory?: KinematicTrajectoryDefinition; kinematicState?: KinematicStateDefinition; sampledCurve?: KinematicSampledCurve };
export interface KinematicsEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
  geometry(value: unknown): unknown;
}
const MAX_SCALAR = 1e9;
const MAX_COORDINATE = 1e12;
const MAX_SAMPLES = 513;
const MIN_INTERVAL = 1e-9;
const MIN_LENGTH = 1e-6;
const METRIC_TOLERANCE = 1e-8;
const INPUT_KEYS = {
  constant_acceleration_trajectory: ["initialPosition", "initialVelocity", "acceleration", "tMin", "tMax", "samples", "units"],
  trajectory_state: ["trajectory", "time", "kind", "timeScale"],
} as const;
class KinematicsInputError extends Error {
  constructor(readonly key: string, message: string) { super(message); }
}
function invalid(key: string, message: string): never { throw new KinematicsInputError(key, message); }
function isOperator(operator: string): operator is KinematicsOperator { return (KINEMATICS_OPERATORS as readonly string[]).includes(operator); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function inputKeys(inputs: Record<string, unknown>, allowed: readonly string[], key = "input"): void {
  for (const name of Object.keys(inputs)) if (!allowed.includes(name)) invalid(key, `kinematics does not accept ${name}`);
}
function numberInput(value: unknown, key: string, context: KinematicsEvaluationContext): number {
  try {
    const number = context.number(value);
    if (!Number.isFinite(number) || Math.abs(number) > MAX_SCALAR) invalid(key, `${key} must be finite with magnitude no greater than ${MAX_SCALAR}`);
    return number;
  } catch (error) {
    if (error instanceof KinematicsInputError) throw error;
    return invalid(key, `${key} must resolve to a finite number`);
  }
}
function componentPair(value: unknown, key: string, context: KinematicsEvaluationContext): RenderPoint {
  const components = pairValues(value, key);
  const limit = key === "initialPosition" ? MAX_COORDINATE : MAX_SCALAR;
  const read = (value: unknown, axis: string): number => {
    try {
      const number = context.number(value);
      if (!Number.isFinite(number) || Math.abs(number) > limit) invalid(`${key}.${axis}`, `${key}.${axis} must be finite with magnitude no greater than ${limit}`);
      return number;
    } catch (error) {
      if (error instanceof KinematicsInputError) throw error;
      return invalid(`${key}.${axis}`, `${key}.${axis} must resolve to a finite number`);
    }
  };
  return { x: read(components[0], "x"), y: read(components[1], "y") };
}
function pairValues(value: unknown, key: string): [unknown, unknown] {
  if (Array.isArray(value) && value.length === 2) return [value[0], value[1]];
  if (isRecord(value)) {
    inputKeys(value, ["x", "y"], key);
    if ("x" in value && "y" in value) return [value.x, value.y];
  }
  return invalid(key, `${key} requires explicit 2D [x,y] or {x,y} numeric components, not a projected point reference`);
}
function checkedPoint(point: RenderPoint, key: string): RenderPoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) invalid(key, `${key} coordinates exceed finite world bounds`);
  return point;
}
function checkedSum(a: number, b: number, key: string): number {
  const sum = a + b;
  if (!Number.isFinite(sum)) invalid(key, `${key} exceeds finite arithmetic`);
  if (sum !== 0 && Math.abs(sum) <= 64 * Number.EPSILON * (Math.abs(a) + Math.abs(b))) invalid(key, `${key} is unresolved within floating-point cancellation`);
  return sum === 0 ? 0 : sum;
}
function positionAt(model: KinematicTrajectoryDefinition, time: number): RenderPoint {
  checkedTime(model, time);
  const component = (axis: "x" | "y"): number => {
    const displacement = checkedSum(model.initialVelocity[axis] * time, model.acceleration[axis] * time * time / 2, "precision");
    const position = model.initialPosition[axis] + displacement;
    if (displacement !== 0 && Math.abs((position - model.initialPosition[axis]) - displacement) > Math.abs(displacement) * METRIC_TOLERANCE) invalid("precision", "world translation cannot preserve the computed displacement at numeric precision");
    return position;
  };
  return checkedPoint({ x: component("x"), y: component("y") }, "position");
}
function checkedTime(model: KinematicTrajectoryDefinition, time: number): void {
  if (!Number.isFinite(time) || time < model.tMin || time > model.tMax) invalid("time", "state time must lie inside the trajectory interval");
}
function velocityAt(model: KinematicTrajectoryDefinition, time: number): RenderPoint {
  checkedTime(model, time);
  return checkedPoint({ x: checkedSum(model.initialVelocity.x, model.acceleration.x * time, "precision"), y: checkedSum(model.initialVelocity.y, model.acceleration.y * time, "precision") }, "velocity");
}
function normalizedUnit(value: string): string { return value.trim().replace(/[A-Za-z]{4,}/g, (word) => word.toLowerCase()); }
function unitsInput(value: unknown): KinematicTrajectoryDefinition["sourceUnits"] {
  if (value === undefined) return { length: null, time: null };
  if (!isRecord(value)) invalid("units", "units must declare length and time");
  inputKeys(value, ["length", "time"], "units");
  const length = typeof value.length === "string" ? LENGTH_UNITS.get(normalizedUnit(value.length)) : undefined;
  const time = typeof value.time === "string" ? TIME_UNITS.get(normalizedUnit(value.time)) : undefined;
  if (!length || !time) invalid("units", "units must declare recognized world length and time units");
  return { length, time };
}
function readTrajectory(inputs: Record<string, unknown>, context: KinematicsEvaluationContext): { model: KinematicTrajectoryDefinition; points: RenderPoint[] } {
  const initialPosition = componentPair(inputs.initialPosition, "initialPosition", context);
  const initialVelocity = componentPair(inputs.initialVelocity, "initialVelocity", context);
  const acceleration = componentPair(inputs.acceleration, "acceleration", context);
  const tMin = numberInput(inputs.tMin, "tMin", context);
  const tMax = numberInput(inputs.tMax, "tMax", context);
  if (!(tMax - tMin > MIN_INTERVAL)) invalid("domain", `tMax must exceed tMin by more than ${MIN_INTERVAL}`);
  const samples = inputs.samples === undefined ? 65 : numberInput(inputs.samples, "samples", context);
  if (!Number.isInteger(samples) || samples < 3 || samples > MAX_SAMPLES) invalid("samples", `samples must be an integer from 3 to ${MAX_SAMPLES}`);
  const sourceUnits = unitsInput(inputs.units);
  checkTrajectoryUnits(inputs, sourceUnits);
  const model: KinematicTrajectoryDefinition = {
    kind: "constant_acceleration_2d", initialPosition, initialVelocity, acceleration, tMin, tMax, samples, sourceUnits,
    renderedExtent: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  };
  let previousTime = -Infinity;
  const points = Array.from({ length: samples }, (_, index) => {
    const time = index === samples - 1 ? tMax : tMin + (tMax - tMin) * index / (samples - 1);
    if (!(time > previousTime)) invalid("precision", "trajectory sample times are indistinguishable at numeric precision");
    previousTime = time;
    return positionAt(model, time);
  });
  model.renderedExtent = {
    minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)),
  };
  const span = Math.hypot(model.renderedExtent.maxX - model.renderedExtent.minX, model.renderedExtent.maxY - model.renderedExtent.minY);
  const stationary = initialVelocity.x === 0 && initialVelocity.y === 0 && acceleration.x === 0 && acceleration.y === 0;
  if (!stationary && span <= MIN_LENGTH) invalid("precision", "nonstationary trajectory is indistinguishable from a point at world precision");
  return { model, points };
}

/** Initial position/velocity refer to t=0, even when the visible interval starts elsewhere. */
export function evaluateKinematicsConstruction(operator: string, inputs: Record<string, unknown>, context: KinematicsEvaluationContext): KinematicsGeometry[] {
  if (!isOperator(operator)) invalid("operator", `unsupported kinematics operator ${operator}`);
  inputKeys(inputs, INPUT_KEYS[operator]);
  if (operator === "constant_acceleration_trajectory") {
    const { model, points } = readTrajectory(inputs, context);
    const sampledCurve: KinematicSampledCurve = { curveKind: "parametric", parameterMin: model.tMin, parameterMax: model.tMax, evaluate: (time) => positionAt(model, time), derivative: (time) => velocityAt(model, time) };
    if (model.initialVelocity.x === 0 && model.initialVelocity.y === 0 && model.acceleration.x === 0 && model.acceleration.y === 0) return [{ kind: "point", point: points[0]!, kinematicTrajectory: model, sampledCurve }];
    return [{ kind: "path", points, kinematicTrajectory: model, sampledCurve }];
  }
  if (inputs.kind !== "position" && inputs.kind !== "velocity" && inputs.kind !== "acceleration" && inputs.kind !== "state") invalid("kind", "trajectory_state requires explicit position, velocity, acceleration, or state kind");
  const model = trajectoryReference(inputs.trajectory, context);
  const time = numberInput(inputs.time, "time", context);
  if (time < model.tMin || time > model.tMax) invalid("time", "state time must lie inside the trajectory interval");
  checkScalarUnits(inputs.time, "time", "time", model.sourceUnits);
  const position = positionAt(model, time);
  const velocity = velocityAt(model, time);
  const metadata = (quantity: KinematicStateDefinition["quantity"], timeScale?: number): KinematicStateDefinition => ({
    trajectoryId: String(inputs.trajectory), time, position: { ...position }, velocity: { ...velocity }, acceleration: { ...model.acceleration }, quantity, sourceUnits: { ...model.sourceUnits },
    ...(timeScale === undefined ? {} : { timeScale }), zero: quantity === "position" ? false : quantity === "velocity" ? velocity.x === 0 && velocity.y === 0 : model.acceleration.x === 0 && model.acceleration.y === 0,
  });
  const positionOutput: KinematicsGeometry = { kind: "point", point: position, kinematicState: metadata("position") };
  if (inputs.kind === "position") {
    if (inputs.timeScale !== undefined) invalid("timeScale", "position state does not accept a vector timeScale");
    return [positionOutput];
  }
  const timeScale = numberInput(inputs.timeScale, "timeScale", context);
  if (!(timeScale > 0)) invalid("timeScale", "vector timeScale must be explicit and positive");
  checkScalarUnits(inputs.timeScale, "timeScale", "time", model.sourceUnits);
  const vector = (quantity: "velocity" | "acceleration"): KinematicsGeometry => {
    const components = quantity === "velocity" ? velocity : model.acceleration;
    const state = metadata(quantity, timeScale);
    if (state.zero) return { kind: "point", point: { ...position }, kinematicState: state };
    const factor = quantity === "velocity" ? timeScale : timeScale * timeScale;
    const displacement = { x: components.x * factor, y: components.y * factor };
    const tip = checkedPoint({ x: position.x + displacement.x, y: position.y + displacement.y }, "vector");
    const length = Math.hypot(displacement.x, displacement.y);
    if (!Number.isFinite(length) || length <= MIN_LENGTH) invalid("precision", "a nonzero state vector must remain distinguishable at world precision");
    for (const axis of ["x", "y"] as const) {
      if (displacement[axis] !== 0 && Math.abs((tip[axis] - position[axis]) - displacement[axis]) > Math.abs(displacement[axis]) * METRIC_TOLERANCE) invalid("precision", "state vector placement cannot preserve its physical components at numeric precision");
    }
    return { kind: "path", points: [{ ...position }, tip], directed: true, kinematicState: state };
  };
  return inputs.kind === "state" ? [positionOutput, vector("velocity"), vector("acceleration")] : [vector(inputs.kind)];
}
/** Physical coordinates are explicit 2D components; a projected diagram point
 * cannot silently become an SI initial condition. Units are never converted. */
export function validateKinematicsConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const { operator, inputs } = construction;
  if (!isOperator(operator)) return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const add = (key: string, message: string, actual?: unknown): void => {
    issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal",
      path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`,
      entityIds: outputs, actual });
  };
  if (!isRecord(inputs)) { add("inputs", "kinematics inputs must be an object", inputs); return; }
  const kinds = operator === "constant_acceleration_trajectory" ? ["polyline"] : inputs.kind === "state" ? ["point", "vector", "vector"] : [inputs.kind === "position" ? "point" : "vector"];
  if (outputs.length !== kinds.length || outputs.some((id) => typeof id !== "string" || !id.trim()) || new Set(outputs).size !== outputs.length) add("outputs", `${operator} requires exactly ${kinds.length} distinct outputs`, construction.outputs);
  outputs.forEach((id, outputIndex) => {
    const actualKind = document.entities.find((entity) => entity.id === id)?.kind;
    if (actualKind !== kinds[outputIndex]) add("output_kind", `${operator} output ${outputIndex} must be ${kinds[outputIndex]}`, actualKind);
  });
  const context: KinematicsEvaluationContext = {
    number(value) {
      const result = validationNumber(value, document);
      if (result === null) throw new Error("unresolved numeric source");
      return result;
    },
    point() { throw new Error("physical motion requires explicit component inputs"); },
    geometry(value) {
      const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined;
      const entity = document.entities.find((candidate) => candidate.id === value);
      if (producer?.operator !== "constant_acceleration_trajectory" || entity?.kind !== "polyline") invalid("trajectory", "trajectory_state must reference a computed 2D motion trajectory");
      checkTrajectoryUnits(producer.inputs, unitsInput(producer.inputs.units), document);
      return evaluateKinematicsConstruction(producer.operator, producer.inputs, context)[0];
    },
  };
  try {
    if (operator === "constant_acceleration_trajectory") checkTrajectoryUnits(inputs, unitsInput(inputs.units), document);
    else {
      const model = trajectoryReference(inputs.trajectory, context);
      checkScalarUnits(inputs.time, "time", "time", model.sourceUnits, document);
      if (inputs.timeScale !== undefined) checkScalarUnits(inputs.timeScale, "timeScale", "time", model.sourceUnits, document);
    }
    evaluateKinematicsConstruction(operator, inputs, context);
  } catch (error) {
    const key = error instanceof KinematicsInputError ? error.key : "inputs";
    add(key, error instanceof Error ? error.message : String(error), inputs[key]);
  }
}
export function kinematicsPointResidual(trajectory: KinematicTrajectoryDefinition, point: RenderPoint, time: number): number {
  if (!Number.isFinite(time) || time < trajectory.tMin || time > trajectory.tMax) invalid("time", "state time must lie inside the trajectory interval");
  checkedPoint(point, "point");
  const expected = positionAt(trajectory, time);
  return Math.hypot(point.x - expected.x, point.y - expected.y);
}

function trajectoryReference(value: unknown, context: KinematicsEvaluationContext): KinematicTrajectoryDefinition {
  if (typeof value !== "string" || !value.trim()) invalid("trajectory", "trajectory_state requires a computed trajectory reference");
  let geometry: unknown;
  try { geometry = context.geometry(value); }
  catch { return invalid("trajectory", "trajectory_state requires a computed trajectory reference"); }
  if (!isRecord(geometry) || geometry.kind !== "path" && geometry.kind !== "point" || !isRecord(geometry.kinematicTrajectory)) invalid("trajectory", "reference does not carry a computed 2D constant-acceleration motion model");
  const model = geometry.kinematicTrajectory;
  if (model.kind !== "constant_acceleration_2d" || !isRecord(model.sourceUnits) || !isRecord(model.renderedExtent)) invalid("trajectory", "reference motion metadata is incomplete");
  const sourceUnits = model.sourceUnits;
  const units = sourceUnits.length === null && sourceUnits.time === null ? undefined : { length: sourceUnits.length, time: sourceUnits.time };
  const result = readTrajectory({
    initialPosition: model.initialPosition, initialVelocity: model.initialVelocity, acceleration: model.acceleration,
    tMin: model.tMin, tMax: model.tMax, samples: model.samples, units,
  }, context).model;
  for (const key of ["minX", "maxX", "minY", "maxY"] as const) {
    if (typeof model.renderedExtent[key] !== "number" || !Number.isFinite(model.renderedExtent[key]) || model.renderedExtent[key] !== result.renderedExtent[key]) invalid("trajectory", "reference rendered extent contradicts its motion model");
  }
  return result;
}

const LENGTH_UNITS = unitAliases([
  ["m", "m,meter,meters,metre,metres"], ["cm", "cm,centimeter,centimeters,centimetre,centimetres"],
  ["mm", "mm,millimeter,millimeters,millimetre,millimetres"], ["km", "km,kilometer,kilometers,kilometre,kilometres"],
  ["nm", "nm,nanometer,nanometers"], ["µm", "µm,μm,um,micrometer,micrometers"],
  ["ft", "ft,foot,feet"], ["in", "in,inch,inches"], ["unit", "unit,units,1,dimensionless"],
]);
const TIME_UNITS = unitAliases([
  ["s", "s,sec,second,seconds"], ["ms", "ms,millisecond,milliseconds"], ["µs", "µs,μs,us,microsecond,microseconds"],
  ["min", "min,minute,minutes"], ["h", "h,hr,hour,hours"], ["unit", "unit,units,1,dimensionless"],
]);
function unitAliases(entries: Array<[string, string]>): Map<string, string> { return new Map(entries.flatMap(([canonical, aliases]) => aliases.split(",").map((alias) => [alias, canonical] as const))); }
type Dimension = "length" | "time" | "velocity" | "acceleration" | "scalar";
function compatibleUnit(unit: string, dimension: Dimension, declared: KinematicTrajectoryDefinition["sourceUnits"]): boolean {
  if (dimension === "scalar") return LENGTH_UNITS.get(unit) === "unit";
  if (!declared.length || !declared.time) return false;
  if (dimension === "length") return LENGTH_UNITS.get(unit) === declared.length;
  if (dimension === "time") return TIME_UNITS.get(unit) === declared.time;
  const normalized = unit.replaceAll(" ", "").replaceAll("²", "^2");
  const [length, time, extra] = normalized.split("/");
  if (!length || !time || extra !== undefined) return false;
  const timeName = dimension === "acceleration" ? time.endsWith("^2") ? time.slice(0, -2) : time.endsWith("2") ? time.slice(0, -1) : "" : time;
  return LENGTH_UNITS.get(length) === declared.length && TIME_UNITS.get(timeName) === declared.time;
}
function scalarUnits(value: unknown, document?: SceneDocument, seen = new Set<unknown>(), depth = 0): string[] {
  if (depth > 32 || seen.has(value)) return [];
  seen.add(value);
  const record = typeof value === "string" ? document?.quantities.find((quantity) => quantity.id === value) : isRecord(value) ? value : undefined;
  if (!record) return [];
  const units = typeof record.unit === "string" && record.unit.trim() ? [normalizedUnit(record.unit)] : [];
  return "value" in record ? [...units, ...scalarUnits(record.value, document, seen, depth + 1)] : units;
}
function checkScalarUnits(value: unknown, key: string, dimension: Dimension, declared: KinematicTrajectoryDefinition["sourceUnits"], document?: SceneDocument): void {
  for (const unit of scalarUnits(value, document)) if (!compatibleUnit(unit, dimension, declared)) invalid("units", `${key} source unit ${unit} is incompatible with declared world length/time units`);
}
function checkTrajectoryUnits(inputs: Record<string, unknown>, declared: KinematicTrajectoryDefinition["sourceUnits"], document?: SceneDocument): void {
  for (const [key, dimension] of [["initialPosition", "length"], ["initialVelocity", "velocity"], ["acceleration", "acceleration"]] as const) {
    const components = pairValues(inputs[key], key);
    components.forEach((value, index) => checkScalarUnits(value, `${key}.${index === 0 ? "x" : "y"}`, dimension, declared, document));
  }
  for (const key of ["tMin", "tMax"]) checkScalarUnits(inputs[key], key, "time", declared, document);
  if (inputs.samples !== undefined) checkScalarUnits(inputs.samples, "samples", "scalar", declared, document);
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>(), depth = 0): number | null {
  if (depth > 32 || seen.has(value)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  seen.add(value);
  if (typeof value === "string") {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) return validationNumber(quantity.value, document, seen, depth + 1);
    return value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;
  }
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen, depth + 1);
  return null;
}
