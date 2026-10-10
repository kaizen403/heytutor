import type { SceneDocument } from "../types";

/** This finite conversion applies only to coulomb_pair. Other operators stay bare SI. */
const CHARGE_SCALE: Readonly<Record<string, number>> = { C: 1, mC: 1e-3, uC: 1e-6, "µC": 1e-6, "μC": 1e-6, nC: 1e-9 };
const LENGTH_SCALE: Readonly<Record<string, number>> = { m: 1, cm: 1e-2, mm: 1e-3 };
type Dimension = "charge" | "length" | "other";
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const canonical = (unit: string): string => unit.trim().replaceAll("²", "^2").replaceAll(" ", "").replaceAll("*", "");
function fail(message: string): never { throw new Error(`Dipole source units: ${message}`); }
function sameUnit(actual: string, expected: string, dimension: Dimension): boolean {
  const table = dimension === "charge" ? CHARGE_SCALE : dimension === "length" ? LENGTH_SCALE : undefined;
  return table
    ? Object.hasOwn(table, actual.trim()) && Object.hasOwn(table, expected) && table[actual.trim()] === table[expected]
    : canonical(actual) === canonical(expected) || (expected === "N/C" && canonical(actual) === "V/m");
}
function checkUnit(unit: unknown, expected: string, dimension: Dimension): void {
  if (unit !== undefined && (typeof unit !== "string" || !sameUnit(unit, expected, dimension))) {
    fail(`expected ${expected}, received ${String(unit)}`);
  }
}
/** Returns the raw scalar, checking every declared unit before any wrapper is removed. */
function scalar(value: unknown, expected: string, dimension: Dimension, document: SceneDocument | undefined, seen = new Set<unknown>(), depth = 0): unknown {
  if (depth > 32 || seen.has(value)) fail("cyclic or overdeep scalar provenance");
  if (record(value)) {
    seen.add(value);
    if (!("value" in value) || Object.keys(value).some((key) => !["value", "unit"].includes(key))) fail("unsupported scalar wrapper");
    checkUnit(value.unit, expected, dimension);
    return scalar(value.value, expected, dimension, document, seen, depth + 1);
  }
  if (typeof value === "string") {
    const quantity = document?.quantities.find((candidate) => candidate.id === value);
    if (quantity) {
      seen.add(value);
      checkUnit(quantity.unit, expected, dimension);
      return scalar(quantity.value, expected, dimension, document, seen, depth + 1);
    }
  }
  return value;
}
function point(value: unknown, expected: string, dimension: "length" | "other", document: SceneDocument | undefined, strip: boolean): unknown {
  const coordinate = (input: unknown): unknown => {
    const raw = scalar(input, expected, dimension, document);
    return strip ? raw : input;
  };
  if (Array.isArray(value)) return value.map(coordinate);
  if (record(value)) return { ...value, x: coordinate(value.x), y: coordinate(value.y) };
  if (typeof value === "string" && document) {
    const producer = document.constructions.find((candidate) => candidate.outputs.includes(value));
    if (producer?.operator === "point") point([producer.inputs.x, producer.inputs.y], expected, dimension, document, false);
    else if (strip) fail("explicit length conversion requires source coordinates or a constructed point");
  }
  return value;
}
export function prepareDipoleSourceUnits(operator: string, inputs: Record<string, unknown>, document?: SceneDocument): { inputs: Record<string, unknown>; chargeFactor: number; lengthFactor: number } {
  let charge = "C", length = "m", typed = false;
  if (inputs.units !== undefined) {
    const units = inputs.units;
    if (operator !== "coulomb_pair" || !record(units) || Object.keys(units).some((key) => !["charge", "length"].includes(key))
      || typeof units.charge !== "string" || typeof units.length !== "string"
      || !Object.hasOwn(CHARGE_SCALE, units.charge) || !Object.hasOwn(LENGTH_SCALE, units.length)) {
      fail("only explicit supported charge and length units are accepted by coulomb_pair");
    }
    charge = units.charge; length = units.length; typed = true;
  }
  const prepared = { ...inputs };
  const readCharge = (value: unknown): unknown => {
    if (!record(value)) return value;
    const raw = scalar(value.charge, charge, "charge", document);
    const position = point(value.position, length, "length", document, typed);
    return { ...value, charge: typed ? raw : value.charge, position };
  };
  if (Array.isArray(inputs.charges)) prepared.charges = inputs.charges.map(readCharge);
  if (inputs.charge !== undefined) prepared.charge = readCharge(inputs.charge);
  if (inputs.at !== undefined) point(inputs.at, length, "length", document, false);
  if (Array.isArray(inputs.starts)) inputs.starts.forEach((value) => point(value, length, "length", document, false));
  if (record(inputs.sampleDomain)) {
    point(inputs.sampleDomain.min, length, "length", document, false);
    point(inputs.sampleDomain.max, length, "length", document, false);
  }
  if (inputs.p !== undefined) point(inputs.p, "C m", "other", document, false);
  if (inputs.E !== undefined) point(inputs.E, "N/C", "other", document, false);
  if (inputs.k !== undefined) scalar(inputs.k, "N*m^2/C^2", "other", document);
  if (inputs.V !== undefined) scalar(inputs.V, "V", "other", document);
  for (const key of ["stepLength", "exclusionRadius"]) if (inputs[key] !== undefined) scalar(inputs[key], "m", "length", document);
  return { inputs: prepared, chargeFactor: CHARGE_SCALE[charge]!, lengthFactor: LENGTH_SCALE[length]! };
}
