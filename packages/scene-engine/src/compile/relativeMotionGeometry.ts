import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import {
  add2, canonicalUnit, hypot2, invalid, isRecord, pair, placement, pointOf, rejectUnknownKeys,
  requireUnits, scale2, scalar, SourceInputError, unit2, validationNumber, compactNumber,
  type SourceContext,
} from "./sourceScalars";

export const RELATIVE_MOTION_OPERATORS = [
  "velocity_triangle",
  "collinear_velocity_pair",
  "crossing_strategies",
  "parallel_guides",
] as const;
export type RelativeMotionOperator = (typeof RELATIVE_MOTION_OPERATORS)[number];

export interface RelativeMotionMark {
  role: "frame" | "body" | "resultant" | "current" | "boat" | "downstream" | "upstream"
    | "across_current" | "across_boat" | "across_resultant" | "short_current" | "short_boat" | "short_resultant"
    | "guide";
  components: RenderPoint;
  magnitude: number;
  unit: string;
  displayScale: number;
  zero: boolean;
}

export type RelativeMotionGeometry =
  | { kind: "point"; point: RenderPoint; relativeMotion: RelativeMotionMark }
  | { kind: "path"; points: RenderPoint[]; directed?: true; relativeMotion: RelativeMotionMark };

const VELOCITY_UNITS: Readonly<Record<string, string>> = {
  "m/s": "m/s", "meter/second": "m/s", "metre/second": "m/s",
  "km/h": "km/h", "km/hr": "km/h", kmph: "km/h",
  "cm/s": "cm/s",
  unit: "unit", units: "unit", "1": "unit", dimensionless: "unit",
};
const INPUTS = {
  velocity_triangle: ["frameVelocity", "bodyVelocity", "units", "origin", "displayScale", "headingDeg"],
  collinear_velocity_pair: ["frameVelocity", "bodySpeed", "units", "origin", "displayScale", "laneGap"],
  crossing_strategies: ["current", "boatSpeed", "units", "origin", "secondOrigin", "displayScale", "orientation"],
  parallel_guides: ["direction", "separation", "halfLength", "origin"],
} as const;
const ROLES = {
  velocity_triangle: ["frame", "body", "resultant"],
  collinear_velocity_pair: ["current", "boat", "downstream", "upstream"],
  crossing_strategies: ["across_current", "across_boat", "across_resultant", "short_current", "short_boat", "short_resultant"],
  parallel_guides: ["guide", "guide"],
} as const;

function isOperator(operator: string): operator is RelativeMotionOperator {
  return (RELATIVE_MOTION_OPERATORS as readonly string[]).includes(operator);
}

function velocityUnit(inputs: Record<string, unknown>, _document?: SceneDocument): string {
  if (!isRecord(inputs.units)) invalid("units", "velocity composition requires an explicit velocity unit");
  rejectUnknownKeys(inputs.units, ["velocity"], "units");
  const unit = canonicalUnit(inputs.units.velocity, VELOCITY_UNITS);
  if (!unit) invalid("units", "velocity unit must be m/s, km/h, cm/s, or dimensionless unit");
  return unit;
}

function checkVelocityUnits(values: unknown[], unit: string, document?: SceneDocument): void {
  for (const value of values) {
    const components = Array.isArray(value) ? value : isRecord(value) ? [value.x, value.y] : [value];
    for (const component of components) requireUnits(component, unit, VELOCITY_UNITS, document);
  }
}

function positiveScale(value: unknown, key: string, context: SourceContext): number {
  const scale = scalar(value, key, context);
  if (!(scale > 1e-6)) invalid(key, `${key} must exceed 1e-6`);
  return scale;
}

function mark(role: RelativeMotionMark["role"], components: RenderPoint, unit: string, displayScale: number): RelativeMotionMark {
  const magnitude = hypot2(components);
  return { role, components: { ...components }, magnitude, unit, displayScale, zero: magnitude === 0 };
}

function arrow(origin: RenderPoint, components: RenderPoint, displayScale: number, metadata: RelativeMotionMark, lane = { x: 0, y: 0 }): RelativeMotionGeometry {
  const start = add2(origin, lane, "placement");
  if (metadata.zero) return { kind: "point", point: start, relativeMotion: metadata };
  const delta = scale2(components, displayScale, "display");
  const length = hypot2(delta);
  if (!(length > 1e-6)) invalid("precision", "a nonzero velocity must remain visible at the stated display scale");
  const tip = add2(start, delta, "display");
  for (const axis of ["x", "y"] as const) {
    if (delta[axis] !== 0 && Math.abs((tip[axis] - start[axis]) - delta[axis]) > Math.abs(delta[axis]) * 1e-8) {
      invalid("precision", "velocity placement cannot retain its computed direction");
    }
  }
  return { kind: "path", points: [start, tip], directed: true, relativeMotion: metadata };
}

function rotate90(value: RenderPoint, orientation: number): RenderPoint {
  return orientation >= 0 ? { x: -value.y, y: value.x } : { x: value.y, y: -value.x };
}

function signedDegrees(from: RenderPoint, to: RenderPoint): number {
  return Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y) * 180 / Math.PI;
}

function readTriangle(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): RelativeMotionGeometry[] {
  const unit = velocityUnit(inputs, document);
  checkVelocityUnits([inputs.frameVelocity, inputs.bodyVelocity], unit, document);
  const frame = pair(inputs.frameVelocity, "frameVelocity", context);
  const body = pair(inputs.bodyVelocity, "bodyVelocity", context);
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = positiveScale(inputs.displayScale, "displayScale", context);
  if (inputs.headingDeg !== undefined) {
    if (hypot2(frame) === 0 || hypot2(body) === 0) invalid("headingDeg", "heading is undefined when either velocity is zero");
    const heading = scalar(inputs.headingDeg, "headingDeg", context, 1e6);
    const actual = signedDegrees(frame, body);
    const delta = ((heading - actual + 540) % 360) - 180;
    if (Math.abs(delta) > 1e-6) invalid("headingDeg", "headingDeg must equal the signed angle from frameVelocity to bodyVelocity");
  }
  const resultant = add2(frame, body, "resultant");
  const roles = ["frame", "body", "resultant"] as const;
  const vectors = [frame, body, resultant];
  return vectors.map((components, index) => arrow(origin, components, displayScale, mark(roles[index]!, components, unit, displayScale)));
}

function readCollinear(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): RelativeMotionGeometry[] {
  const unit = velocityUnit(inputs, document);
  checkVelocityUnits([inputs.frameVelocity, inputs.bodySpeed], unit, document);
  const frame = pair(inputs.frameVelocity, "frameVelocity", context);
  const bodySpeed = scalar(inputs.bodySpeed, "bodySpeed", context);
  if (!(bodySpeed > 0) || hypot2(frame) === 0) invalid("frameVelocity", "collinear composition requires a positive body speed and a nonzero frame velocity");
  const direction = unit2(frame, "frameVelocity");
  const boat = scale2(direction, bodySpeed, "boat");
  const downstream = add2(frame, boat, "downstream");
  const upstream = add2(frame, scale2(boat, -1, "upstream"), "upstream");
  const origin = placement(inputs.origin, "origin", context);
  const displayScale = positiveScale(inputs.displayScale, "displayScale", context);
  const laneGap = inputs.laneGap === undefined ? 0.35 : positiveScale(inputs.laneGap, "laneGap", context);
  const normal = rotate90(direction, 1);
  const roles = ["current", "boat", "downstream", "upstream"] as const;
  return [frame, boat, downstream, upstream].map((components, index) => arrow(
    origin,
    components,
    displayScale,
    mark(roles[index]!, components, unit, displayScale),
    scale2(normal, (index - 1.5) * laneGap, "lane"),
  ));
}

function readCrossing(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): RelativeMotionGeometry[] {
  const unit = velocityUnit(inputs, document);
  checkVelocityUnits([inputs.current, inputs.boatSpeed], unit, document);
  const current = pair(inputs.current, "current", context);
  const boatSpeed = scalar(inputs.boatSpeed, "boatSpeed", context);
  const currentSpeed = hypot2(current);
  if (!(boatSpeed > currentSpeed) || currentSpeed === 0) invalid("boatSpeed", "straight-across crossing requires boat speed strictly greater than current speed");
  const radialSquared = boatSpeed * boatSpeed - currentSpeed * currentSpeed;
  if (!(radialSquared > 0)) invalid("precision", "crossing speed is unresolved at numeric precision");
  const radial = Math.sqrt(radialSquared);
  if (radial === 0 || Math.abs(radial * radial - radialSquared) > Math.abs(radialSquared) * 1e-8) invalid("precision", "crossing speed cannot retain its source difference");
  const orientation = inputs.orientation === undefined ? 1 : scalar(inputs.orientation, "orientation", context);
  if (orientation !== 1 && orientation !== -1) invalid("orientation", "orientation must be 1 or -1");
  const direction = unit2(current, "current");
  const normal = rotate90(direction, orientation);
  const acrossBoat = add2(scale2(current, -1, "across"), scale2(normal, radial, "across"), "across");
  const acrossResult = scale2(normal, radial, "across");
  const shortBoat = scale2(normal, boatSpeed, "short");
  const shortResult = add2(current, shortBoat, "short");
  if (Math.abs(hypot2(acrossBoat) - boatSpeed) > boatSpeed * 1e-8) invalid("precision", "straight-across heading does not preserve boat speed");
  if (Math.abs(acrossResult.x * current.x + acrossResult.y * current.y) > currentSpeed * radial * 1e-8) invalid("precision", "straight-across resultant is not perpendicular to the current");
  const first = placement(inputs.origin, "origin", context);
  const second = placement(inputs.secondOrigin, "secondOrigin", context);
  if (first.x === second.x && first.y === second.y) invalid("secondOrigin", "the two crossing triangles require distinct origins");
  const displayScale = positiveScale(inputs.displayScale, "displayScale", context);
  const roles = ["across_current", "across_boat", "across_resultant", "short_current", "short_boat", "short_resultant"] as const;
  const placed = [
    [first, current], [first, acrossBoat], [first, acrossResult],
    [second, current], [second, shortBoat], [second, shortResult],
  ] as const;
  return placed.map(([origin, components], index) => arrow(origin, components, displayScale, mark(roles[index]!, components, unit, displayScale)));
}

function readGuides(inputs: Record<string, unknown>, context: SourceContext): RelativeMotionGeometry[] {
  rejectUnknownKeys(inputs, INPUTS.parallel_guides);
  const direction = unit2(pair(inputs.direction, "direction", context), "direction");
  const separation = positiveScale(inputs.separation, "separation", context);
  const halfLength = positiveScale(inputs.halfLength, "halfLength", context);
  const origin = placement(inputs.origin, "origin", context);
  const normal = rotate90(direction, 1);
  const offset = scale2(normal, separation / 2, "separation");
  const along = scale2(direction, halfLength, "halfLength");
  return [-1, 1].map((side) => {
    const center = add2(origin, scale2(offset, side, "guide"), "guide");
    const start = add2(center, scale2(along, -1, "guide"), "guide");
    const end = add2(center, along, "guide");
    return {
      kind: "path" as const,
      points: [start, end],
      relativeMotion: mark("guide", { x: end.x - start.x, y: end.y - start.y }, "unit", 1),
    };
  });
}

export function evaluateRelativeMotionConstruction(operator: string, inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): RelativeMotionGeometry[] {
  if (!isOperator(operator)) invalid("operator", `unsupported relative-motion operator ${operator}`);
  rejectUnknownKeys(inputs, INPUTS[operator]);
  if (operator === "velocity_triangle") return readTriangle(inputs, context, document);
  if (operator === "collinear_velocity_pair") return readCollinear(inputs, context, document);
  if (operator === "crossing_strategies") return readCrossing(inputs, context, document);
  return readGuides(inputs, context);
}

const SYMBOLS: Record<RelativeMotionMark["role"], string> = {
  frame: "vc", body: "vb", resultant: "vr", current: "vc", boat: "vb", downstream: "down", upstream: "up",
  across_current: "vc", across_boat: "vb", across_resultant: "vr", short_current: "vc", short_boat: "vb", short_resultant: "vr",
  guide: "bank",
};

function allowedLabel(metadata: RelativeMotionMark): string[] {
  const symbol = SYMBOLS[metadata.role];
  const numeric = metadata.role === "guide" ? symbol : `${symbol}=${compactNumber(metadata.magnitude)} ${metadata.unit}`;
  return [symbol, numeric];
}

export function relativeMotionOutputLabels(operator: string, outputs: readonly unknown[], requested?: readonly unknown[]): string[] {
  if (!isOperator(operator) || outputs.length !== ROLES[operator].length) invalid("outputs", "relative-motion labels require every ordered output");
  return outputs.map((output, index) => {
    const metadata = motionOf(output);
    if (metadata.role !== ROLES[operator][index]) invalid("outputs", "relative-motion outputs are in the wrong role order");
    const requestedText = requested?.[index];
    if (requestedText !== undefined && !allowedLabel(metadata).includes(String(requestedText))) invalid("label", "relative-motion labels must be the role symbol or the verified magnitude");
    return requestedText === allowedLabel(metadata)[1] ? allowedLabel(metadata)[1]! : allowedLabel(metadata)[0]!;
  });
}

function motionOf(value: unknown): RelativeMotionMark {
  if (!isRecord(value) || !isRecord(value.relativeMotion)) invalid("outputs", "relative-motion geometry is missing its source metadata");
  return value.relativeMotion as unknown as RelativeMotionMark;
}

export function validateRelativeMotionConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const operator = construction.operator;
  if (!isOperator(operator)) return;
  const add = (key: string, message: string): void => {
    issues.push({ code: `invalid_${operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].${key === "outputs" ? "outputs" : `inputs.${key}`}` });
  };
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  const expected = ROLES[operator].length;
  if (outputs.length !== expected || new Set(outputs).size !== expected) add("outputs", `${operator} requires ${expected} distinct outputs`);
  const kinds = operator === "parallel_guides" ? ["segment", "segment"] : outputs.map(() => "vector");
  outputs.forEach((id, outputIndex) => {
    if (document.entities.find((entity) => entity.id === id)?.kind !== kinds[outputIndex]) add("outputs", `${operator} output ${outputIndex} must be ${kinds[outputIndex]}`);
  });
  if (!isRecord(construction.inputs)) { add("inputs", "inputs must be an object"); return; }
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
    const geometry = evaluateRelativeMotionConstruction(operator, construction.inputs, context, document);
    relativeMotionOutputLabels(operator, geometry, outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
    geometry.forEach((output) => pointOf(output.kind === "point" ? output.point : output.points[0], "geometry"));
  } catch (error) {
    add(error instanceof SourceInputError ? error.key : "inputs", error instanceof Error ? error.message : "relative-motion inputs are invalid");
  }
}
