import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";

export const TRIANGLE_OPERATORS = [
  "triangle_from_sides", "triangle_from_sas", "triangle_from_asa", "triangle_center",
] as const;
export type TriangleOperator = (typeof TRIANGLE_OPERATORS)[number];
export type TriangleGeometry =
  | { kind: "point"; point: RenderPoint }
  | { kind: "path"; points: RenderPoint[]; closed: true };
export interface TriangleEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
}

const MAX_LENGTH = 1e9;
const MAX_COORDINATE = 1e12;
// The downstream compiler treats edges shorter than 1e-6 as coincident.
const MIN_EDGE = 1e-6;
const MIN_RELATIVE_AREA = 1e-8;
const CENTER_KINDS = new Set(["centroid", "incenter", "circumcenter", "orthocenter"]);
const LENGTH_UNIT_ALIASES: Readonly<Record<string, string>> = {
  m: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  cm: "cm", centimeter: "cm", centimeters: "cm", centimetre: "cm", centimetres: "cm",
  mm: "mm", millimeter: "mm", millimeters: "mm", millimetre: "mm", millimetres: "mm",
  km: "km", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km",
  nm: "nm", nanometer: "nm", nanometers: "nm", nanometre: "nm", nanometres: "nm",
  "µm": "µm", "μm": "µm", um: "µm", micrometer: "µm", micrometers: "µm", micrometre: "µm", micrometres: "µm",
  in: "in", inch: "in", inches: "in", ft: "ft", foot: "ft", feet: "ft",
  yd: "yd", yard: "yd", yards: "yd", mi: "mi", mile: "mi", miles: "mi",
};
const DEGREE_UNITS = new Set(["°", "deg", "degree", "degrees"]);
const RADIAN_UNITS = new Set(["rad", "radian", "radians"]);
const INPUT_KEYS: Readonly<Record<TriangleOperator, readonly string[]>> = {
  triangle_from_sides: ["sideAB", "sideBC", "sideCA", "origin", "headingDeg", "orientation"],
  triangle_from_sas: ["sideAB", "sideCA", "angleADeg", "origin", "headingDeg", "orientation"],
  triangle_from_asa: ["sideAB", "angleADeg", "angleBDeg", "origin", "headingDeg", "orientation"],
  triangle_center: ["a", "b", "c", "kind"],
};

/** SSS/SAS/ASA outputs are always [A, B, C, closed ABC outline].
 * Heading is A→B in world xy; orientation is sign(cross(AB, AC)).
 * All side measurements must use the same unit; all angles are degrees. */
export function evaluateTriangleConstruction(
  operator: string,
  inputs: Record<string, unknown>,
  context: TriangleEvaluationContext,
): TriangleGeometry[] {
  if (!isTriangleOperator(operator)) throw new Error(`unsupported triangle operator ${operator}`);
  rejectUnknownInputs(operator, inputs);
  if (operator === "triangle_center") {
    if (!CENTER_KINDS.has(String(inputs.kind))) throw new Error("triangle_center requires an explicit supported kind");
    const points = [inputs.a, inputs.b, inputs.c].map((value) => checkedPoint(context.point(value)));
    return [{ kind: "point", point: triangleCenter(points[0]!, points[1]!, points[2]!, String(inputs.kind)) }];
  }
  const local = localTriangle(operator, inputs, context.number);
  const origin = inputs.origin === undefined ? { x: 0, y: 0 } : checkedPoint(context.point(inputs.origin));
  const heading = inputs.headingDeg === undefined ? 0 : finiteNumber(context.number(inputs.headingDeg), "headingDeg");
  const orientation = inputs.orientation === undefined ? 1 : inputs.orientation;
  if (orientation !== 1 && orientation !== -1) throw new Error("orientation must be 1 or -1");
  const theta = (heading % 360) * Math.PI / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const points = local.map((point) => checkedPoint({
    x: origin.x + point.x * cos - orientation * point.y * sin,
    y: origin.y + point.x * sin + orientation * point.y * cos,
  }));
  assertTriangle(points[0]!, points[1]!, points[2]!);
  // A large translation must not silently erase the given lengths in floating point.
  for (let i = 0; i < 3; i++) {
    const next = (i + 1) % 3;
    const expected = distance(local[i]!, local[next]!);
    if (Math.abs(distance(points[i]!, points[next]!) - expected) > expected * 1e-7) {
      throw new Error("triangle placement cannot preserve its measurements at numeric precision");
    }
  }
  return [
    ...points.map((point): TriangleGeometry => ({ kind: "point", point })),
    { kind: "path", points, closed: true },
  ];
}

/** Structural checks share the evaluator's numeric feasibility checks; point
 * references stay references and are resolved only by the live compiler. */
export function validateTriangleConstruction(
  construction: SceneConstruction,
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneConstruction>,
  issues: SceneIssue[],
): void {
  const { operator, inputs, outputs } = construction;
  if (!isTriangleOperator(operator)) return;
  const outputIds = Array.isArray(outputs) ? outputs : [];
  const invalid = (key: string, message: string, actual?: unknown): void => {
    issues.push({ code: `invalid_${operator}_${key}`, message, severity: "fatal",
      path: `constructions[${index}].${key === "outputs" || key === "output_kind" ? "outputs" : `inputs.${key}`}`,
      entityIds: outputIds, actual });
  };
  const arity = operator === "triangle_center" ? 1 : 4;
  if (outputIds.length !== arity) invalid("outputs", `${operator} requires exactly ${arity} outputs`, outputs);
  outputIds.forEach((id, outputIndex) => {
    const actualKind = document.entities.find((entity) => entity.id === id)?.kind;
    const expectedKind = outputIndex === 3 && operator !== "triangle_center" ? "polygon" : "point";
    if (actualKind !== expectedKind) invalid("output_kind", `${operator} output ${outputIndex} must be ${expectedKind}`, actualKind);
  });
  for (const key of Object.keys(inputs)) {
    if (!INPUT_KEYS[operator].includes(key)) invalid("input", `${operator} does not accept ${key}`, key);
  }
  const number = (value: unknown): number => {
    const resolved = validationNumber(value, document);
    if (resolved === null) throw new Error("requires a finite literal or resolved quantity value");
    return resolved;
  };
  const pointInput = (key: string, optional = false): RenderPoint | null => {
    const value = inputs[key];
    if (optional && value === undefined) return null;
    if (typeof value === "string") {
      const entity = document.entities.find((candidate) => candidate.id === value);
      if (entity?.kind === "point" && constructionByOutput.has(value)) return null;
      invalid(key, `${operator} ${key} must reference a constructed point`, value);
      return null;
    }
    try { return checkedPoint(inlinePoint(value)); }
    catch (error) { invalid(key, `${operator} ${key}: ${errorMessage(error)}`, value); return null; }
  };
  if (operator === "triangle_center") {
    if (!CENTER_KINDS.has(String(inputs.kind))) invalid("kind", "triangle_center kind must be centroid, incenter, circumcenter, or orthocenter", inputs.kind);
    const [a, b, c] = [pointInput("a"), pointInput("b"), pointInput("c")];
    if (a && b && c && CENTER_KINDS.has(String(inputs.kind))) {
      try { triangleCenter(a, b, c, String(inputs.kind)); }
      catch (error) { invalid("geometry", errorMessage(error)); }
    }
    return;
  }
  pointInput("origin", true);
  if (inputs.orientation !== undefined && inputs.orientation !== 1 && inputs.orientation !== -1) invalid("orientation", "orientation must be 1 or -1", inputs.orientation);
  if (inputs.headingDeg !== undefined) {
    try { finiteNumber(number(inputs.headingDeg), "headingDeg"); }
    catch (error) { invalid("headingDeg", errorMessage(error), inputs.headingDeg); }
  }
  let numericInputsValid = true;
  for (const key of INPUT_KEYS[operator]) {
    if (key === "origin" || key === "headingDeg" || key === "orientation") continue;
    try {
      const resolved = number(inputs[key]);
      if (key.startsWith("side")) checkedLength(resolved, key);
      else interiorAngle(resolved, key);
    } catch (error) {
      numericInputsValid = false;
      invalid(key, errorMessage(error), inputs[key]);
    }
  }
  if (numericInputsValid) {
    const sideUnits = new Set<string>();
    for (const key of INPUT_KEYS[operator]) {
      for (const unit of quantityUnits(inputs[key], document)) {
        if (key.startsWith("side")) {
          if (LENGTH_UNIT_ALIASES[unit]) sideUnits.add(LENGTH_UNIT_ALIASES[unit]);
          else if (DEGREE_UNITS.has(unit) || RADIAN_UNITS.has(unit)) invalid("units", `${key} cannot use an angular unit`, unit);
          else if (!["1", "unit", "units", "dimensionless"].includes(unit)) invalid("units", `${key} requires a supported length unit; source scales are not inferred`, unit);
        } else if (key.startsWith("angle") && (RADIAN_UNITS.has(unit) || LENGTH_UNIT_ALIASES[unit])) {
          invalid("units", `${key} requires degrees; normalize the source quantity before construction`, unit);
        }
      }
    }
    if (sideUnits.size > 1) invalid("units", "triangle side quantities must use one common unit; normalize the source quantities before construction", [...sideUnits]);
    try { localTriangle(operator, inputs, number); }
    catch (error) { invalid("geometry", errorMessage(error)); }
  }
}

function localTriangle(
  operator: Exclude<TriangleOperator, "triangle_center">,
  inputs: Record<string, unknown>,
  number: TriangleEvaluationContext["number"],
): RenderPoint[] {
  const sideAB = checkedLength(number(inputs.sideAB), "sideAB");
  let c: RenderPoint;
  if (operator === "triangle_from_sides") {
    const sideBC = checkedLength(number(inputs.sideBC), "sideBC");
    const sideCA = checkedLength(number(inputs.sideCA), "sideCA");
    const scale = Math.max(sideAB, sideBC, sideCA);
    const ab = sideAB / scale;
    const bc = sideBC / scale;
    const ca = sideCA / scale;
    const [a, b, shortest] = [ab, bc, ca].sort((x, y) => y - x) as [number, number, number];
    if (!(shortest > a - b)) throw new Error("SSS lengths violate the strict triangle inequality");
    // Stable Heron product; normalizing prevents overflow and underflow.
    const product = (a + (b + shortest)) * (shortest - (a - b)) * (shortest + (a - b)) * (a + (b - shortest));
    const x = (ab * ab + ca * ca - bc * bc) / (2 * ab);
    const y = Math.sqrt(product) / (2 * ab);
    c = { x: x * scale, y: y * scale };
  } else if (operator === "triangle_from_sas") {
    const sideCA = checkedLength(number(inputs.sideCA), "sideCA");
    const theta = interiorAngle(number(inputs.angleADeg), "angleADeg") * Math.PI / 180;
    c = { x: sideCA * Math.cos(theta), y: sideCA * Math.sin(theta) };
  } else {
    const angleA = interiorAngle(number(inputs.angleADeg), "angleADeg");
    const angleB = interiorAngle(number(inputs.angleBDeg), "angleBDeg");
    const angleC = 180 - angleA - angleB;
    if (!(angleC > 0)) throw new Error("ASA requires angleADeg + angleBDeg < 180");
    const sideCA = checkedLength(sideAB * Math.sin(angleB * Math.PI / 180) / Math.sin(angleC * Math.PI / 180), "derived sideCA");
    const theta = angleA * Math.PI / 180;
    c = { x: sideCA * Math.cos(theta), y: sideCA * Math.sin(theta) };
  }
  const points = [{ x: 0, y: 0 }, { x: sideAB, y: 0 }, c];
  assertTriangle(points[0]!, points[1]!, points[2]!);
  return points;
}

function triangleCenter(a: RenderPoint, b: RenderPoint, c: RenderPoint, kind: string): RenderPoint {
  const scale = assertTriangle(a, b, c);
  const u = { x: (b.x - a.x) / scale, y: (b.y - a.y) / scale };
  const v = { x: (c.x - a.x) / scale, y: (c.y - a.y) / scale };
  let local: RenderPoint;
  if (kind === "centroid") local = { x: (u.x + v.x) / 3, y: (u.y + v.y) / 3 };
  else if (kind === "incenter") {
    const weightA = distance(u, v);
    const weightB = Math.hypot(v.x, v.y);
    const weightC = Math.hypot(u.x, u.y);
    const sum = weightA + weightB + weightC;
    local = { x: (weightB * u.x + weightC * v.x) / sum, y: (weightB * u.y + weightC * v.y) / sum };
  } else {
    const denominator = 2 * (u.x * v.y - u.y * v.x);
    const uSquared = u.x * u.x + u.y * u.y;
    const vSquared = v.x * v.x + v.y * v.y;
    const circumcenter = { x: (uSquared * v.y - vSquared * u.y) / denominator, y: (u.x * vSquared - v.x * uSquared) / denominator };
    local = kind === "circumcenter" ? circumcenter : { x: u.x + v.x - 2 * circumcenter.x, y: u.y + v.y - 2 * circumcenter.y };
  }
  return checkedPoint({ x: a.x + local.x * scale, y: a.y + local.y * scale });
}

function assertTriangle(a: RenderPoint, b: RenderPoint, c: RenderPoint): number {
  checkedPoint(a); checkedPoint(b); checkedPoint(c);
  const lengths = [distance(a, b), distance(b, c), distance(c, a)];
  const scale = Math.max(...lengths);
  if (lengths.some((length) => !Number.isFinite(length) || length <= MIN_EDGE || length > MAX_LENGTH)) {
    throw new Error(`triangle edges must be distinguishable, greater than ${MIN_EDGE}, and no greater than ${MAX_LENGTH}`);
  }
  const ux = (b.x - a.x) / scale;
  const uy = (b.y - a.y) / scale;
  const vx = (c.x - a.x) / scale;
  const vy = (c.y - a.y) / scale;
  if (Math.abs(ux * vy - uy * vx) <= MIN_RELATIVE_AREA) throw new Error("triangle is collinear or numerically indistinguishable from collinear");
  return scale;
}
function checkedLength(value: number, key: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_LENGTH) throw new Error(`${key} must be positive, finite, and no greater than ${MAX_LENGTH}`);
  return value;
}
function interiorAngle(value: number, key: string): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 180) throw new Error(`${key} must be strictly between 0 and 180 degrees`);
  return value;
}
function finiteNumber(value: number, key: string): number {
  if (!Number.isFinite(value)) throw new Error(`${key} must be finite`);
  return value;
}
function checkedPoint(point: RenderPoint): RenderPoint {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) {
    throw new Error(`point coordinates must be finite with magnitude no greater than ${MAX_COORDINATE}`);
  }
  return { x: point.x, y: point.y };
}
function inlinePoint(value: unknown): RenderPoint {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number") return { x: value[0], y: value[1] };
  if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y };
  throw new Error("requires a point reference or finite [x,y] / {x,y}");
}
function validationNumber(value: unknown, document: SceneDocument, seen = new Set<unknown>()): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (seen.has(value) || seen.size > 32) return null;
  seen.add(value);
  if (typeof value === "string") {
    const quantity = document.quantities.find((candidate) => candidate.id === value);
    if (quantity) return validationNumber(quantity.value, document, seen);
    if (value.trim() === "") return null;
    const literal = Number(value);
    return Number.isFinite(literal) ? literal : null;
  }
  if (isRecord(value) && "value" in value) return validationNumber(value.value, document, seen);
  return null;
}
function normalizedUnit(value: string): string { return value.trim().replace(/[A-Za-z]{4,}/g, (word) => word.toLowerCase()); }
function quantityUnits(value: unknown, document: SceneDocument, seen = new Set<unknown>()): string[] {
  if (seen.has(value) || seen.size > 32) return [];
  seen.add(value);
  const quantity = typeof value === "string" ? document.quantities.find((candidate) => candidate.id === value) : null;
  const record = quantity ?? (isRecord(value) ? value : null);
  if (!record) return [];
  const units = typeof record.unit === "string" && record.unit.trim() ? [normalizedUnit(record.unit)] : [];
  return "value" in record ? [...units, ...quantityUnits(record.value, document, seen)] : units;
}
function rejectUnknownInputs(operator: TriangleOperator, inputs: Record<string, unknown>): void {
  for (const key of Object.keys(inputs)) if (!INPUT_KEYS[operator].includes(key)) throw new Error(`${operator} does not accept ${key}`);
}
function isTriangleOperator(operator: string): operator is TriangleOperator {
  return (TRIANGLE_OPERATORS as readonly string[]).includes(operator);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function distance(a: RenderPoint, b: RenderPoint): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
