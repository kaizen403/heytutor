import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ProblemIR, ExpressionNodeIR, SceneDocument, CompileOptions, RenderScene } from "../../src/index";

// Built mode uses only the normal public engine bundle for every engine boundary.
const esm = process.argv.includes("--esm");
const engine: typeof import("../../src/index") = esm
  ? await import(new URL("../../dist/index.js", import.meta.url).href) : await import("../../src/index");
let checks = 0;
const check = (condition: unknown, message: string): void => { assert(condition, message); checks++; };
const equal = (actual: unknown, expected: unknown, message: string): void => { assert.deepEqual(actual, expected, message); checks++; };
const number = (value: number): ExpressionNodeIR => ({kind: "number", value});

// Authored complete role profile, not a captured live planner output. Expected
// coefficients below are independent constants/enumeration, not kernel outputs.
function problemFor(question: string, expected?: number): ProblemIR {
  const reading = engine.readFiniteBinomialProgram(question);
  assert(reading.status === "ok");
  const evidence = (quote: string) => { const start = question.indexOf(quote); return {source: "question" as const, quote, start, end: start + quote.length}; };
  return {schemaVersion: "problem-ir/v1", id: "actual_full_polynomial", question,
    facts: [{id: "given", kind: "given", statement: "Full source expression", evidence: evidence(reading.source.expressionSource)},
      {id: "asked", kind: "requested", statement: "Full source request", evidence: evidence(reading.source.requestSource)}],
    entities: [{id: "P", kind: "other", label: "P(x)", evidenceFactIds: ["given"]}],
    expressions: [{id: "polynomial", valueType: "function", root: reading.source.root, evidenceFactIds: ["given"]},
      ...(expected === undefined ? [] : [{id: "coefficient", valueType: "scalar" as const, root: number(expected), evidenceFactIds: ["asked"]}])],
    constraints: [], representationIntents: [{id: "table", kind: "conceptual", entityIds: ["P"], evidenceFactIds: ["given", "asked"]}],
    solveRequests: expected === undefined ? [] : [{id: "coefficient_ask", kind: "evaluate", expressionId: "coefficient",
      resultBinding: {turnPlanQuantityId: "caller_result", symbol: "c", unit: "1", evidenceFactIds: ["asked"]}}]};
}
const native = JSON.parse(readFileSync(new URL("./w3-binomial/native2014P2Q43.json", import.meta.url), "utf8"));
const cases = [
  {name: "pascal", question: "Expand (1+x)^4.", coefficients: ["1", "4", "6", "4", "1"]},
  {name: "signed", question: "Coefficient of x^2 in the expansion of (2-3x)^4 is", expected: 216, coefficients: ["16", "-96", "216"]},
  {name: "rational", question: "Expand (1/2+x/3)^3.", coefficients: ["1/8", "1/4", "1/6", "1/27"]},
  {name: "composite", question: "Coefficient of x^3 in the expansion of (1+x)^2(1-x)^3 is", expected: 2, coefficients: ["1", "-1", "-2", "2"]},
  {name: "native", question: native.question_options_and_source_answer_verbatim as string, expected: 1113},
  {name: "zero", question: "Coefficient of x^5 in the expansion of (1+x)^2 is", expected: 0, coefficients: ["1", "2", "1", "0", "0", "0"]},
  {name: "constant", question: "Expand (1+x)^0.", coefficients: ["1"]},
  {name: "cancellation", question: "Expand (1+x)-(1+x).", coefficients: ["0"]},
  {name: "bound", question: "Expand (1+x)^15.", coefficients: ["1", "15", "105", "455", "1365", "3003", "5005", "6435", "6435", "5005", "3003", "1365", "455", "105", "15", "1"]},
  {name: "source_whitespace", question: "  Expand (1+x)^2.  ", coefficients: ["1", "2", "1"]},
];
check(engine.isExecutableSceneConstructionOperator("finite_polynomial_expansion"), "operator is registered executable");
check(engine.isPlannerVisibleSceneConstructionOperator("finite_polynomial_expansion"), "operator appears in canonical visible capabilities");
equal(engine.FINITE_BINOMIAL_ENTITY_KINDS, ["finite_polynomial_source", "finite_polynomial_term"], "reviewed output kinds");
const scenes: {name: string; scene: RenderScene}[] = [];
for (const item of cases) {
  const problem = problemFor(item.question, item.expected), authority = {question: item.question, problemIR: problem};
  const document = engine.finiteBinomialSourceDocument(item.question, problem);
  assert(document);
  const snapshot = JSON.stringify(document), irSnapshot = JSON.stringify(problem);
  equal(engine.validateSceneSourceAuthority(document, item.question, problem), [], `${item.name} normal source proof`);
  const validated = engine.validateSceneDocument(document, {sourceAuthority: authority});
  check(validated.report.valid && validated.document, `${item.name} structural/source validation`);
  equal(validated.document, document, `${item.name} normal validation preserves complete candidate`);
  const result = engine.compileSceneDocument(document, {sourceAuthority: authority});
  check(result.ok && result.renderScene && result.report.valid, `${item.name} normal compile ${JSON.stringify(result.report.issues)}`);
  const scene = result.renderScene!;
  scenes.push({name: item.name, scene});
  equal(scene.revealGroups, document.revealGroups, `${item.name} exact reveal groups`);
  equal(scene.timeline, document.teachingTimeline, `${item.name} exact reveal order`);
  check(document.requiredEntityIds.every(id => scene.primitives.some(p => p.entityId === id)), `${item.name} every required entity renders`);
  check(scene.primitives.every(p => p.kind === "label" && p.provenance?.nonmetric === true && p.provenance?.finitePolynomial === true), `${item.name} no invented curve/topology/metric ink`);
  check(scene.primitives.every(p => document.revealGroups.some(g => g.id === p.groupId && g.entityIds.includes(p.entityId))), `${item.name} every mark has verified reveal owner`);
  const rows = scene.primitives.filter(p => p.provenance?.exactCoefficient);
  if (item.coefficients) equal(rows.map(p => engine.exactPolynomialText(p.provenance!.exactCoefficient as {numerator: string; denominator: string})), item.coefficients, `${item.name} independent exact coefficient oracle`);
  if (item.expected !== undefined) {
    equal(rows.filter(p => p.provenance?.selected).map(p => p.text), [`[${item.expected}]`], `${item.name} selected scalar is source requested`);
    const solver = engine.solveFiniteBinomialProblem(item.question, problem);
    check(solver && engine.validateSolverResult(solver, problem).valid, `${item.name} original SolverResult contract`);
    equal(solver!.values[0]!.approximate, item.expected, `${item.name} original solver output`);
    equal(document.quantities[0]!.id, "caller_result", `${item.name} actual result binding`);
  }
  const bounds = scene.primitives.map(p => p.provenance!.labelCollisionBounds as {x: number; y: number; width: number; height: number});
  check(bounds.every(b => b && b.x >= 410 && b.y >= 55 && b.x + b.width <= 1150 && b.y + b.height <= 610), `${item.name} measured ink fits diagram viewport`);
  check(bounds.every((a, i) => bounds.slice(i + 1).every(b => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)), `${item.name} measured label collision boxes do not overlap`);
  const family = engine.synthesizeFamilyScene({question: item.question, problemIR: problem});
  check(family && family.family === "finite_polynomial_expansion" && family.tier === "exact_verified" && family.nonMetric, `${item.name} normal family result`);
  equal(family!.document.source.problemIR, problem, `${item.name} family retains actual full IR`);
  equal(engine.visualObligationIssues(problem, family!.document), [], `${item.name} source body obligations`);
  const restored = JSON.parse(JSON.stringify(document)), restoredIR = JSON.parse(JSON.stringify(problem));
  const fresh = engine.compileSceneDocument(restored, {sourceAuthority: {question: item.question, problemIR: restoredIR}});
  equal(fresh.renderScene, scene, `${item.name} fresh source-rederived JSON compile is deterministic`);
  equal(JSON.stringify(document), snapshot, `${item.name} compile does not mutate candidate`);
  equal(JSON.stringify(problem), irSnapshot, `${item.name} actual IR is not reduced/mutated`);
}
const question = cases[1]!.question, problem = problemFor(question, 216), authority = {question, problemIR: problem};
const document = engine.finiteBinomialSourceDocument(question, problem)!;
function rejected(candidate: SceneDocument, sourceAuthority: CompileOptions["sourceAuthority"], name: string): void {
  const structural = engine.validateSceneDocument(candidate, {sourceAuthority});
  check(!structural.document && !structural.report.valid, `${name} validator rejects`);
  const compiled = engine.compileSceneDocument(candidate, {sourceAuthority});
  check(!compiled.ok && compiled.renderScene === null && compiled.report.issues.some(i => i.severity === "fatal"), `${name} no partial normal render`);
  if (sourceAuthority) check(engine.validateSceneSourceAuthority(candidate, sourceAuthority.question, sourceAuthority.problemIR).some(i => i.severity === "fatal"), `${name} callable source boundary rejects`);
  if (sourceAuthority?.question === question && sourceAuthority.problemIR) check(engine.visualObligationIssues(sourceAuthority.problemIR as ProblemIR, candidate).some(i => i.severity === "fatal"), `${name} whole-document visual obligations reject`);
}
rejected(document, undefined, "document source cannot supply authority");
check(!engine.checkVisualObligations(engine.deriveVisualObligations(problem), document).satisfied, "obligations cannot recover fullIR from document source");
rejected(document, {question, problemIR: undefined}, "missing caller full IR");
rejected(document, {question: "Expand (1+x)^4.", problemIR: problem}, "wrong caller question");
const mutations: [string, (d: SceneDocument) => void][] = [
  ["forged coefficient", d => {d.quantities[0]!.value = 215;}],
  ["wrong exact rational", d => {d.quantities[0]!.exact = {numerator: "215", denominator: "1"};}],
  ["wrong quantity binding", d => {d.quantities[0]!.id = "other_quantity";}],
  ["wrong symbol", d => {d.quantities[0]!.symbol = "d";}],
  ["metric unit", d => {d.quantities[0]!.unit = "m";}],
  ["forged table label", d => {d.entities[1]!.label = "999";}],
  ["cached geometry", d => {d.source.geometry = {coefficient: 216};}],
  ["provenance approval", d => {d.entities[0]!.provenance = {sourceVerified: true};}],
  ["omitted required row", d => {d.requiredEntityIds.pop();}],
  ["omitted output", d => {d.constructions[0]!.outputs.pop();}],
  ["wrong output kind", d => {d.entities[1]!.kind = "point";}],
  ["changed reveal owner", d => {d.revealGroups[0]!.entityIds.push(d.revealGroups[1]!.entityIds.pop()!);}],
  ["changed reveal order", d => {d.teachingTimeline[1]!.dependsOn = [];}],
  ["normalizable duplicate requirement", d => {d.requiredEntityIds.push(d.requiredEntityIds[0]!);}],
  ["text-only bypass", d => {d.visualDecision.mode = "text_only";}],
  ["wrong family without finite markers", d => {d.entities = [{id: "P", kind: "point", role: "stand-in", label: "P(x)"}]; d.constructions = [{id: "stand_in", operator: "point", inputs: {x: 0, y: 0}, outputs: ["P"]}];}],
  ["metric assertion", d => {d.assertions.push({id: "fake_metric", predicate: "equal_length", entities: d.requiredEntityIds.slice(1, 3), severity: "fatal"});}],
  ["extra ink", d => {d.constructions.push({id: "extra", operator: "point", inputs: {x: 0, y: 0}, outputs: ["ink"]}); d.entities.push({id: "ink", kind: "point", role: "extra"});}],
  ["source and input self-authorization", d => {d.source.question = "Expand (1+x)^4."; d.constructions[0]!.inputs.question = d.source.question;}],
  ["reduced embedded IR", d => {d.constructions[0]!.inputs.problemIR = {...problem, expressions: problem.expressions.slice(1)};}],
  ["cyclic cache", d => {d.source.cycle = d;}],
];
for (const [name, mutate] of mutations) {const d = structuredClone(document); mutate(d); rejected(d, authority, name);}
const irMutations: [string, (p: ProblemIR) => void][] = [
  ["same answer wrong full AST", p => {p.expressions[0]!.root = engine.parseFinitePolynomialExpression("(2+3x)^4");}],
  ["reduced actual IR", p => {p.expressions.shift();}],
  ["extra entity", p => {p.entities.push({id: "hidden", kind: "other", evidenceFactIds: ["given"]});}],
  ["extra expression", p => {p.expressions.push({id: "hidden_expression", valueType: "scalar", root: number(1), evidenceFactIds: ["given"]});}],
  ["extra ask", p => {p.solveRequests.push({...p.solveRequests[0]!, id: "hidden_ask"});}],
  ["constraint never dropped", p => {p.constraints.push({id: "hidden_constraint", kind: "tangent", entityIds: ["P"], evidenceFactIds: ["given"]});}],
  ["wrong given span", p => {p.facts[0]!.evidence.start++;}],
  ["stale scalar answer", p => {p.expressions[1]!.root = number(215);}],
];
for (const [name, mutate] of irMutations) {
  const p = structuredClone(problem); mutate(p);
  rejected(document, {question, problemIR: p}, name);
  equal(engine.synthesizeFamilyScene({question, problemIR: p}), null, `${name} normal family declines whole IR`);
}
const renamedBinding = structuredClone(problem);
renamedBinding.solveRequests[0]!.resultBinding!.turnPlanQuantityId = "another_actual_id";
rejected(document, {question, problemIR: renamedBinding}, "old document cannot substitute caller binding");
const renamedFamily = engine.synthesizeFamilyScene({question, problemIR: renamedBinding});
check(renamedFamily && renamedFamily.document.quantities[0]!.id === "another_actual_id", "fresh candidate follows actual caller binding, never a fixture ID");
equal(engine.synthesizeFamilyScene({question}), null, "source family requires actual full IR");
const narrow = engine.compileSceneDocument(document, {sourceAuthority: authority, viewport: {x: 410, y: 55, width: 60, height: 55, padding: 10}});
check(!narrow.ok && narrow.renderScene === null, "unreadable viewport declines atomically");
const resized = engine.compileSceneDocument(document, {sourceAuthority: authority, viewport: {x: 430, y: 80, width: 650, height: 500, padding: 20}});
check(resized.ok && resized.renderScene, "normal fitting adapts to different viewport");
check(JSON.stringify(resized.renderScene!.primitives.map(p => p.points)) !== JSON.stringify(scenes[1]!.scene.primitives.map(p => p.points)), "no fixed canvas coordinates");
// Sorting object keys, as JSONB may do, cannot supply or destroy source authority.
function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => b.localeCompare(a)).map(([k, v]) => [k, reorder(v)]));
  return value;
}
check(engine.compileSceneDocument(reorder(document) as SceneDocument, {sourceAuthority: {question, problemIR: reorder(problem)}}).ok, "JSONB key order rederives source");
if (process.argv.includes("--artifact")) {
  mkdirSync("/tmp/w3-integration-20261006-evidence", {recursive: true});
  writeFileSync("/tmp/w3-integration-20261006-evidence/scenes.json", JSON.stringify(scenes, null, 2));
}
console.log(`W3 finite binomial normal engine integration (${esm ? "built ESM public index" : "source TS"}): ${checks} checks PASS; READY=0 accepted=0; authored fullIR profile, lifecycle acceptance pending`);
