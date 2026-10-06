import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProblemIR } from "../../src/ir/problemIR";
import { sectionFormulaScene, validateSectionPointSourceInputs } from "../../src/ir/sectionFormulaSource";
import { compileSceneDocument } from "../../src/compile/compiler";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import { buildMatrixSourceDocument, recoverMatrixLiteralPlanEvidence } from "../../src/compile/matrixSourceBinding";
import { prepareMatrixLiteralSourceAuthority, matrixLiteralSourceEntityIsCarried, matrixLiteralSourceDimensionIsCarried } from "../../src/ir/matrixLiteralSource";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { validateTurnPlanV3, validateTurnPlanSceneProofs } from "../../src/contracts/contractsV3";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver } from "../../src/ir/solverAuthority";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import { evaluateAnalyticLineConstruction } from "../../src/compile/analyticLineGeometry";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/w2-section-matrix/${name}.json`, import.meta.url), "utf8"));
}
const section = fixture("section-sf3-actual-full-ir") as ProblemIR;
const doc = sectionFormulaScene(section.question, section);
assert(doc, "actual four-entity SF3 must bind the entire graph");
assert(checkVisualObligations(deriveVisualObligations(section), doc).satisfied);
assert(compileSceneDocument(doc).ok);
console.log("w2-section-matrix: actual SF3 passed");
const matrixIR = fixture("matrix-case1-actual-normalized-ir") as ProblemIR;
const matrixPlan = fixture("matrix-case1-actual-plan") as TurnPlanV3;
assert.equal(prepareMatrixLiteralSourceAuthority(matrixIR.question, matrixPlan, fixture("matrix-case1-actual-raw-ir") as ProblemIR), null, "unsupported raw equations are not stripped to obtain admission");
assert.equal(buildMatrixSourceDocument(matrixIR.question, matrixPlan), null, "captured fabricated quotes still decline");
const recovered = recoverMatrixLiteralPlanEvidence(matrixIR.question, matrixPlan);
assert(recovered, "uniquely source-owned cells recover actual literal evidence");
assert.deepEqual(matrixPlan, fixture("matrix-case1-actual-plan"), "captured input is not mutated");
const prepared = prepareMatrixLiteralSourceAuthority(matrixIR.question, matrixPlan, matrixIR);
assert(prepared, "full actual matrix IR must retain every source role");
assert(validateTurnPlanV3(prepared.plan, matrixIR.question).valid, JSON.stringify(validateTurnPlanV3(prepared.plan, matrixIR.question).issues));
assert(compileSceneDocument(prepared.document).ok);
const solver = new LocalDeterministicSolverProvider();
const sectionResult = await solver.solve(section);
assert.equal(sectionResult.status, "solved");
assert.deepEqual(sectionResult.values.map((value) => value.approximate), [7, 8], "actual full-IR solver recomputes both source coordinates");
const result = await solver.solve(prepared.problemIR);
assert.equal(result.status, "solved");
assert.equal(verifyTurnPlanAgainstSolver(prepared.problemIR, result, prepared.plan, matrixIR.question).status, "verified");
const canonical = prepareMatrixLiteralSourceAuthority(matrixIR.question, matrixPlan);
assert(canonical && canonical.problemIR.entities.length === 20 && canonical.problemIR.expressions.length === 14 && canonical.problemIR.solveRequests.length === 7, "independent full source IR keeps all rows/columns/cells, order components and requested entries");
assert.equal(verifyTurnPlanAgainstSolver(canonical.problemIR, await solver.solve(canonical.problemIR), canonical.plan, matrixIR.question).status, "verified");
for (const entity of prepared.problemIR.entities) assert.equal(matrixLiteralSourceEntityIsCarried(prepared.document, prepared.problemIR, entity.id), true, entity.id);
for (const expression of prepared.problemIR.expressions.filter((expression) => expression.root.kind === "number")) {
  assert.equal(matrixLiteralSourceDimensionIsCarried(prepared.document, prepared.problemIR, expression.id, expression.root.kind === "number" ? expression.root.value : NaN, expression.evidenceFactIds), true, expression.id);
}
console.log("w2-section-matrix: actual matrix source/solver authority passed");

// Independently calculated expected results; these cases do not import old fixtures/generators.
const sectionCases = [
  { question: "Find point Q which divides the join of A(-3,7) and B(7,-8) internally in the ratio 3:2.", a: [-3, 7], b: [7, -8], p: [3, -2], m: 3, n: 2, name: "Q" },
  { question: "Find point R which divides the join of A(1,2) and B(4,5) externally in the ratio 1:2.", a: [1, 2], b: [4, 5], p: [-2, -1], m: 1, n: 2, name: "R" },
  { question: "Find the midpoint of the join of A(-2,4) and B(6,-8).", a: [-2, 4], b: [6, -8], p: [2, -2], m: 1, n: 1, name: "M" },
  { question: "In what ratio does P(4,5) divide the join of A(2,3) and B(8,9)?", a: [2, 3], b: [8, 9], p: [4, 5], m: 1, n: 2, name: "P" },
];
function sectionIR(c: typeof sectionCases[number]): ProblemIR {
  const evidence = { source: "question" as const, start: 0, end: c.question.length, quote: c.question };
  return {
    schemaVersion: "problem-ir/v1", id: "independent_section", question: c.question,
    facts: [{ id: "given", kind: "given", statement: c.question, evidence }, { id: "requested", kind: "requested", statement: c.question, evidence }],
    entities: [
      ...["A", "B", c.name].map((name) => ({ id: name, label: name, kind: "point" as const, evidenceFactIds: [name === c.name ? "requested" : "given"] })),
      { id: "source_join", kind: "line", label: "AB", evidenceFactIds: ["given"] },
    ],
    expressions: [...c.a, ...c.b].map((value, index) => ({ id: ["Ax", "Ay", "Bx", "By"][index]!, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: ["given"] })),
    constraints: [], solveRequests: [], representationIntents: [{ id: "graph", kind: "graph", entityIds: ["A", "B", c.name, "source_join"], evidenceFactIds: ["given", "requested"] }],
  };
}
for (const c of sectionCases) {
  const ir = sectionIR(c);
  const family = synthesizeFamilyScene({ question: c.question, problemIR: ir });
  assert(family && family.tier === "exact_verified", c.question);
  assert(checkVisualObligations(deriveVisualObligations(ir), family.document).satisfied);
  const readingPoint = family.document.constructions.find((construction) => construction.operator === "section_point")!;
  // Check actual emitted point geometry in world space via the construction,
  // separately from the source reader's expected result.
  const input = readingPoint.inputs;
  const t = input.mode === "midpoint" ? 0.5 : Number(input.m) / (input.mode === "external" ? Number(input.m) - Number(input.n) : Number(input.m) + Number(input.n));
  assert.deepEqual(c.a.map((a, i) => a + t * (c.b[i]! - a)), c.p);
  const geometry = evaluateAnalyticLineConstruction("section_point", { ...input, a: c.a, b: c.b }, { number(value: unknown) { return Number(value); }, point() { throw new Error("Unexpected point reference"); }, geometry() { return undefined; } })[0]!;
  assert.equal(geometry.kind, "point");
  if (geometry.kind === "point") [geometry.point.x, geometry.point.y].forEach((value, i) => assert(Math.abs(value - c.p[i]!) < 1e-12, "actual operator geometry against independent oracle"));
  const compiled = compileSceneDocument(family.document);
  assert(compiled.ok && compiled.renderScene);
  assert(compiled.renderScene.primitives.some((primitive) => primitive.entityId === readingPoint.outputs[0] && primitive.kind === "point"));
  const wrongName = structuredClone(ir);
  wrongName.entities[2]!.label = "T";
  if (c.name !== "M") assert.equal(sectionFormulaScene(c.question, wrongName), null);
  const reverse = structuredClone(family.document);
  const op = reverse.constructions.find((construction) => construction.operator === "section_point")!;
  [op.inputs.a, op.inputs.b] = [op.inputs.b, op.inputs.a];
  if (op.inputs.mode !== "midpoint") [op.inputs.m, op.inputs.n] = [op.inputs.n, op.inputs.m];
  assert.deepEqual(validateSectionPointSourceInputs(reverse, c.question), [], "reversed endpoints need reversed weights");
  if (c.m !== c.n) {
    [op.inputs.m, op.inputs.n] = [op.inputs.n, op.inputs.m];
    assert(validateSectionPointSourceInputs(reverse, c.question).some((issue) => issue.severity === "fatal"));
  }
}
const sf3Family = synthesizeFamilyScene({ question: section.question, problemIR: section });
assert(sf3Family?.tier === "exact_verified", "actual SF3 normal family route");
const line = doc.entities.find((entity) => entity.label === "AB")!;
assert.equal(line.kind, "line", "the caller's line carries external-point incidence beyond the finite endpoint interval");
assert.deepEqual(line.provenance?.evidenceFactIds, ["fA", "fB"]);
assert(doc.requiredEntityIds.includes(line.id));
const unmarked = structuredClone(doc);
delete unmarked.source.sectionFormula;
for (const entity of unmarked.entities) delete entity.provenance;
assert.deepEqual(validateSectionPointSourceInputs(unmarked, section.question), [], "source markers are not authority");
for (const mutate of [
  (ir: ProblemIR) => { ir.entities.push({ id: "extraP", kind: "point", label: "Q", evidenceFactIds: ["fA"] }); ir.representationIntents[0]!.entityIds.push("extraP"); },
  (ir: ProblemIR) => { ir.entities.push({ id: "extraLine", kind: "line", label: "AQ", evidenceFactIds: ["fA", "fB"] }); ir.representationIntents[0]!.entityIds.push("extraLine"); },
  (ir: ProblemIR) => { ir.entities[3]!.label = "BA"; },
  (ir: ProblemIR) => { ir.entities[3]!.evidenceFactIds = ["fA"]; },
  (ir: ProblemIR) => { ir.entities[0]!.evidenceFactIds = ["fB"]; },
  (ir: ProblemIR) => { ir.entities[2]!.evidenceFactIds = ["fA"]; },
  (ir: ProblemIR) => { ir.expressions[0]!.root = { kind: "number", value: 2 }; },
  (ir: ProblemIR) => { ir.expressions[4]!.root = { kind: "number", value: 1 }; },
  (ir: ProblemIR) => { ir.expressions[4]!.evidenceFactIds = ["fA"]; },
  (ir: ProblemIR) => { ir.expressions[6]!.root = { kind: "binary", operator: "+", left: { kind: "number", value: 4 }, right: { kind: "number", value: 1 } }; },
  (ir: ProblemIR) => { ir.facts[0]!.evidence.quote = "A(2,1)"; },
  (ir: ProblemIR) => { ir.constraints.push({ id: "false", kind: "perpendicular", entityIds: ["ptA", "ptB"], evidenceFactIds: ["fA"] }); },
]) {
  const bad = structuredClone(section); mutate(bad);
  assert.equal(synthesizeFamilyScene({ question: bad.question, problemIR: bad }), null, `SF3 negative ${mutate.toString()}`);
}
for (const mutate of [
  (scene: SceneDocument) => { scene.constructions.find((construction) => construction.id === "join")!.inputs.end = "pt_P"; },
  (scene: SceneDocument) => { scene.constructions.find((construction) => construction.id === "place_a")!.inputs.x = 2; },
  (scene: SceneDocument) => { scene.annotations.find((annotation) => annotation.targetIds.includes("pt_P"))!.text = "P=(8,7)"; },
]) {
  const bad = structuredClone(doc); mutate(bad);
  bad.source.sectionFormula = "forged";
  assert(validateSectionPointSourceInputs(bad, section.question).some((issue) => issue.severity === "fatal"));
  assert(validateTurnPlanSceneProofs(bad, null).some((issue) => issue.severity === "fatal"), "existing admission proof seam rejects source forgery");
}
for (const question of [
  section.question.replace("2:1", "1:1"), section.question.replace("2:1", "0:1"), section.question.replace("2:1", "-2:1"),
  section.question.replace("A(1,2)", "A(1/2,2)"), section.question + " Also find Q(8,9).",
]) assert.equal(sectionFormulaScene(question), null);

// Four more literal shapes, with complete source IR and independently fixed cell expectations.
for (const c of [
  { entries: [[-4, 0, 1.25]], requested: ["a11", "a13"], expected: [-4, 1.25] },
  { entries: [[0], [-2.5], [8]], requested: ["a21", "a31"], expected: [-2.5, 8] },
  { entries: [[1, 0], [0, 1]], requested: ["a12", "a22"], expected: [0, 1] },
  { entries: [[2, 2], [-5, 7]], requested: ["a11", "a12", "a21"], expected: [2, 2, -5] },
]) {
  const question = `A=${JSON.stringify(c.entries)}. Show A, state its order and write the elements ${c.requested.join(", ")}.`;
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: [{ id: "order", symbol: "order" }, ...c.requested.map((symbol) => ({ id: symbol, symbol }))], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const authority = prepareMatrixLiteralSourceAuthority(question, plan);
  assert(authority, question);
  assert.equal(authority.problemIR.entities.length, 1 + c.entries.length + c.entries[0]!.length + c.entries.flat().length, "all matrices/rows/columns/cells retained");
  const result = await solver.solve(authority.problemIR);
  const audit = verifyTurnPlanAgainstSolver(authority.problemIR, result, authority.plan, question);
  assert.equal(audit.status, "verified", JSON.stringify(audit));
  for (let i = 0; i < c.requested.length; i++) {
    const request = authority.problemIR.solveRequests.find((request) => request.resultBinding?.symbol === c.requested[i]);
    assert.equal(result.values.find((value) => value.requestId === request?.id)?.approximate, c.expected[i]);
  }
  assert(compileSceneDocument(authority.document).ok);
}
for (const mutate of [
  (plan: TurnPlanV3) => { plan.givens[0]!.value = 5; },
  (plan: TurnPlanV3) => { plan.givens[0]!.symbol = "a12"; },
  (plan: TurnPlanV3) => { plan.givens[0]!.symbol = "x"; plan.givens[0]!.id = "height"; },
  (plan: TurnPlanV3) => { plan.givens[0]!.unit = "A"; },
  (plan: TurnPlanV3) => { plan.givens[0]!.provenance = "derived"; },
  (plan: TurnPlanV3) => { plan.givens[0]!.sourceText = "A[1][1]=5"; },
  (plan: TurnPlanV3) => { plan.givens[0]!.sourceText = "A[1][2]=2"; },
  (plan: TurnPlanV3) => { plan.givens[0]!.sourceText = "B[1][1]=2"; },
  (plan: TurnPlanV3) => { plan.givens[0]!.sourceText = "A is a nice matrix"; },
  (plan: TurnPlanV3) => { plan.givens[0]!.symbol = "x"; },
  (plan: TurnPlanV3) => { plan.derived[0]!.value = 35; },
  (plan: TurnPlanV3) => { plan.qualitativeClaims[0]!.expected = "4 x 3"; },
  (plan: TurnPlanV3) => { plan.qualitativeClaims[1]!.expected = "35"; },
  (plan: TurnPlanV3) => { plan.unknowns = plan.unknowns.filter((unknown) => unknown.id !== "a23"); },
]) {
  const bad = structuredClone(matrixPlan); mutate(bad);
  assert.equal(prepareMatrixLiteralSourceAuthority(matrixIR.question, bad, matrixIR), null, `matrix plan negative ${mutate.toString()}`);
}
for (const mutate of [
  (ir: ProblemIR) => { ir.expressions[0]!.root = { kind: "number", value: 5 }; },
  (ir: ProblemIR) => { ir.expressions[0]!.id = "x"; },
  (ir: ProblemIR) => { ir.entities[1]!.label = "row 4"; },
  (ir: ProblemIR) => { ir.entities[8]!.label = "a12"; },
  (ir: ProblemIR) => { ir.entities[8]!.evidenceFactIds = ["fShowMatrix"]; },
  (ir: ProblemIR) => { ir.entities.push({ id: "extra", kind: "other", label: "B", evidenceFactIds: ["fMatrixGiven"] }); },
  (ir: ProblemIR) => { ir.solveRequests = ir.solveRequests.filter((request) => request.id !== "srA23"); },
  (ir: ProblemIR) => { ir.solveRequests[1]!.resultBinding!.symbol = "a21"; },
  (ir: ProblemIR) => { ir.constraints.push({ id: "unowned", kind: "parallel", entityIds: ["row1", "row2"], evidenceFactIds: ["fMatrixGiven"] }); },
]) {
  const bad = structuredClone(matrixIR); mutate(bad);
  assert.equal(prepareMatrixLiteralSourceAuthority(matrixIR.question, matrixPlan, bad), null, `matrix IR negative ${mutate.toString()}`);
}
assert.deepEqual(prepared.problemIR.entities, matrixIR.entities);
assert.deepEqual(prepared.problemIR.facts, matrixIR.facts);
assert.deepEqual(prepared.problemIR.expressions, matrixIR.expressions);
assert.deepEqual(prepared.problemIR.representationIntents, matrixIR.representationIntents);
assert.equal(prepared.problemIR.solveRequests.length, matrixIR.solveRequests.length + 1, "add column request; preserve row and all entries");
for (const mutate of [
  (scene: SceneDocument) => { (scene.constructions[0]!.inputs.entries as string[][])[0]![0] = "5"; },
  (scene: SceneDocument) => { scene.entities[0]!.label = "B"; },
  (scene: SceneDocument) => { scene.constructions = []; },
  (scene: SceneDocument) => { scene.requiredEntityIds = []; },
  (scene: SceneDocument) => { scene.revealGroups = []; },
  (scene: SceneDocument) => { scene.entities.push({ id: "invented", kind: "point", role: "unowned" }); },
]) {
  const bad = structuredClone(prepared.document); mutate(bad);
  assert.equal(matrixLiteralSourceEntityIsCarried(bad, prepared.problemIR, "entry11"), false);
  assert.equal(matrixLiteralSourceDimensionIsCarried(bad, prepared.problemIR, "e11", 2, ["fMatrixGiven"]), false);
}
assert.equal(matrixLiteralSourceDimensionIsCarried(prepared.document, prepared.problemIR, "e11", 5, ["fMatrixGiven"]), false);
assert.equal(matrixLiteralSourceDimensionIsCarried(prepared.document, prepared.problemIR, "e11", 2, ["fShowMatrix"]), false);
for (const question of ["If A=[[1,2],[3,4]], show A.", "A=[[1,x],[3,4]]. Show A.", "A=[[1e-999]]. Show A.", `A=${JSON.stringify(Array.from({ length: 7 }, () => [1]))}. Show A.`, "A=[[1,2],[3,4]]. Find inverse A."]) {
  const plan = { ...matrixPlan, question };
  assert.equal(prepareMatrixLiteralSourceAuthority(question, plan), null);
}
const products = buildMatrixSourceDocument("A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Show A and B and find AB and BA.");
assert(products);
const productScene = compileSceneDocument(products);
assert(productScene.ok && productScene.renderScene);
for (const [name, expected] of [["AB", [[2, 1], [4, 3]]], ["BA", [[3, 4], [1, 2]]]] as const) {
  const entity = products.entities.find((entity) => entity.label === name)!;
  const cells = productScene.renderScene.primitives.filter((primitive) => primitive.entityId === entity.id && primitive.provenance?.matrixCell);
  assert.equal(cells.length, 4);
  for (const primitive of cells) {
    const cell = primitive.provenance!.matrixCell!;
    assert.equal(cell.exactValue.numerator, String(expected[cell.row]![cell.column]));
    assert.equal(cell.exactValue.denominator, "1");
  }
}
const scale = buildMatrixSourceDocument("A=[[1,2],[3,4]]. Find 2A.");
assert(scale?.entities.some((entity) => entity.label === "2·A"));
const native = JSON.parse(readFileSync(new URL("../../../../apps/tutor/scripts/verify/fixtures/matrix-native-source.json", import.meta.url), "utf8")) as { nativeCases: Array<{ full_source_record: { text: string } }> };
const nativeQuestion = native.nativeCases[0]!.full_source_record.text;
const nativeDocument = buildMatrixSourceDocument(nativeQuestion);
assert(nativeDocument && compileSceneDocument(nativeDocument).ok, "unchanged native source premise still compiles");
assert.equal(nativeDocument.source.representationTier, "question_representation");
assert.equal(prepareMatrixLiteralSourceAuthority(nativeQuestion, { ...matrixPlan, question: nativeQuestion }), null, "literal repair does not reinterpret unresolved native options");
console.log("w2-section-matrix: five section cores, five matrix cores, AB/BA and rejection/ownership controls passed (offline only)");
