import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import {
  add2, canonicalUnit, compactNumber, hypot2, invalid, isRecord, placement, rejectUnknownKeys,
  scale2, scalar, SourceInputError, validationNumber,
  type SourceContext,
} from "./sourceScalars";

export const CHAPTER_INSTRUMENT_OPERATORS = [
  "metre_bridge",
  "potentiometer",
  "incline_friction",
  "cyclotron",
] as const;

export interface InstrumentMark {
  role: string;
  components: { x: number; y: number; z?: number };
  magnitude: number;
  unit: string;
  displayScale: number;
  zero: boolean;
  pageNormal?: "out" | "in" | null;
  certified?: number;
}
export type InstrumentGeometry =
  | { kind: "point"; point: RenderPoint; instrument: InstrumentMark }
  | { kind: "path"; points: RenderPoint[]; directed?: true; closed?: true; instrument: InstrumentMark }
  | { kind: "circle"; center: RenderPoint; radius: number; instrument: InstrumentMark }
  | { kind: "multi_path"; paths: RenderPoint[][]; instrument: InstrumentMark };

const COUNTS = { metre_bridge: 4, potentiometer: 2, incline_friction: 6, cyclotron: 5 } as const;
const OHM: Readonly<Record<string, string>> = { ohm: "ohm", Ω: "ohm" };
const LENGTH: Readonly<Record<string, string>> = { m: "m", metre: "m", meter: "m", cm: "cm" };
const VOLT: Readonly<Record<string, string>> = { V: "V", volt: "V" };
const MASS: Readonly<Record<string, string>> = { kg: "kg" };
const GRAVITY: Readonly<Record<string, string>> = { "m/s^2": "m/s^2", "m/s²": "m/s^2" };
const CHARGE: Readonly<Record<string, string>> = { C: "C" };
const TESLA: Readonly<Record<string, string>> = { T: "T" };
const SPEED: Readonly<Record<string, string>> = { "m/s": "m/s" };

function isOperator(operator: string): operator is (typeof CHAPTER_INSTRUMENT_OPERATORS)[number] {
  return (CHAPTER_INSTRUMENT_OPERATORS as readonly string[]).includes(operator);
}
function mark(role: string, components: InstrumentMark["components"], unit: string, displayScale: number, certified?: number): InstrumentMark {
  const magnitude = Math.hypot(components.x, components.y, components.z ?? 0);
  return { role, components, magnitude, unit, displayScale, zero: magnitude === 0, pageNormal: null, ...(certified === undefined ? {} : { certified }) };
}
function positive(value: unknown, key: string, context: SourceContext): number {
  const number = scalar(value, key, context);
  if (!(number > 0)) invalid(key, `${key} must be positive`);
  return number;
}
function unitOf(inputs: Record<string, unknown>, key: string, aliases: Readonly<Record<string, string>>, expected: string): void {
  if (!isRecord(inputs.units) || canonicalUnit(inputs.units[key], aliases) !== expected) invalid("units", `${key} must declare ${expected}`);
}
function agree(actual: number, supplied: unknown, key: string, context: SourceContext): number {
  if (supplied === undefined) return actual;
  const value = scalar(supplied, key, context);
  if (Math.abs(value - actual) > 1e-8 * Math.max(1, Math.abs(actual))) invalid(key, `${key} contradicts the balance law`);
  return actual;
}

function readBridge(inputs: Record<string, unknown>, context: SourceContext): InstrumentGeometry[] {
  rejectUnknownKeys(inputs, ["knownResistance", "unknownResistance", "balanceFromLeft", "wireLength", "origin", "displayLength", "units"]);
  unitOf(inputs, "resistance", OHM, "ohm");
  if (!isRecord(inputs.units) || !canonicalUnit(inputs.units.length, LENGTH)) invalid("units", "length must declare m or cm");
  const known = positive(inputs.knownResistance, "knownResistance", context);
  const wire = positive(inputs.wireLength, "wireLength", context);
  if (inputs.unknownResistance === undefined && inputs.balanceFromLeft === undefined) invalid("unknownResistance", "supply the unknown resistance or the balance length");
  const balance = inputs.balanceFromLeft === undefined
    ? wire * known / (known + positive(inputs.unknownResistance, "unknownResistance", context))
    : positive(inputs.balanceFromLeft, "balanceFromLeft", context);
  if (!(balance < wire)) invalid("balanceFromLeft", "the jockey must lie strictly between the wire ends");
  const unknown = known * (wire - balance) / balance;
  agree(unknown, inputs.unknownResistance, "unknownResistance", context);
  const origin = placement(inputs.origin, "origin", context);
  const display = positive(inputs.displayLength, "displayLength", context);
  const end = { x: origin.x + display, y: origin.y };
  const jockey = { x: origin.x + display * balance / wire, y: origin.y };
  const gap = (at: RenderPoint, role: string, value: number): InstrumentGeometry => ({
    kind: "path",
    points: [at, { x: at.x, y: at.y + 0.45 }],
    instrument: mark(role, { x: value, y: 0 }, "ohm", display, value),
  });
  return [
    { kind: "path", points: [origin, end], instrument: mark("wire", { x: wire, y: 0 }, String(inputs.units.length), display) },
    { kind: "point", point: jockey, instrument: mark("jockey", { x: balance, y: unknown }, "ohm", display, unknown) },
    gap(origin, "known", known),
    gap(end, "unknown", unknown),
  ];
}

function readPotentiometer(inputs: Record<string, unknown>, context: SourceContext): InstrumentGeometry[] {
  rejectUnknownKeys(inputs, ["driverEmf", "cellEmf", "wireLength", "balanceLength", "origin", "displayLength", "units"]);
  unitOf(inputs, "emf", VOLT, "V");
  if (!isRecord(inputs.units) || !canonicalUnit(inputs.units.length, LENGTH)) invalid("units", "length must declare m or cm");
  const driver = positive(inputs.driverEmf, "driverEmf", context);
  const cell = positive(inputs.cellEmf, "cellEmf", context);
  const wire = positive(inputs.wireLength, "wireLength", context);
  if (cell > driver) invalid("cellEmf", "a cell above the driver emf has no null point on the wire");
  const balance = agree(wire * cell / driver, inputs.balanceLength, "balanceLength", context);
  const origin = placement(inputs.origin, "origin", context);
  const display = positive(inputs.displayLength, "displayLength", context);
  return [
    { kind: "path", points: [origin, { x: origin.x + display, y: origin.y }], instrument: mark("wire", { x: wire, y: driver }, "V", display) },
    { kind: "point", point: { x: origin.x + display * balance / wire, y: origin.y }, instrument: mark("jockey", { x: balance, y: cell }, "V", display, cell) },
  ];
}

function readIncline(inputs: Record<string, unknown>, context: SourceContext): InstrumentGeometry[] {
  rejectUnknownKeys(inputs, ["mass", "gravity", "angleDeg", "mu", "motion", "origin", "displayScale", "forceScale", "accelScale", "units"]);
  unitOf(inputs, "mass", MASS, "kg");
  unitOf(inputs, "gravity", GRAVITY, "m/s^2");
  const mass = positive(inputs.mass, "mass", context);
  const gravity = positive(inputs.gravity, "gravity", context);
  const angle = scalar(inputs.angleDeg, "angleDeg", context, 90) * Math.PI / 180;
  if (!(angle > 0) || !(angle < Math.PI / 2)) invalid("angleDeg", "the incline angle must lie strictly between 0 and 90 degrees");
  const mu = scalar(inputs.mu, "mu", context);
  if (mu < 0) invalid("mu", "the friction coefficient cannot be negative");
  if (inputs.motion !== "rest" && inputs.motion !== "down" && inputs.motion !== "up") invalid("motion", "motion must be rest, down, or up");
  const normalMagnitude = mass * gravity * Math.cos(angle);
  const parallel = mass * gravity * Math.sin(angle);
  const limiting = mu * normalMagnitude;
  let frictionMagnitude = limiting;
  let frictionUp = true;
  let acceleration = 0;
  if (inputs.motion === "rest") {
    if (parallel > limiting + 1e-9) invalid("mu", "static friction cannot hold the block at this angle");
    frictionMagnitude = parallel;
    acceleration = 0;
  } else if (inputs.motion === "down") {
    acceleration = gravity * (Math.sin(angle) - mu * Math.cos(angle));
    if (acceleration < -1e-9) invalid("motion", "kinetic friction would not let the block slide down");
    acceleration = Math.max(0, acceleration);
  } else {
    frictionUp = false;
    acceleration = -gravity * (Math.sin(angle) + mu * Math.cos(angle));
  }
  const origin = placement(inputs.origin, "origin", context);
  const display = positive(inputs.displayScale, "displayScale", context);
  const forceScale = positive(inputs.forceScale, "forceScale", context);
  const accelScale = positive(inputs.accelScale, "accelScale", context);
  const up = { x: Math.cos(angle), y: Math.sin(angle) };
  const outward = { x: -Math.sin(angle), y: Math.cos(angle) };
  const body = add2(origin, scale2(up, display / 2, "incline"), "body");
  const top = add2(origin, scale2(up, display, "incline"), "incline");
  const along = (direction: RenderPoint, magnitude: number): RenderPoint => ({ x: direction.x * magnitude, y: direction.y * magnitude });
  const weight = { x: 0, y: -mass * gravity };
  const normal = along(outward, normalMagnitude);
  const friction = along(up, frictionUp ? frictionMagnitude : -frictionMagnitude);
  const accel = along(up, acceleration);
  const arrow = (start: RenderPoint, components: RenderPoint, metadata: InstrumentMark): InstrumentGeometry => {
    if (metadata.zero) return { kind: "point", point: start, instrument: metadata };
    const delta = scale2(components, metadata.displayScale, "display");
    if (!(hypot2(delta) > 1e-6)) invalid("precision", "a nonzero force collapses at the stated display scale");
    return { kind: "path", points: [start, add2(start, delta, "display")], directed: true, instrument: metadata };
  };
  return [
    { kind: "path", points: [origin, top], instrument: mark("incline", { x: angle, y: 0 }, "rad", display) },
    { kind: "point", point: body, instrument: mark("body", { x: mass, y: 0 }, "kg", display) },
    arrow(body, weight, mark("weight", weight, "N", forceScale)),
    arrow(body, normal, mark("normal", normal, "N", forceScale)),
    arrow(body, friction, mark("friction", friction, "N", forceScale)),
    arrow(body, accel, mark("acceleration", accel, "m/s^2", accelScale)),
  ];
}

function dee(center: RenderPoint, radius: number, side: -1 | 1): RenderPoint[] {
  const gap = radius * 0.08;
  const points = Array.from({ length: 25 }, (_, index) => {
    const angle = side === 1 ? -Math.PI / 2 + Math.PI * index / 24 : Math.PI / 2 + Math.PI * index / 24;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
  return [
    { x: center.x + side * gap, y: center.y - radius },
    ...points.slice(1, -1),
    { x: center.x + side * gap, y: center.y + radius },
    { x: center.x + side * gap, y: center.y - radius },
  ];
}

function readCyclotron(inputs: Record<string, unknown>, context: SourceContext): InstrumentGeometry[] {
  rejectUnknownKeys(inputs, ["charge", "mass", "field", "speed", "origin", "displayScale", "units"]);
  unitOf(inputs, "charge", CHARGE, "C");
  unitOf(inputs, "mass", MASS, "kg");
  unitOf(inputs, "field", TESLA, "T");
  unitOf(inputs, "speed", SPEED, "m/s");
  const charge = scalar(inputs.charge, "charge", context);
  const mass = positive(inputs.mass, "mass", context);
  const field = scalar(inputs.field, "field", context);
  const speed = scalar(inputs.speed, "speed", context);
  if (charge === 0 || field === 0) invalid("field", "a cyclotron orbit requires nonzero charge and field");
  if (!(speed > 0)) invalid("speed", "a cyclotron snapshot requires positive speed");
  const radius = mass * speed / (Math.abs(charge) * Math.abs(field));
  if (!Number.isFinite(radius)) invalid("precision", "the cyclotron radius is unresolved");
  const origin = placement(inputs.origin, "origin", context);
  const display = positive(inputs.displayScale, "displayScale", context);
  const drawn = radius * display;
  if (!(drawn > 1e-6) && speed !== 0) invalid("precision", "a nonzero orbit collapses at the stated display scale");
  const sense = Math.sign(charge) * Math.sign(field);
  const particle = { x: origin.x + drawn, y: origin.y };
  // At the +x point of the orbit, q(v x B) must point toward the centre.
  // For positive qB this requires -y velocity; reversing either q or B
  // reverses the tangent while preserving inward magnetic force.
  const velocity = { x: 0, y: -sense * speed };
  const fieldMark = mark("field", { x: 0, y: 0, z: field }, "T", display);
  fieldMark.pageNormal = field > 0 ? "out" : "in";
  const glyphRadius = display * 0.18;
  const ring = Array.from({ length: 25 }, (_, index) => {
    const angle = 2 * Math.PI * index / 24;
    return { x: origin.x + glyphRadius * Math.cos(angle), y: origin.y + glyphRadius * Math.sin(angle) };
  });
  return [
    { kind: "circle", center: origin, radius: drawn, instrument: mark("orbit", { x: radius, y: 0 }, "m", display, radius) },
    { kind: "path", closed: true, points: dee(origin, drawn, -1), instrument: mark("dee", { x: radius, y: 0 }, "m", display) },
    { kind: "path", closed: true, points: dee(origin, drawn, 1), instrument: mark("dee", { x: radius, y: 0 }, "m", display) },
    speed === 0
      ? { kind: "point", point: particle, instrument: mark("velocity", velocity, "m/s", display) }
      : { kind: "path", directed: true, points: [particle, add2(particle, { x: 0, y: -sense * display }, "velocity")], instrument: mark("velocity", velocity, "m/s", display) },
    { kind: "multi_path", paths: [ring], instrument: fieldMark },
  ];
}

export function evaluateChapterInstrumentConstruction(operator: string, inputs: Record<string, unknown>, context: SourceContext): InstrumentGeometry[] {
  if (!isOperator(operator)) invalid("operator", `unsupported instrument operator ${operator}`);
  if (operator === "metre_bridge") return readBridge(inputs, context);
  if (operator === "potentiometer") return readPotentiometer(inputs, context);
  if (operator === "incline_friction") return readIncline(inputs, context);
  return readCyclotron(inputs, context);
}

export function chapterInstrumentOutputLabels(operator: string, outputs: readonly unknown[], requested?: readonly unknown[]): string[] {
  if (!isOperator(operator) || outputs.length !== COUNTS[operator]) invalid("outputs", "instrument labels require every ordered output");
  return outputs.map((output, index) => {
    if (!isRecord(output) || !isRecord(output.instrument)) invalid("outputs", "instrument geometry is missing source metadata");
    const metadata = output.instrument as unknown as InstrumentMark;
    const numeric = `${metadata.role}=${compactNumber(metadata.certified ?? metadata.magnitude)}`;
    const requestedText = requested?.[index];
    if (requestedText !== undefined && requestedText !== metadata.role && requestedText !== numeric) invalid("label", "instrument labels must be the role symbol or the verified magnitude");
    return requestedText === numeric ? numeric : metadata.role;
  });
}

export function validateChapterInstrumentConstruction(
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
  try { evaluateChapterInstrumentConstruction(operator, construction.inputs, context); }
  catch (error) {
    issues.push({
      code: `invalid_${operator}_${error instanceof SourceInputError ? error.key : "inputs"}`,
      severity: "fatal",
      message: error instanceof Error ? error.message : "instrument inputs are invalid",
      path: `constructions[${index}].inputs`,
    });
  }
}
