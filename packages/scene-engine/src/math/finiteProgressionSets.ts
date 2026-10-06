import { snapshotMathSourceData } from "../compile/mathSourceData";

export interface IntegerProgressionSet { first: number; step: number; count: number }
export interface IntegerCongruence { modulus: number; residue: number }
export interface FiniteProgressionSetRequest {
  model: "integer_ap_sets";
  operation: "intersection" | "union";
  sets: [IntegerProgressionSet, IntegerProgressionSet];
  congruence?: IntegerCongruence;
}
export interface FiniteSetPattern {
  cardinality: number;
  minimum: string | null;
  maximum: string | null;
  stride: string | null;
}
export interface FiniteProgressionSetResult {
  model: "integer_ap_sets";
  operation: "intersection" | "union";
  sets: [IntegerProgressionSet, IntegerProgressionSet];
  congruence: IntegerCongruence | null;
  sourcePatterns: [FiniteSetPattern, FiniteSetPattern];
  filteredPatterns: [FiniteSetPattern, FiniteSetPattern];
  unfilteredIntersection: FiniteSetPattern;
  intersection: FiniteSetPattern;
  cardinality: number;
  proofMethod: "exact_bounded_generalized_crt";
}
type Pattern = { first: bigint; last: bigint; step: bigint; count: bigint };
class ProgressionSetInputError extends Error {}
function fail(message: string): never { throw new ProgressionSetInputError(message); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("finite AP sets contain unsupported fields");
}
function integer(value: unknown, minimum: number, maximum: number, key: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${key} requires a primitive safe integer from${minimum} through${maximum}`);
  return value === 0 ? 0 : value;
}
function bounded(value: bigint): bigint {
  if ((value < 0n ? -value : value).toString(2).length > 512) fail("exact AP set arithmetic exceeds512 bits");
  return value;
}
function floorDivide(value: bigint, positiveDivisor: bigint): bigint {
  if (positiveDivisor <= 0n) fail("AP set division requires a positive modulus");
  const quotient = value / positiveDivisor;
  return bounded(value % positiveDivisor < 0n ? quotient - 1n : quotient);
}
function ceilDivide(value: bigint, positiveDivisor: bigint): bigint { return -floorDivide(-value, positiveDivisor); }
function modulo(value: bigint, positiveModulus: bigint): bigint {
  if (positiveModulus <= 0n) fail("AP set congruences require a positive modulus");
  const remainder = value % positiveModulus;
  return bounded(remainder < 0n ? remainder + positiveModulus : remainder);
}
function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  return a;
}
function inverseCoprime(value: bigint, modulus: bigint): bigint {
  let oldR = value, r = modulus, oldCoefficient = 1n, coefficient = 0n;
  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, bounded(oldR - bounded(quotient * r))];
    [oldCoefficient, coefficient] = [coefficient, bounded(oldCoefficient - bounded(quotient * coefficient))];
  }
  if (oldR !== 1n) fail("AP congruence inverse requires coprime reduced moduli");
  return modulo(oldCoefficient, modulus);
}
function pattern(first: bigint, last: bigint, step: bigint): Pattern | null {
  if (first > last) return null;
  if (first === last) return { first, last, step: 0n, count: 1n };
  if (step <= 0n || (last - first) % step !== 0n) fail("AP set pattern endpoints must share a positive stride");
  return { first, last, step, count: bounded((last - first) / step + 1n) };
}
function normalize(source: IntegerProgressionSet): Pattern | null {
  if (source.count === 0) return null;
  const first = BigInt(source.first);
  const last = bounded(first + bounded(BigInt(source.step) * BigInt(source.count - 1)));
  if (first > 1000000000000n || first < -1000000000000n || last > 1000000000000n || last < -1000000000000n) fail("derived AP source values exceed magnitude1e12");
  return first <= last ? pattern(first, last, BigInt(source.step)) : pattern(last, first, -BigInt(source.step));
}
function member(value: bigint, source: Pattern): boolean {
  return value >= source.first && value <= source.last && (source.step === 0n ? value === source.first : modulo(value - source.first, source.step) === 0n);
}
function intersect(a: Pattern | null, b: Pattern | null): Pattern | null {
  if (a === null || b === null) return null;
  const lower = a.first > b.first ? a.first : b.first;
  const upper = a.last < b.last ? a.last : b.last;
  if (lower > upper) return null;
  if (a.step === 0n) return member(a.first, b) ? a : null;
  if (b.step === 0n) return member(b.first, a) ? b : null;
  const divisor = gcd(a.step, b.step);
  const difference = bounded(b.first - a.first);
  if (difference % divisor !== 0n) return null;
  const reducedModulus = b.step / divisor;
  const coefficient = inverseCoprime(a.step / divisor, reducedModulus);
  const shift = modulo(bounded((difference / divisor) * coefficient), reducedModulus);
  const stride = bounded((a.step / divisor) * b.step);
  const reference = bounded(a.first + bounded(a.step * shift));
  const first = bounded(reference + bounded(ceilDivide(lower - reference, stride) * stride));
  if (first > upper) return null;
  const last = bounded(first + bounded(floorDivide(upper - first, stride) * stride));
  return pattern(first, last, stride);
}
function filtered(source: Pattern | null, filter: IntegerCongruence | null): Pattern | null {
  if (source === null || filter === null) return source;
  const modulus = BigInt(filter.modulus);
  const residue = BigInt(filter.residue);
  if (source.step === 0n) return modulo(source.first, modulus) === residue ? source : null;
  const first = bounded(residue + bounded(ceilDivide(source.first - residue, modulus) * modulus));
  if (first > source.last) return null;
  const last = bounded(first + bounded(floorDivide(source.last - first, modulus) * modulus));
  return intersect(source, pattern(first, last, modulus));
}
function count(source: Pattern | null): bigint { return source?.count ?? 0n; }
function serialized(source: Pattern | null): FiniteSetPattern {
  if (source === null) return { cardinality: 0, minimum: null, maximum: null, stride: null };
  if (source.count < 1n || source.count > 2000000n) fail("returned finite set cardinality exceeds2e6");
  return { cardinality: Number(source.count), minimum: source.first.toString(), maximum: source.last.toString(), stride: source.step.toString() };
}

export function evaluateFiniteProgressionSets(raw: unknown): FiniteProgressionSetResult {
  const request = snapshotMathSourceData(raw);
  if (!record(request)) fail("finite AP sets require an own data request record");
  fields(request, ["model", "operation", "sets", "congruence"]);
  if (request.model !== "integer_ap_sets" || request.operation !== "intersection" && request.operation !== "union") fail("finite AP sets require the explicit integer_ap_sets model and intersection/union operation");
  if (!Array.isArray(request.sets) || request.sets.length !== 2) fail("exactly two finite AP sets must be supplied");
  const sets = Array.from(request.sets).map((source): IntegerProgressionSet => {
    if (!record(source)) fail("each AP set needs an own first/step/count record");
    fields(source, ["first", "step", "count"]);
    return { first: integer(source.first, -1000000, 1000000, "first"), step: integer(source.step, -1000000, 1000000, "step"), count: integer(source.count, 0, 1000000, "count") };
  }) as [IntegerProgressionSet, IntegerProgressionSet];
  let congruence: IntegerCongruence | null = null;
  if (request.congruence !== undefined) {
    if (!record(request.congruence)) fail("congruence must explicitly supply modulus/residue");
    fields(request.congruence, ["modulus", "residue"]);
    const modulus = integer(request.congruence.modulus, 1, 1000000, "modulus");
    congruence = { modulus, residue: integer(request.congruence.residue, 0, modulus - 1, "residue") };
  }
  const sources = sets.map(normalize) as [Pattern | null, Pattern | null];
  const selected = sources.map((source) => filtered(source, congruence)) as [Pattern | null, Pattern | null];
  const overlap = intersect(selected[0], selected[1]);
  const cardinality = request.operation === "intersection" ? count(overlap) : bounded(count(selected[0]) + count(selected[1]) - count(overlap));
  if (cardinality < 0n || cardinality > 2000000n || count(selected[0]) > count(sources[0]) || count(selected[1]) > count(sources[1]) || count(overlap) > count(selected[0]) || count(overlap) > count(selected[1])) fail("AP set cardinality violates an exact subset bound");
  return { model: "integer_ap_sets", operation: request.operation, sets, congruence, sourcePatterns: [serialized(sources[0]), serialized(sources[1])], filteredPatterns: [serialized(selected[0]), serialized(selected[1])], unfilteredIntersection: serialized(intersect(sources[0], sources[1])), intersection: serialized(overlap), cardinality: Number(cardinality), proofMethod: "exact_bounded_generalized_crt" };
}
