import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import {
  add2, canonicalUnit, compactNumber, hypot2, invalid, isRecord, pair, pairValues, placement, rejectUnknownKeys,
  requireUnits, scale2, scalar, SourceInputError, unit2, validationNumber,
  type SourceContext,
} from "./sourceScalars";

export const CHAPTER_REMAINDER_OPERATORS = [
  "relative_velocity",
  "motion_graph",
  "uniform_circular_motion",
  "projectile_trajectory",
  "work_interval",
  "spring_energy",
  "potential_curve",
  "collision",
  "loop_torque",
  "galvanometer",
  "bar_magnet",
] as const;

export interface RemainderMark {
  role: string;
  components: { x: number; y: number; z?: number };
  magnitude: number;
  unit: string;
  displayScale: number;
  zero: boolean;
  pageNormal?: "out" | "in" | null;
  certified?: number;
}
export type RemainderGeometry =
  | { kind: "point"; point: RenderPoint; remainder: RemainderMark }
  | { kind: "path"; points: RenderPoint[]; directed?: true; closed?: true; remainder: RemainderMark }
  | { kind: "circle"; center: RenderPoint; radius: number; remainder: RemainderMark }
  | { kind: "multi_path"; paths: RenderPoint[][]; remainder: RemainderMark };

const COUNTS: Record<(typeof CHAPTER_REMAINDER_OPERATORS)[number], number> = {
  relative_velocity: 3,
  motion_graph: 1,
  uniform_circular_motion: 5,
  projectile_trajectory: 2,
  work_interval: 2,
  spring_energy: 2,
  potential_curve: 1,
  collision: 4,
  loop_torque: 1,
  galvanometer: 2,
  bar_magnet: 5,
};

function isOperator(operator: string): operator is (typeof CHAPTER_REMAINDER_OPERATORS)[number] {
  return (CHAPTER_REMAINDER_OPERATORS as readonly string[]).includes(operator);
}
function mark(role: string, components: RemainderMark["components"], unit: string, displayScale: number): RemainderMark {
  const magnitude = Math.hypot(components.x, components.y, components.z ?? 0);
  return { role, components, magnitude, unit, displayScale, zero: magnitude === 0, pageNormal: null };
}
function arrow(origin: RenderPoint, components: RenderPoint, scale: number, metadata: RemainderMark, lane = { x: 0, y: 0 }): RemainderGeometry {
  const start = add2(origin, lane, "placement");
  if (metadata.zero) return { kind: "point", point: start, remainder: metadata };
  const delta = scale2(components, scale, "display");
  if (!(hypot2(delta) > 1e-6)) invalid("precision", "a nonzero vector collapses at the stated display scale");
  return { kind: "path", points: [start, add2(start, delta, "display")], directed: true, remainder: metadata };
}
function positive(value: unknown, key: string, context: SourceContext): number {
  const number = scalar(value, key, context);
  if (!(number > 0)) invalid(key, `${key} must be positive`);
  return number;
}

const VELOCITY_UNITS: Readonly<Record<string, string>> = {
  "m/s": "m/s", "km/h": "km/h", "km/hr": "km/h", "cm/s": "cm/s", unit: "unit", units: "unit",
};

function readRelative(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["velocityA", "velocityB", "units", "origin", "displayScale"]);
  if (!isRecord(inputs.units) || !canonicalUnit(inputs.units.velocity, VELOCITY_UNITS)) invalid("units", "relative velocity requires one shared velocity unit");
  const unit = canonicalUnit(inputs.units.velocity, VELOCITY_UNITS)!;
  requireUnits(inputs.velocityA, unit, VELOCITY_UNITS, document);
  requireUnits(inputs.velocityB, unit, VELOCITY_UNITS, document);
  const a = pair(inputs.velocityA, "velocityA", context);
  const b = pair(inputs.velocityB, "velocityB", context);
  const relative = add2(a, scale2(b, -1, "relative"), "relative");
  const origin = placement(inputs.origin, "origin", context);
  const scale = positive(inputs.displayScale, "displayScale", context);
  const largest = Math.max(hypot2(a), hypot2(b), hypot2(relative), 1e-9);
  return [a, b, relative].map((components, index) => arrow(
    origin, components, scale / largest, mark(["vA", "vB", "vRel"][index]!, components, unit, scale),
    { x: index * 1e-4, y: 0 },
  ));
}

function readGraph(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["quantity", "points", "origin", "timeScale", "ordinateScale"]);
  if (inputs.quantity !== "position" && inputs.quantity !== "velocity") invalid("quantity", "motion_graph quantity must be position or velocity");
  if (!Array.isArray(inputs.points) || inputs.points.length < 2 || inputs.points.length > 64) invalid("points", "motion_graph needs 2 to 64 samples");
  const samples = inputs.points.map((point, index) => {
    if (!isRecord(point)) invalid("points", "each sample needs t and value");
    rejectUnknownKeys(point, ["t", "value"], "points");
    return { t: scalar(point.t, `points[${index}].t`, context), value: scalar(point.value, `points[${index}].value`, context) };
  });
  for (let index = 1; index < samples.length; index += 1) {
    if (!(samples[index]!.t > samples[index - 1]!.t)) invalid("points", "sample times must strictly increase");
  }
  const origin = placement(inputs.origin, "origin", context);
  const timeScale = positive(inputs.timeScale, "timeScale", context);
  const ordinateScale = positive(inputs.ordinateScale, "ordinateScale", context);
  return [{
    kind: "path",
    points: samples.map((sample) => ({ x: origin.x + sample.t * timeScale, y: origin.y + sample.value * ordinateScale })),
    remainder: mark(inputs.quantity, { x: samples.at(-1)!.t, y: samples.at(-1)!.value }, inputs.quantity, timeScale),
  }];
}

function readCircular(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["radius", "speed", "angleDeg", "origin", "displayScale", "vectorScale"]);
  const radius = positive(inputs.radius, "radius", context);
  const speed = positive(inputs.speed, "speed", context);
  const angle = (inputs.angleDeg === undefined ? 0 : scalar(inputs.angleDeg, "angleDeg", context, 1e6)) * Math.PI / 180;
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = positive(inputs.displayScale, "displayScale", context);
  const vectorScale = positive(inputs.vectorScale, "vectorScale", context);
  const drawn = radius * displayScale;
  const particle = { x: origin.x + drawn * Math.cos(angle), y: origin.y + drawn * Math.sin(angle) };
  const tangent = { x: -speed * Math.sin(angle), y: speed * Math.cos(angle) };
  const centripetal = { x: -speed * speed / radius * Math.cos(angle), y: -speed * speed / radius * Math.sin(angle) };
  return [
    { kind: "point", point: particle, remainder: mark("particle", { x: radius, y: angle }, "m", displayScale) },
    { kind: "circle", center: origin, radius: drawn, remainder: mark("circle", { x: radius, y: 0 }, "m", displayScale) },
    { kind: "path", points: [origin, particle], remainder: mark("radius", { x: radius, y: 0 }, "m", displayScale) },
    arrow(particle, tangent, vectorScale / speed, mark("velocity", tangent, "m/s", vectorScale)),
    arrow(particle, centripetal, vectorScale / hypot2(centripetal), mark("acceleration", centripetal, "m/s^2", vectorScale), { x: 0.08, y: 0 }),
  ];
}

function landingTime(speed: number, angle: number, gravity: number, incline: number, height: number, direction: number): number {
  const ux = speed * Math.cos(angle);
  const uy = speed * Math.sin(angle);
  const slope = Math.tan(incline) * direction;
  const quadratic = 0.5 * gravity;
  const linear = ux * slope - uy;
  const discriminant = linear * linear + 2 * gravity * height;
  if (discriminant < 0) invalid("trajectory", "the projectile does not meet the landing line");
  const root = Math.sqrt(discriminant);
  const times = [(-linear - root) / (2 * quadratic), (-linear + root) / (2 * quadratic)].filter((time) => time > 1e-9).sort((left, right) => left - right);
  const time = times[0];
  if (time === undefined) invalid("trajectory", "the landing time is not positive");
  return time;
}

function readProjectile(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["speed", "launchAngleDeg", "gravity", "inclineAngleDeg", "initialHeight", "direction", "origin", "displayScale", "samples"]);
  const speed = positive(inputs.speed, "speed", context);
  const launch = scalar(inputs.launchAngleDeg, "launchAngleDeg", context, 1e6) * Math.PI / 180;
  const gravity = positive(inputs.gravity, "gravity", context);
  const incline = (inputs.inclineAngleDeg === undefined ? 0 : scalar(inputs.inclineAngleDeg, "inclineAngleDeg", context, 360)) * Math.PI / 180;
  const height = inputs.initialHeight === undefined ? 0 : scalar(inputs.initialHeight, "initialHeight", context);
  if (height < 0) invalid("initialHeight", "initial height cannot be negative");
  const direction = inputs.direction === "down" ? -1 : 1;
  if (inputs.direction !== undefined && inputs.direction !== "up" && inputs.direction !== "down") invalid("direction", "incline direction must be up or down");
  const time = landingTime(speed, launch, gravity, incline, height, direction);
  const samples = inputs.samples === undefined ? 49 : scalar(inputs.samples, "samples", context);
  if (!Number.isInteger(samples) || samples < 8 || samples > 129) invalid("samples", "samples must be an integer from 8 to 129");
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = positive(inputs.displayScale, "displayScale", context);
  const points = Array.from({ length: samples }, (_, index) => {
    const t = time * index / (samples - 1);
    return {
      x: origin.x + speed * Math.cos(launch) * t * displayScale,
      y: origin.y + (height + speed * Math.sin(launch) * t - 0.5 * gravity * t * t) * displayScale,
    };
  });
  const launchVector = { x: speed * Math.cos(launch), y: speed * Math.sin(launch) };
  return [
    { kind: "path", points, remainder: mark("trajectory", { x: time, y: height }, "s", displayScale) },
    arrow(origin, launchVector, displayScale, mark("launch", launchVector, "m/s", displayScale), { x: 0, y: height * displayScale }),
  ];
}

function readWork(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["force", "displacement", "origin", "displayScale"]);
  const force = pair(inputs.force, "force", context);
  const displacement = pair(inputs.displacement, "displacement", context);
  const work = force.x * displacement.x + force.y * displacement.y;
  const origin = placement(inputs.origin, "origin", context);
  const scale = positive(inputs.displayScale, "displayScale", context);
  const displacementMark = mark("displacement", displacement, "m", scale);
  displacementMark.certified = work;
  return [
    arrow(origin, force, scale / Math.max(hypot2(force), 1e-9), mark("force", force, "N", scale)),
    arrow(origin, displacement, scale / Math.max(hypot2(displacement), 1e-9), displacementMark, { x: 0, y: 0.2 }),
  ];
}

function readSpring(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["stiffness", "extension", "origin", "displayScale"]);
  const stiffness = positive(inputs.stiffness, "stiffness", context);
  const extension = scalar(inputs.extension, "extension", context);
  if (extension === 0) invalid("extension", "a zero extension has no stored spring energy to draw");
  const energy = 0.5 * stiffness * extension * extension;
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = positive(inputs.displayScale, "displayScale", context);
  const end = { x: origin.x + extension * displayScale, y: origin.y };
  const coil = Array.from({ length: 25 }, (_, index) => {
    const t = index / 24;
    return { x: origin.x + (end.x - origin.x) * t, y: origin.y + 0.18 * Math.sin(t * Math.PI * 8) };
  });
  return [
    { kind: "path", points: coil, remainder: mark("spring", { x: extension, y: energy }, "J", displayScale) },
    { kind: "point", point: end, remainder: mark("mass", { x: extension, y: energy }, "J", displayScale) },
  ];
}

function readPotential(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["samples", "origin", "xScale", "energyScale"]);
  if (!Array.isArray(inputs.samples) || inputs.samples.length < 2 || inputs.samples.length > 128) invalid("samples", "potential_curve needs 2 to 128 samples");
  const samples = inputs.samples.map((sample, index) => {
    if (!isRecord(sample)) invalid("samples", "each sample needs x and energy");
    rejectUnknownKeys(sample, ["x", "energy"], "samples");
    return { x: scalar(sample.x, `samples[${index}].x`, context), energy: scalar(sample.energy, `samples[${index}].energy`, context) };
  });
  for (let index = 1; index < samples.length; index += 1) if (!(samples[index]!.x > samples[index - 1]!.x)) invalid("samples", "potential samples must increase in x");
  const origin = placement(inputs.origin, "origin", context);
  const xScale = positive(inputs.xScale, "xScale", context);
  const energyScale = positive(inputs.energyScale, "energyScale", context);
  return [{
    kind: "path",
    points: samples.map((sample) => ({ x: origin.x + sample.x * xScale, y: origin.y + sample.energy * energyScale })),
    remainder: mark("potential", { x: samples[0]!.x, y: samples[0]!.energy }, "J", energyScale),
  }];
}

function readCollision(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["mass1", "mass2", "velocity1", "velocity2", "restitution", "axis", "origin", "displayScale"]);
  const mass1 = positive(inputs.mass1, "mass1", context);
  const mass2 = positive(inputs.mass2, "mass2", context);
  const restitution = scalar(inputs.restitution, "restitution", context);
  if (restitution < 0 || restitution > 1) invalid("restitution", "restitution must lie from 0 to 1");
  const u1 = scalar(inputs.velocity1, "velocity1", context);
  const u2 = scalar(inputs.velocity2, "velocity2", context);
  if (!(u1 > u2)) invalid("velocity1", "the rear body must be approaching along the impact axis");
  const total = mass1 + mass2;
  const v1 = (mass1 * u1 + mass2 * u2 - mass2 * restitution * (u1 - u2)) / total;
  const v2 = (mass1 * u1 + mass2 * u2 + mass1 * restitution * (u1 - u2)) / total;
  const origin = placement(inputs.origin, "origin", context);
  const scale = positive(inputs.displayScale, "displayScale", context);
  const axis = inputs.axis === undefined ? { x: 1, y: 0 } : unit2(pair(inputs.axis, "axis", context), "axis");
  const largest = Math.max(Math.abs(u1), Math.abs(u2), Math.abs(v1), Math.abs(v2), 1e-9);
  return [u1, u2, v1, v2].map((value, index) => {
    const components = { x: axis.x * value, y: axis.y * value };
    return arrow(
      { x: origin.x + (index % 2) * 1.6, y: origin.y - Math.floor(index / 2) * 0.8 },
      components,
      scale / largest,
      mark(["u1", "u2", "v1", "v2"][index]!, components, "m/s", scale),
    );
  });
}

function readTorque(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["current", "area", "magneticField", "origin", "displayLength"]);
  const current = scalar(inputs.current, "current", context);
  if (!Array.isArray(inputs.area) || inputs.area.length !== 3 || !Array.isArray(inputs.magneticField) || inputs.magneticField.length !== 3) invalid("area", "area and magneticField require three components");
  const area = { x: scalar(inputs.area[0], "area.x", context), y: scalar(inputs.area[1], "area.y", context), z: scalar(inputs.area[2], "area.z", context) };
  const field = { x: scalar(inputs.magneticField[0], "magneticField.x", context), y: scalar(inputs.magneticField[1], "magneticField.y", context), z: scalar(inputs.magneticField[2], "magneticField.z", context) };
  const torque = {
    x: current * (area.y * field.z - area.z * field.y),
    y: current * (area.z * field.x - area.x * field.z),
    z: current * (area.x * field.y - area.y * field.x),
  };
  if (torque.z !== 0 && (torque.x !== 0 || torque.y !== 0)) invalid("torque", "mixed planar and page-normal torque fails closed");
  const origin = placement(inputs.origin, "origin", context);
  const displayLength = positive(inputs.displayLength, "displayLength", context);
  const metadata = mark("torque", torque, "N m", displayLength);
  metadata.pageNormal = torque.z === 0 ? null : torque.z > 0 ? "out" : "in";
  if (metadata.zero) return [{ kind: "point", point: origin, remainder: metadata }];
  if (metadata.pageNormal) {
    const radius = displayLength / 2;
    const ring = (scale: number, samples: number): RenderPoint[] => Array.from({ length: samples + 1 }, (_, index) => {
      const angle = index === samples ? 0 : 2 * Math.PI * index / samples;
      return { x: origin.x + radius * scale * Math.cos(angle), y: origin.y + radius * scale * Math.sin(angle) };
    });
    const paths = metadata.pageNormal === "out"
      ? [ring(1, 48), ring(0.12, 12)]
      : [ring(1, 48), [{ x: origin.x - radius / 2, y: origin.y - radius / 2 }, { x: origin.x + radius / 2, y: origin.y + radius / 2 }], [{ x: origin.x - radius / 2, y: origin.y + radius / 2 }, { x: origin.x + radius / 2, y: origin.y - radius / 2 }]];
    return [{ kind: "multi_path", paths, remainder: metadata }];
  }
  return [arrow(origin, { x: torque.x, y: torque.y }, displayLength / hypot2({ x: torque.x, y: torque.y }), metadata)];
}

function readGalvanometer(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["current", "turns", "area", "field", "springConstant", "origin", "displayScale"]);
  const current = scalar(inputs.current, "current", context);
  const turns = scalar(inputs.turns, "turns", context);
  const area = positive(inputs.area, "area", context);
  const field = positive(inputs.field, "field", context);
  const spring = positive(inputs.springConstant, "springConstant", context);
  if (!Number.isInteger(turns) || turns < 1) invalid("turns", "turns must be a positive integer");
  const deflection = turns * current * area * field / spring;
  if (!Number.isFinite(deflection) || Math.abs(deflection) > Math.PI / 2) invalid("deflection", "the radial-field deflection is outside a right angle of the zero");
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = positive(inputs.displayScale, "displayScale", context);
  const tip = { x: origin.x + displayScale * Math.sin(deflection), y: origin.y + displayScale * Math.cos(deflection) };
  return [
    { kind: "circle", center: origin, radius: displayScale * 0.72, remainder: mark("coil", { x: turns, y: area }, "m^2", displayScale) },
    { kind: "path", points: [origin, tip], directed: true, remainder: mark("needle", { x: deflection, y: 0 }, "rad", displayScale) },
  ];
}

function readMagnet(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["moment", "origin", "displayScale", "units"]);
  const momentUnits = { "A m^2": "A m^2", "A*m^2": "A m^2", "A m²": "A m^2" };
  if (inputs.units !== undefined) {
    if (!isRecord(inputs.units)) invalid("units", "bar magnet units must declare moment in A m^2");
    rejectUnknownKeys(inputs.units, ["moment"], "units");
    if (canonicalUnit(inputs.units.moment, momentUnits) !== "A m^2") invalid("units", "bar magnet moment must use A m^2");
  }
  for (const component of pairValues(inputs.moment, "moment")) requireUnits(component, "A m^2", momentUnits, document);
  const moment = pair(inputs.moment, "moment", context);
  if (hypot2(moment) === 0) invalid("moment", "a bar magnet requires a nonzero moment");
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = positive(inputs.displayScale, "displayScale", context);
  const axis = unit2(moment, "moment");
  const bar: RemainderGeometry = {
    kind: "path",
    closed: true,
    points: [
      add2(origin, { x: -axis.x * 0.7 - axis.y * 0.18, y: -axis.y * 0.7 + axis.x * 0.18 }, "bar"),
      add2(origin, { x: axis.x * 0.7 - axis.y * 0.18, y: axis.y * 0.7 + axis.x * 0.18 }, "bar"),
      add2(origin, { x: axis.x * 0.7 + axis.y * 0.18, y: axis.y * 0.7 - axis.x * 0.18 }, "bar"),
      add2(origin, { x: -axis.x * 0.7 + axis.y * 0.18, y: -axis.y * 0.7 - axis.x * 0.18 }, "bar"),
    ],
    remainder: mark("bar", moment, "A m^2", displayScale),
  };
  const lines = [0.9, 1.6].flatMap((scale) => [-1, 1].map((side) => {
    const normal = { x: -axis.y * side, y: axis.x * side };
    const points = Array.from({ length: 49 }, (_, index) => {
      const theta = Math.PI * index / 48;
      const radius = scale * Math.sin(theta) ** 2 * displayScale;
      return {
        x: origin.x + axis.x * radius * Math.cos(theta) + normal.x * radius * Math.sin(theta),
        y: origin.y + axis.y * radius * Math.cos(theta) + normal.y * radius * Math.sin(theta),
      };
    });
    return { kind: "path" as const, points, remainder: mark("field_line", moment, "A m^2", displayScale) };
  }));
  return [bar, ...lines];
}

export function evaluateChapterRemainderConstruction(operator: string, inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): RemainderGeometry[] {
  if (!isOperator(operator)) invalid("operator", `unsupported remainder operator ${operator}`);
  if (operator === "relative_velocity") return readRelative(inputs, context, document);
  if (operator === "motion_graph") return readGraph(inputs, context);
  if (operator === "uniform_circular_motion") return readCircular(inputs, context);
  if (operator === "projectile_trajectory") return readProjectile(inputs, context);
  if (operator === "work_interval") return readWork(inputs, context);
  if (operator === "spring_energy") return readSpring(inputs, context);
  if (operator === "potential_curve") return readPotential(inputs, context);
  if (operator === "collision") return readCollision(inputs, context);
  if (operator === "loop_torque") return readTorque(inputs, context);
  if (operator === "galvanometer") return readGalvanometer(inputs, context);
  return readMagnet(inputs, context, document);
}

export function chapterRemainderOutputLabels(operator: string, outputs: readonly unknown[], requested?: readonly unknown[]): string[] {
  if (!isOperator(operator) || outputs.length !== COUNTS[operator]) invalid("outputs", "remainder labels require every ordered output");
  return outputs.map((output, index) => {
    if (!isRecord(output) || !isRecord(output.remainder)) invalid("outputs", "remainder geometry is missing source metadata");
    const metadata = output.remainder as unknown as RemainderMark;
    const symbol = metadata.role;
    const numeric = `${symbol}=${compactNumber(metadata.certified ?? metadata.magnitude)}`;
    const requestedText = requested?.[index];
    if (requestedText !== undefined && requestedText !== symbol && requestedText !== numeric) invalid("label", "remainder labels must be the role symbol or the verified magnitude");
    return requestedText === numeric ? numeric : symbol;
  });
}

export function validateChapterRemainderConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const operator = construction.operator;
  if (!isOperator(operator)) return;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputs.length !== COUNTS[operator] || new Set(outputs).size !== outputs.length) {
    issues.push({ code: `invalid_${operator}_outputs`, severity: "fatal", message: `${operator} requires ${COUNTS[operator]} distinct outputs`, path: `constructions[${index}].outputs` });
  }
  if (!isRecord(construction.inputs)) {
    issues.push({ code: `invalid_${operator}_inputs`, severity: "fatal", message: "inputs must be an object", path: `constructions[${index}].inputs` });
    return;
  }
  const context: SourceContext = {
    number: (value) => validationNumber(value, document),
    point: (value) => {
      if (typeof value !== "string") return placement(value, "origin", context);
      const producer = constructionByOutput.get(value);
      if (producer?.operator !== "point") invalid("origin", "placement must reference a point construction");
      return { x: validationNumber(producer.inputs.x, document), y: validationNumber(producer.inputs.y, document) };
    },
    geometry: () => undefined,
  };
  try { evaluateChapterRemainderConstruction(operator, construction.inputs, context, document); }
  catch (error) {
    issues.push({
      code: `invalid_${operator}_${error instanceof SourceInputError ? error.key : "inputs"}`,
      severity: "fatal",
      message: error instanceof Error ? error.message : "remainder inputs are invalid",
      path: `constructions[${index}].inputs`,
    });
  }
}
