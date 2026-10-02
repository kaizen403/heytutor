import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import {
  add2, canonicalUnit, compactNumber, hypot2, invalid, isRecord, pair, placement, rejectUnknownKeys,
  requireUnits, scale2, scalar, SourceInputError, unit2, validationNumber,
  type SourceContext,
} from "./sourceScalars";

export const CURRENT_FIELD_OPERATORS = [
  "current_element_field",
  "conductor_force",
  "parallel_wire_force",
  "magnetic_dipole_field",
  "solenoid_field",
] as const;

export interface CurrentFieldMark {
  role: "field" | "force";
  components: { x: number; y: number; z: number };
  magnitude: number;
  unit: string;
  displayScale: number;
  zero: boolean;
  pageNormal: "out" | "in" | null;
}
export type CurrentFieldGeometry =
  | { kind: "point"; point: RenderPoint; currentField: CurrentFieldMark }
  | { kind: "path"; points: RenderPoint[]; directed?: true; currentField: CurrentFieldMark }
  | { kind: "multi_path"; paths: RenderPoint[][]; currentField: CurrentFieldMark };

const AMP: Readonly<Record<string, string>> = { A: "A", ampere: "A", amperes: "A" };
const METRE: Readonly<Record<string, string>> = { m: "m", metre: "m", meter: "m" };
const TESLA: Readonly<Record<string, string>> = { T: "T", tesla: "T" };
const MU0: Readonly<Record<string, string>> = { "N/A^2": "N/A^2", "T m/A": "N/A^2" };
const MOMENT: Readonly<Record<string, string>> = { "A m^2": "A m^2", "A*m^2": "A m^2" };
const DENSITY: Readonly<Record<string, string>> = { "1/m": "1/m", "m^-1": "1/m" };

function mark(role: CurrentFieldMark["role"], components: CurrentFieldMark["components"], unit: string, displayScale: number): CurrentFieldMark {
  const magnitude = Math.hypot(components.x, components.y, components.z);
  if (!Number.isFinite(magnitude) || magnitude > 1e12) invalid("precision", "field magnitude exceeds finite authority");
  const planar = components.x !== 0 || components.y !== 0;
  if (components.z !== 0 && planar) invalid("field", "mixed planar and page-normal results are unsupported");
  return {
    role, components, magnitude, unit, displayScale, zero: magnitude === 0,
    pageNormal: components.z === 0 ? null : components.z > 0 ? "out" : "in",
  };
}

function glyph(origin: RenderPoint, metadata: CurrentFieldMark): CurrentFieldGeometry {
  if (metadata.zero) return { kind: "point", point: origin, currentField: metadata };
  if (metadata.pageNormal) {
    const radius = metadata.displayScale / 2;
    const ring = (scale: number, samples: number): RenderPoint[] => Array.from({ length: samples + 1 }, (_, index) => {
      const angle = index === samples ? 0 : 2 * Math.PI * index / samples;
      return { x: origin.x + radius * scale * Math.cos(angle), y: origin.y + radius * scale * Math.sin(angle) };
    });
    const paths = metadata.pageNormal === "out"
      ? [ring(1, 48), ring(0.12, 12)]
      : [ring(1, 48), [{ x: origin.x - radius / 2, y: origin.y - radius / 2 }, { x: origin.x + radius / 2, y: origin.y + radius / 2 }], [{ x: origin.x - radius / 2, y: origin.y + radius / 2 }, { x: origin.x + radius / 2, y: origin.y - radius / 2 }]];
    return { kind: "multi_path", paths, currentField: metadata };
  }
  const length = hypot2({ x: metadata.components.x, y: metadata.components.y });
  const delta = scale2({ x: metadata.components.x, y: metadata.components.y }, metadata.displayScale / length, "display");
  return { kind: "path", points: [origin, add2(origin, delta, "display")], directed: true, currentField: metadata };
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function readElement(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): CurrentFieldGeometry[] {
  rejectUnknownKeys(inputs, ["shape", "current", "mu0", "units", "displayLength", "origin", "start", "end", "at", "direction", "through", "radius", "startAngle", "endAngle", "axis", "distance", "center"]);
  if (canonicalUnit(inputs.units && isRecord(inputs.units) ? inputs.units.current : undefined, AMP) !== "A") invalid("units", "current must declare A");
  if (!isRecord(inputs.units) || canonicalUnit(inputs.units.length, METRE) !== "m" || canonicalUnit(inputs.units.mu0, MU0) !== "N/A^2") invalid("units", "length must be m and mu0 N/A^2");
  const current = scalar(inputs.current, "current", context);
  const mu0 = scalar(inputs.mu0, "mu0", context);
  const displayLength = scalar(inputs.displayLength, "displayLength", context);
  if (!(mu0 > 0) || !(displayLength > 1e-6)) invalid("mu0", "mu0 and displayLength must be positive");
  requireUnits(inputs.current, "A", AMP, document);
  requireUnits(inputs.mu0, "N/A^2", MU0, document);
  const origin = placement(inputs.origin, "origin", context);
  let components = { x: 0, y: 0, z: 0 };
  if (inputs.shape === "finite_wire" || inputs.shape === "infinite_wire") {
    const at = pair(inputs.at, "at", context);
    const start = inputs.shape === "finite_wire" ? pair(inputs.start, "start", context) : pair(inputs.through, "through", context);
    const direction = inputs.shape === "finite_wire"
      ? unit2({ x: pair(inputs.end, "end", context).x - start.x, y: pair(inputs.end, "end", context).y - start.y }, "end")
      : unit2(pair(inputs.direction, "direction", context), "direction");
    const end = inputs.shape === "finite_wire" ? pair(inputs.end, "end", context) : start;
    const along = (at.x - start.x) * direction.x + (at.y - start.y) * direction.y;
    const foot = { x: start.x + direction.x * along, y: start.y + direction.y * along };
    const perp = { x: at.x - foot.x, y: at.y - foot.y };
    const distance = hypot2(perp);
    if (!(distance > 1e-9)) invalid("at", "the observation point lies on the wire");
    const normal = direction.x * perp.y - direction.y * perp.x;
    const sense = normal === 0 ? 0 : normal > 0 ? 1 : -1;
    if (inputs.shape === "infinite_wire") components = { x: 0, y: 0, z: sense * mu0 * current / (2 * Math.PI * distance) };
    else {
      const length = hypot2({ x: end.x - start.x, y: end.y - start.y });
      const startDistance = hypot2({ x: at.x - start.x, y: at.y - start.y });
      const endDistance = hypot2({ x: at.x - end.x, y: at.y - end.y });
      const signed = (endDistance === 0 || startDistance === 0) ? invalid("at", "the observation point is an endpoint") : (length - along) / endDistance - (-along) / startDistance;
      components = { x: 0, y: 0, z: sense * mu0 * current * signed / (4 * Math.PI * distance) };
    }
  } else if (inputs.shape === "arc") {
    const radius = scalar(inputs.radius, "radius", context);
    const startAngle = scalar(inputs.startAngle, "startAngle", context, 1e3);
    const endAngle = scalar(inputs.endAngle, "endAngle", context, 1e3);
    const delta = endAngle - startAngle;
    if (!(radius > 0) || delta === 0 || Math.abs(delta) > 2 * Math.PI + 1e-9) invalid("radius", "an arc needs a positive radius and a turn of at most one revolution");
    components = { x: 0, y: 0, z: mu0 * current * delta / (4 * Math.PI * radius) };
  } else if (inputs.shape === "loop_axis") {
    const radius = scalar(inputs.radius, "radius", context);
    const distance = scalar(inputs.distance, "distance", context);
    const axis = unit2(pair(inputs.axis, "axis", context), "axis");
    if (!(radius > 0)) invalid("radius", "loop radius must be positive");
    const strength = mu0 * current * radius * radius / (2 * Math.pow(radius * radius + distance * distance, 1.5));
    components = { x: axis.x * strength, y: axis.y * strength, z: 0 };
  } else invalid("shape", "shape must be finite_wire, infinite_wire, arc, or loop_axis");
  return [glyph(origin, mark("field", components, "T", displayLength))];
}

function readConductor(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): CurrentFieldGeometry[] {
  rejectUnknownKeys(inputs, ["current", "length", "magneticField", "units", "origin", "displayLength"]);
  if (!isRecord(inputs.units) || canonicalUnit(inputs.units.current, AMP) !== "A" || canonicalUnit(inputs.units.length, METRE) !== "m" || canonicalUnit(inputs.units.magneticField, TESLA) !== "T") invalid("units", "conductor force requires A, m, and T");
  const current = scalar(inputs.current, "current", context);
  if (!Array.isArray(inputs.length) || inputs.length.length < 2 || inputs.length.length > 3) invalid("length", "length requires two or three components");
  const length = {
    x: scalar(inputs.length[0], "length.x", context),
    y: scalar(inputs.length[1], "length.y", context),
    z: inputs.length.length === 3 ? scalar(inputs.length[2], "length.z", context) : 0,
  };
  const field = inputs.magneticField;
  if (!Array.isArray(field) || field.length !== 3) invalid("magneticField", "magneticField requires three components");
  const magnetic = { x: scalar(field[0], "magneticField.x", context), y: scalar(field[1], "magneticField.y", context), z: scalar(field[2], "magneticField.z", context) };
  requireUnits(inputs.current, "A", AMP, document);
  const force = cross({ x: length.x * current, y: length.y * current, z: length.z * current }, magnetic);
  const displayLength = scalar(inputs.displayLength, "displayLength", context);
  if (!(displayLength > 1e-6)) invalid("displayLength", "displayLength must exceed 1e-6");
  return [glyph(placement(inputs.origin, "origin", context), mark("force", force, "N", displayLength))];
}

function readParallel(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): CurrentFieldGeometry[] {
  rejectUnknownKeys(inputs, ["currents", "separation", "mu0", "length", "units", "origin", "displayScale", "forceScale"]);
  if (!isRecord(inputs.units) || canonicalUnit(inputs.units.current, AMP) !== "A" || canonicalUnit(inputs.units.length, METRE) !== "m" || canonicalUnit(inputs.units.mu0, MU0) !== "N/A^2") invalid("units", "parallel wires require A, m, and N/A^2");
  if (!Array.isArray(inputs.currents) || inputs.currents.length !== 2) invalid("currents", "two wire currents are required");
  const currents = [scalar(inputs.currents[0], "currents[0]", context), scalar(inputs.currents[1], "currents[1]", context)];
  const separation = scalar(inputs.separation, "separation", context);
  const mu0 = scalar(inputs.mu0, "mu0", context);
  const length = scalar(inputs.length, "length", context);
  const displayScale = scalar(inputs.displayScale, "displayScale", context);
  const forceScale = scalar(inputs.forceScale, "forceScale", context);
  if (!(separation > 0) || !(mu0 > 0) || !(length > 0) || !(displayScale > 1e-6) || !(forceScale > 1e-6)) invalid("separation", "separation, mu0, length, and display scales must be positive");
  requireUnits(inputs.currents[0], "A", AMP, document);
  requireUnits(inputs.separation, "m", METRE, document);
  const perLength = mu0 * currents[0]! * currents[1]! / (2 * Math.PI * separation);
  const attract = currents[0]! * currents[1]! >= 0;
  const origin = placement(inputs.origin, "origin", context);
  const drawn = separation * displayScale;
  const left = { x: origin.x - drawn / 2, y: origin.y };
  const right = { x: origin.x + drawn / 2, y: origin.y };
  const half = length * displayScale / 2;
  const wire = (at: RenderPoint): CurrentFieldGeometry => ({
    kind: "path",
    points: [{ x: at.x, y: at.y - half }, { x: at.x, y: at.y + half }],
    currentField: mark("field", { x: 0, y: length, z: 0 }, "m", displayScale),
  });
  const force = (at: RenderPoint, sign: number): CurrentFieldGeometry => glyph(at, mark("force", { x: sign * perLength, y: 0, z: 0 }, "N/m", forceScale));
  return [wire(left), wire(right), force(left, attract ? 1 : -1), force(right, attract ? -1 : 1)];
}

function readDipole(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): CurrentFieldGeometry[] {
  rejectUnknownKeys(inputs, ["moment", "at", "mu0", "units", "origin", "displayLength"]);
  if (!isRecord(inputs.units) || canonicalUnit(inputs.units.moment, MOMENT) !== "A m^2" || canonicalUnit(inputs.units.length, METRE) !== "m" || canonicalUnit(inputs.units.mu0, MU0) !== "N/A^2") invalid("units", "dipole field requires A m^2, m, and N/A^2");
  const moment = pair(inputs.moment, "moment", context);
  const at = pair(inputs.at, "at", context);
  const mu0 = scalar(inputs.mu0, "mu0", context);
  const distance = hypot2(at);
  if (!(mu0 > 0) || !(distance > 0)) invalid("at", "observation distance must be positive and mu0 explicit");
  requireUnits(inputs.mu0, "N/A^2", MU0, document);
  const radial = unit2(at, "at");
  const projection = moment.x * radial.x + moment.y * radial.y;
  const factor = mu0 / (4 * Math.PI * distance ** 3);
  const field = {
    x: factor * (3 * projection * radial.x - moment.x),
    y: factor * (3 * projection * radial.y - moment.y),
    z: 0,
  };
  return [glyph(placement(inputs.origin, "origin", context), mark("field", field, "T", scalar(inputs.displayLength, "displayLength", context)))];
}

function readSolenoid(inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): CurrentFieldGeometry[] {
  rejectUnknownKeys(inputs, ["turnsPerLength", "current", "mu0", "region", "axis", "units", "origin", "displayLength"]);
  if (inputs.region !== "interior" && inputs.region !== "exterior") invalid("region", "region must be interior or exterior");
  if (!isRecord(inputs.units) || canonicalUnit(inputs.units.turnsPerLength, DENSITY) !== "1/m" || canonicalUnit(inputs.units.current, AMP) !== "A" || canonicalUnit(inputs.units.mu0, MU0) !== "N/A^2") invalid("units", "solenoid field requires 1/m, A, and N/A^2");
  const density = scalar(inputs.turnsPerLength, "turnsPerLength", context);
  const current = scalar(inputs.current, "current", context);
  const mu0 = scalar(inputs.mu0, "mu0", context);
  if (!(density > 0) || !(mu0 > 0)) invalid("turnsPerLength", "turn density and mu0 must be positive");
  requireUnits(inputs.current, "A", AMP, document);
  const axis = unit2(pair(inputs.axis, "axis", context), "axis");
  const strength = inputs.region === "exterior" ? 0 : mu0 * density * current;
  return [glyph(placement(inputs.origin, "origin", context), mark("field", { x: axis.x * strength, y: axis.y * strength, z: 0 }, "T", scalar(inputs.displayLength, "displayLength", context)))];
}

export function evaluateCurrentFieldConstruction(operator: string, inputs: Record<string, unknown>, context: SourceContext, document?: SceneDocument): CurrentFieldGeometry[] {
  if (!(CURRENT_FIELD_OPERATORS as readonly string[]).includes(operator)) invalid("operator", `unsupported current-field operator ${operator}`);
  if (operator === "current_element_field") return readElement(inputs, context, document);
  if (operator === "conductor_force") return readConductor(inputs, context, document);
  if (operator === "parallel_wire_force") return readParallel(inputs, context, document);
  if (operator === "magnetic_dipole_field") return readDipole(inputs, context, document);
  return readSolenoid(inputs, context, document);
}

function fieldOf(value: unknown): CurrentFieldMark {
  if (!isRecord(value) || !isRecord(value.currentField)) invalid("outputs", "current-field geometry is missing source metadata");
  return value.currentField as unknown as CurrentFieldMark;
}

export function currentFieldOutputLabels(operator: string, outputs: readonly unknown[], requested?: readonly unknown[]): string[] {
  const count = operator === "parallel_wire_force" ? 4 : 1;
  if (outputs.length !== count) invalid("outputs", "current-field labels require every ordered output");
  return outputs.map((output, index) => {
    const metadata = fieldOf(output);
    const symbol = metadata.role === "force" ? "F" : "B";
    const glyphText = metadata.pageNormal === "out" ? " ⊙" : metadata.pageNormal === "in" ? " ⊗" : "";
    const numeric = `${symbol}=${compactNumber(metadata.pageNormal ? metadata.components.z : metadata.magnitude)} ${metadata.unit}${glyphText}`;
    const plain = `${symbol}${glyphText}`;
    const requestedText = requested?.[index];
    if (requestedText !== undefined && requestedText !== plain && requestedText !== numeric && requestedText !== symbol) invalid("label", "field labels must be the symbol or the verified value");
    return requestedText === numeric ? numeric : plain;
  });
}

export function validateCurrentFieldConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const operator = construction.operator;
  if (!(CURRENT_FIELD_OPERATORS as readonly string[]).includes(operator)) return;
  const add = (key: string, message: string): void => {
    issues.push({ code: `invalid_${operator}_${key}`, severity: "fatal", message, path: `constructions[${index}].inputs.${key}` });
  };
  const expected = operator === "parallel_wire_force" ? 4 : 1;
  const outputs = Array.isArray(construction.outputs) ? construction.outputs : [];
  if (outputs.length !== expected) issues.push({ code: `invalid_${operator}_outputs`, severity: "fatal", message: `${operator} requires ${expected} outputs`, path: `constructions[${index}].outputs` });
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
  try { evaluateCurrentFieldConstruction(operator, construction.inputs, context, document); }
  catch (error) { add(error instanceof SourceInputError ? error.key : "inputs", error instanceof Error ? error.message : "current-field inputs are invalid"); }
}

