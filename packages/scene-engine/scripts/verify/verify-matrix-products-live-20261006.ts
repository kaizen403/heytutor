import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import * as sourceEngine from "../../src/index";
import * as sourceAuthority from "../../src/ir/matrixProductSourceAuthority";
import { readMatrixProductSourceProgram, buildMatrixSourceDocument, validateMatrixSourceBinding } from "../../src/compile/matrixSourceBinding";
import { evaluateMatrixArrayConstruction } from "../../src/compile/matrixArrayGeometry";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { SceneDocument } from "../../src/types";

const artifacts = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const engine: typeof sourceEngine = artifacts[0] ? await import(pathToFileURL(artifacts[0]).href) : sourceEngine;
const authority: typeof sourceAuthority = artifacts[1] ? await import(pathToFileURL(artifacts[1]).href) : sourceAuthority;
let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; assert.ok(condition, message); }
function equal(actual: unknown, expected: unknown, message: string): void { checks++; assert.deepEqual(actual, expected, message); }
const json = (url: URL) => JSON.parse(readFileSync(url, "utf8"));
const actual: {question: string; plan: TurnPlanV3; problemIR: ProblemIR; rawProblemResponse: object; provenance: Record<string, string>} = json(new URL("../../fixtures/matrix-products-live-20261006/actual-runtime.json", import.meta.url));

// The actual canonical plan is from the immutable scene request, not the
// invalid string-valued initial TurnPlan response in diagnosis.plan.
if (process.argv.includes("--check-capture")) {
  for (const [pathKey, hashKey] of [["capture", "captureSha256"], ["diagnosis", "diagnosisSha256"]]) {
    equal(createHash("sha256").update(readFileSync(actual.provenance[pathKey]!)).digest("hex"), actual.provenance[hashKey]!, `immutable ${pathKey} hash`);
  }
  const exchanges = JSON.parse(readFileSync(actual.provenance.capture!, "utf8"));
  const request = exchanges.find((row: {kind: string}) => row.kind === "scene-document-v2");
  const message = request.requestBody.messages.find((row: {content: string}) => row.content.includes("AUTHORITATIVE TURN PLAN V3\n")).content;
  equal(actual.plan, JSON.parse(message.split("AUTHORITATIVE TURN PLAN V3\n")[1].split("\n")[0]), "complete captured canonical plan");
  equal(actual.problemIR, JSON.parse(readFileSync(actual.provenance.diagnosis!, "utf8")).ir, "complete original captured full IR");
  const response = JSON.parse(exchanges.find((row: {kind: string}) => row.kind === "problem-ir-v1").responseBody).choices[0].message.content;
  equal(actual.rawProblemResponse, JSON.parse(response), "raw formulation capture");
}

function exact(entries: unknown): unknown {
  return evaluateMatrixArrayConstruction("matrix_array", { entries, origin: [0, 0], displayScale: 1 }, {
    scalar() { throw new Error("oracle literals only"); }, geometry() { return undefined; },
  })[0]!.matrixArray.exactEntries;
}
function cellMetadata(value: unknown): {row: number; column: number; exactValue: {numerator: string; denominator: string}} {
  check(typeof value === "object" && value !== null && "row" in value && typeof value.row === "number" && Number.isInteger(value.row)
    && "column" in value && typeof value.column === "number" && Number.isInteger(value.column)
    && "exactValue" in value && typeof value.exactValue === "object" && value.exactValue !== null
    && "numerator" in value.exactValue && typeof value.exactValue.numerator === "string"
    && "denominator" in value.exactValue && typeof value.exactValue.denominator === "string", "emitted exact matrix metadata is typed own data");
  return {row: value.row, column: value.column, exactValue: {numerator: value.exactValue.numerator, denominator: value.exactValue.denominator}};
}
function allSeams(question: string, plan: TurnPlanV3, problem: ProblemIR, expected: Record<string, unknown>): SceneDocument {
  const beforePlan = JSON.stringify(plan), beforeProblem = JSON.stringify(problem);
  check(authority.matrixProductSourcePlanIssues(question, plan).length > 0, "scalar matrix placeholders reject at strict plan seam");
  equal(authority.matrixProductFullIRIssues(question, problem), [], "whole original IR binds");
  const prepared = authority.prepareMatrixProductSourceAuthority(question, plan, problem);
  check(prepared, "all-seams authority produces a source-bound document");
  check(prepared.problemIR === problem, "original complete IR reference is returned unchanged");
  equal(JSON.stringify(problem), beforeProblem, "full original IR unchanged, no artificial numeric graph");
  equal(JSON.stringify(plan), beforePlan, "original plan unchanged");
  equal(prepared.correction.audit.withdrawn, plan.givens, "every rejected placeholder retained in audit");
  check(prepared.correction.audit.originalIssues.length > 0, "original rejection retained");
  check(prepared.correction.audit.dependencies.length === plan.derived.length, "every dependency rewrite audited");
  check(prepared.correction.sourceAliases.every(alias => alias.numericScalarAuthority === false && !Object.hasOwn(alias, "value")), "typed literal aliases cannot narrate numeric zero");
  check(prepared.plan.givens.every(given => !plan.givens.some(original => original.id === given.id)), "no matrix-named scalar remains in teaching givens");
  equal(authority.matrixProductSourcePlanIssues(question, prepared.plan), [], "corrected complete teaching plan binds");
  equal(authority.matrixProductSourceDocumentIssues(prepared.document, question, problem, prepared.plan), [], "whole source/plan/IR/document joins");
  equal(validateMatrixSourceBinding(prepared.document, question, prepared.plan), [], "original matrix validator still applies");
  const compiled = engine.compileSceneDocument(prepared.document, {sourceAuthority: {question, problemIR: problem, turnPlan: prepared.plan}});
  check(compiled.ok && compiled.renderScene, `normal compile accepts complete context: ${JSON.stringify(compiled.report.issues)}`);
  const source = readMatrixProductSourceProgram(question)!;
  for (const product of source.products) equal(product.geometry.matrixArray.exactEntries, exact(expected[product.name]), `independent ordered oracle ${product.name}`);
  for (const product of source.products) {
    const oracle = exact(expected[product.name]) as Array<Array<{numerator: string; denominator: string}>>;
    const cells = compiled.renderScene.primitives.filter(primitive => primitive.provenance?.matrixCell
      && prepared.document.entities.find(entity => entity.id === primitive.entityId)?.label === product.name);
    equal(cells.length, product.geometry.matrixArray.rows * product.geometry.matrixArray.columns, `${product.name} all runtime cells emitted`);
    const typedCells = cells.map(cell => ({cell, metadata: cellMetadata(cell.provenance!.matrixCell)}));
    equal(new Set(typedCells.map(({metadata}) => `${metadata.row},${metadata.column}`)).size, cells.length, `${product.name} unique emitted positions`);
    for (const {cell, metadata} of typedCells) {
      const wanted = oracle[metadata.row]![metadata.column]!;
      equal([metadata.exactValue.numerator, metadata.exactValue.denominator], [wanted.numerator, wanted.denominator], `${product.name} emitted cell ${metadata.row},${metadata.column} independent exact oracle`);
      check(cell.provenance!.matrixNonmetric === true, "exact entry never makes table spacing metric");
    }
  }
  const restored = JSON.parse(JSON.stringify(prepared.document));
  equal(authority.matrixProductSourceDocumentIssues(restored, question, JSON.parse(beforeProblem), JSON.parse(JSON.stringify(prepared.plan))), [], "serialized context rebinds every obligation");
  check(engine.compileSceneDocument(restored, {sourceAuthority: {question, problemIR: problem, turnPlan: prepared.plan}}).ok, "serialized engine compile");
  return prepared.document;
}

const bare = buildMatrixSourceDocument(actual.question)!;
check(bare, "actual bare source document exists");
equal(engine.compileSceneDocument(bare).renderScene?.primitives.length, 28, "actual baseline 28 primitives reproduced");
check(validateMatrixSourceBinding(bare, actual.question, actual.plan).some(issue => issue.severity === "fatal"), "actual plan remains rejected without audited repair");
const doc = allSeams(actual.question, actual.plan, actual.problemIR, {AB: [[4,4],[10,8]], BA: [[2,4],[7,10]]});
const prepared = authority.prepareMatrixProductSourceAuthority(actual.question, actual.plan, actual.problemIR)!;
const repeated = authority.prepareMatrixProductSourceAuthority(actual.question, prepared.plan, actual.problemIR);
check(repeated?.problemIR === actual.problemIR, "early correction followed by registry preparation retains original IR");
equal(JSON.stringify(repeated!.plan), JSON.stringify(prepared.plan), "early correction is idempotent");

interface Case { id: string; leftName: string; rightName: string; left: unknown[][]; right: unknown[][]; [key: string]: unknown }
const cases: Case[] = json(new URL("../../fixtures/matrix-products-live-20261006/independent-products.json", import.meta.url));
for (const fixture of cases) {
  const a = fixture.leftName, b = fixture.rightName;
  const literal = (entries: unknown[][]) => JSON.stringify(entries).replace(/"/g, "");
  const question = `Let ${a}=${literal(fixture.left)} and ${b}=${literal(fixture.right)}. Find ${a}${b} and ${b}${a}.`;
  const quotes = [`${a}=${literal(fixture.left)}`, `${b}=${literal(fixture.right)}`];
  const products = [`${a}${b}`, `${b}${a}`];
  const facts: ProblemIR["facts"] = [a,b,...products].map((name, i) => {
    const quote = quotes[i] ?? (i === 2 ? `Find ${name}` : name), start = question.indexOf(quote);
    return {id: `f${name}`, kind: i < 2 ? "given" : "requested", statement: i < 2 ? `Matrix ${name} is ${literal(i === 0 ? fixture.left : fixture.right)}` : `Find product ${name}`, evidence: {source: "question", start, end: start + quote.length, quote}};
  });
  const problem: ProblemIR = {schemaVersion: "problem-ir/v1", id: fixture.id, question, facts, entities: [a,b].map(name => ({id: `mat${name}`, kind: "other", label: name, evidenceFactIds: [`f${name}`]})), expressions: [], constraints: [], representationIntents: [], solveRequests: []};
  const plan: TurnPlanV3 = {schemaVersion: "turn-plan/v3", question, givens: [a,b].map((name, i) => ({id: name, symbol: name, value: 0, sourceText: quotes[i], provenance: "given"})), unknowns: products.map(name => ({id: name, symbol: name})), derived: [], qualitativeClaims: [], lawIds: ["matrix-multiplication-definition"], assumptions: ["Standard row-by-column matrix multiplication over the real numbers"], visualRequirement: "optional"};
  // Fixture outputs were worked independently by row/column dot products.
  // Plan cells use those outputs; the implementation cannot supply its oracle.
  for (const name of products) (fixture[name] as Array<Array<number|string>>).forEach((row, i) => row.forEach((entry, j) => {
    const value = typeof entry === "number" ? entry : entry.split("/").map(Number).reduce((n,d) => n/d);
    const left = name === products[0] ? fixture.left : fixture.right, right = name === products[0] ? fixture.right : fixture.left;
    const factor = (value: unknown) => String(value).startsWith("-") || String(value).includes("/") ? `(${value})` : String(value);
    const sourceText = left[i]!.map((value, k) => `${factor(value)}*${factor(right[k]![j])}`).join("+") + `=${entry}`;
    plan.derived.push({id: `${name}${i+1}${j+1}`, symbol: `(${name})${i+1}${j+1}`, value, sourceText, provenance: "derived", dependsOn: [a,b]});
  }));
  for (const name of products) plan.qualitativeClaims.push({id: `claim_${name}`, claim: `${name} is the matrix product ${name[0]} times ${name[1]}`, expected: `${name}=${literal(fixture[name] as unknown[][])}`, relatedQuantityIds: [name, ...plan.derived.filter(row => row.id.startsWith(name)).map(row => row.id)]});
  const same = JSON.stringify(fixture[products[0]!]) === JSON.stringify(fixture[products[1]!]);
  plan.qualitativeClaims.push({id: "pair", claim: `Matrix multiplication is ${same ? "" : "not "}commutative here`, expected: `${products[0]} ${same ? "=" : "!="} ${products[1]}`, relatedQuantityIds: products});
  allSeams(question, plan, problem, fixture);
}

function badIR(name: string, mutate: (problem: ProblemIR) => void): void {
  const problem = structuredClone(actual.problemIR); mutate(problem);
  check(authority.matrixProductFullIRIssues(actual.question, problem).length > 0, name);
  equal(authority.prepareMatrixProductSourceAuthority(actual.question, actual.plan, problem), null, `${name}: atomic no candidate`);
}
badIR("false given statement", ir => {ir.facts[0]!.statement = "Matrix A is [[9,2],[3,4]]";});
badIR("reversed requested statement", ir => {ir.facts[2]!.statement = "Find product BA";});
badIR("missing original request fact", ir => {ir.facts.pop();});
badIR("unknown requested fact", ir => {ir.facts[3]!.statement = "Find determinant A";});
badIR("assumption cannot ride a literal quote", ir => {ir.facts[0]!.kind = "assumption";});
badIR("wrong entity evidence", ir => {ir.entities[0]!.evidenceFactIds = ["fB"];});
badIR("unowned extra entity", ir => {ir.entities.push({id: "extra", kind: "other", label: "C", evidenceFactIds: ["fA"]});});
badIR("counterfeit numeric AST with authentic quote", ir => {ir.expressions.push({id: "AB11", valueType: "scalar", root: {kind: "number", value: 4}, evidenceFactIds: ["fAB"]});});
badIR("counterfeit equation graph", ir => {ir.constraints.push({id: "fake", kind: "connected", entityIds: ["matA","matB"], evidenceFactIds: ["fA","fB"]});});
badIR("unowned representation intent", ir => {ir.representationIntents.push({id: "fake", kind: "graph", entityIds: ["matA"], evidenceFactIds: ["fA"]});});
badIR("unowned solve request", ir => {ir.solveRequests.push({id: "fake", kind: "evaluate", expressionId: "missing"});});
badIR("unowned root channel", ir => {Object.assign(ir, {numericResults: [0]});});

function badPlan(name: string, mutate: (plan: TurnPlanV3) => void): void {
  const plan = structuredClone(actual.plan); mutate(plan);
  equal(authority.correctMatrixProductSourcePlan(actual.question, plan), null, name);
  equal(authority.prepareMatrixProductSourceAuthority(actual.question, plan, actual.problemIR), null, `${name}: no candidate`);
}
badPlan("wrong entry", plan => {plan.derived[0]!.value = 99;});
badPlan("same-value wrong role", plan => {plan.derived[0]!.symbol = "(BA)12";});
badPlan("nonzero placeholder", plan => {plan.givens[0]!.value = 1;});
badPlan("scalar zero sign asserted", plan => {plan.givens[0]!.sign = "zero";});
badPlan("forged literal quote", plan => {plan.givens[0]!.sourceText = "A";});
badPlan("wrong product unknown", plan => {plan.unknowns[0]!.symbol = "BA";});
badPlan("missing product unknown", plan => {plan.unknowns.pop();});
badPlan("missing product cell", plan => {plan.derived.pop();});
badPlan("wrong dependency", plan => {plan.derived[0]!.dependsOn = ["A", "AB12"];});
badPlan("uncertain exact result", plan => {plan.derived[0]!.uncertainty = 0.1;});
badPlan("unit counterfeit", plan => {plan.derived[0]!.unit = "m";});
badPlan("false matrix expected", plan => {plan.qualitativeClaims[0]!.expected = "AB=[[4,4],[10,9]]";});
badPlan("false commutativity", plan => {plan.qualitativeClaims[2]!.expected = "AB = BA";});
badPlan("extra claim hidden in prose", plan => {plan.qualitativeClaims[0]!.claim += " and determinant A is 0";});
badPlan("additional assumption", plan => {plan.assumptions.push("A is singular");});
badPlan("additional unsupported law", plan => {plan.lawIds.push("determinant-expansion");});
badPlan("unknown additional channel", plan => {Object.assign(plan, {fakeAuthority: 0});});
badPlan("false arithmetic", plan => {plan.derived[0]!.sourceText = "9*9=4";});
badPlan("correct value with unrelated arithmetic", plan => {plan.derived[0]!.sourceText = "2+2=4";});
badPlan("correct arithmetic with extra scalar assertion", plan => {plan.derived[0]!.sourceText += "; A=0";});
badPlan("non-string explanation", plan => {Object.assign(plan.derived[0]!, {sourceText: 4});});
badPlan("claim evidence hint is not an array", plan => {Object.assign(plan.qualitativeClaims[0]!, {relatedEntityHints: 0});});
badPlan("untyped teaching hint", plan => {Object.assign(plan, {teachingSequenceHints: 0});});

for (const [name, mutate] of [
  ["reversed construction", (d: SceneDocument) => {d.constructions[2]!.inputs.left = "B"; d.constructions[2]!.inputs.right = "A";}],
  ["wrong given source entry", (d: SceneDocument) => {d.constructions[0]!.inputs.entries = [[0,2],[3,4]];}],
  ["missing requested product", (d: SceneDocument) => {d.constructions.pop();}],
  ["missing reveal", (d: SceneDocument) => {d.revealGroups.pop();}],
  ["missing required ownership", (d: SceneDocument) => {d.requiredEntityIds.pop();}],
  ["counterfeit scalar quantity", (d: SceneDocument) => {d.quantities.push({id: "AB11", value: 99});}],
  ["unowned extra quantity", (d: SceneDocument) => {d.quantities.push({id: "fake", value: 0});}],
  ["unowned annotation", (d: SceneDocument) => {d.annotations.push({id: "fake", kind: "narration", targetIds: ["A"], text: "A=0"});}],
  ["hidden source scalar placeholders", (d: SceneDocument) => {Object.assign(d.source, {givens: actual.plan.givens});}],
  ["missing stored whole question", (d: SceneDocument) => {delete d.source.question;}],
] as const) {
  const changed = structuredClone(doc); mutate(changed);
  check(authority.matrixProductSourceDocumentIssues(changed, actual.question, actual.problemIR, prepared.plan).length > 0, name);
}
let accessorCalls = 0;
const accessor = {...actual.problemIR}; Object.defineProperty(accessor, "facts", {get() {accessorCalls++; return actual.problemIR.facts;}});
check(authority.matrixProductFullIRIssues(actual.question, accessor).length > 0, "accessor declines"); equal(accessorCalls, 0, "accessor never executed");
check(authority.matrixProductFullIRIssues(actual.question, Object.create(actual.problemIR)).length > 0, "inherited IR declines");
equal(authority.prepareMatrixProductSourceAuthority(actual.question, actual.plan, null as unknown as ProblemIR), null, "absent full original IR cannot be replaced");
for (const tail of [" Find determinant A.", " Find inverse A.", " Assume A is zero.", " Find AC.", " State the type of A.", " Is A symmetric?", " A is square?", " Find the order of A."]) {
  equal(readMatrixProductSourceProgram(actual.question + tail), null, `whole residual obligation ${tail}`);
}
equal(readMatrixProductSourceProgram("Let A=[[1,2,3]] and B=[[1,2]]. Find AB."), null, "dimension mismatch declines");
console.log(`matrix-products-live-20261006: ${checks} checks passed; immutable actual context + four independent products; integration_pending`);
