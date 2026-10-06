import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateMatrixArrayConstruction, matrixArrayPrimitives, validateMatrixArrayConstruction, type MatrixArrayEvaluationContext, type MatrixArrayGeometry, type MatrixArrayType } from "../../src/compile/matrixArrayGeometry";
import type { RenderPrimitive, RenderScene, SceneConstruction, SceneDocument, SceneIssue } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";

let checks = 0;
function check(condition: unknown, message: string): asserts condition {
  checks++;
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function rejects(run: () => unknown, message: string): void {
  let threw = false;
  try { run(); } catch { threw = true; }
  check(threw, message);
}
const geometries = new Map<string, unknown>();
const quantities = new Map<string, unknown>([["tenth", { value: "0.1", unit: "dimensionless" }], ["two", 2], ["cycle", { value: "cycle" }]]);
const context: MatrixArrayEvaluationContext = {
  scalar(id) { if (!quantities.has(id)) throw new Error("missing quantity"); return quantities.get(id); },
  geometry(id) { return geometries.get(id); },
};
function construct(id: string, operator: string, inputs: Record<string, unknown>): MatrixArrayGeometry {
  const outputs = evaluateMatrixArrayConstruction(operator, { origin: [0, 0], displayScale: 1, ...inputs }, context);
  check(outputs.length === 1 && outputs[0]!.kind === "matrix_array", `${id}: one nonmetric array output`);
  geometries.set(id, outputs[0]);
  return outputs[0]!;
}
function array(id: string, entries: unknown, claimedType?: MatrixArrayType): MatrixArrayGeometry {
  return construct(id, "matrix_array", { entries, ...(claimedType ? { claimedType } : {}) });
}
function entryOracle(actual: MatrixArrayGeometry, expected: number[][], id: string): void {
  equal(actual.matrixArray.entries, expected, `${id}: independent numeric entries`);
  equal([actual.matrixArray.rows, actual.matrixArray.columns], [expected.length, expected[0]!.length], `${id}: dimensions`);
  for (let i = 0; i < expected.length; i++) for (let j = 0; j < expected[i]!.length; j++) {
    const exact = actual.matrixArray.exactEntries[i]![j]!;
    check(BigInt(exact.numerator) === BigInt(expected[i]![j]!) * BigInt(exact.denominator), `${id}: exact integer entry ${i},${j}`);
  }
}
function productOracle(a: number[][], b: number[][]): number[][] {
  const result = Array.from({ length: a.length }, () => Array(b[0]!.length).fill(0n) as bigint[]);
  for (let k = 0; k < b.length; k++) {
    for (let i = 0; i < a.length; i++) for (let j = 0; j < b[0]!.length; j++) result[i]![j] += BigInt(a[i]![k]!) * BigInt(b[k]![j]!);
  }
  return result.map((row) => row.map(Number));
}

if (process.argv.includes("--holdout")) {
  let state = 0x14a84;
  const next = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const m = 1 + next() % 6;
    const n = 1 + next() % 6;
    const p = 1 + next() % 6;
    const a = Array.from({ length: m }, () => Array.from({ length: n }, () => (next() % 81) - 40));
    const b = Array.from({ length: n }, () => Array.from({ length: p }, () => (next() % 81) - 40));
    array("ha", a);
    array("hb", b);
    const product = construct("hp", "matrix_product", { left: "ha", right: "hb", origin: [-caseIndex, caseIndex], displayScale: 0.25 + next() % 8 });
    entryOracle(product, productOracle(a, b), `synthetic-holdout-${caseIndex}`);
    const transposed = construct("ht", "matrix_transpose", { matrix: "hp" });
    entryOracle(transposed, productOracle(a, b)[0]!.map((_, j) => productOracle(a, b).map((row) => row[j]!)), `synthetic-holdout-transpose-${caseIndex}`);
    const factor = (next() % 7) - 3;
    entryOracle(construct("hs", "matrix_scale", { matrix: "hp", scalar: factor }), productOracle(a, b).map((row) => row.map((entry) => entry * factor)), `synthetic-holdout-scale-${caseIndex}`);
    rejects(() => construct("hm", "matrix_array", { entries: [[1, 2], [2, 1]], claimedType: "skew_symmetric" }), `synthetic-holdout-${caseIndex}: false skew claim`);
  }
  console.log(`matrix-array synthetic local holdout passed (100 cases, ${checks} checks); not a bank-question cohort`);
} else {
  const examples: Array<{ id: string; entries: number[][]; types: MatrixArrayType[] }> = [
    { id: "rect", entries: [[1, 2, 3], [4, 5, 6]], types: ["rectangular"] },
    { id: "row", entries: [[0, -2, 3]], types: ["rectangular", "row"] },
    { id: "column", entries: [[-1], [2], [0]], types: ["rectangular", "column"] },
    { id: "one", entries: [[1]], types: ["square", "row", "column", "identity", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"] },
    { id: "zero", entries: [[0, 0], [0, 0]], types: ["square", "zero", "diagonal", "symmetric", "skew_symmetric", "scalar", "upper_triangular", "lower_triangular"] },
    { id: "identity", entries: [[1, 0], [0, 1]], types: ["square", "identity", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"] },
    { id: "diagonal", entries: [[2, 0], [0, -3]], types: ["square", "diagonal", "symmetric", "upper_triangular", "lower_triangular"] },
    // Scalar: diagonal with one repeated diagonal value. Triangular: square with zeros strictly below (upper) or above (lower) the diagonal.
    { id: "scalar", entries: [[5, 0, 0], [0, 5, 0], [0, 0, 5]], types: ["square", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"] },
    { id: "upper", entries: [[1, 2, 3], [0, 4, 5], [0, 0, 6]], types: ["square", "upper_triangular"] },
    { id: "lower", entries: [[1, 0], [7, 3]], types: ["square", "lower_triangular"] },
    { id: "rect-staircase", entries: [[1, 2, 3], [0, 4, 5]], types: ["rectangular"] },
    { id: "symmetric", entries: [[1, -3], [-3, 2]], types: ["square", "symmetric"] },
    { id: "skew", entries: [[0, 4], [-4, 0]], types: ["square", "skew_symmetric"] },
    { id: "singular", entries: [[1, 2], [2, 4]], types: ["square", "symmetric"] },
  ];
  for (const example of examples) {
    const geometry = array(example.id, example.entries);
    equal(geometry.matrixArray.types, example.types, `${example.id}: independently defined entry conditions`);
    entryOracle(geometry, example.entries, example.id);
    const marks = matrixArrayPrimitives(geometry, example.id, "array");
    check(marks.length === 2 + example.entries.flat().length && marks.filter((mark) => mark.kind === "polyline").length === 2, `${example.id}: both brackets and every cell`);
    check(marks.every((mark) => mark.provenance?.matrixNonmetric === true && mark.entityId === example.id && mark.groupId === "array"), `${example.id}: scene-owned nonmetric reveal marks`);
  }
  const literal = array("literal", [["tenth", ".2", { value: "3e-1", unit: "1" }], [-0, "+4.0", "-2e2"]]);
  equal(literal.matrixArray.entries, [[0.1, 0.2, 0.3], [0, 4, -200]], "literal and quantity real entries");
  equal(literal.matrixArray.exactEntries[0], [{ numerator: "1", denominator: "10" }, { numerator: "1", denominator: "5" }, { numerator: "3", denominator: "10" }], "literal decimals preserve exact source values");
  array("tenth-array", [["tenth"]]);
  array("fifth-array", [[".2"]]);
  equal(construct("decimal-sum", "matrix_add", { left: "tenth-array", right: "fifth-array" }).matrixArray.exactEntries, [[{ numerator: "3", denominator: "10" }]], "0.1+0.2 is exact3/10, not a rounded binary sum");
  equal(construct("decimal-scale", "matrix_scale", { matrix: "literal", scalar: "two" }).matrixArray.exactEntries[0], [{ numerator: "1", denominator: "5" }, { numerator: "2", denominator: "5" }, { numerator: "3", denominator: "5" }], "declared scalar source preserves exact products");
  array("tiny", [["1e-300"]]);
  array("subnormal", [["5e-324"]]);
  equal(matrixArrayPrimitives(geometries.get("tiny") as MatrixArrayGeometry, "tiny", "tiny").find((mark) => mark.kind === "label")!.text, "1e-300", "small source remains nonzero and explicitly labelled");
  const precise = array("precise", [["0.12345678901234567890123456789"]]);
  const rounded = matrixArrayPrimitives(precise, "precise", "precise").find((mark) => mark.kind === "label")!;
  check(rounded.text!.startsWith("≈") && (rounded.provenance!.matrixCell as { displayAccuracy: string }).displayAccuracy === "rounded", "long label approximation is visible and typed, exact authority remains separate");
  equal(rounded.text, "≈1.23457e-1", "long label is rounded from exact decimal authority");
  equal(precise.matrixArray.exactEntries[0]![0], { numerator: "12345678901234567890123456789", denominator: "100000000000000000000000000000" }, "long decimal source does not silently round into authority");
  for (const [value, expected] of [["999999.999999999999", "≈1e6"], ["-0.0000012345678912345", "≈-1.23457e-6"], ["5.123456789123456e-324", "≈5.12346e-324"]]) {
    const geometry = array("rounded-case", [[value]]);
    equal(matrixArrayPrimitives(geometry, "rounded-case", "rounded").find((mark) => mark.kind === "label")!.text, expected, `source-bound decimal rounding ${value}`);
  }

  array("A", [[1, 2], [0, 1]]);
  array("B", [[1, 0], [3, 1]]);
  const ab = construct("AB", "matrix_product", { left: "A", right: "B" });
  const ba = construct("BA", "matrix_product", { left: "B", right: "A" });
  entryOracle(ab, [[7, 2], [3, 1]], "AB explicit witness");
  entryOracle(ba, [[1, 2], [3, 7]], "BA explicit witness");
  check(JSON.stringify(ab.matrixArray.entries) !== JSON.stringify(ba.matrixArray.entries), "AB need not equalBA");
  for (let m = 1; m <= 6; m++) for (let n = 1; n <= 6; n++) {
    const a = Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => i - 2 * j));
    const b = Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => 2 * i + j - 3));
    array("a", a);
    array("b", b);
    const zero = array("shape-zero", Array.from({ length: m }, () => Array(n).fill(0)), "zero");
    check(zero.matrixArray.types.includes("zero") && zero.matrixArray.types.includes(m === n ? "square" : "rectangular"), `zero-shape-${m}x${n}`);
    array("identity-left", Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => Number(i === j))), "identity");
    array("identity-right", Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Number(i === j))), "identity");
    entryOracle(construct("identity-left-result", "matrix_product", { left: "identity-left", right: "a" }), a, `left-identity-${m}x${n}`);
    entryOracle(construct("identity-right-result", "matrix_product", { left: "a", right: "identity-right" }), a, `right-identity-${m}x${n}`);
    entryOracle(construct("sum", "matrix_add", { left: "a", right: "b" }), a.map((row, i) => row.map((value, j) => value + b[i]![j]!)), `sum-${m}x${n}`);
    const transpose = construct("transpose", "matrix_transpose", { matrix: "a" });
    entryOracle(transpose, a[0]!.map((_, j) => a.map((row) => row[j]!)), `transpose-${m}x${n}`);
    entryOracle(construct("involution", "matrix_transpose", { matrix: "transpose" }), a, `transpose-involution-${m}x${n}`);
    for (const factor of [-3, 0, 2]) entryOracle(construct("scale", "matrix_scale", { matrix: "a", scalar: factor }), a.map((row) => row.map((value) => value * factor)), `scale-${m}x${n}-${factor}`);
    for (let p = 1; p <= 6; p++) {
      const right = Array.from({ length: n }, (_, k) => Array.from({ length: p }, (_, j) => k + j - 2));
      array("right", right);
      const product = construct("product", "matrix_product", { left: "a", right: "right", origin: [-5, 7], displayScale: p / 3 });
      entryOracle(product, productOracle(a, right), `product-${m}x${n}x${p}`);
      construct("productT", "matrix_transpose", { matrix: "product" });
      construct("rightT", "matrix_transpose", { matrix: "right" });
      equal(construct("transposedProduct", "matrix_product", { left: "rightT", right: "transpose" }).matrixArray.exactEntries, (geometries.get("productT") as MatrixArrayGeometry).matrixArray.exactEntries, `transpose-product-order-${m}x${n}x${p}`);
    }
    if (m === n) {
      construct("negT", "matrix_scale", { matrix: "transpose", scalar: -1 });
      check(construct("sym", "matrix_add", { left: "a", right: "transpose", claimedType: "symmetric" }).matrixArray.types.includes("symmetric"), `A+AT symmetric-${m}`);
      check(construct("skewSum", "matrix_add", { left: "a", right: "negT", claimedType: "skew_symmetric" }).matrixArray.types.includes("skew_symmetric"), `A-AT skew-${m}`);
    }
  }
  array("upper-bound", [[1e6, -1e6]]);
  entryOracle(construct("bound-scale", "matrix_scale", { matrix: "upper-bound", scalar: -1 }), [[-1e6, 1e6]], "closed magnitude boundary");
  const safeInputs = { entries: [[1, 2], [3, 4]], origin: [0, 0], displayScale: 1 };
  const invalidEntries: unknown[] = [[], [[]], [[1], [2, 3]], Array(2), [Array(2)], [[null]], [[true]], [[{}]], [[NaN]], [[Infinity]], [[1e6 + 1]], [["1e-400"]], [["1e10000"]], [["cycle"]], [[{ value: 1, unit: "m" }]], [[{ value: 1, hidden: true }]], Array.from({ length: 7 }, () => [1]), [Array(7).fill(1)], [[{ real: 1, imaginary: 2 }]]];
  for (const [i, entries] of invalidEntries.entries()) rejects(() => evaluateMatrixArrayConstruction("matrix_array", { ...safeInputs, entries }, context), `invalid-entries-${i}: fail closed`);
  for (const mutation of [
    { claimedType: "diagonal" }, { claimedType: "skew_symmetric" }, { claimedType: "singular" }, { inverse: true }, { expression: "A+B" },
    { origin: [NaN, 0] }, { origin: [0] }, { origin: { x: 0, y: 0 } }, { displayScale: 0 }, { displayScale: -1 }, { displayScale: 1e-7 }, { displayScale: 1e6 + 1 },
  ]) rejects(() => evaluateMatrixArrayConstruction("matrix_array", { ...safeInputs, ...mutation }, context), `invalid-input-${JSON.stringify(mutation)}`);
  rejects(() => evaluateMatrixArrayConstruction("matrix_inverse", { matrix: "rect" }, context), "rectangular inverse is outside this operator contract");
  rejects(() => construct("bad-add", "matrix_add", { left: "rect", right: "A" }), "addition dimension mismatch");
  rejects(() => construct("bad-product", "matrix_product", { left: "rect", right: "A" }), "product inner dimension mismatch");
  rejects(() => construct("missing", "matrix_transpose", { matrix: "unknown" }), "missing matrix source");
  geometries.set("physical", { kind: "point", point: { x: 1, y: 2 }, matrixArray: ab.matrixArray });
  rejects(() => construct("flattened", "matrix_transpose", { matrix: "physical" }), "ordinary or physical geometry cannot become a matrix array");
  array("max", [[1e6]]);
  array("one-more", [[1]]);
  array("tiny-more", [["1e-20"]]);
  rejects(() => construct("overflow", "matrix_add", { left: "max", right: "one-more" }), "derived entries retain the approved magnitude bound");
  rejects(() => construct("rounded-overflow", "matrix_add", { left: "max", right: "tiny-more" }), "an exact excess above1e6 cannot round back into allowed authority");
  rejects(() => construct("underflow", "matrix_scale", { matrix: "tiny", scalar: "1e-300" }), "nonzero derived authority cannot turn into zero on display");
  quantities.set("unitful", { value: 2, unit: "kg" });
  rejects(() => construct("unitful-scale", "matrix_scale", { matrix: "A", scalar: "unitful" }), "scalar quantity units cannot be hidden through a reference");
  rejects(() => construct("missing-scale", "matrix_scale", { matrix: "A" }), "missing scale factor cannot be invented");
  rejects(() => evaluateMatrixArrayConstruction("matrix_array", { entries: [[1]], displayScale: 1 }, context), "missing placement cannot be invented");
  rejects(() => evaluateMatrixArrayConstruction("matrix_array", { entries: [[1]], origin: [0, 0] }, context), "missing display scale cannot be invented");
  for (const mutation of [
    (g: MatrixArrayGeometry) => { g.matrixArray.entries[0]![0] = 99; },
    (g: MatrixArrayGeometry) => { g.matrixArray.rows = 3; },
    (g: MatrixArrayGeometry) => { g.matrixArray.nonmetric = false as true; },
    (g: MatrixArrayGeometry) => { g.matrixArray.types = ["identity"]; },
    (g: MatrixArrayGeometry) => { g.matrixArray.exactEntries[0]![0] = { numerator: "14", denominator: "2" }; },
    (g: MatrixArrayGeometry) => { g.matrixArray.sourceIds = []; },
    (g: MatrixArrayGeometry) => { g.matrixArray.origin.x = Infinity; },
  ]) {
    const candidate = structuredClone(ab);
    mutation(candidate);
    geometries.set("mutated", candidate);
    rejects(() => construct("mutated-result", "matrix_transpose", { matrix: "mutated" }), "corrupted source metadata rejects before producing output");
  }

  function document(): SceneDocument {
    const constructions: SceneConstruction[] = [
      { id: "create-a", operator: "matrix_array", inputs: { entries: [["q", 2, 3], [-1, 0, 4]], origin: [0, 0], displayScale: 1 }, outputs: ["da"] },
      { id: "create-b", operator: "matrix_array", inputs: { entries: [[2, 0], [1, -1], [3, 2]], origin: [10, 0], displayScale: 1 }, outputs: ["db"] },
      { id: "multiply", operator: "matrix_product", inputs: { left: "da", right: "db", origin: [20, 0], displayScale: 1 }, outputs: ["dp"] },
      { id: "transpose", operator: "matrix_transpose", inputs: { matrix: "dp", origin: [30, 0], displayScale: 1 }, outputs: ["dt"] },
    ];
    const ids = constructions.flatMap((construction) => construction.outputs);
    return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source-declared matrix algebra" }, source: {},
      quantities: [{ id: "q", value: 1, unit: "dimensionless" }], entities: ids.map((id) => ({ id, kind: "matrix_array", role: "source matrix or computed array" })), constructions,
      relations: [], assertions: [], annotations: [], requiredEntityIds: ids, revealGroups: [{ id: "matrices", entityIds: ids, dependsOn: [], narrationCue: "inspect exact entries" }], teachingTimeline: [],
    };
  }
  function structural(candidate: SceneDocument): SceneIssue[] {
    const producers = new Map(candidate.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
    const issues: SceneIssue[] = [];
    candidate.constructions.forEach((construction, index) => validateMatrixArrayConstruction(construction, index, candidate, producers, issues));
    return issues;
  }
  equal(structural(document()), [], "matrix-specific validator replays a composed source document");
  for (const [caseId, mutate] of [
    ["wrong output kind", (d: SceneDocument) => { d.entities[0]!.kind = "point"; }],
    ["two outputs", (d: SceneDocument) => { d.constructions[0]!.outputs.push("extra"); }],
    ["missing reference", (d: SceneDocument) => { d.constructions[2]!.inputs.left = "missing"; }],
    ["dimension mismatch", (d: SceneDocument) => { d.constructions[1]!.inputs.entries = [[1, 2]]; }],
    ["scalar units", (d: SceneDocument) => { d.quantities[0]!.unit = "m"; }],
    ["quantity cycle", (d: SceneDocument) => { d.quantities[0]!.value = "q"; }],
    ["ambiguous quantity", (d: SceneDocument) => { d.quantities.push({ id: "q", value: 2, unit: "1" }); }],
    ["duplicate producer", (d: SceneDocument) => { d.constructions.push(structuredClone(d.constructions[0]!)); }],
    ["dependency cycle", (d: SceneDocument) => { d.constructions[0]!.operator = "matrix_transpose"; d.constructions[0]!.inputs = { matrix: "dt", origin: [0, 0], displayScale: 1 }; }],
    ["false diagonal claim", (d: SceneDocument) => { d.constructions[2]!.inputs.claimedType = "diagonal"; }],
  ] as const) {
    const candidate = document();
    mutate(candidate);
    const issues = structural(candidate);
    check(issues.length > 0 && issues.every((issue) => issue.severity === "fatal"), `structural mutation: ${caseId}`);
  }
  console.log(`matrix-array operators passed (${checks} independent authority, parameter, edge, invalid and mutation checks); shared compiler registration and lifecycle pending`);

  const renderIndex = process.argv.indexOf("--render-dir");
  if (renderIndex >= 0) {
    const out = resolve(process.argv[renderIndex + 1]!);
    mkdirSync(out, { recursive: true });
    const dense = array("dense", Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i - j) * 13)));
    const densePrecision = array("dense-precision", Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => `${(i + j) % 2 ? "-" : ""}0.12345678901234567890123456789`)));
    const galleries: Array<{ id: string; title: string; matrices: MatrixArrayGeometry[] }> = [
      { id: "rectangular", title: "2×3 real array; dimensions and entries", matrices: [geometries.get("rect") as MatrixArrayGeometry] },
      { id: "noncommutative", title: "AB = [[7,2],[3,1]]; BA = [[1,2],[3,7]]", matrices: [ab, ba] },
      { id: "symmetry", title: "Symmetric and skew-symmetric arrays", matrices: [geometries.get("symmetric") as MatrixArrayGeometry, geometries.get("skew") as MatrixArrayGeometry] },
      { id: "dense", title: "6×6 dense signed entries", matrices: [dense] },
      { id: "dense-precision", title: "6×6 long signed decimals; explicit rounded labels", matrices: [densePrecision] },
      { id: "precise", title: "Exact long decimal authority; visibly rounded cell label", matrices: [precise] },
    ];
    for (const gallery of galleries) {
      const primitives: RenderPrimitive[] = [];
      gallery.matrices.forEach((geometry, index) => {
        const marks = matrixArrayPrimitives(geometry, `matrix_${index}`, "matrices");
        const points = marks.flatMap((mark) => mark.points);
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const xMin = Math.min(...xs);
        const yMin = Math.min(...ys);
        const width = Math.max(...xs) - xMin;
        const height = Math.max(...ys) - yMin;
        const panelWidth = 700 / gallery.matrices.length;
        const factor = Math.min((panelWidth - 50) / width, 400 / height, 35);
        primitives.push(...marks.map((mark) => ({ ...mark, points: mark.points.map((point) => ({ x: 420 + index * panelWidth + 25 + (point.x - xMin) * factor, y: 150 + (height - (point.y - yMin)) * factor })) })));
      });
      check(primitives.every((mark) => mark.points.every((point) => point.x >= 400 && point.x <= 1160 && point.y >= 55 && point.y <= 610)), `${gallery.id}: offline marks lie within diagram viewport`);
      const scene: RenderScene = { engineVersion: "scene-engine/2.0.0", primitives, revealGroups: [{ id: "matrices", entityIds: gallery.matrices.map((_, index) => `matrix_${index}`), dependsOn: [], narrationCue: "show exact array entries" }], timeline: [], entityBounds: {}, caption: "Offline evaluator evidence; no shared compiler or live acceptance" };
      writeFileSync(join(out, `${gallery.id}.svg`), renderSceneSvg(scene, { title: gallery.title, subtitle: "CH-14a offline evaluator — integration / live / persistence / replay pending" }));
      writeFileSync(join(out, `${gallery.id}.json`), JSON.stringify({ matrices: gallery.matrices, scene }, null, 2));
    }
    console.log(`Wrote ${galleries.length} offline matrix examples to ${out}; ${checks} total checks`);
  }
}
