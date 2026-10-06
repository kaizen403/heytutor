import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { captureMathSourceData, snapshotMathSourceData } from "../../src/compile/mathSourceData";
import * as correctedMatrix from "../../src/compile/matrixArrayGeometry";
import * as correctedProgression from "../../src/compile/indexedProgressionGeometry";
import type { SceneDocument, SceneIssue } from "../../src/types";

const originalIndex = process.argv.indexOf("--original-root");
const referenceIndex = process.argv.indexOf("--reference-root");
const matrix: typeof correctedMatrix = originalIndex < 0 ? correctedMatrix : await import(pathToFileURL(join(process.argv[originalIndex + 1]!, "packages/scene-engine/src/compile/matrixArrayGeometry.ts")).href);
const progression: typeof correctedProgression = originalIndex < 0 ? correctedProgression : await import(pathToFileURL(join(process.argv[originalIndex + 1]!, "packages/scene-engine/src/compile/indexedProgressionGeometry.ts")).href);
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void { check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
function rejected(run: () => unknown, message: string): void { let caught = false; try { run(); } catch { caught = true; } check(caught, message); }
const matrixInput = () => ({ entries: [[1, 2], [3, 4]], origin: [0, 0], displayScale: 1 });
const progressionInput = () => ({ kind: "arithmetic", first: 1, difference: 2, indices: [1, 2, 3], origin: [0, 0], displayScale: 1 });
const scalarContext = { scalar() { throw new Error("source was not declared"); } };
const matrixContext = { ...scalarContext, geometry() { return undefined; } };
const families = [
  { name: "matrix", base: matrixInput, evaluate: (input: Record<string, unknown>) => matrix.evaluateMatrixArrayConstruction("matrix_array", input, matrixContext) },
  { name: "progression", base: progressionInput, evaluate: (input: Record<string, unknown>) => progression.evaluateIndexedProgressionConstruction("indexed_progression", input, scalarContext) },
];

for (const family of families) {
  const baseline = family.base();
  const reference = family.evaluate(baseline);
  for (const key of Object.keys(baseline)) {
    let reads = 0;
    const getter = { ...baseline };
    const value = (baseline as Record<string, unknown>)[key];
    Object.defineProperty(getter, key, { enumerable: true, get() { reads++; return value; } });
    rejected(() => family.evaluate(getter), `${family.name}:${key} getter must reject`);
    check(reads === 0, `${family.name}:${key} getter must never execute (actual${reads})`);
    const inherited = { ...baseline } as Record<string, unknown>;
    delete inherited[key];
    Object.setPrototypeOf(inherited, { [key]: value });
    rejected(() => family.evaluate(inherited), `${family.name}:${key} inherited source data must reject`);
    const nonenumerable = { ...baseline };
    Object.defineProperty(nonenumerable, key, { value, enumerable: false });
    equal(family.evaluate(nonenumerable), reference, `${family.name}:${key} own nonenumerable DATA parity`);
  }
  equal(family.evaluate(JSON.parse(JSON.stringify(baseline))), reference, `${family.name}: source JSON parity`);
  equal(family.evaluate(Object.freeze({ ...baseline })), reference, `${family.name}: frozen own DATA parity`);
  equal(family.evaluate(Object.assign(Object.create(null), baseline)), reference, `${family.name}: null-prototype own DATA parity`);
  for (const name of ["unknown", "__proto__"]) {
    const extra = { ...baseline };
    Object.defineProperty(extra, name, { value: 1, enumerable: false });
    rejected(() => family.evaluate(extra), `${family.name}: hidden unknown DATA is not silently ignored`);
  }
  const symbol = { ...baseline, [Symbol("extra")]: 1 };
  rejected(() => family.evaluate(symbol), `${family.name}: source symbol keys reject`);
  const setter = { ...baseline };
  let writes = 0;
  Object.defineProperty(setter, "optional", { enumerable: false, set() { writes++; } });
  rejected(() => family.evaluate(setter), `${family.name}: unused setter rejects before source reads`);
  check(writes === 0, `${family.name}: setter never executed`);
}

const nestedCases: Array<{ name: string; make: (getter: () => unknown) => Record<string, unknown>; run: (input: Record<string, unknown>) => unknown }> = [
  { name: "matrix cell", make(getter) { const row = [1, 2]; Object.defineProperty(row, "0", { enumerable: true, get: getter }); return { ...matrixInput(), entries: [row] }; }, run(input) { return matrix.evaluateMatrixArrayConstruction("matrix_array", input, matrixContext); } },
  { name: "matrix scalar unit", make(getter) { const value = { value: 1 }; Object.defineProperty(value, "unit", { enumerable: false, get: getter }); return { ...matrixInput(), entries: [[value]] }; }, run(input) { return matrix.evaluateMatrixArrayConstruction("matrix_array", input, matrixContext); } },
  { name: "progression scalar value", make(getter) { const value = {}; Object.defineProperty(value, "value", { enumerable: true, get: getter }); return { ...progressionInput(), first: value }; }, run(input) { return progression.evaluateIndexedProgressionConstruction("indexed_progression", input, scalarContext); } },
  { name: "progression index", make(getter) { const at = [1, 2]; Object.defineProperty(at, "1", { enumerable: true, get: getter }); return { ...progressionInput(), indices: at }; }, run(input) { return progression.evaluateIndexedProgressionConstruction("indexed_progression", input, scalarContext); } },
  { name: "observation", make(getter) { const observed = { index: 1 }; Object.defineProperty(observed, "value", { enumerable: true, get: getter }); return { kind: "arithmetic", observations: [observed, { index: 3, value: 5 }], indices: [1, 3], origin: [0, 0], displayScale: 1 }; }, run(input) { return progression.evaluateIndexedProgressionConstruction("progression_recover", input, scalarContext); } },
  { name: "property witness", make(getter) { const witness = { kind: "equidistant_sum" }; Object.defineProperty(witness, "indices", { enumerable: true, get: getter }); return { ...progressionInput(), witnesses: [witness] }; }, run(input) { return progression.evaluateIndexedProgressionConstruction("indexed_progression", input, scalarContext); } },
];
for (const scenario of nestedCases) {
  let reads = 0;
  const input = scenario.make(() => { reads++; return 1; });
  rejected(() => scenario.run(input), `${scenario.name}: nested accessor rejects`);
  check(reads === 0, `${scenario.name}: nested getter never executes`);
}

const alias = { value: 1, unit: "1" };
const graph = { first: alias, difference: alias };
const snapshot = snapshotMathSourceData(graph);
check(snapshot.first === snapshot.difference && snapshot.first !== alias, "DAG aliases retain one captured identity without original references");
check(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.first), "capture is deeply immutable");
alias.value = 9;
check(snapshot.first.value === 1, "snapshot isolates later source mutation");
const cyclic: Record<string, unknown> = {};
cyclic.self = cyclic;
rejected(() => snapshotMathSourceData(cyclic), "true source cycle rejects, not a DAG alias");
let deep: unknown = 1;
for (let i = 0; i < 66; i++) deep = { value: deep };
rejected(() => snapshotMathSourceData(deep), "depth cap rejects");
rejected(() => snapshotMathSourceData(Array(2)), "sparse source arrays reject");
rejected(() => snapshotMathSourceData(Array(16385).fill(1)), "array/node capacity rejects");
rejected(() => snapshotMathSourceData("x".repeat(1048577)), "aggregate source string capacity rejects");
rejected(() => snapshotMathSourceData({ value: () => 1 }), "callable source value rejects");
rejected(() => snapshotMathSourceData({ value: Symbol("value") }), "symbol source value rejects");
rejected(() => snapshotMathSourceData(new Date()), "custom source prototype rejects");
const indexed = Object.setPrototypeOf([1, 2, 3], null);
equal(progression.evaluateIndexedProgressionConstruction("indexed_progression", { ...progressionInput(), indices: indexed }, scalarContext), progression.evaluateIndexedProgressionConstruction("indexed_progression", progressionInput(), scalarContext), "null-prototype indexed-array DATA parity");
for (let depth = 0; depth <= 32; depth++) {
  let value: unknown = 1;
  for (let i = 0; i < depth; i++) value = { value, unit: "1" };
  const geometry = progression.evaluateIndexedProgressionConstruction("indexed_progression", { ...progressionInput(), first: value }, scalarContext);
  equal(geometry[0]!.indexedProgression.solutions[0]!.first, { numerator: "1", denominator: "1" }, `original scalar depth${depth} remains supported`);
}
let pollutedReads = 0;
Object.defineProperty(Object.prototype, "first", { configurable: true, get() { pollutedReads++; return 1; } });
try {
  const missing = progressionInput() as Record<string, unknown>;
  delete missing.first;
  rejected(() => progression.evaluateIndexedProgressionConstruction("indexed_progression", missing, scalarContext), "polluted Object.prototype cannot supply missing source data");
  check(pollutedReads === 0, "inherited Object.prototype getter is never executed");
} finally { delete (Object.prototype as Record<string, unknown>).first; }
const nonenumerableQuantity = Object.create(null);
Object.defineProperties(nonenumerableQuantity, { value: { value: 1, enumerable: false }, unit: { value: "1", enumerable: false } });
equal(progression.evaluateIndexedProgressionConstruction("indexed_progression", { ...progressionInput(), first: "q" }, { scalar() { return nonenumerableQuantity; } }), progression.evaluateIndexedProgressionConstruction("indexed_progression", progressionInput(), scalarContext), "own nonenumerable raw quantity callback parity");

let calls = 0;
const repeated = progression.evaluateIndexedProgressionConstruction("indexed_progression", { ...progressionInput(), first: "q", difference: "q" }, { scalar() { return { value: ++calls, unit: "1" }; } });
check(calls === 1, "scalar source ID resolved once per construction");
equal(repeated[0]!.indexedProgression.solutions[0]!.terms.map((term) => term.value), [1, 2, 3], "same scalar ID cannot drift between coefficient reads");
calls = 0;
const repeatedMatrix = matrix.evaluateMatrixArrayConstruction("matrix_array", { ...matrixInput(), entries: [["q", "q"], ["q", "q"]] }, { scalar() { return ++calls; }, geometry() { return undefined; } });
check(calls === 1, "matrix scalar ID resolved once");
equal(repeatedMatrix[0]!.matrixArray.entries, [[1, 1], [1, 1]], "matrix alias values remain consistent");
const input = { ...matrixInput(), entries: [["q"]] };
const isolated = matrix.evaluateMatrixArrayConstruction("matrix_array", input, { scalar() { input.displayScale = 99; return 1; }, geometry() { return undefined; } });
check(input.displayScale === 99 && isolated[0]!.matrixArray.displayScale === 1, "payload mutation from a resolver cannot rewrite captured display inputs");
const shared = { value: 1, unit: "1" };
const sharedResult = progression.evaluateIndexedProgressionConstruction("indexed_progression", { ...progressionInput(), first: "a", difference: "d" }, { scalar(id) { if (id === "d") shared.value = 99; return shared; } });
equal(sharedResult[0]!.indexedProgression.solutions[0]!.terms.map((term) => term.value), [1, 2, 3], "source object aliases use the first immutable snapshot even if later callback mutates it");

const a = matrix.evaluateMatrixArrayConstruction("matrix_array", matrixInput(), matrixContext)[0]!;
let geometryCalls = 0;
const squared = matrix.evaluateMatrixArrayConstruction("matrix_product", { left: "A", right: "A", origin: [0, 0], displayScale: 1 }, { ...scalarContext, geometry() { geometryCalls++; return a; } });
check(geometryCalls === 1, "matrix geometry ID resolved once");
equal(squared[0]!.matrixArray.entries, [[7, 10], [15, 22]], "geometry capture preserves the independent matrix-square oracle");
for (const resolver of ["scalar", "geometry"] as const) {
  let reads = 0;
  const unsafe: Record<string, unknown> = resolver === "scalar" ? { unit: "1" } : { matrixArray: a.matrixArray };
  Object.defineProperty(unsafe, resolver === "scalar" ? "value" : "kind", { enumerable: true, get() { reads++; return resolver === "scalar" ? 1 : "matrix_array"; } });
  const context = { scalar() { return unsafe; }, geometry() { return unsafe; } };
  rejected(() => matrix.evaluateMatrixArrayConstruction(resolver === "scalar" ? "matrix_array" : "matrix_transpose", resolver === "scalar" ? { ...matrixInput(), entries: [["q"]] } : { matrix: "A", origin: [0, 0], displayScale: 1 }, context), `${resolver}: raw returned accessor rejects`);
  check(reads === 0, `${resolver}: returned getter never executes`);
}
let missingCalls = 0;
const capture = captureMathSourceData({}, { scalar(id) { missingCalls++; return id === "a" ? undefined : 1; } });
check(capture.sources.scalar("a") === undefined && capture.sources.scalar("a") === undefined, "undefined missing sources are cached, not resolved repeatedly");
check(missingCalls === 1, "undefined source callback runs once");
let cyclicCalls = 0;
rejected(() => progression.evaluateIndexedProgressionConstruction("indexed_progression", { ...progressionInput(), first: "q" }, { scalar() { cyclicCalls++; return { value: "q", unit: "1" }; } }), "named source alias cycle retains existing decline");
check(cyclicCalls === 1, "cyclic alias is not repeatedly resolved");

const p = progression.evaluateIndexedProgressionConstruction("indexed_progression", progressionInput(), scalarContext)[0]!;
for (const family of ["matrix", "progression"] as const) {
  let reads = 0;
  const geometry = structuredClone(family === "matrix" ? a : p);
  Object.defineProperty(geometry, "kind", { enumerable: true, get() { reads++; return family === "matrix" ? "matrix_array" : "indexed_progression"; } });
  rejected(() => family === "matrix" ? matrix.matrixArrayPrimitives(geometry as correctedMatrix.MatrixArrayGeometry, "m", "g") : progression.indexedProgressionPrimitives(geometry as correctedProgression.IndexedProgressionGeometry, "p", "g"), `${family}: render entry snapshots geometry before reads`);
  check(reads === 0, `${family}: render getter never executes`);
}

function document(): SceneDocument {
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "numeric input data control" }, source: {}, quantities: [{ id: "q", value: 1, unit: "1" }],
    entities: [{ id: "p", kind: "indexed_progression", role: "indexed terms" }], constructions: [{ id: "make-p", operator: "indexed_progression", inputs: { ...progressionInput(), first: "q" }, outputs: ["p"] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ["p"], revealGroups: [{ id: "g", entityIds: ["p"], dependsOn: [], narrationCue: "terms" }], teachingTimeline: [], };
}
const doc = document();
let reads = 0;
Object.defineProperty(doc.quantities[0]!, "value", { enumerable: true, get() { reads++; return 1; } });
const issues: SceneIssue[] = [];
progression.validateIndexedProgressionConstruction(doc.constructions[0]!, 0, doc, issues);
check(reads === 0 && issues.some((issue) => issue.code === "invalid_math_source_data"), "validator snapshots nested quantity source before any read");
const matrixDoc = document();
matrixDoc.entities[0]!.kind = "matrix_array";
matrixDoc.constructions[0]!.operator = "matrix_array";
matrixDoc.constructions[0]!.inputs = { ...matrixInput(), entries: [["q"]] };
reads = 0;
Object.defineProperty(matrixDoc.constructions[0]!, "operator", { enumerable: true, get() { reads++; return "matrix_array"; } });
const matrixIssues: SceneIssue[] = [];
matrix.validateMatrixArrayConstruction(matrixDoc.constructions[0]!, 0, matrixDoc, new Map(), matrixIssues);
check(reads === 0 && matrixIssues.some((issue) => issue.code === "invalid_math_source_data"), "matrix validator snapshots construction before operator reads");
const producerDoc = document();
producerDoc.entities = [{ id: "A", kind: "matrix_array", role: "matrix" }, { id: "T", kind: "matrix_array", role: "transpose" }];
producerDoc.constructions = [{ id: "make-A", operator: "matrix_array", inputs: matrixInput(), outputs: ["A"] }, { id: "make-T", operator: "matrix_transpose", inputs: { matrix: "A", origin: [0, 0], displayScale: 1 }, outputs: ["T"] }];
const unsafeProducer = { ...producerDoc.constructions[0]! };
reads = 0;
Object.defineProperty(unsafeProducer, "operator", { enumerable: true, get() { reads++; return "matrix_array"; } });
const producerIssues: SceneIssue[] = [];
matrix.validateMatrixArrayConstruction(producerDoc.constructions[1]!, 1, producerDoc, new Map([["A", unsafeProducer]]), producerIssues);
check(reads === 0 && producerIssues.some((issue) => issue.severity === "fatal"), "dependency-map producer data is captured before replay field reads");

if (referenceIndex >= 0) {
  const root = process.argv[referenceIndex + 1]!;
  const originalMatrix: typeof correctedMatrix = await import(pathToFileURL(join(root, "packages/scene-engine/src/compile/matrixArrayGeometry.ts")).href);
  const originalProgression: typeof correctedProgression = await import(pathToFileURL(join(root, "packages/scene-engine/src/compile/indexedProgressionGeometry.ts")).href);
  for (let index = 0; index < 40; index++) {
    const input = { ...matrixInput(), entries: [[index - 20, -2], [3, index % 7]], origin: [index, -index], displayScale: 1 + index % 4 };
    const before = originalMatrix.evaluateMatrixArrayConstruction("matrix_array", input, matrixContext)[0]!;
    const after = matrix.evaluateMatrixArrayConstruction("matrix_array", input, matrixContext)[0]!;
    equal(after, before, `matrix${index}: complete supported output JSON parity`);
    equal(matrix.matrixArrayPrimitives(after, "M", "g"), originalMatrix.matrixArrayPrimitives(before, "M", "g"), `matrix${index}: exact primitive/label JSON parity`);
    const kind = index % 2 ? "geometric" : "arithmetic";
    const pInput = { ...progressionInput(), kind, first: index - 20, difference: kind === "arithmetic" ? -3 : undefined, ratio: kind === "geometric" ? -2 : undefined, indices: [1, 2, 3, 4], origin: [index, -index], displayScale: 1 + index % 4 };
    const pBefore = originalProgression.evaluateIndexedProgressionConstruction("indexed_progression", pInput, scalarContext)[0]!;
    const pAfter = progression.evaluateIndexedProgressionConstruction("indexed_progression", pInput, scalarContext)[0]!;
    equal(pAfter, pBefore, `progression${index}: complete supported output JSON parity`);
    equal(progression.indexedProgressionPrimitives(pAfter, "P", "g"), originalProgression.indexedProgressionPrimitives(pBefore, "P", "g"), `progression${index}: exact primitive/label JSON parity`);
  }
}

console.log(`mathematical source DATA boundary passed (${checks} descriptor/alias/mutation/resolver controls); arithmetic and full source/lifecycle acceptance remain separate`);
