/** Independent authored full-IR oracles. Historical student full IR was absent. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bindCircleSourceProblem, checkCircleSourceProblemBinding, circleSourceDocument,
  circleSourceDimensionIsCarried, circleSourceProblemEntitySceneId, readCircleSourceProgram,
} from "../../src/ir/circleSourceProgram";
import { applyCircleSourceAuthority } from "../../src/ir/circleSourceAuthority";
import { polynomialOfSource, polynomialOfIR, equivalentPolynomial } from "../../src/ir/circleSourceMath";
import { validateProblemIR, type ProblemIR, type ExpressionNodeIR } from "../../src/ir/problemIR";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import { validateTurnPlanV3, type TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { SceneDocument } from "../../src/types";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/w2-circle-source/authored-full-ir.json", import.meta.url), "utf8")) as Array<{ problem: ProblemIR; expected: { center: number[]; radiusSquared: number; pointPositions: string[] } }>;
let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert.ok(value, message); }
const copy = <T>(value: T): T => structuredClone(value);
for (const [i, fixture] of fixtures.entries()) {
  const problem = fixture.problem, before = JSON.stringify(problem);
  check(validateProblemIR(problem, problem.question).valid, `authored fixture ${i} schema`);
  const reading = readCircleSourceProgram(problem.question);
  check(reading.status === "ok", `whole source ${i}: ${JSON.stringify(reading.status === "declined" ? reading : reading.status)}`);
  assert.deepEqual([reading.source.center.x, reading.source.center.y], fixture.expected.center); checks++;
  assert.equal(reading.source.radiusSquared, fixture.expected.radiusSquared); checks++;
  assert.deepEqual(reading.source.points.map(p => p.position), fixture.expected.pointPositions); checks++;
  const binding = bindCircleSourceProblem(problem.question, problem);
  check(binding, `full IR binds ${i}`);
  check(binding.problem === problem && JSON.stringify(problem) === before, `actual IR retained intact ${i}`);
  check(binding.expressionBindings.length === problem.expressions.length && binding.factBindings.length === problem.facts.length && binding.entityBindings.length === problem.entities.length, `every full-IR item bound ${i}`);
  check(checkCircleSourceProblemBinding(problem.question, problem, binding.document).length === 0, `independent regeneration ${i}`);
  check(circleSourceDocument(problem.question, problem), `document factory ${i}`);
  check(validateSceneDocument(binding.document).report.valid, `canonical document ${i}`);
  const compiled = compileSceneDocument(binding.document);
  check(compiled.ok && compiled.renderScene, `existing deterministic operators compile ${i}: ${JSON.stringify(compiled.report.issues)}`);
  if (fixture.expected.radiusSquared === 0) check(compiled.renderScene.caption?.includes("circle:(1,-2)"), "singleton coordinates/name survive as actual scene caption");
  for (const entity of problem.entities) {
    const id = circleSourceProblemEntitySceneId(binding.document, problem, entity.id);
    check(id && binding.document.requiredEntityIds.includes(id) && binding.document.revealGroups.some(g => g.entityIds.includes(id)), `required/revealed source identity ${entity.id}`);
    check(compiled.renderScene.primitives.some(p => p.entityId === id && p.kind !== "label"), `physical source body ${i}/${entity.id}: ${JSON.stringify(compiled.renderScene.primitives.map(p => [p.entityId, p.kind]))}`);
    check(compiled.renderScene.primitives.some(p => p.entityId === id && p.kind === "label" && (p.text === entity.label || p.text?.startsWith(`${entity.label}(`))), `rendered source name ${i}/${entity.id}`);
  }
  for (const row of binding.expressionBindings.filter(e => e.sceneQuantityId)) {
    check(circleSourceDimensionIsCarried(binding.document, problem, row.expressionId, row.value!, row.factIds), `role-bound dimension ${row.expressionId}`);
    check(circleSourceDimensionIsCarried(binding.document, problem, row.expressionId, row.value! + 1, row.factIds) === false, `stale dimension ${row.expressionId}`);
  }
  const forged = copy(problem);
  forged.expressions.find(e => e.id === "coefficient_d")!.root = { kind: "number", value: 123 };
  check(bindCircleSourceProblem(problem.question, forged) === null, `given role/value forgery ${i}`);
}

const adverse = fixtures[5]!.problem, whole = bindCircleSourceProblem(adverse.question, adverse)!;
for (const [label, mutate] of [
  ["missing Q", (d: SceneDocument) => { d.entities = d.entities.filter(e => e.id !== "circle_point_1"); d.constructions = d.constructions.filter(c => !c.outputs.includes("circle_point_1")); }],
  ["required Q removed", (d: SceneDocument) => { d.requiredEntityIds = d.requiredEntityIds.filter(id => id !== "circle_point_1"); }],
  ["reveal Q removed", (d: SceneDocument) => { d.revealGroups[0]!.entityIds = d.revealGroups[0]!.entityIds.filter(id => id !== "circle_point_1"); }],
  ["renamed Q entity", (d: SceneDocument) => { d.entities.find(e => e.id === "circle_point_1")!.label = "P(8,0)"; }],
  ["forged Q caption", (d: SceneDocument) => { d.annotations.push({ id: "forged", kind: "label", targetIds: ["circle_point_1"], text: "P(8,0)" }); }],
  ["forged Q coordinate", (d: SceneDocument) => { d.constructions.find(c => c.outputs.includes("circle_point_1"))!.inputs.x = 3; }],
  ["forged semantic coordinate", (d: SceneDocument) => { d.entities.find(e => e.id === "circle_point_1")!.semantic!.x = 3; }],
  ["forged center", (d: SceneDocument) => { d.constructions.find(c => c.outputs.includes("circle_center"))!.inputs.y = 1; }],
  ["unit forge", (d: SceneDocument) => { d.quantities[0]!.unit = "m"; }],
  ["coefficient role swap", (d: SceneDocument) => { d.quantities.find(q => q.symbol === "D")!.sourceRole = "E"; }],
  ["hidden foreign entity", (d: SceneDocument) => { d.entities.push({ id: "hidden", kind: "point", role: "helper" }); }],
  ["unsupported constraint", (d: SceneDocument) => { d.assertions.push({ id: "foreign", predicate: "parallel", entities: ["circle_locus", "circle_center"], severity: "fatal" }); }],
  ["layout coordinates", (d: SceneDocument) => { d.constructions.find(c => c.outputs.includes("circle_point_1"))!.inputs.coordinateSpace = "layout"; }],
] as Array<[string, (d: SceneDocument) => void]>) {
  const d = copy(whole.document); d.source = {}; mutate(d);
  check(checkCircleSourceProblemBinding(adverse.question, adverse, d).some(e => e.severity === "fatal"), `marker stripped: ${label}`);
}
const qOnly = bindCircleSourceProblem(fixtures[6]!.problem.question, fixtures[6]!.problem)!;
check(qOnly.document.entities.some(e => e.label === "Q(8,0)") && !qOnly.document.entities.some(e => /^P\(/.test(e.label ?? "")), "Q-only never renamed P");
const clean = copy(whole.document); clean.source = {};
check(!checkCircleSourceProblemBinding(adverse.question, adverse, clean).length, "source markers confer no permission");
const reordered = JSON.parse(JSON.stringify(whole.document), (_key, value) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value) as SceneDocument;
check(!checkCircleSourceProblemBinding(adverse.question, adverse, reordered).length, "JSONB object ordering preserves identity");

for (const change of [
  (p: ProblemIR) => { p.entities.find(e => e.id === "Q")!.label = "P"; },
  (p: ProblemIR) => { p.entities = p.entities.filter(e => e.id !== "Q"); p.representationIntents[0]!.entityIds = p.representationIntents[0]!.entityIds.filter(id => id !== "Q"); },
  (p: ProblemIR) => { p.constraints.push({ id: "unsupported", kind: "tangent", entityIds: ["P", "locus"], evidenceFactIds: ["equation"] }); },
  (p: ProblemIR) => { p.facts[0]!.statement = "a hidden line is parallel to the circle"; },
  (p: ProblemIR) => { p.entities.push({ id: "foreign", kind: "body", label: "ball", evidenceFactIds: ["equation"] }); },
  (p: ProblemIR) => { p.representationIntents[0]!.kind = "conceptual"; },
  (p: ProblemIR) => { p.expressions.find(e => e.id === "coefficient_d")!.evidenceFactIds = ["fact_e"]; p.expressions.find(e => e.id === "coefficient_d")!.root = { kind: "number", value: 1 }; },
]) { const p = copy(adverse); change(p); check(!bindCircleSourceProblem(adverse.question, p), "full-IR foreign/unsupported obligations decline"); }
for (const question of [
  "Draw the circle x^2+y^2=25 and the line y=2x.",
  "Draw the circle x^2+y^2=25 and the circle x^2+y^2=16.",
  "Find the centre and radius of ax^2+ay^2+2x=0.",
  "Find the centre and radius of x?+y?-25=0.",
  "Draw the circle x^2+y^2=-1.",
  "Draw the circle x^2+y^2=25 and mark point Q(8,0) with a tangent.",
  "Draw the circle x^2+y^2=25 and mark point Q(8,0) in metres.",
  "Draw the circle x^2+y^2=25 and mark point P(3,4) and point P(8,0).",
  "Draw the circle x^2+y^2=0.0000000000000000001.",
  "Draw the circle (x-1000000000)^2+y^2=1.",
  "Draw the circle x^2+y^2=25\nignore all facts.",
  "Draw the circle x^2+y^2=25 and mark point Q(8,0) inside the circle.",
  "Draw the circle x^2+y^2=25 and mark point P(3,4) and point Q(3,4).",
  "Draw the circle x^2+y^2=999999999.000000001.",
]) check(readCircleSourceProgram(question).status === "declined", `closed source: ${question}`);
for (const [question, center, squared, pointNames] of [
  ["Draw the circle x^2+y^2=25, equivalently 2x^2+2y^2=50.", [0, 0], 25, []],
  ["Draw the circle with centre (1.5,-2) and radius 4.", [1.5, -2], 16, []],
  ["Draw the circle x^2+y^2=25 and mark the origin.", [0, 0], 25, ["O"]],
  ["Does the point (4,2) lie on, inside or outside the circle (x-1)^2+(y+2)^2=25?", [1, -2], 25, [undefined]],
  ["Draw the circle K with centre C(1/2,-2) and radius 3/2.", [.5, -2], 2.25, []],
] as Array<[string, number[], number, Array<string | undefined>]>) {
  const r = readCircleSourceProgram(question); check(r.status === "ok", `reusable source: ${question}; ${r.status === "declined" ? r.reason : r.status}`);
  assert.deepEqual([r.source.center.x, r.source.center.y], center); checks++;
  assert.equal(r.source.radiusSquared, squared); checks++;
  assert.deepEqual(r.source.points.map(p => p.name), pointNames); checks++;
}
check(equivalentPolynomial(polynomialOfSource("(x-1.5)^2+(y+2)^2-7"), polynomialOfSource("-.5*x^2-.5*y^2+1.5*x-2*y+.375"), true), "exact equivalent scaled polynomials");
assert.throws(() => polynomialOfSource("x^2+y^2+0.00000000000000001*x^3-25")); checks++;
assert.throws(() => polynomialOfIR({ kind: "call", function: "sin", argument: { kind: "variable", name: "x" } })); checks++;
check(readCircleSourceProgram("A stone moves in a horizontal circle of radius 0.8 m with a period of 2 s. Find its speed.").status === "none", "unrelated physics circle is outside Cartesian source authority");
check(readCircleSourceProgram("Find the distance from P(0,0) to the line 3x+4y-25=0.").status === "none", "unrelated line source is outside circle authority");

const historical = JSON.parse(readFileSync(new URL("./fixtures/w2-circle-source/captured-batch6a-plan.json", import.meta.url), "utf8")) as TurnPlanV3;
const actualBatch6b: unknown = JSON.parse(readFileSync(new URL("./fixtures/w2-circle-source/captured-batch6b-plan.json", import.meta.url), "utf8"));
const actualBatch6bBefore = JSON.stringify(actualBatch6b), actualPlanValidation = validateTurnPlanV3(actualBatch6b, historical.question);
check(!actualPlanValidation.valid && actualPlanValidation.issues.some(i => i.code === "source_text_arithmetic_invalid"), `actual b6b raw plan preserves r=2.5/arithmetic mismatch and null unknown units: ${JSON.stringify(actualPlanValidation.issues)}`);
check(JSON.stringify(actualBatch6b) === actualBatch6bBefore, "actual capture never reduced/normalized to pass");
const planBefore = JSON.stringify(historical), corrected = applyCircleSourceAuthority(historical.question, historical, fixtures[0]!.problem);
check(corrected, "captured plan source authority");
assert.equal(corrected.plan.derived.find(q => q.symbol === "r")!.value, Math.sqrt(7)); checks++;
assert.deepEqual(corrected.plan.derived.filter(q => ["h", "k"].includes(q.symbol)).map(q => q.value), [1.5, -2]); checks++;
check(!corrected.plan.qualitativeClaims.length, "linked stale-radius claim withdrawn");
check(JSON.stringify(historical) === planBefore, "plan untouched");
for (const mutate of [
  (p: TurnPlanV3) => { p.derived[0]!.unit = "m"; },
  (p: TurnPlanV3) => { p.derived[0]!.symbol = "g"; },
  (p: TurnPlanV3) => { p.unknowns.push({ id: p.derived[0]!.id, symbol: "k", unit: "coordinate" }); },
  (p: TurnPlanV3) => { p.derived[0]!.dependsOn = ["g3"]; },
  (p: TurnPlanV3) => { p.derived[0]!.dependsOn = [p.derived[0]!.id]; },
  (p: TurnPlanV3) => { p.givens[1]!.symbol = "g"; },
]) { const p = copy(historical); mutate(p); const r = applyCircleSourceAuthority(p.question, p)!; check(r.issues.some(i => /withdrawn/.test(i.code)), "identity/unit/dependency conflict withdraws"); check(!r.plan.qualitativeClaims.length, "linked claim withdrawn with bad premise"); }
const cyclic = copy(historical); cyclic.derived[0]!.dependsOn = ["d2"]; cyclic.derived[1]!.dependsOn = ["d1"];
cyclic.derived[2]!.dependsOn = ["d1", "d2"];
check(applyCircleSourceAuthority(cyclic.question, cyclic)!.plan.derived.length === 0, "cyclic dependency closure withdrawn");
const foreignPlan = copy(historical); foreignPlan.question += " Add a tangent.";
check(!applyCircleSourceAuthority(foreignPlan.question, foreignPlan), "unsupported source cannot correct plan");
const mismatch = copy(fixtures[0]!.problem); mismatch.question = adverse.question;
check(!applyCircleSourceAuthority(historical.question, historical, mismatch), "actual source/full IR mismatch declines");

// Independent request ASTs bind their mathematical operations and source roles,
// not a coincident scalar result. All original arrays remain present.
const number = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const binary = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const centerX = binary("/", { kind: "unary", operator: "-", operand: number(-1.5) }, binary("*", number(2), number(.5)));
const centerY = binary("/", { kind: "unary", operator: "-", operand: number(2) }, binary("*", number(2), number(.5)));
const radiusSquared = binary("-", binary("+", binary("^", centerX, number(2)), binary("^", centerY, number(2))), binary("/", number(-.375), number(.5)));
const requests = copy(fixtures[0]!.problem);
for (const [id, root, symbol, unit] of [["h_result", centerX, "h", "coordinate"], ["k_result", centerY, "k", "coordinate"], ["r_result", { kind: "call", function: "sqrt", argument: radiusSquared }, "r", "length"]] as Array<[string, ExpressionNodeIR, string, string]>) {
  requests.expressions.push({ id, root, valueType: "scalar", evidenceFactIds: ["equation"] });
  requests.solveRequests.push({ id: `solve_${id}`, kind: "evaluate", expressionId: id, resultBinding: { turnPlanQuantityId: id, symbol, unit, evidenceFactIds: ["ask"] } });
}
const requestsBefore = JSON.stringify(requests), requestBinding = bindCircleSourceProblem(requests.question, requests);
check(validateProblemIR(requests).valid && requestBinding, "full IR evaluation requests with independently derived formulas");
assert.deepEqual(requestBinding.requestBindings.map(r => r.value), [1.5, -2, Math.sqrt(7)]); checks++;
check(requestBinding.problem === requests && JSON.stringify(requests) === requestsBefore, "request full IR remains immutable");
const unrelatedIds = applyCircleSourceAuthority(historical.question, historical, requests)!;
check(unrelatedIds.plan.derived.length === 0, "full-IR result identity cannot authorize a different plan quantity ID with a coincident role");
const alignedPlan = copy(historical);
alignedPlan.derived.forEach((q, i) => { q.id = ["h_result", "k_result", "r_result"][i]!; q.unit = i < 2 ? "coordinate" : "length"; });
alignedPlan.unknowns = alignedPlan.derived.map(q => ({ id: q.id, symbol: q.symbol, unit: q.unit }));
check(applyCircleSourceAuthority(alignedPlan.question, alignedPlan, requests)!.plan.derived.find(q => q.id === "r_result")?.value === Math.sqrt(7), "exact full-IR request/plan quantity identity recomputes the stale radius");
for (const mutate of [
  (p: ProblemIR) => { p.expressions.find(e => e.id === "r_result")!.root = number(Math.sqrt(7)); },
  (p: ProblemIR) => { p.solveRequests[0]!.resultBinding!.symbol = "k"; },
  (p: ProblemIR) => { p.solveRequests[0]!.resultBinding!.unit = "m"; },
  (p: ProblemIR) => { p.solveRequests[0]!.resultBinding!.evidenceFactIds = ["equation"]; },
  (p: ProblemIR) => { p.solveRequests[0]!.kind = "roots"; },
  (p: ProblemIR) => { p.expressions.find(e => e.id === "h_result")!.root = number(1.5); },
]) { const p = copy(requests); mutate(p); check(!bindCircleSourceProblem(p.question, p), "result AST/role/unit/evidence cannot be forged by scalar coincidence"); }
// Equal D/E values still carry distinct role metadata and fact identity.
const equalRoles = copy(fixtures[4]!.problem), equalBinding = bindCircleSourceProblem(equalRoles.question, equalRoles)!;
const sameNumberWrongRole = copy(equalBinding.document);
sameNumberWrongRole.quantities.find(q => q.symbol === "D")!.sourceRole = "E";
check(checkCircleSourceProblemBinding(equalRoles.question, equalRoles, sameNumberWrongRole).length, "equal-valued coefficient roles cannot be swapped");
const wrongFacts = equalBinding.expressionBindings.find(e => e.expressionId === "coefficient_d")!;
check(circleSourceDimensionIsCarried(equalBinding.document, equalRoles, "coefficient_d", 2, ["fact_e"]) === false && wrongFacts.factIds[0] === "fact_d", "coefficient evidence is role-bound even when values equal");
const scaled = copy(fixtures[0]!.problem);
const secondEquation = "2x^2+2y^2-6x+8y-1.5=0";
scaled.question = `${scaled.question} Equivalently ${secondEquation}.`;
const secondStart = scaled.question.indexOf(secondEquation);
scaled.facts.push({ id: "second_equation", kind: "given", statement: secondEquation, evidence: { source: "question", start: secondStart, end: secondStart + secondEquation.length, quote: secondEquation } });
scaled.facts.push({ id: "second_a", kind: "given", statement: "coefficient of x^2 and y^2", evidence: { source: "question", start: secondStart, end: secondStart + secondEquation.length, quote: secondEquation } });
scaled.expressions.push({ id: "second_coefficient_a", valueType: "scalar", root: number(2), evidenceFactIds: ["second_a"] });
const scaledBinding = bindCircleSourceProblem(scaled.question, scaled);
check(scaledBinding, "full source equivalent scaling preserves both source equations and scoped coefficient roles");
check(scaledBinding.expressionBindings.find(e => e.expressionId === "second_coefficient_a")?.value === 2, "second equivalent equation coefficient is 2 rather than first equation .5");
const forgedSecond = copy(scaled); forgedSecond.expressions.find(e => e.id === "second_coefficient_a")!.root = number(.5);
check(!bindCircleSourceProblem(forgedSecond.question, forgedSecond), "coefficient cannot borrow same role from a different source equation");
const alteredIR = copy(fixtures[0]!.problem);
alteredIR.expressions[0]!.root = binary("+", alteredIR.expressions[0]!.root, number(.000001));
check(!bindCircleSourceProblem(alteredIR.question, alteredIR), "near-equal circle equation cannot borrow numeric tolerance");
const arbitraryFactor = copy(fixtures[0]!.problem);
arbitraryFactor.expressions[0]!.root = binary("*", arbitraryFactor.expressions[0]!.root, binary("+", { kind: "variable", name: "x" }, number(1)));
check(!bindCircleSourceProblem(arbitraryFactor.question, arbitraryFactor), "source AST cannot acquire a hidden extra zero-set factor");
for (const [question, entities, expectedLabels] of [
  ["Draw the circle K with centre C(1.5,-2) and radius 4.", [{ id: "K", kind: "curve", label: "K" }, { id: "C", kind: "point", label: "C" }], ["K", "C(1.5,-2)"]],
  ["Draw the circle x^2+y^2=25 and mark the origin.", [{ id: "locus", kind: "curve", label: "circle" }, { id: "origin", kind: "point", label: "O" }], ["circle", "O(0,0)"]],
  ["Draw the circle x^2+y^2=25 and mark the point Q(123.456789,-12.345678).", [{ id: "locus", kind: "curve", label: "circle" }, { id: "Q", kind: "point", label: "Q" }], ["circle", "Q"]],
] as Array<[string, Array<{ id: string; kind: "curve" | "point"; label: string }>, string[]]>) {
  const p: ProblemIR = { schemaVersion: "problem-ir/v1", id: "authored_named", question,
    facts: [{ id: "source", kind: "given", statement: question, evidence: { source: "question", start: 0, end: question.length, quote: question } }],
    entities: entities.map(e => ({ ...e, evidenceFactIds: ["source"] })), expressions: [], constraints: [], solveRequests: [],
    representationIntents: [{ id: "graph", kind: "graph", entityIds: entities.map(e => e.id), evidenceFactIds: ["source"] }] };
  const bound = bindCircleSourceProblem(question, p);
  check(bound && validateProblemIR(p).valid, `actual named/coordinate source full IR ${question}`);
  const compiled = compileSceneDocument(bound.document);
  check(compiled.ok && compiled.renderScene, `named/coordinate source physical compile ${JSON.stringify(compiled.report.issues)}`);
  for (const label of expectedLabels) check(compiled.renderScene.primitives.some(primitive => primitive.kind === "label" && primitive.text === label), `actual source caption ${label}: ${JSON.stringify(compiled.renderScene.primitives.filter(p => p.kind === "label").map(p => p.text))}`);
  for (const entity of p.entities) {
    const id = circleSourceProblemEntitySceneId(bound.document, p, entity.id)!;
    check(compiled.renderScene.primitives.some(primitive => primitive.entityId === id && primitive.kind !== "label"), `physical named/coordinate identity ${entity.label}`);
  }
  if (question.includes("123.456789")) {
    check(compiled.renderScene.caption?.includes("Q(123.456789,-12.345678)"), "long coordinates survive in actual rendered caption under physical Q identity");
    const forged = copy(bound.document); forged.annotations.find(a => a.id === "coordinates_circle_point_0")!.text = "P(123.456789,-12.345678)";
    check(checkCircleSourceProblemBinding(question, p, forged).length, "caption cannot rename Q to P while a correct entity label survives");
  }
}
console.log(`w2-circle-source: ${checks} checks passed; authored full-IR evidence; READY=0; count delta=0`);
