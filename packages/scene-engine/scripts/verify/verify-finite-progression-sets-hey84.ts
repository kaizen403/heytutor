import { evaluateFiniteProgressionSets, type FiniteProgressionSetRequest, type FiniteSetPattern, type IntegerProgressionSet, type IntegerCongruence } from "../../src/math/finiteProgressionSets";

let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void { check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
function rejects(run: () => unknown, message: string): void { let caught = false; try { run(); } catch { caught = true; } check(caught, message); }
function request(a: IntegerProgressionSet, b: IntegerProgressionSet, operation: "intersection" | "union", congruence?: IntegerCongruence): FiniteProgressionSetRequest {
  return { model: "integer_ap_sets", operation, sets: [a, b], ...(congruence ? { congruence } : {}) };
}
function enumerate(source: IntegerProgressionSet, congruence?: IntegerCongruence): Set<number> {
  const result = new Set<number>();
  for (let index = 0; index < source.count; index++) {
    const value = source.first + source.step * index;
    if (!congruence || ((value % congruence.modulus) + congruence.modulus) % congruence.modulus === congruence.residue) result.add(value);
  }
  return result;
}
function patternMembers(pattern: FiniteSetPattern): number[] {
  if (pattern.cardinality === 0) {
    equal([pattern.minimum, pattern.maximum, pattern.stride], [null, null, null], "empty pattern has no invented endpoints");
    return [];
  }
  check(pattern.cardinality <= 4096, "test enumerator is only used for small oracle patterns");
  const values = Array.from({ length: pattern.cardinality }, (_, i) => Number(BigInt(pattern.minimum!) + BigInt(pattern.stride!) * BigInt(i)));
  check(values.at(-1)!.toString() === pattern.maximum, "exact pattern maximum matches its last member");
  if (pattern.cardinality === 1) check(pattern.stride === "0", "singleton has zero canonical stride, not sequence multiplicity");
  return values;
}
function oracle(candidate: FiniteProgressionSetRequest, caseId: string): void {
  const a = enumerate(candidate.sets[0]);
  const b = enumerate(candidate.sets[1]);
  const filteredA = enumerate(candidate.sets[0], candidate.congruence);
  const filteredB = enumerate(candidate.sets[1], candidate.congruence);
  const overlap = [...filteredA].filter((value) => filteredB.has(value)).sort((a, b) => a - b);
  const unfiltered = [...a].filter((value) => b.has(value)).sort((a, b) => a - b);
  const expected = candidate.operation === "intersection" ? overlap.length : new Set([...filteredA, ...filteredB]).size;
  const actual = evaluateFiniteProgressionSets(candidate);
  check(actual.cardinality === expected, `${caseId}: independent distinct-set cardinality`);
  equal(actual.sets, candidate.sets, `${caseId}: original signed descriptors retained`);
  equal(actual.congruence, candidate.congruence ?? null, `${caseId}: no filter silently invented`);
  equal(patternMembers(actual.sourcePatterns[0]), [...a].sort((a, b) => a - b), `${caseId}: first source set normalization`);
  equal(patternMembers(actual.sourcePatterns[1]), [...b].sort((a, b) => a - b), `${caseId}: second source set normalization`);
  equal(patternMembers(actual.filteredPatterns[0]), [...filteredA].sort((a, b) => a - b), `${caseId}: filter applied to first operand`);
  equal(patternMembers(actual.filteredPatterns[1]), [...filteredB].sort((a, b) => a - b), `${caseId}: filter applied to second operand`);
  equal(patternMembers(actual.unfilteredIntersection), unfiltered, `${caseId}: unfiltered CRT pattern`);
  equal(patternMembers(actual.intersection), overlap, `${caseId}: filtered CRT pattern`);
}

const prelistedHoldouts = Array.from({ length: 128 }, (_, i) => request(
  { first: ((i * 37) % 83) - 41, step: (i % 11) - 5, count: (i * 3) % 19 },
  { first: ((i * 53) % 89) - 44, step: ((i * 7) % 13) - 6, count: (i * 5) % 17 },
  i % 2 ? "union" : "intersection",
  i % 3 ? { modulus: 1 + i % 17, residue: (i * 11) % (1 + i % 17) } : undefined,
));
if (process.argv.includes("--holdout")) {
  prelistedHoldouts.forEach((candidate, i) => oracle(candidate, `prelisted-synthetic-${i}`));
  console.log(`finite AP sets prelisted synthetic holdout passed (128 cases, ${checks} checks); not a bank-question cohort`);
} else {
  const small: IntegerProgressionSet[] = [];
  for (const first of [-7, 0, 6]) for (const step of [-3, -2, 0, 2, 3]) for (const count of [0, 1, 2, 6]) small.push({ first, step, count });
  const filters: Array<IntegerCongruence | undefined> = [undefined, { modulus: 1, residue: 0 }, { modulus: 2, residue: 0 }, { modulus: 2, residue: 1 }, { modulus: 3, residue: 0 }, { modulus: 3, residue: 2 }];
  for (const [ai, a] of small.entries()) for (const [bi, b] of small.entries()) for (const filter of filters) for (const operation of ["intersection", "union"] as const) oracle(request(a, b, operation, filter), `grid-${ai}-${bi}-${filter?.modulus ?? 0}-${filter?.residue ?? 0}-${operation}`);

  const main2026 = request({ first: 1, step: 5, count: 101 }, { first: 9, step: 7, count: 71 }, "intersection", { modulus: 3, residue: 0 });
  oracle(main2026, "original-PDF-Main2026-0402s1-Q5");
  const source = evaluateFiniteProgressionSets(main2026);
  check(source.cardinality === 5 && source.unfilteredIntersection.cardinality === 14, "2026 source oracle, not invented primitive truncation");
  equal(source.intersection, { cardinality: 5, minimum: "51", maximum: "471", stride: "105" }, "source congruence interval from independent CRT");
  const advanced2018 = request({ first: 1, step: 5, count: 2018 }, { first: 9, step: 7, count: 2018 }, "union");
  oracle(advanced2018, "original-PDF-Advanced2018-P1-Q9");
  check(evaluateFiniteProgressionSets(advanced2018).cardinality === 3748 && evaluateFiniteProgressionSets(advanced2018).intersection.cardinality === 288, "2018 union/overlap source calibration");
  const applyBoth = request({ first: 1, step: 1, count: 2 }, { first: 2, step: 1, count: 2 }, "union", { modulus: 2, residue: 0 });
  check(evaluateFiniteProgressionSets(applyBoth).cardinality === 1, "union filters BOTH operands before inclusion-exclusion");

  const million = { first: -500000, step: 1, count: 1000000 };
  check(evaluateFiniteProgressionSets(request(million, million, "intersection")).cardinality === 1000000, "large identical interval analytic count");
  const largeFiltered = evaluateFiniteProgressionSets(request(million, million, "union", { modulus: 997, residue: 123 }));
  equal(largeFiltered.intersection, { cardinality: 1003, minimum: "-499374", maximum: "499620", stride: "997" }, "large signed ceil/floor congruence oracle");
  check(largeFiltered.cardinality === 1003, "large union deduplication with filter");
  const odd = { first: -999999, step: 2, count: 1000000 }, even = { first: -1000000, step: 2, count: 1000000 };
  check(evaluateFiniteProgressionSets(request(odd, even, "intersection")).cardinality === 0, "large incompatible congruences have zero intersection");
  check(evaluateFiniteProgressionSets(request(odd, even, "union")).cardinality === 2000000, "maximum admitted exact distinct union count");
  check(evaluateFiniteProgressionSets(request(odd, even, "union", { modulus: 2, residue: 0 })).cardinality === 1000000, "large residue filter rejects one entire operand");
  const constant = { first: 5, step: 0, count: 1000000 };
  check(evaluateFiniteProgressionSets(request(constant, constant, "union")).cardinality === 1, "million repeated terms are one set member");
  check(evaluateFiniteProgressionSets(request(constant, constant, "intersection", { modulus: 3, residue: 0 })).cardinality === 0, "singleton congruence exclusion");
  const negativeLarge = { first: -1000000, step: -1000000, count: 1000000 };
  const negative = evaluateFiniteProgressionSets(request(negativeLarge, negativeLarge, "intersection"));
  equal(negative.sourcePatterns[0], { cardinality: 1000000, minimum: "-1000000000000", maximum: "-1000000", stride: "1000000" }, "negative step endpoint normalization at admitted1e12 boundary");
  equal(negative.sets[0], negativeLarge, "source descending direction retained despite ascending canonical membership");
  const coprimeBoundary = evaluateFiniteProgressionSets(request({ first: 0, step: 999983, count: 1000000 }, { first: 0, step: 999979, count: 1000000 }, "intersection"));
  equal(coprimeBoundary.intersection, { cardinality: 2, minimum: "0", maximum: "999962000357", stride: "999962000357" }, "large coprime generalized CRT, no runtime enumeration");

  const base = request({ first: 1, step: 2, count: 4 }, { first: 2, step: 3, count: 5 }, "intersection");
  for (const bad of [
    { ...base, model: undefined }, { ...base, model: "real_ap_sets" }, { ...base, operation: "difference" }, { ...base, operation: undefined },
    { ...base, sets: [] }, { ...base, sets: [base.sets[0]] }, { ...base, sets: [...base.sets, base.sets[0]] }, { ...base, sets: Array(2) },
    { ...base, congruence: null }, { ...base, congruence: { modulus: 3 } }, { ...base, congruence: { residue: 0 } }, { ...base, congruence: { modulus: 0, residue: 0 } }, { ...base, congruence: { modulus: 3, residue: -1 } }, { ...base, congruence: { modulus: 3, residue: 3 } }, { ...base, congruence: { modulus: 1000001, residue: 0 } },
    { ...base, callback: () => 1 }, { ...base, unit: "m" }, { ...base, sourceQuestionId: "q_not_a_router" },
  ]) rejects(() => evaluateFiniteProgressionSets(bad), `invalid request:${JSON.stringify(bad)}`);
  for (const key of ["first", "step", "count"] as const) for (const value of [NaN, Infinity, -Infinity, 0.5, "1", true, null, undefined, Number.MAX_SAFE_INTEGER, 1000001]) {
    const candidate = structuredClone(base);
    (candidate.sets[0] as unknown as Record<string, unknown>)[key] = value;
    rejects(() => evaluateFiniteProgressionSets(candidate), `invalid primitive-safe-integer:${key}:${String(value)}`);
  }
  rejects(() => evaluateFiniteProgressionSets(request({ ...base.sets[0], count: -1 }, base.sets[1], "union")), "negative count is not a reversed source sequence");

  const before = JSON.stringify(base), control = evaluateFiniteProgressionSets(base);
  check(JSON.stringify(base) === before, "source input is not mutated");
  equal(evaluateFiniteProgressionSets(JSON.parse(before)), control, "source JSON parity");
  equal(evaluateFiniteProgressionSets(Object.freeze({ ...base })), control, "frozen record parity");
  equal(evaluateFiniteProgressionSets(Object.assign(Object.create(null), base)), control, "null-prototype record parity");
  const hidden = { ...base };
  Object.defineProperty(hidden, "sets", { value: base.sets, enumerable: false });
  equal(evaluateFiniteProgressionSets(hidden), control, "own nonenumerable required DATA accepted");
  const alias = { first: 1, step: 2, count: 4 };
  check(evaluateFiniteProgressionSets(request(alias, alias, "union")).cardinality === 4, "DAG alias sets remain identical sets, not doubled multiplicity");
  for (const key of ["model", "operation", "sets"] as const) {
    const unsafe = { ...base };
    let reads = 0;
    Object.defineProperty(unsafe, key, { enumerable: true, get() { reads++; return base[key]; } });
    rejects(() => evaluateFiniteProgressionSets(unsafe), `top accessor:${key}`);
    check(reads === 0, `top getter${key} never executes`);
    const inherited = { ...base } as Record<string, unknown>;
    delete inherited[key]; Object.setPrototypeOf(inherited, { [key]: base[key] });
    rejects(() => evaluateFiniteProgressionSets(inherited), `inherited required source:${key}`);
  }
  for (const key of ["first", "step", "count"] as const) {
    const unsafe = structuredClone(base);
    let reads = 0;
    Object.defineProperty(unsafe.sets[0], key, { enumerable: false, get() { reads++; return base.sets[0][key]; } });
    rejects(() => evaluateFiniteProgressionSets(unsafe), `nested accessor:${key}`);
    check(reads === 0, `nested getter${key} never executes`);
  }
  const unsafeFilter = { ...base, congruence: { modulus: 3, residue: 0 } };
  let reads = 0;
  Object.defineProperty(unsafeFilter.congruence, "residue", { get() { reads++; return 0; } });
  rejects(() => evaluateFiniteProgressionSets(unsafeFilter), "filter accessor rejects");
  check(reads === 0, "filter getter never executes");
  const symbol = { ...base, [Symbol("extra")]: 1 };
  rejects(() => evaluateFiniteProgressionSets(symbol), "symbol metadata rejects");
  const cycle: Record<string, unknown> = { ...base }; cycle.self = cycle;
  rejects(() => evaluateFiniteProgressionSets(cycle), "true cycle rejects");
  let deep: unknown = 1; for (let i = 0; i < 66; i++) deep = { value: deep };
  rejects(() => evaluateFiniteProgressionSets({ ...base, extra: deep }), "depth capacity rejects before extra-field reads");
  rejects(() => evaluateFiniteProgressionSets({ ...base, extra: Array(16385).fill(1) }), "node/array capacity rejects");

  console.log(`finite AP sets passed (${checks} exact enumeration/CRT/source/large/descriptor controls); no runtime enumeration, source-cohort or scene/lifecycle acceptance`);
}
