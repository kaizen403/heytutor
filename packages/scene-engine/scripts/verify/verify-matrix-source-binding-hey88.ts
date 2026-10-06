import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import type { SceneConstruction, SceneDocument } from "../../src/types";
import * as sourceEngine from "../../src/index";

const engine: typeof sourceEngine = process.argv[2] ? await import(pathToFileURL(process.argv[2]).href) : sourceEngine;
let checks = 0;
function check(condition: unknown, message: string): void { checks++; assert.ok(condition, message); }
function array(id: string, entries: unknown, claimedType?: string): SceneConstruction {
  return { id: `make_${id}`, operator: "matrix_array", inputs: { entries, origin: [0, 0], displayScale: 1, ...(claimedType ? { claimedType } : {}) }, outputs: [id] };
}
function operation(id: string, operator: string, inputs: Record<string, unknown>): SceneConstruction {
  return { id: `make_${id}`, operator, inputs: { ...inputs, origin: [0, 0], displayScale: 1 }, outputs: [id] };
}
function document(question: string | undefined, constructions: SceneConstruction[], labels: Record<string, string> = {}): SceneDocument {
  const ids = constructions.map((construction) => construction.outputs[0]!);
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source matrix admission control" },
    source: question === undefined ? {} : { question, representationTier: "exact_verified", nonMetric: false }, quantities: [],
    entities: ids.map((id) => ({ id, kind: "matrix_array", role: "matrix source or result", label: labels[id] ?? id })),
    constructions, relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "matrix_group", entityIds: ids, dependsOn: [], narrationCue: "source matrices" }], teachingTimeline: [],
  };
}
function verdict(doc: SceneDocument, expected: boolean, name: string): void {
  const source = engine.validateMatrixSourceBinding(doc);
  const structural = engine.validateSceneDocument(doc);
  const compiled = engine.compileSceneDocument(doc);
  check(compiled.ok === expected, `${name}: compile ${expected ? "accept" : "reject"}: ${JSON.stringify(compiled.report.issues)}`);
  check(structural.report.valid === expected, `${name}: structural verdict`);
  if (expected) {
    check(source.length === 0, `${name}: source proof`);
    check(compiled.renderScene !== null && compiled.renderScene.primitives.length > 0, `${name}: actual public emitted primitives`);
    const cells = compiled.renderScene!.primitives.filter((primitive) => primitive.provenance?.matrixCell);
    check(cells.length > 0 && cells.every((primitive) => primitive.provenance?.matrixNonmetric === true), `${name}: nonmetric exact source cells`);
  } else check(compiled.renderScene === null, `${name}: atomic no-scene rejection`);
}
const A = [[1, 2], [3, 4]];
const q = "The square matrix A has 2 rows and 2 columns, with A=[[1,2],[3,4]]. Show A and state its type.";
const givens = [
  { id: "rowsA", value: 2 }, { id: "colsA", value: 2 }, { id: "a11", value: 1 },
  { id: "a12", value: 2 }, { id: "a21", value: 3 }, { id: "a22", value: 4 },
].map((quantity) => ({ ...quantity, unit: "dimensionless" }));
const original = document(q, [array("A", A, "square")]);
original.quantities = givens;
for (const tier of ["exact_verified", "question_representation", "qualitative_verified"]) {
  for (const nonMetric of [false, true]) {
    const valid = structuredClone(original);
    valid.source.representationTier = tier;
    valid.source.nonMetric = nonMetric;
    verdict(valid, true, `${tier}/${nonMetric}: literal`);
    const references = structuredClone(valid);
    references.constructions[0]!.inputs.entries = [["a11", "a12"], ["a21", "a22"]];
    verdict(references, true, `${tier}/${nonMetric}: position references`);
    for (const [name, entries, type] of [
      ["wrong-entry", [[9, 2], [3, 4]], "square"],
      ["wrong-column-shape-and-type", [[1, 2, 5], [3, 4, 6]], "rectangular"],
      ["wrong-row-shape-and-type", [[1, 2]], "row"],
      ["false-local-type", A, "diagonal"],
    ] as const) {
      const invalid = structuredClone(valid);
      invalid.constructions[0]!.inputs.entries = entries;
      invalid.constructions[0]!.inputs.claimedType = type;
      verdict(invalid, false, `${tier}/${nonMetric}: ${name}`);
    }
    const wrongQuantity = structuredClone(valid);
    wrongQuantity.quantities[2]!.value = 9;
    verdict(wrongQuantity, false, `${tier}/${nonMetric}: contradictory unused source-role declaration`);
    const wrongQuestion = structuredClone(valid);
    wrongQuestion.source.question = q.replace("[1,2]", "[8,2]");
    verdict(wrongQuestion, false, `${tier}/${nonMetric}: changed source question`);
  }
}
for (const [name, entries, type] of [
  ["rectangular", [[1, 2, 3], [4, 5, 6]], "rectangular"], ["row", [[1, 2, 3]], "row"],
  ["column", [[1], [2], [3]], "column"], ["zero", [[0, 0], [0, 0]], "zero"],
  ["identity", [[1, 0], [0, 1]], "identity"], ["diagonal", [[2, 0], [0, -3]], "diagonal"],
  ["symmetric", [[1, 2], [2, 3]], "symmetric"], ["skew_symmetric", [[0, 2], [-2, 0]], "skew_symmetric"],
] as const) verdict(document(`A=${JSON.stringify(entries)}. Show A and state its type.`, [array("A", entries, type)]), true, `type-${name}`);
for (const question of ["A=[[1,2],[3,4]]. Is A diagonal?", "A=[[1,2],[3,4]]. Determine whether A is symmetric?", "A=[[1,2],[3,4]]. A is diagonal?"]) {
  verdict(document(question, [array("A", A)]), true, "type question is not an affirmative claim");
}
for (const question of [
  "A=[[1,2],[3,4]]. A is diagonal.", "The diagonal matrix A=[[1,2],[3,4]]. Show A.",
  "A has 2 rows and 3 columns, A=[[1,2],[3,4]]. Show A.",
  "A=[[1,2],[3,4]]. Show A inverse.", "If A=[[1,2],[3,4]], show A.",
  "A=[[1,2],[3,4]] or A=[[9,2],[3,4]]. Show A.", "A=[[1,2],[3,4]]. Show A^2.",
  "A=[[1,x],[3,4]]. Show A.", "A=[[1,2],[3,4]]. Show determinant A.",
  "A=[[1,2],[3,4]]. Show product A.", "A=[[1,2],[3,4]]. Show A, not A.",
]) verdict(document(question, [array("A", A)]), false, `unsupported/contradictory source ${question}`);
for (const entries of [
  [[{ value: "1.00", unit: "1" }, { value: "2e0", unit: "dimensionless" }], ["3", "+4.0"]],
  [[{ value: "a11", unit: "unitless" }, "a12"], ["a21", { value: { value: "a22", unit: "scalar" }, unit: "dimensionless" }]],
]) {
  const doc = structuredClone(original);
  doc.constructions[0]!.inputs.entries = entries;
  verdict(doc, true, "literal/reference nested wrappers retain source decimal authority");
}
for (const mutate of [
  (doc: SceneDocument) => { doc.constructions[0]!.inputs.entries = [["a12", "a11"], ["a21", "a22"]]; },
  (doc: SceneDocument) => { doc.quantities[2]!.symbol = "a12"; },
  (doc: SceneDocument) => { doc.entities[0]!.label = "Z"; },
  (doc: SceneDocument) => { doc.entities[0]!.id = "B"; doc.entities[0]!.label = "B"; doc.constructions[0]!.outputs = ["B"]; doc.requiredEntityIds = ["B"]; doc.revealGroups[0]!.entityIds = ["B"]; },
  (doc: SceneDocument) => { doc.quantities[2]!.unit = "m"; },
]) { const doc = structuredClone(original); mutate(doc); verdict(doc, false, "source quantity/reference/identity ownership mutation"); }
const repeated = document("A=[[1,1],[3,4]]. Show A.", [array("A", [["a12", "a11"], [3, 4]])]);
repeated.quantities = [{ id: "a11", value: 1, unit: "dimensionless" }, { id: "a12", value: 1, unit: "dimensionless" }];
verdict(repeated, false, "equal-valued references cannot swap source cell roles");
for (const syntax of [
  "A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}. Show A.",
  "A=\\left[\\begin{array}{rr}1&2\\\\3&4\\end{array}\\right]. Show A.",
  "A=\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}. Show A.",
]) verdict(document(syntax, [array("A", A)]), true, "native LaTeX matrix notation");
const precise = "0.12345678901234567890123456789";
verdict(document(`A=[[${precise},1e-300]]. Show A.`, [array("A", [[precise, "1e-300"]])]), true, "exact long/tiny source decimals");
verdict(document(`A=[[${precise}]]. Show A.`, [array("A", [[Number(precise)]])]), false, "binary rounding is not exact source authority");
const B = [[5, 6], [7, 8]];
const bases = (): SceneConstruction[] => [array("A", A), array("B", B)];
for (const [request, op, inputs, label] of [
  ["A+B", "matrix_add", { left: "A", right: "B" }, "A+B"],
  ["AB", "matrix_product", { left: "A", right: "B" }, "AB"],
  ["BA", "matrix_product", { left: "B", right: "A" }, "BA"],
  ["2A", "matrix_scale", { matrix: "A", scalar: 2 }, "2A"],
  ["A^T", "matrix_transpose", { matrix: "A" }, "A^T"],
] as const) {
  const question = `A=[[1,2],[3,4]], B=[[5,6],[7,8]]. Find ${request}.`;
  verdict(document(question, [...bases(), operation("result", op, inputs)], { result: label }), true, `source ordered expression ${request}`);
  const changed = document(question, [...bases(), operation("result", op, { ...inputs, ...(op === "matrix_add" || op === "matrix_product" ? { left: inputs.right, right: inputs.left } : op === "matrix_scale" ? { scalar: 3 } : { matrix: "B" }) })], { result: label });
  verdict(changed, false, `wrong operand/order/scalar/transpose ${request}`);
}
verdict(document("A=[[1,2],[3,4]], B=[[5,6],[7,8]]. C=A+B. Show C.", [...bases(), operation("C", "matrix_add", { left: "A", right: "B" })]), true, "named result source identity");
verdict(document("A=[[1,2],[3,4]], k=2. Find kA.", [array("A", A), operation("result", "matrix_scale", { matrix: "A", scalar: 2 })], { result: "2A" }), true, "declared scalar adjacency retains its role");
const scale = document("A=[[1,2],[3,4]], k=2. Find k*A.", [array("A", A), operation("result", "matrix_scale", { matrix: "A", scalar: "k" })], { result: "k*A" });
scale.quantities = [{ id: "k", value: 2, unit: "dimensionless" }];
verdict(scale, true, "declared scalar reference role");
const wrongScalar = structuredClone(scale); wrongScalar.quantities[0]!.value = 3;
verdict(wrongScalar, false, "wrong declared scalar value");
verdict(document("A=[[1,2,3],[4,5,6]], B=[[1,2],[3,4],[5,6]]. Find AB.", [array("A", [[1,2,3],[4,5,6]]), array("B", [[1,2],[3,4],[5,6]]), operation("result", "matrix_product", { left: "A", right: "B" })], { result: "AB" }), true, "rectangular source product");
verdict(document("A=[[1,2,3],[4,5,6]]. Find A^T.", [array("A", [[1,2,3],[4,5,6]]), operation("result", "matrix_transpose", { matrix: "A" })], { result: "A^T" }), true, "rectangular source transpose");
verdict(document("A=[[1,2,3],[4,5,6]], B=[[1,2],[3,4]]. Find AB.", [array("A", [[1,2,3],[4,5,6]]), array("B", B), operation("result", "matrix_product", { left: "A", right: "B" })], { result: "AB" }), false, "incompatible source product atomically declines");
verdict(document("A=[[1,2],[3,4]], B=[[5,6],[7,8]]. Find AB.", bases()), false, "missing requested operation is not a complete source witness");
const standalone = document(undefined, [array("A", A)]);
verdict(standalone, true, "source-less standalone local operator gate");
for (const source of [{ question: "" }, { representationTier: "question_representation", nonMetric: true }, { question: "unmatched source" }]) {
  const doc = structuredClone(standalone); doc.source = source; verdict(doc, false, "no source-bearing bypass");
}
check(engine.validateMatrixSourceBinding(original, q).length === 0, "independent authoritative question same checker");
check(engine.validateMatrixSourceBinding(original, q.replace("[1,2]", "[8,2]")).some((issue) => issue.code === "matrix_source_question_mismatch"), "independent authoritative question mismatch");
check(engine.validateMatrixSourceBinding(standalone, q).length === 0, "external source binds standalone inputs without stored metadata");
const accessor = structuredClone(original);
let getterCalls = 0;
Object.defineProperty(accessor.source, "question", { get() { getterCalls++; return q; }, enumerable: true });
check(engine.validateMatrixSourceBinding(accessor).length > 0 && getterCalls === 0, "source accessor rejected without execution");
const plan = { schemaVersion: "turn-plan/v3", question: q, givens: givens.map((quantity) => ({ ...quantity, symbol: quantity.id, provenance: "given", sourceText: q })), derived: [], qualitativeClaims: [{ claim: "A is a square matrix with 2 rows and 2 columns", expected: true }] };
check(engine.validateMatrixSourceBinding(original, q, plan).length === 0, "valid plan source role and type proof");
check(engine.validateMatrixSourceBinding(original, q, null).length === 0, "PlanNull never bypasses actual source binding");
const fabricated = structuredClone(plan); fabricated.givens[2]!.value = 9; fabricated.givens[2]!.sourceText = "a11=9";
check(engine.validateMatrixSourceBinding(original, q, fabricated).length > 0, "fabricated plan value/sourceText rejects");
const falseQuote = structuredClone(plan); falseQuote.givens[2]!.sourceText = "The statement A=[[1,2],[3,4]] is false.";
check(engine.validateMatrixSourceBinding(original, q, falseQuote).length > 0, "false plan quote rejects");
const falseType = structuredClone(plan); falseType.qualitativeClaims[0]!.claim = "A is a diagonal matrix";
check(engine.validateMatrixSourceBinding(original, q, falseType).length > 0, "false source type plan claim rejects");
for (const suffix of [" Instead show 2A, not A.", " Replace a11 with 9 before showing A.", " The statement is false."]) {
  const doc = structuredClone(original); doc.source.question = q + suffix; verdict(doc, false, "whole source suffix/task mutation");
}
const quoted = structuredClone(original); quoted.source.question = `The statement "${q}" is false.`;
verdict(quoted, false, "full false source quotation");
const arbitraryIds = document(q, [array("A", [["quantity1", "quantity2"], ["quantity3", "quantity4"]])]);
arbitraryIds.quantities = [1, 2, 3, 4].map((value, index) => ({ id: `quantity${index + 1}`, symbol: `a${Math.floor(index / 2) + 1}${index % 2 + 1}`, value, unit: "dimensionless" }));
verdict(arbitraryIds, true, "arbitrary quantity ids with complete source cell symbol roles");
const missingRoles = structuredClone(arbitraryIds); for (const quantity of missingRoles.quantities) delete quantity.symbol;
verdict(missingRoles, false, "arbitrary quantity ids without source position proof decline");
for (const question of ["A=[[1/2]]. Show A.", "A=[[1e7]]. Show A.", "A=[[1],[2],[3],[4],[5],[6],[7]]. Show A.", "A=[[i]]. Show A.", "A=[[sqrt(2)]]. Show A."]) verdict(document(question, [array("A", [[1]])]), false, "unsupported source arithmetic domain/bounds remain visible");
const query = document("A=[[1,2],[3,4]]. Is A diagonal?", [array("A", A)]);
const queryPlan = { ...plan, question: query.source.question, givens: [], qualitativeClaims: [{ claim: "A is a diagonal matrix", expected: false }] };
check(engine.validateMatrixSourceBinding(query, query.source.question, queryPlan).length === 0, "query negative type answer is source proved");
if (process.argv[3]) {
  const native = JSON.parse(readFileSync(process.argv[3], "utf8")) as { results: Array<{ id: string; document: SceneDocument }> };
  for (const sample of native.results) verdict(sample.document, false, `whole native source obligations honestly decline: ${sample.id}`);
}
console.log(`HEY88 matrix source binding passed (${checks} source, structural, atomic public compile and nonmetric emitted-cell checks); no bank cohort/storage/render/replay/topic acceptance claimed`);
