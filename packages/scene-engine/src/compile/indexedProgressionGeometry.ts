import type { RenderPrimitive, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { captureMathSourceData, snapshotMathSourceData } from "./mathSourceData";

export const INDEXED_PROGRESSION_OPERATORS = ["indexed_progression", "progression_recover", "progression_insert"] as const;
export type ProgressionKind = "arithmetic" | "geometric";
export interface ExactProgressionValue { numerator: string; denominator: string }
export interface IndexedProgressionTerm { index: number; value: number; exactValue: ExactProgressionValue }
export interface ProgressionWitness {
  kind: "equidistant_sum" | "equidistant_product";
  indices: number[];
  exactValue: ExactProgressionValue;
}
export interface IndexedProgressionSolution {
  kind: ProgressionKind;
  first: ExactProgressionValue;
  parameter: ExactProgressionValue;
  terms: IndexedProgressionTerm[];
  witnesses: ProgressionWitness[];
}
export interface IndexedProgressionGeometry {
  kind: "indexed_progression";
  indexedProgression: {
    operation: string;
    solutions: IndexedProgressionSolution[];
    observations: Array<{ index: number; exactValue: ExactProgressionValue }>;
    origin: { x: number; y: number };
    displayScale: number;
    branch: "positive" | "negative" | "all_real" | null;
    displayMode: "index_value_table";
    nonmetric: true;
  };
}
export interface IndexedProgressionEvaluationContext { scalar(id: string): unknown }
type Rational = { n: bigint; d: bigint };
type Observation = { index: number; value: Rational };
const ZERO: Rational = { n: 0n, d: 1n };
const ONE: Rational = { n: 1n, d: 1n };
const INPUT_KEYS: Readonly<Record<string, readonly string[]>> = {
  indexed_progression: ["kind", "first", "difference", "ratio", "indices", "witnesses", "origin", "displayScale"],
  progression_recover: ["kind", "observations", "branch", "indices", "witnesses", "origin", "displayScale"],
  progression_insert: ["kind", "first", "last", "insertions", "branch", "origin", "displayScale"],
};
class ProgressionInputError extends Error {
  constructor(readonly key: string, message: string, readonly unsupported = false) { super(message); }
}
function fail(key: string, message: string, unsupported = false): never { throw new ProgressionInputError(key, message, unsupported); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: readonly string[], key: string): void {
  if (Object.keys(value).some((name) => !allowed.includes(name))) fail(key, "progression input contains unsupported fields");
}
function rational(n: bigint, d: bigint): Rational {
  if (d === 0n) fail("scalar", "progression arithmetic cannot divide by zero");
  if (n === 0n) return ZERO;
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n;
  let b = d;
  while (b) { const next = a % b; a = b; b = next; }
  const result = { n: n / a, d: d / a };
  if (result.n.toString(2).length > 4096 || result.d.toString(2).length > 4096) fail("capacity", "exact progression arithmetic exceeds4096 bits", true);
  return result;
}
function add(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function subtract(a: Rational, b: Rational): Rational { return add(a, { n: -b.n, d: b.d }); }
function multiply(a: Rational, b: Rational): Rational { return rational(a.n * b.n, a.d * b.d); }
function divide(a: Rational, b: Rational): Rational { return rational(a.n * b.d, a.d * b.n); }
function equal(a: Rational, b: Rational): boolean { return a.n === b.n && a.d === b.d; }
function power(value: Rational, exponent: number): Rational {
  let result = ONE;
  let factor = value;
  for (let remaining = exponent; remaining > 0; remaining = Math.floor(remaining / 2)) {
    if (remaining % 2) result = multiply(result, factor);
    if (remaining > 1) factor = multiply(factor, factor);
  }
  return result;
}
function numeric(value: Rational, maximum: number, key: string): number {
  const n = value.n < 0n ? -value.n : value.n;
  if (n > BigInt(maximum) * value.d) fail(key, `progression value magnitude must not exceed${maximum}`, true);
  if (n === 0n) return 0;
  const exponent = n.toString(2).length - value.d.toString(2).length;
  const shift = 54 - exponent;
  const numerator = shift >= 0 ? n << BigInt(shift) : n;
  const denominator = shift >= 0 ? value.d : value.d << BigInt(-shift);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (2n * remainder > denominator || 2n * remainder === denominator && quotient % 2n !== 0n ? 1n : 0n);
  const result = Number(rounded) / 2 ** 54 * 2 ** exponent * (value.n < 0n ? -1 : 1);
  if (!Number.isFinite(result) || result === 0) fail(key, "nonzero progression authority cannot underflow display precision", true);
  return result;
}
function literal(text: string): Rational | null {
  if (text.length > 512) fail("scalar", "progression literal spelling exceeds512 characters", true);
  const fraction = /^([+-]?\d+)\/([+-]?\d+)$/.exec(text);
  if (fraction) return rational(BigInt(fraction[1]!), BigInt(fraction[2]!));
  const decimal = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(text);
  if (!decimal) return null;
  const exponent = Number(decimal[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1024) fail("scalar", "progression decimal exponent exceeds1024", true);
  const [whole, fractionPart = ""] = decimal[2]!.split(".");
  const n = BigInt((whole || "0") + fractionPart) * (decimal[1] === "-" ? -1n : 1n);
  const shift = exponent - fractionPart.length;
  return shift >= 0 ? rational(n * 10n ** BigInt(shift), 1n) : rational(n, 10n ** BigInt(-shift));
}
function scalar(value: unknown, context: IndexedProgressionEvaluationContext, seen = new Set<unknown>(), depth = 0): Rational {
  if (depth > 32 || seen.has(value)) fail("scalar", "progression source references are cyclic or exceed depth32");
  if (record(value)) {
    fields(value, ["value", "unit"], "scalar");
    if (value.unit !== undefined && (typeof value.unit !== "string" || !["1", "dimensionless", "unitless", "scalar"].includes(value.unit.trim().toLowerCase()))) fail("units", "indexed progression coefficients and display coordinates must be dimensionless");
    seen.add(value);
    return scalar(value.value, context, seen, depth + 1);
  }
  if (typeof value === "number" && !Number.isFinite(value)) fail("scalar", "progression values must be finite real numbers");
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) fail("scalar", "progression values require explicit real coefficients");
  const parsed = literal(String(value).trim());
  if (parsed) { numeric(parsed, 1e6, "scalar"); return parsed; }
  seen.add(value);
  let resolved: unknown;
  try { resolved = context.scalar(String(value)); } catch { return fail("scalar", "progression source quantity is unresolved"); }
  return scalar(resolved, context, seen, depth + 1);
}
function integer(value: unknown, context: IndexedProgressionEvaluationContext, minimum: number, maximum: number, key: string): number {
  const parsed = scalar(value, context);
  if (parsed.d !== 1n || parsed.n < BigInt(minimum) || parsed.n > BigInt(maximum)) fail(key, `${key} must be an integer from${minimum} through${maximum}`);
  return Number(parsed.n);
}
function indices(value: unknown, context: IndexedProgressionEvaluationContext): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) fail("indices", "display requires1 through16 explicit integer indices");
  const result = Array.from(value).map((index) => integer(index, context, 1, 64, "indices"));
  if (new Set(result).size !== result.length || result.some((index, i) => i > 0 && index <= result[i - 1]!)) fail("indices", "displayed indices must be distinct and increasing");
  return result;
}
function term(kind: ProgressionKind, first: Rational, parameter: Rational, index: number): Rational {
  if (kind === "geometric" && first.n === 0n) return ZERO;
  return kind === "arithmetic" ? add(first, multiply(parameter, { n: BigInt(index - 1), d: 1n })) : multiply(first, power(parameter, index - 1));
}
function integerRoot(value: bigint, degree: number): bigint | null {
  if (value === 0n || value === 1n || degree === 1) return value;
  let low = 0n;
  let high = 1n << BigInt(Math.ceil(value.toString(2).length / degree));
  while (low <= high) {
    const mid = (low + high) / 2n;
    const raised = mid ** BigInt(degree);
    if (raised === value) return mid;
    if (raised < value) low = mid + 1n; else high = mid - 1n;
  }
  return null;
}
function roots(value: Rational, degree: number, branch: unknown): Rational[] {
  if (!["positive", "negative", "all_real"].includes(String(branch)) || typeof branch !== "string") fail("branch", "geometric recovery/insertion requires an explicit positive, negative or all_real branch");
  if (value.n < 0n && degree % 2 === 0) fail("observations", "negative endpoint ratio has no real even-power geometric branch");
  const n = integerRoot(value.n < 0n ? -value.n : value.n, degree);
  const d = integerRoot(value.d, degree);
  if (n === null || d === null) fail("root", "nonrational geometric roots require an independently accepted algebraic-root contract", true);
  const positive = rational(n, d);
  const candidates = n === 0n ? [ZERO] : value.n < 0n ? [{ n: -positive.n, d: positive.d }] : degree % 2 === 0 ? [positive, { n: -positive.n, d: positive.d }] : [positive];
  const selected = candidates.filter((candidate) => branch === "all_real" || (branch === "positive" ? candidate.n > 0n : candidate.n < 0n));
  if (!selected.length) fail("branch", "declared geometric sign branch is incompatible with the endpoints");
  return selected;
}
function serialized(value: Rational): ExactProgressionValue { return { numerator: value.n.toString(), denominator: value.d.toString() }; }
function deserialized(value: unknown): Rational {
  if (!record(value)) fail("metadata", "progression exact authority is missing");
  fields(value, ["numerator", "denominator"], "metadata");
  const integer = (text: unknown): bigint => {
    if (typeof text !== "string" || text.length > 1250 || !/^-?(?:0|[1-9]\d*)$/.test(text)) fail("metadata", "progression exact integers must be bounded and canonical");
    const result = BigInt(text);
    if (result.toString() !== text) fail("metadata", "progression exact integers must be canonical");
    return result;
  };
  const n = integer(value.numerator);
  const d = integer(value.denominator);
  if (d <= 0n) fail("metadata", "progression exact denominator must be positive");
  const result = rational(n, d);
  if (result.n !== n || result.d !== d) fail("metadata", "progression exact authority must be reduced");
  return result;
}

export function evaluateIndexedProgressionConstruction(operator: string, inputs: Record<string, unknown>, context: IndexedProgressionEvaluationContext): IndexedProgressionGeometry[] {
  const captured = captureMathSourceData(inputs, context);
  inputs = captured.data;
  context = captured.sources;
  const allowed = INPUT_KEYS[operator];
  if (!allowed) fail("operator", `unsupported indexed progression operator ${operator}`);
  if (!record(inputs)) fail("inputs", "progression inputs must be an object");
  fields(inputs, allowed, "fields");
  if (inputs.kind !== "arithmetic" && inputs.kind !== "geometric") fail("kind", "progression kind must be explicit arithmetic or geometric");
  const kind = inputs.kind;
  let displayed: number[];
  let observations: Observation[] = [];
  let candidates: Array<{ first: Rational; parameter: Rational }>;
  if (operator === "indexed_progression") {
    if (kind === "arithmetic" && inputs.ratio !== undefined || kind === "geometric" && inputs.difference !== undefined) fail("parameter", "AP difference and GP ratio are distinct source parameters");
    displayed = indices(inputs.indices, context);
    candidates = [{ first: scalar(inputs.first, context), parameter: scalar(kind === "arithmetic" ? inputs.difference : inputs.ratio, context) }];
  } else if (operator === "progression_insert") {
    const inserted = integer(inputs.insertions, context, 0, 14, "insertions");
    displayed = Array.from({ length: inserted + 2 }, (_, i) => i + 1);
    const first = scalar(inputs.first, context);
    const last = scalar(inputs.last, context);
    observations = [{ index: 1, value: first }, { index: inserted + 2, value: last }];
    if (kind === "arithmetic") {
      if (inputs.branch !== undefined) fail("branch", "arithmetic insertion has no geometric sign branch");
      candidates = [{ first, parameter: divide(subtract(last, first), { n: BigInt(inserted + 1), d: 1n }) }];
    } else {
      if (first.n === 0n) fail("observations", last.n === 0n ? "zero endpoints do not determine a unique GP ratio; use an explicitly supplied ratio" : "a zero first term cannot reach a nonzero geometric endpoint", last.n === 0n);
      candidates = roots(divide(last, first), inserted + 1, inputs.branch).map((parameter) => ({ first, parameter }));
    }
  } else {
    displayed = indices(inputs.indices, context);
    if (!Array.isArray(inputs.observations) || inputs.observations.length < 2 || inputs.observations.length > 16) fail("observations", "recovery needs2 through16 source observations");
    observations = Array.from(inputs.observations).map((observation) => {
      if (!record(observation)) fail("observations", "observations require explicit index/value pairs");
      fields(observation, ["index", "value"], "observations");
      return { index: integer(observation.index, context, 1, 64, "observations"), value: scalar(observation.value, context) };
    }).sort((a, b) => a.index - b.index);
    if (new Set(observations.map((observation) => observation.index)).size !== observations.length) fail("observations", "source observation indices must be distinct");
    if (observations.some((observation) => !displayed.includes(observation.index))) fail("indices", "recovery display must retain every source observation index");
    const a = observations[0]!;
    const b = observations[1]!;
    if (kind === "arithmetic") {
      if (inputs.branch !== undefined) fail("branch", "arithmetic recovery has no geometric sign branch");
      const parameter = divide(subtract(b.value, a.value), { n: BigInt(b.index - a.index), d: 1n });
      candidates = [{ first: subtract(a.value, multiply(parameter, { n: BigInt(a.index - 1), d: 1n })), parameter }];
    } else {
      if (a.value.n === 0n) fail("observations", b.value.n === 0n ? "zero observations cannot determine a unique GP ratio; use explicit parameters" : "a geometric sequence cannot recover after a zero term", b.value.n === 0n);
      const parameters = roots(divide(b.value, a.value), b.index - a.index, inputs.branch);
      candidates = parameters.filter((parameter) => parameter.n !== 0n || a.index === 1).map((parameter) => ({ first: divide(a.value, power(parameter, a.index - 1)), parameter }));
    }
  }
  candidates = candidates.filter((candidate) => observations.every((observation) => equal(term(kind, candidate.first, candidate.parameter, observation.index), observation.value)));
  if (!candidates.length) fail("observations", "no admissible progression satisfies all source observations");
  if (!Array.isArray(inputs.origin) || inputs.origin.length !== 2) fail("origin", "progression table requires explicit [x,y] placement");
  const origin = { x: numeric(scalar(inputs.origin[0], context), 1e6, "origin"), y: numeric(scalar(inputs.origin[1], context), 1e6, "origin") };
  const displayScale = numeric(scalar(inputs.displayScale, context), 1e6, "displayScale");
  if (displayScale < 1e-6) fail("displayScale", "progression display scale must be at least1e-6");
  const solutions = candidates.map(({ first, parameter }): IndexedProgressionSolution => {
    numeric(first, operator === "indexed_progression" ? 1e6 : 1e12, "first");
    numeric(parameter, operator === "indexed_progression" ? 1e6 : 1e12, "parameter");
    const terms = displayed.map((index) => { const value = term(kind, first, parameter, index); return { index, value: numeric(value, 1e12, "term"), exactValue: serialized(value) }; });
    if (inputs.witnesses !== undefined && (!Array.isArray(inputs.witnesses) || inputs.witnesses.length > 8)) fail("witnesses", "at most8 explicit property witnesses are supported");
    const witnesses = Array.from(inputs.witnesses as unknown[] ?? []).map((witness): ProgressionWitness => {
      if (!record(witness)) fail("witnesses", "witnesses require an explicit kind and indices");
      fields(witness, ["kind", "indices"], "witnesses");
      const expected = kind === "arithmetic" ? "equidistant_sum" : "equidistant_product";
      if (witness.kind !== expected || !Array.isArray(witness.indices) || witness.indices.length !== 4) fail("witnesses", "witness kind must match its progression and name4 indices");
      const at = Array.from(witness.indices).map((index) => integer(index, context, 1, 64, "witnesses"));
      if (at.some((index) => !displayed.includes(index)) || at[0]! + at[1]! !== at[2]! + at[3]!) fail("witnesses", "equidistant witnesses require visible terms and equal index sums");
      const values = at.map((index) => term(kind, first, parameter, index));
      const left = kind === "arithmetic" ? add(values[0]!, values[1]!) : multiply(values[0]!, values[1]!);
      const right = kind === "arithmetic" ? add(values[2]!, values[3]!) : multiply(values[2]!, values[3]!);
      if (!equal(left, right)) fail("witnesses", "progression property contradicts exact recurrence");
      numeric(left, 1e12, "witnesses");
      return { kind: expected, indices: at, exactValue: serialized(left) };
    });
    return { kind, first: serialized(first), parameter: serialized(parameter), terms, witnesses };
  });
  return [{ kind: "indexed_progression", indexedProgression: { operation: operator, solutions, observations: observations.map((observation) => ({ index: observation.index, exactValue: serialized(observation.value) })), origin, displayScale, branch: kind === "geometric" && operator !== "indexed_progression" ? inputs.branch as "positive" | "negative" | "all_real" : null, displayMode: "index_value_table", nonmetric: true } }];
}

export function indexedProgressionPrimitives(geometry: IndexedProgressionGeometry, entityId: string, groupId: string): RenderPrimitive[] {
  geometry = snapshotMathSourceData(geometry);
  if (!record(geometry) || geometry.kind !== "indexed_progression" || !record(geometry.indexedProgression)) fail("metadata", "rendering requires indexed progression authority");
  fields(geometry, ["kind", "indexedProgression"], "metadata");
  const definition = geometry.indexedProgression;
  fields(definition, ["operation", "solutions", "observations", "origin", "displayScale", "branch", "displayMode", "nonmetric"], "metadata");
  if (!(INDEXED_PROGRESSION_OPERATORS as readonly string[]).includes(definition.operation) || definition.nonmetric !== true || definition.displayMode !== "index_value_table" || !Array.isArray(definition.solutions) || definition.solutions.length < 1 || definition.solutions.length > 2 || definition.operation === "indexed_progression" && definition.solutions.length !== 1) fail("metadata", "progression rendering cannot imply a continuum or omit its branch model");
  if (!record(definition.origin) || !Number.isFinite(definition.origin.x) || !Number.isFinite(definition.origin.y) || Math.abs(definition.origin.x) > 1e6 || Math.abs(definition.origin.y) > 1e6 || !Number.isFinite(definition.displayScale) || definition.displayScale < 1e-6 || definition.displayScale > 1e6) fail("metadata", "progression placement must remain bounded and nonmetric");
  fields(definition.origin, ["x", "y"], "metadata");
  if (!Array.isArray(definition.observations) || definition.observations.length > 16) fail("metadata", "progression source observations are invalid");
  if (definition.operation === "indexed_progression" ? definition.observations.length !== 0 : definition.operation === "progression_insert" ? definition.observations.length !== 2 : definition.observations.length < 2) fail("metadata", "progression source observation arity is missing");
  const observed = definition.observations.map((observation, i) => {
    if (!record(observation) || !Number.isInteger(observation.index) || observation.index < 1 || observation.index > 64 || i > 0 && observation.index <= definition.observations[i - 1]!.index) fail("metadata", "source observation indices must remain distinct/increasing integers");
    fields(observation, ["index", "exactValue"], "metadata");
    return { index: observation.index, value: deserialized(observation.exactValue) };
  });
  definition.solutions.forEach((solution) => {
    if (!record(solution)) fail("metadata", "progression solution is missing");
    fields(solution, ["kind", "first", "parameter", "terms", "witnesses"], "metadata");
    if (solution.kind !== "arithmetic" && solution.kind !== "geometric" || !Array.isArray(solution.terms) || solution.terms.length < 1 || solution.terms.length > 16) fail("metadata", "progression solution kind/terms are invalid");
    const first = deserialized(solution.first);
    const parameter = deserialized(solution.parameter);
    numeric(first, definition.operation === "indexed_progression" ? 1e6 : 1e12, "metadata");
    numeric(parameter, definition.operation === "indexed_progression" ? 1e6 : 1e12, "metadata");
    const at = solution.terms.map((stored, i) => {
      if (!record(stored)) fail("metadata", "progression term is missing");
      fields(stored, ["index", "value", "exactValue"], "metadata");
      if (!Number.isInteger(stored.index) || stored.index < 1 || stored.index > 64 || i > 0 && stored.index <= solution.terms[i - 1]!.index) fail("metadata", "progression term indices must remain distinct/increasing integers");
      const expected = term(solution.kind, first, parameter, stored.index);
      if (!equal(deserialized(stored.exactValue), expected) || stored.value !== numeric(expected, 1e12, "metadata")) fail("metadata", "progression stored values contradict exact source recurrence");
      return stored.index;
    });
    for (const observation of definition.observations) {
      if (!record(observation) || !at.includes(observation.index) || !equal(deserialized(observation.exactValue), term(solution.kind, first, parameter, observation.index))) fail("metadata", "progression rendering omits or contradicts a source observation");
    }
    if (!Array.isArray(solution.witnesses) || solution.witnesses.length > 8) fail("metadata", "progression witnesses are invalid");
    for (const witness of solution.witnesses) {
      const expected = solution.kind === "arithmetic" ? "equidistant_sum" : "equidistant_product";
      if (!record(witness) || witness.kind !== expected || !Array.isArray(witness.indices) || witness.indices.length !== 4 || witness.indices.some((index) => !at.includes(index)) || witness.indices[0]! + witness.indices[1]! !== witness.indices[2]! + witness.indices[3]!) fail("metadata", "progression witness does not retain its visible equidistant indices");
      fields(witness, ["kind", "indices", "exactValue"], "metadata");
      const values = witness.indices.map((index) => term(solution.kind, first, parameter, index));
      const actual = solution.kind === "arithmetic" ? add(values[0]!, values[1]!) : multiply(values[0]!, values[1]!);
      if (!equal(actual, deserialized(witness.exactValue))) fail("metadata", "progression witness value contradicts its recurrence");
    }
  });
  if (definition.operation === "progression_insert" && (observed[0]!.index !== 1 || definition.solutions.some((solution) => solution.terms.length !== observed[1]!.index || solution.terms.some((term, i) => term.index !== i + 1)))) fail("metadata", "mean insertion must retain both endpoints and every inserted index");
  const kind = definition.solutions[0]!.kind;
  if (definition.solutions.some((solution) => solution.kind !== kind || JSON.stringify(solution.terms.map((term) => term.index)) !== JSON.stringify(definition.solutions[0]!.terms.map((term) => term.index)))) fail("metadata", "progression branches must retain one source model and requested index set");
  if (kind === "geometric" && definition.operation !== "indexed_progression") {
    const a = observed[0]!;
    const b = observed[1]!;
    if (a.value.n === 0n) fail("metadata", "zero observations cannot certify a recovered ratio");
    const expected = roots(divide(b.value, a.value), b.index - a.index, definition.branch)
      .filter((parameter) => parameter.n !== 0n || a.index === 1)
      .map((parameter) => ({ first: divide(a.value, power(parameter, a.index - 1)), parameter }))
      .filter((candidate) => observed.every((observation) => equal(term(kind, candidate.first, candidate.parameter, observation.index), observation.value)));
    if (expected.length !== definition.solutions.length || expected.some((candidate, i) => !equal(candidate.first, deserialized(definition.solutions[i]!.first)) || !equal(candidate.parameter, deserialized(definition.solutions[i]!.parameter)))) fail("metadata", "progression rendering omits or changes a declared sign branch");
  } else if (definition.branch !== null || definition.solutions.length !== 1) fail("metadata", "progression branch metadata disagrees with its source model");
  const labels = (value: ExactProgressionValue, numericValue: number): string => {
    const exact = value.denominator === "1" ? value.numerator : `${value.numerator}/${value.denominator}`;
    return exact.length <= 14 ? exact : `≈${numericValue.toPrecision(6)}`;
  };
  const primitives: RenderPrimitive[] = [];
  let branchOffset = 0;
  definition.solutions.forEach((solution, branch) => {
    const widths = solution.terms.map((term) => Math.max(String(term.index).length, labels(term.exactValue, term.value).length) * 0.8 + 2);
    const at = (x: number, y: number) => ({ x: definition.origin.x + definition.displayScale * x, y: definition.origin.y - definition.displayScale * (y + branchOffset) });
    const addLabel = (id: string, text: string, x: number, y: number, provenance: Record<string, unknown>): void => {
      primitives.push({ id: `${entityId}_${branch}_${id}`, entityId, groupId, kind: "label", points: [at(x, y)], text, provenance: { indexedDiscrete: true, nonmetric: true, ...provenance } });
    };
    const first = rational(BigInt(solution.first.numerator), BigInt(solution.first.denominator));
    const parameter = rational(BigInt(solution.parameter.numerator), BigInt(solution.parameter.denominator));
    addLabel("parameters", `a=${labels(solution.first, numeric(first, 1e12, "first"))}; ${solution.kind === "arithmetic" ? "d" : "r"}=${labels(solution.parameter, numeric(parameter, 1e12, "parameter"))}`, widths.slice(0, 4).reduce((sum, width) => sum + width, 0) / 2, 0, { exactFirst: solution.first, exactParameter: solution.parameter });
    let x = 2;
    solution.terms.forEach((term, i) => {
      const row = Math.floor(i / 4);
      if (i % 4 === 0) {
        x = 2;
        addLabel(`n_${row}`, "n", 0, 2 + row * 6, {});
        addLabel(`tn_${row}`, "t_n", 0, 4 + row * 6, {});
      }
      const center = x + widths[i]! / 2;
      const text = labels(term.exactValue, term.value);
      addLabel(`index_${term.index}`, String(term.index), center, 2 + row * 6, { index: term.index });
      addLabel(`value_${term.index}`, text, center, 4 + row * 6, { index: term.index, exactValue: term.exactValue, displayAccuracy: text.startsWith("≈") ? "rounded" : "exact" });
      primitives.push({ id: `${entityId}_${branch}_point_${term.index}`, entityId, groupId, kind: "point", points: [at(center, 3 + row * 6)], provenance: { indexedDiscrete: true, nonmetric: true, index: term.index, exactValue: term.exactValue } });
      x += widths[i]!;
    });
    const witnessStart = Math.ceil(solution.terms.length / 4) * 6;
    solution.witnesses.forEach((witness, i) => {
      const value = deserialized(witness.exactValue);
      const symbol = witness.kind === "equidistant_sum" ? "+" : "*";
      addLabel(`witness_${i}`, `t_${witness.indices[0]}${symbol}t_${witness.indices[1]}=t_${witness.indices[2]}${symbol}t_${witness.indices[3]}=${labels(witness.exactValue, numeric(value, 1e12, "witness"))}`, widths.slice(0, 4).reduce((sum, width) => sum + width, 0) / 2, witnessStart + i * 2, { exactValue: witness.exactValue, indices: witness.indices });
    });
    branchOffset += witnessStart + solution.witnesses.length * 2 + 4;
  });
  if (primitives.some((primitive) => primitive.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e12 || Math.abs(point.y) > 1e12))) fail("display", "progression table exceeds bounded display coordinates", true);
  return primitives;
}

export function validateIndexedProgressionConstruction(construction: SceneConstruction, index: number, document: SceneDocument, issues: SceneIssue[]): void {
  try {
    const captured = snapshotMathSourceData({ construction, document });
    construction = captured.construction;
    document = captured.document;
  } catch (error) {
    issues.push({ code: "invalid_math_source_data", message: error instanceof Error ? error.message : "mathematical source data cannot be captured", severity: "fatal", path: `constructions[${index}]` });
    return;
  }
  if (!(INDEXED_PROGRESSION_OPERATORS as readonly string[]).includes(construction.operator)) return;
  try {
    if (!Array.isArray(construction.outputs) || construction.outputs.length !== 1 || typeof construction.outputs[0] !== "string" || !construction.outputs[0].trim() || document.entities.filter((entity) => entity.id === construction.outputs[0] && entity.kind === "indexed_progression").length !== 1 || document.constructions.filter((candidate) => candidate.outputs.includes(construction.outputs[0]!)).length !== 1) fail("outputs", "indexed progressions require one unique indexed_progression output and producer");
    const visited = new Set<unknown>();
    const checkAmbiguousLiteral = (value: unknown, depth = 0): void => {
      if (depth > 32) fail("scalar", "progression input nesting exceeds depth32");
      if (typeof value === "string" && document.quantities.some((quantity) => quantity.id === value) && literal(value.trim()) !== null) fail("scalar", "a numeric-spelled quantity reference is ambiguous with a literal; use a named source id");
      if (typeof value !== "object" || value === null || visited.has(value)) return;
      visited.add(value);
      for (const child of Object.values(value)) checkAmbiguousLiteral(child, depth + 1);
    };
    checkAmbiguousLiteral(construction.inputs);
    const context: IndexedProgressionEvaluationContext = { scalar(id) { const quantities = document.quantities.filter((quantity) => quantity.id === id); if (quantities.length !== 1) fail("scalar", "progression quantity reference is missing or ambiguous"); return { value: quantities[0]!.value, unit: quantities[0]!.unit }; } };
    const [geometry] = evaluateIndexedProgressionConstruction(construction.operator, construction.inputs, context);
    indexedProgressionPrimitives(geometry!, construction.outputs[0]!, "validation");
  } catch (error) {
    const key = error instanceof ProgressionInputError ? error.key : "inputs";
    issues.push({ code: `${error instanceof ProgressionInputError && error.unsupported ? "unsupported" : "invalid"}_${construction.operator}_${key}`, message: error instanceof Error ? error.message : "progression construction cannot be verified", severity: "fatal", entityIds: construction.outputs,
      path: `constructions[${index}].${key === "outputs" ? "outputs" : `inputs.${key}`}` });
  }
}
