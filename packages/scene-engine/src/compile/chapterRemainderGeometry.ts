import type { RenderPoint, RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import {
  add2, bounded, canonicalUnit, compactNumber, hypot2, invalid, isRecord, pair, placement, rejectUnknownKeys,
  requireUnits, scale2, scalar, SourceInputError, sourceUnits, unit2, validationNumber,
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
  | { kind: "dimension"; a: RenderPoint; b: RenderPoint; remainder: RemainderMark }
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
    // A [t, value] pair names the same sample as {t, value}; the order is the
    // graph's own axis order, time first.
    if (Array.isArray(point) && point.length === 2) {
      return { t: scalar(point[0], `points[${index}].t`, context), value: scalar(point[1], `points[${index}].value`, context) };
    }
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

function landingTime(ux: number, uy: number, gravity: number, incline: number, height: number, direction: number): number {
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

/**
 * projectile_trajectory works in m/s, m/s^2, m and degrees. A unit stated on
 * an input (its {value, unit} wrapper or the quantity it names) must be one of
 * these or km/h, which is converted to m/s. Any other stated unit is refused,
 * never read as SI. A value with no stated unit is read in the working unit,
 * as the operator contract says.
 */
const SI = "si";
const KM_PER_HOUR = "km/h";
const PROJECTILE_UNITS = {
  speed: {
    "m/s": SI, "ms^-1": SI, "m/sec": SI, "metre/s": SI, "metres/s": SI, "meter/s": SI, "meters/s": SI,
    metrepersecond: SI, metrespersecond: SI, meterpersecond: SI, meterspersecond: SI,
    "km/h": KM_PER_HOUR, "km/hr": KM_PER_HOUR, "km/hour": KM_PER_HOUR, "kmh^-1": KM_PER_HOUR, kmph: KM_PER_HOUR,
    kilometreperhour: KM_PER_HOUR, kilometresperhour: KM_PER_HOUR, kilometerperhour: KM_PER_HOUR, kilometersperhour: KM_PER_HOUR,
  },
  acceleration: {
    "m/s^2": SI, "m/s2": SI, "ms^-2": SI, "m/s/s": SI, "m/sec^2": SI,
    metrepersecondsquared: SI, metrespersecondsquared: SI, meterpersecondsquared: SI, meterspersecondsquared: SI,
  },
  length: { m: SI, metre: SI, metres: SI, meter: SI, meters: SI },
  angle: { "°": SI, "º": SI, deg: SI, degree: SI, degrees: SI },
} as const satisfies Record<string, Readonly<Record<string, typeof SI | typeof KM_PER_HOUR>>>;
type ProjectileDimension = keyof typeof PROJECTILE_UNITS;

function projectileUnitSpelling(unit: string): string {
  return unit.trim()
    .replace(/[−–]/g, "-").replace(/⁻²/g, "^-2").replace(/⁻¹/g, "^-1").replace(/²/g, "^2")
    .replace(/[\s·⋅*]+/g, "")
    .replace(/[A-Za-z]{3,}/g, (word) => word.toLowerCase());
}

/** The input in its working unit; a stated unit the operator cannot read is fatal. */
function projectileScalar(value: unknown, key: string, dimension: ProjectileDimension, context: SourceContext, document: SceneDocument | undefined, cap?: number): number {
  const number = scalar(value, key, context, cap);
  const units: Readonly<Record<string, typeof SI | typeof KM_PER_HOUR>> = PROJECTILE_UNITS[dimension];
  const stated = sourceUnits(value, document).map((unit) => {
    const spelling = projectileUnitSpelling(unit);
    const reading = Object.hasOwn(units, spelling) ? units[spelling] : undefined;
    if (reading === undefined) invalid("units", `${key} unit ${unit} is not a ${dimension} unit projectile_trajectory reads; it is not treated as SI`);
    return reading;
  });
  if (stated.some((reading) => reading !== stated[0])) invalid("units", `${key} source units disagree`);
  // Exact for whole km/h: 72 km/h is 72000 / 3600 = 20 m/s, not 20.000000000000004.
  return stated[0] === KM_PER_HOUR ? bounded(number * 1000 / 3600, key, cap) : number;
}

function readProjectile(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["speed", "launchAngleDeg", "gravity", "inclineAngleDeg", "initialHeight", "direction", "origin", "displayScale", "samples", "showMeasurements", "heightReference"]);
  if (inputs.showMeasurements !== undefined && typeof inputs.showMeasurements !== "boolean") invalid("showMeasurements", "showMeasurements must be a boolean");
  const speed = projectileScalar(inputs.speed, "speed", "speed", context, document);
  if (!(speed > 0)) invalid("speed", "speed must be positive");
  const degrees = projectileScalar(inputs.launchAngleDeg, "launchAngleDeg", "angle", context, document, 1e6);
  const launch = degrees * Math.PI / 180;
  const cardinal = degrees % 360;
  const launchVector = { x: speed * (Math.abs(cardinal) === 90 || Math.abs(cardinal) === 270 ? 0 : Math.cos(launch)),
    y: speed * (cardinal === 0 || Math.abs(cardinal) === 180 ? 0 : Math.sin(launch)) };
  if (launchVector.y === 0 && cardinal !== 0 && Math.abs(cardinal) !== 180) invalid("precision", "a nonzero launch component underflowed at the stated angle");
  const gravity = projectileScalar(inputs.gravity, "gravity", "acceleration", context, document);
  if (!(gravity > 0)) invalid("gravity", "gravity must be positive");
  const incline = (inputs.inclineAngleDeg === undefined ? 0 : projectileScalar(inputs.inclineAngleDeg, "inclineAngleDeg", "angle", context, document, 360)) * Math.PI / 180;
  const heightReference = inputs.heightReference ?? "level_ground";
  if (heightReference !== "launch" && heightReference !== "level_ground") invalid("heightReference", "heightReference must be launch or level_ground");
  if (inputs.showMeasurements === true && heightReference === "level_ground" && incline !== 0) invalid("heightReference", "an inclined landing line requires heightReference:launch (vertical rise), not a height above level ground");
  const height = inputs.initialHeight === undefined ? 0 : projectileScalar(inputs.initialHeight, "initialHeight", "length", context, document);
  if (height < 0) invalid("initialHeight", "initial height cannot be negative");
  const direction = inputs.direction === "down" ? -1 : 1;
  if (inputs.direction !== undefined && inputs.direction !== "up" && inputs.direction !== "down") invalid("direction", "incline direction must be up or down");
  const time = landingTime(launchVector.x, launchVector.y, gravity, incline, height, direction);
  const samples = inputs.samples === undefined ? 49 : scalar(inputs.samples, "samples", context);
  if (!Number.isInteger(samples) || samples < 8 || samples > 129) invalid("samples", "samples must be an integer from 8 to 129");
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = positive(inputs.displayScale, "displayScale", context);
  const points = Array.from({ length: samples }, (_, index) => {
    const t = time * index / (samples - 1);
    return {
      x: origin.x + launchVector.x * t * displayScale,
      y: origin.y + (height + launchVector.y * t - 0.5 * gravity * t * t) * displayScale,
    };
  });
  const result: RemainderGeometry[] = [
    { kind: "path", points, remainder: mark("trajectory", { x: time, y: height }, "s", displayScale) },
    arrow(origin, launchVector, displayScale, mark("launch", launchVector, "m/s", displayScale), { x: 0, y: height * displayScale }),
  ];
  if (inputs.showMeasurements === true) {
    const launchPoint = points[0]!, landing = points.at(-1)!;
    const peakTime = Math.max(0, Math.min(time, launchVector.y / gravity));
    const rise = Math.max(0, launchVector.y * peakTime - 0.5 * gravity * peakTime * peakTime);
    const peak = { x: launchPoint.x + launchVector.x * peakTime * displayScale, y: launchPoint.y + rise * displayScale };
    const range = launchVector.x * time;
    if ((range === 0 && launchVector.x !== 0) || (rise === 0 && launchVector.y > 0)) invalid("precision", "a nonzero projectile measurement underflowed; it cannot be certified as zero");
    result.push(range === 0
      ? { kind: "point", point: landing, remainder: mark("R", { x: 0, y: 0 }, "m", displayScale) }
      : { kind: "dimension", a: { x: launchPoint.x, y: landing.y }, b: landing, remainder: mark("R", { x: range, y: 0 }, "m", displayScale) });
    const measuredHeight = heightReference === "launch" ? rise : height + rise;
    const heightSymbol = heightReference === "launch" ? "Δh" : "H";
    result.push(measuredHeight === 0
      ? { kind: "point", point: peak, remainder: mark(heightSymbol, { x: 0, y: 0 }, "m", displayScale) }
      : { kind: "dimension", a: { x: peak.x, y: heightReference === "launch" ? launchPoint.y : origin.y }, b: peak,
        remainder: mark(heightSymbol, { x: 0, y: measuredHeight }, "m", displayScale) });
  }
  return result;
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

function readMagnet(inputs: Record<string, unknown>, context: SourceContext): RemainderGeometry[] {
  rejectUnknownKeys(inputs, ["moment", "origin", "displayScale"]);
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
  if (operator === "projectile_trajectory") return readProjectile(inputs, context, document);
  if (operator === "work_interval") return readWork(inputs, context);
  if (operator === "spring_energy") return readSpring(inputs, context);
  if (operator === "potential_curve") return readPotential(inputs, context);
  if (operator === "collision") return readCollision(inputs, context);
  if (operator === "loop_torque") return readTorque(inputs, context);
  if (operator === "galvanometer") return readGalvanometer(inputs, context);
  return readMagnet(inputs, context);
}

export function chapterRemainderOutputLabels(operator: string, outputs: readonly unknown[], requested?: readonly unknown[], allowQuantitySymbols = false): string[] {
  if (!isOperator(operator) || (outputs.length !== COUNTS[operator] && !(operator === "projectile_trajectory" && outputs.length === 4))) invalid("outputs", "remainder labels require every ordered output");
  return outputs.map((output, index) => {
    if (!isRecord(output) || !isRecord(output.remainder)) invalid("outputs", "remainder geometry is missing source metadata");
    const metadata = output.remainder as unknown as RemainderMark;
    const symbol = metadata.role;
    const numeric = `${symbol}=${compactNumber(metadata.certified ?? metadata.magnitude)}`;
    const requestedText = requested?.[index];
    // An identifier names a quantity; it does not assert its value. Do not
    // normalize superscripts/operators into identifiers or accept equations.
    if (allowQuantitySymbols && !(operator === "projectile_trajectory" && index >= 2) &&
        typeof requestedText === "string" && /^[\p{L}][\p{L}\p{M}\p{Nd}_₀-₉]*$/u.test(requestedText)) return requestedText;
    if (requestedText !== undefined && requestedText !== symbol && requestedText !== numeric) invalid("label", "remainder labels must be the role symbol or the verified magnitude");
    return requestedText === numeric ? numeric : symbol;
  });
}

/** A native measurement cannot silently become a different physical symbol
 * through an entity label or a replacing/append annotation, even in yield mode. */
export function validateProjectileMeasurementLabels(construction: SceneConstruction, document: SceneDocument, values: RemainderGeometry[]): void {
  if (construction.operator !== "projectile_trajectory" || construction.inputs.showMeasurements !== true) return;
  for (const [index, value] of values.entries()) {
    if (index < 2) continue;
    const id = construction.outputs[index], role = value.remainder.role;
    const allowed = [role, `${role}=${compactNumber(value.remainder.magnitude)}`];
    const entity = document.entities.find(e => e.id === id), label = entity?.label;
    if (index === 3 && ((role === "Δh" && /\babove\s+(?:the\s+)?(?:level\s+)?ground\b/i.test(entity?.role ?? "")) ||
        (role === "H" && /\brise\b|\babove\s+(?:the\s+)?launch\b/i.test(entity?.role ?? "")))) {
      invalid("heightReference", "The declared height role must agree with heightReference: H above level ground or Δh above launch.");
    }
    // Only whole-text labels/braces can repeat a measurement symbol. Badges
    // truncate text and polarity/spin split or reinterpret it; neither can
    // establish this scalar's meaning. Narration carries no ink.
    const annotations = document.annotations.filter(a => a.kind !== "narration" && a.targetIds.includes(id!));
    if (annotations.some(a => a.text !== undefined && !["label", "callout", "brace"].includes(a.kind))) {
      invalid("label", "Projectile measurements support whole-text label, callout or brace annotations only.");
    }
    const annotationTexts = annotations.map(a => a.text);
    if ([label, ...annotationTexts].some(text => text !== undefined && !allowed.includes(text))) {
      invalid("label", `Computed projectile ${role} must retain its own symbol or verified magnitude; use heightReference to choose H above level ground or Δh above launch.`);
    }
  }
}

/** A nonzero computed measurement may not project to a zero-length bar.
 * True zero measurements were emitted as point markers by the operator. */
export function validateProjectileMeasurementProjection(document: SceneDocument, primitives: RenderPrimitive[]): SceneIssue[] {
  const ids = new Set(document.constructions.filter(c => c.operator === "projectile_trajectory" && c.inputs.showMeasurements === true).flatMap(c => c.outputs.slice(2)));
  return primitives.flatMap(p => {
    if (!ids.has(p.entityId) || p.kind !== "dimension") return [];
    const a = p.provenance?.measuredStart, b = p.provenance?.measuredEnd;
    if (isRecord(a) && isRecord(b) && typeof a.x === "number" && typeof a.y === "number" && typeof b.x === "number" && typeof b.y === "number" &&
        Number.isFinite(Math.hypot(a.x - b.x, a.y - b.y)) && Math.hypot(a.x - b.x, a.y - b.y) >= 1) return [];
    return [{ code: "projectile_measurement_collapsed", severity: "fatal" as const, failureKind: "truth" as const,
      entityIds: [p.entityId], message: "A nonzero projectile measurement is not resolved at the rendered scale." }];
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
  const count = operator === "projectile_trajectory" && construction.inputs?.showMeasurements === true ? 4 : COUNTS[operator];
  if (outputs.length !== count || new Set(outputs).size !== outputs.length) {
    issues.push({ code: `invalid_${operator}_outputs`, severity: "fatal", message: `${operator} requires ${count} distinct outputs`, path: `constructions[${index}].outputs` });
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
  try {
    const values = evaluateChapterRemainderConstruction(operator, construction.inputs, context, document);
    validateProjectileMeasurementLabels(construction, document, values);
  }
  catch (error) {
    issues.push({
      code: `invalid_${operator}_${error instanceof SourceInputError ? error.key : "inputs"}`,
      severity: "fatal",
      message: error instanceof Error ? error.message : "remainder inputs are invalid",
      path: `constructions[${index}].inputs`,
    });
  }
}
