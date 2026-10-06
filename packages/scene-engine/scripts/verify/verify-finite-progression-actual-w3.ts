/** Independent whole-capture/role gate. No chapter dispatch or another session's gates. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeProblemIRModelOutput, parseInfixExpression } from "../../../tutor-core/src/planners/problemPlannerV1";
import type { ExpressionNodeIR, ProblemIR, SceneDocument, TurnPlanV3 } from "../../src/index";

const mode = process.argv.includes("--esm") ? "built ESM" : "source";
const engine = mode === "built ESM" ? await import("../../dist/index.js") : await import("../../src/index");
const fixture = JSON.parse(readFileSync(new URL("../../fixtures/source/finite-progression-actual-w3-20261006.json", import.meta.url), "utf8"));
type Case = { question: string; problem: ProblemIR; plan: TurnPlanV3; values: number[] };
let checks = 0;
const check = (value: unknown, message: string) => { checks++; assert.ok(value, message); };
const equal = (actual: unknown, expected: unknown, message: string) => { checks++; assert.deepEqual(structuredClone(actual), structuredClone(expected), message); };
const root = (expr: string): ExpressionNodeIR => {
  const parsed = parseInfixExpression(expr);
  assert.ok(parsed, expr);
  return parsed as unknown as ExpressionNodeIR;
};
const actual: Case = { question: fixture.question, problem: fixture.normalizedProblemIR, plan: fixture.actualPlan, values: [62, 670] };
const normalized = normalizeProblemIRModelOutput(fixture.rawProblemIR, fixture.question, fixture.actualPlan) as ProblemIR;
equal(normalized, actual.problem, "frozen actual full IR equals canonical normalizer output");
for (const key of ["facts", "entities", "expressions", "constraints", "representationIntents", "solveRequests"] as const) {
  equal(actual.problem[key].map(item => item.id), fixture.rawProblemIR[key].map((item: {id: string}) => item.id), `all actual ${key} retained`);
}
fixture.rawProblemIR.facts.forEach((fact: {statement: string; quote: string}, i: number) => {
  equal(actual.problem.facts[i]!.statement, fact.statement, "full fact statement retained");
  equal(actual.problem.facts[i]!.evidence.quote, fact.quote, "exact fact quote retained");
});
fixture.rawProblemIR.expressions.forEach((expression: {expr: string}, i: number) => equal(actual.problem.expressions[i]!.root, root(expression.expr), "full unsimplified actual AST retained"));

function admitted(name: string, c: Case): SceneDocument {
  const before = structuredClone(c);
  const result = engine.finiteProgressionSourceProgram(c.question, c.problem, c.plan);
  check(result.status === "ok", `${name}: ${result.status === "declined" ? result.reason : ""}`);
  assert.ok(result.status === "ok");
  equal(c, before, `${name}: no input mutation`);
  equal(result.problem, c.problem, `${name}: complete IR retained`);
  equal(result.plan, c.plan, `${name}: actual Plan retained`);
  equal(result.document.source?.problemIR, c.problem, `${name}: complete IR in document`);
  equal(result.document.source?.turnPlan, c.plan, `${name}: actual Plan in document`);
  equal(result.bindings.map(binding => binding.ask.value), c.values, `${name}: independent recurrence oracle`);
  check(result.bindings.every(binding => c.plan.unknowns.some(quantity => quantity.id === binding.quantityId && quantity.symbol === binding.symbol)), `${name}: exact source bindings`);
  equal(engine.validateFiniteProgressionSourceDocument(result.document, c.question, c.problem, c.plan), [], `${name}: source regeneration`);
  const restored = JSON.parse(JSON.stringify(result.document));
  equal(engine.validateFiniteProgressionSourceDocument(restored, c.question, c.problem, c.plan), [], `${name}: offline JSON round trip`);
  const primitives = engine.finiteProgressionSourceTablePrimitives(restored, c.question, c.problem, c.plan);
  check(primitives.length > 0 && primitives.every(primitive => primitive.provenance?.sourceSequence === result.source.sequence), `${name}: source table ink`);
  const options = { sourceAuthority: {question: c.question, problemIR: c.problem, turnPlan: c.plan} };
  const validated = engine.validateSceneDocument(restored, options);
  check(validated.report.valid, `${name}: normal document validation ${JSON.stringify(validated.report.issues)}`);
  const compiled = engine.compileSceneDocument(restored, options);
  check(compiled.ok && compiled.report.valid && (compiled.renderScene?.primitives.length ?? 0) > 0, `${name}: normal compiler ${JSON.stringify(compiled.report.issues)}`);
  check(!compiled.renderScene!.primitives.some(primitive => primitive.kind === "polyline" || primitive.kind === "axes"), `${name}: discrete nonmetric ink`);
  return result.document;
}
function declined(name: string, c: Case, reason?: RegExp): void {
  const before = structuredClone(c);
  const result = engine.finiteProgressionSourceProgram(c.question, c.problem, c.plan);
  check(result.status === "declined", `${name}: must decline atomically`);
  assert.ok(result.status === "declined");
  if (reason) check(reason.test(result.reason), `${name}: ${result.reason}`);
  check(!("document" in result) && !("bindings" in result), `${name}: no partial authority`);
  equal(c, before, `${name}: no pruning or mutation`);
}
function mutate(base: Case, edit: (c: Case) => void): Case { const c = structuredClone(base); edit(c); return c; }
function expression(c: Case, id: string, expr: string): void { c.problem.expressions.find(item => item.id === id)!.root = root(expr); }

/** Authored holdouts use arithmetic recurrence, NOT the source reader or ask AST. */
function direct(sequence: string, kind: "arithmetic" | "geometric", first: string, parameter: string, n: number, sumForm = "canonical"): Case {
  const scalar = (literal: string) => literal.split("/").map(Number).reduce((a, b) => a / b);
  let term = scalar(first), sum = 0;
  for (let i = 1; i <= n; i++) { sum += term; if (i < n) term = kind === "arithmetic" ? term + scalar(parameter) : term * scalar(parameter); }
  const parameterName = kind === "arithmetic" ? "difference" : "ratio";
  const model = `Let ${sequence}_n be an ${kind} progression with ${sequence}_1 = ${first} and common ${parameterName} ${parameter}.`;
  const symbols = [`${sequence}_${n}`, `sum_{k=1}^${n} ${sequence}_k`];
  const question = `${model} Find ${symbols.join(", ")}.`;
  const plan: TurnPlanV3 = {schemaVersion: "turn-plan/v3", question, givens: [], unknowns: symbols.map((symbol, i) => ({id: `answer${i}`, symbol, unit: "1"})), derived: symbols.map((symbol, i) => ({id: `answer${i}`, symbol, unit: "1", value: i ? sum : term, provenance: "derived"})), assumptions: [], qualitativeClaims: [], lawIds: [], visualRequirement: "optional"};
  const f = `(${first})`, p = `(${parameter})`, tail = `(${n}-1)*${p}`;
  const termExpr = kind === "arithmetic" ? `${f}+${tail}` : `${f}*${p}^(${n}-1)`;
  let sumExpr = kind === "arithmetic" ? `${n}*(2*${f}+${tail})/2` : scalar(parameter) === 1 ? `${n}*${f}` : `${f}*(1-${p}^${n})/(1-${p})`;
  if (sumForm === "pair") sumExpr = `${n}*(${f}+(${f}+${tail}))/2`;
  if (sumForm === "half") sumExpr = `(${n}/2)*(2*${f}+${tail})`;
  if (sumForm === "reversed") sumExpr = `${f}*(${p}^${n}-1)/(${p}-1)`;
  const quotes = [model, `${sequence}_1 = ${first}`, `common ${parameterName} ${parameter}`, ...symbols];
  const ids = ["fModel", "fFirst", "fParameter", "fTerm", "fSum"];
  const raw = {
    facts: quotes.map((quote, i) => {
      const start = i < 3 ? question.indexOf(quote) : question.lastIndexOf(quote);
      return {id: ids[i], kind: i < 3 ? "given" : "requested", statement: quote, evidence: {source: "question", start, end: start + quote.length, quote}};
    }),
    entities: [{id: "sequence", kind: "other", label: `${sequence}_n`, evidenceFactIds: [ids[0]]}],
    expressions: [{id: "eModel", valueType: "function", expr: kind === "arithmetic" ? `${f}+(n-1)*${p}` : `${f}*${p}^(n-1)`, evidenceFactIds: [ids[0]]}, {id: "eTerm", valueType: "scalar", expr: termExpr, evidenceFactIds: [ids[3]]}, {id: "eSum", valueType: "scalar", expr: sumExpr, evidenceFactIds: [ids[4]]}],
    constraints: [], representationIntents: [{id: "concept", kind: "conceptual", entityIds: ["sequence"], evidenceFactIds: ids}],
    solveRequests: symbols.map((symbol, i) => ({id: `solve${i}`, kind: "evaluate", expressionId: i ? "eSum" : "eTerm", resultBinding: {turnPlanQuantityId: `answer${i}`, symbol, unit: "1", evidenceFactIds: [ids[i + 3]]}})),
  };
  return {question, plan, problem: normalizeProblemIRModelOutput(raw, question, plan) as ProblemIR, values: [term, sum]};
}
const document = admitted("actual original full capture", actual);
for (const [role, factId, label] of [["first", "fFirst", "a_1=5"], ["parameter", "fDiff", "d=3"]]) {
  const summary = document.entities.find(entity => entity.provenance?.sourceRole === role);
  equal(summary?.label, label, "grounded conceptual premise is represented");
  check((summary?.provenance?.evidenceFactIds as string[]).includes(factId!), "redundant actual fact has explicit representation provenance");
}
const pairActual = mutate(actual, c => expression(c, "eSum", "20*(5+(5+(20-1)*3))/2"));
admitted("actual pair-sum source roles", pairActual);
admitted("actual half product", mutate(actual, c => expression(c, "eSum", "(20/2)*(2*5+(20-1)*3)")));
admitted("actual associated pair", mutate(actual, c => expression(c, "eSum", "20*((5+5)+(20-1)*3)/2")));
const cases = [
  direct("b", "arithmetic", "-7", "-2", 6, "pair"),
  direct("c", "arithmetic", "-3/2", "1/4", 8, "half"),
  direct("d", "arithmetic", "0", "4", 1, "pair"),
  direct("f", "arithmetic", "3", "5", 2),
  direct("g", "arithmetic", "8", "0", 7, "pair"),
  direct("h", "geometric", "3", "2", 5, "reversed"),
  direct("j", "geometric", "-2", "-3", 4, "reversed"),
  direct("k", "geometric", "8", "1/2", 4, "reversed"),
  direct("m", "geometric", "-4", "1", 5),
  direct("p", "geometric", "7", "0", 4),
];
cases.forEach((c, i) => admitted(`independent AP/GP holdout ${i}`, c));

for (const [name, expr] of [
  ["answer-only constant", "670"],
  ["same answer foreign operands", "10*67"],
  ["answer substituted for source term role", "20*(5+62)/2"],
  ["canceling foreign extras", "20*(2*5+(20-1)*3)/2+(997-997)"],
  ["canceling source-looking extras", "20*(2*5+(20-1)*3)/2+(3-3)"],
  ["wrong first role", "20*(3+(5+(20-1)*3))/2"],
  ["wrong ordinal role", "19*(5+(5+(20-1)*3))/2"],
  ["foreign compensated first", "20*(2*2+(20-1)*3+6)/2"],
]) declined(name!, mutate(actual, c => expression(c, "eSum", expr!)), /solve AST/);
declined("wrong roles with equal answer", mutate(cases[3]!, c => expression(c, "eTerm", "5+(2-1)*3")), /solve AST/);
for (const expr of ["93", "6*2^(4-1)", "3*(2^5-1)/(1-2)", "3*(1-2^5)/(2-1)", "3*(2^5-1)/(2-1)+(2-2)"]) {
  declined(`GP wrong/equal/canceling ${expr}`, mutate(cases[5]!, c => expression(c, "eSum", expr)), /solve AST/);
}
declined("AP wrong model with same value at zero", mutate(actual, c => expression(c, "eModel", "3+(n-1)*1")), /uncovered full-IR expression/);
declined("GP foreign model operands", mutate(cases[5]!, c => expression(c, "eModel", "6*2^(n-2)")), /uncovered full-IR expression/);
declined("wrong requested role", mutate(actual, c => { c.problem.expressions.find(item => item.id === "eSum")!.evidenceFactIds = ["fAskTerm"]; }), /solve AST/);
declined("unconsumed grounded facts", mutate(actual, c => { c.problem.representationIntents[0]!.evidenceFactIds = ["fModel", "fAskTerm", "fAskSum"]; }), /fFirst,fDiff/);
declined("unconsumed first fact", mutate(actual, c => { c.problem.representationIntents[0]!.evidenceFactIds = ["fModel", "fDiff", "fAskTerm", "fAskSum"]; }), /: fFirst$/);
declined("false given statement", mutate(actual, c => { c.problem.facts[1]!.statement = "a_1 = 3"; }), /fact statement/);
declined("contradictory model statement", mutate(actual, c => { c.problem.facts[0]!.statement = "Let a_n be a geometric progression with a_1 = 5 and common ratio 3."; }), /fact statement/);
declined("arbitrary intent cannot consume clipped fact", mutate(actual, c => {
  const start = c.question.indexOf("difference 3");
  c.problem.facts.push({id: "fExtra", kind: "given", statement: "difference 3", evidence: {source: "question", start, end: start + 12, quote: "difference 3"}});
  c.problem.representationIntents[0]!.evidenceFactIds.push("fExtra");
}), /uncovered full-IR fact role/);
declined("uncertain Plan", mutate(actual, c => { c.plan.derived[0]!.uncertainty = 0.1; }), /uncertain/);
declined("empty actual Plan quantities", mutate(actual, c => { c.plan.unknowns = []; c.plan.derived = []; }), /actual requested plan quantity/);
declined("stale Plan result", mutate(actual, c => { c.plan.derived[1]!.value = 671; }), /stale/);
declined("empty actual Plan", {...actual, plan: {} as TurnPlanV3}, /TurnPlan invalid/);
declined("actual unknown binding must not be renamed", mutate(actual, c => { c.plan.unknowns[1]!.id = "foreign"; }), /one-to-one|binding|TurnPlan invalid/);
declined("non-conceptual interpolation", mutate(actual, c => { c.problem.representationIntents[0]!.kind = "graph"; }), /conceptual/);
declined("uncovered constraint retained", mutate(actual, c => { c.problem.constraints.push({id: "extra", kind: "parallel", entityIds: ["seqA", "seqA"], evidenceFactIds: ["fModel"]}); }), /constraint|ProblemIR invalid/);
declined("uncovered extra expression", mutate(actual, c => { c.problem.expressions.push({id: "extra", valueType: "scalar", root: root("5+3"), evidenceFactIds: ["fFirst"]}); }), /uncovered full-IR expression/);
declined("oversized finite domain", direct("t", "arithmetic", "1", "1", 65), /outside0\.\.64/);
declined("foreign entity role", mutate(actual, c => { c.problem.entities[0]!.label = "b_n"; }), /entity/);
declined("unmodeled fields preserved then rejected", mutate(actual, c => { Object.assign(c.problem, {extraObligation: "must survive"}); }), /uncovered actual/);
for (const prefix of ["It is false that ", "Suppose the following unverified claim: ", "Maybe "]) {
  declined(`false/hypothetical source ${prefix}`, mutate(actual, c => { c.question = prefix + c.question; c.problem.question = c.question; c.plan.question = c.question; }), /source is unsupported/);
}
const withConstraints = mutate(actual, c => {
  c.problem.expressions.push({id: "leftFirst", valueType: "function", root: root("a_1"), evidenceFactIds: ["fFirst"]}, {id: "rightFirst", valueType: "scalar", root: root("5"), evidenceFactIds: ["fFirst"]});
  c.problem.constraints.push({id: "firstEquation", kind: "equation", leftExpressionId: "leftFirst", rightExpressionId: "rightFirst", evidenceFactIds: ["fFirst"]});
});
admitted("complete source constraint retained", withConstraints);
admitted("first fact consumed by proved equation", mutate(withConstraints, c => { c.problem.representationIntents[0]!.evidenceFactIds = ["fModel", "fDiff", "fAskTerm", "fAskSum"]; }));
declined("false source constraint", mutate(withConstraints, c => expression(c, "rightFirst", "3")), /constraint AST/);

for (const edit of [
  (doc: SceneDocument) => { doc.entities.find(entity => entity.id === "result_1")!.label = "S_20(a)=671"; },
  (doc: SceneDocument) => { doc.requiredEntityIds.pop(); },
  (doc: SceneDocument) => { doc.revealGroups.pop(); },
  (doc: SceneDocument) => { (doc.source!.problemIR as ProblemIR).facts.pop(); },
  (doc: SceneDocument) => { (doc.source!.turnPlan as TurnPlanV3).unknowns = []; },
]) {
  const forged = structuredClone(document); edit(forged);
  check(engine.validateFiniteProgressionSourceDocument(forged, actual.question, actual.problem, actual.plan).length > 0, "forged document rejected by regeneration");
  const compiled = engine.compileSceneDocument(forged, {sourceAuthority: {question: actual.question, problemIR: actual.problem, turnPlan: actual.plan}});
  check(!compiled.ok && !compiled.report.valid && compiled.renderScene === null, "forged document emits no partial ink");
}
check(engine.validateFiniteProgressionSourceDocument(document, actual.question, actual.problem, {}).length > 0, "saved scene cannot replace missing actual Plan");
console.log(JSON.stringify({mode, checks, actualCapture: "full IR + actual Plan admitted", actualStudentCredit: 0}));
