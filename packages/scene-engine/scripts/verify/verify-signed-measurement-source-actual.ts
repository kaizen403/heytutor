import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { verifyMeasurementSourceAuthority as Verify } from "../../src/ir/measurementSourceAuthority";
import type { ExpressionNodeIR, ProblemIR } from "../../src/ir/problemIR";

const built = process.argv.includes("--built");
const { verifyMeasurementSourceAuthority: verify } = await import(built
  ? "../../dist/index.js"
  : "../../src/index.ts") as { verifyMeasurementSourceAuthority: typeof Verify };

const captured = JSON.parse(readFileSync(new URL("./fixtures/w3-signed-measurement-source-actual/captured-input.json", import.meta.url), "utf8")) as {
  problem: ProblemIR;
  plan: TurnPlanV3;
  rawInput: { issueCodes: string[]; rawProblemIR: { expressions: { expr: string }[] }; rawTurnPlan: TurnPlanV3 };
};
assert.deepEqual(captured.rawInput.issueCodes, ["expression_source_lineage_incomplete"]);
assert.equal(captured.rawInput.rawProblemIR.expressions[0]?.expr, "((2.675+(-0.02))-2.5)/0.005");
assert.equal(JSON.stringify(captured.rawInput.rawTurnPlan), JSON.stringify(captured.plan), "freeze the complete rejected caller Plan verbatim");
const beforeProblem = structuredClone(captured.problem);
const beforePlan = structuredClone(captured.plan);
const result = verify(captured.problem, captured.plan, captured.problem.question);
assert.equal(result.status, "verified", `actual signed numeric literal should verify: ${JSON.stringify(result.issues)}`);
assert.equal(result.numericalAuthority?.value, 31);
assert.equal(JSON.stringify(result.problem), JSON.stringify(beforeProblem), "the complete caller IR is preserved structurally");
assert.deepEqual(captured.problem, beforeProblem, "verification does not normalize or mutate the original IR");
assert.deepEqual(captured.plan, beforePlan, "verification does not mutate the actual full Plan");

const num = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const op = (operator: "+" | "-" | "/", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
type Input = { problem: ProblemIR; plan: TurnPlanV3 };
function caseInput({ diameter, zeroError, main, expected }: { diameter: number; zeroError: number; main: number; expected: number }): Input {
  const signed = `${zeroError < 0 ? "-" : "+"}${Math.abs(zeroError)}`;
  const scales = "Least count corresponding to the main scale and circular scale of a screw gauge are 0.5 mm and 0.005 mm, respectively.";
  const wire = `A wire of diameter ${diameter} mm`;
  const zero = `zero error of the screw gauge is ${signed} mm`;
  const ask = `What would be the reading of divisions on circular scale of the screw gauge, if the ${zero}?`;
  const question = `${scales} ${wire} is measured with the screw gauge. ${ask}`;
  const quote = (text: string) => {
    const start = question.indexOf(text);
    assert.notEqual(start, -1, `source clause is present: ${text}`);
    return { source: "question" as const, start, end: start + text.length, quote: text };
  };
  const facts: ProblemIR["facts"] = [
    { id: "p", kind: "given", statement: "pitch", evidence: quote(scales) },
    { id: "LC", kind: "given", statement: "least count", evidence: quote(scales) },
    { id: "d", kind: "given", statement: "wire diameter", evidence: quote(`${wire} is measured with the screw gauge.`) },
    { id: "e0", kind: "given", statement: "zero error", evidence: quote(zero) },
    { id: "circular_reading", kind: "requested", statement: "circular scale divisions", evidence: quote(ask) },
  ];
  const evidenceFactIds = facts.map(fact => fact.id);
  const signedError: ExpressionNodeIR = { kind: "unary", operator: zeroError < 0 ? "-" : "+", operand: num(Math.abs(zeroError)) };
  const root = op("/", op("-", op("+", num(diameter), signedError), num(main)), num(0.005));
  const problem: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: "signedMeasurementCase", question, facts,
    entities: [{ id: "wire", kind: "body", label: "wire", evidenceFactIds: ["d"] }],
    expressions: [{ id: "count", valueType: "scalar", root, evidenceFactIds }],
    constraints: [], representationIntents: [],
    solveRequests: [{ id: "countRequest", kind: "evaluate", expressionId: "count", resultBinding: { turnPlanQuantityId: "count", symbol: "n", unit: "division", evidenceFactIds } }],
  };
  const givens: TurnPlanV3["givens"] = [
    { id: "p", symbol: "p", value: 0.5, unit: "mm", sourceText: `pitch ${scales}`, provenance: "given" },
    { id: "LC", symbol: "LC", value: 0.005, unit: "mm", sourceText: `least count ${scales}`, provenance: "given" },
    { id: "d", symbol: "d", value: diameter, unit: "mm", sourceText: `diameter ${wire} is measured with the screw gauge.`, provenance: "given" },
    { id: "e0", symbol: "e_0", value: zeroError, unit: "mm", sourceText: `zero error ${zero}`, provenance: "given" },
  ];
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question, givens,
    unknowns: [{ id: "count", symbol: "n", unit: "division" }],
    derived: [{ id: "count", symbol: "n", value: expected, unit: "division", sourceText: facts.map(fact => fact.evidence.quote).join(" | "), provenance: "derived", dependsOn: givens.map(row => row.id) }],
    qualitativeClaims: [], lawIds: ["micrometer_reading"], assumptions: [], visualRequirement: "none",
  };
  return { problem, plan };
}

for (const { name, input, expected } of [
  { name: "positive error", input: caseInput({ diameter: 2.675, zeroError: 0.02, main: 2.5, expected: 39 }), expected: 39 },
  { name: "zero error and zero divisions", input: caseInput({ diameter: 2.5, zeroError: 0, main: 2.5, expected: 0 }), expected: 0 },
  { name: "negative error crosses below the sleeve mark", input: caseInput({ diameter: 3.005, zeroError: -0.01, main: 2.5, expected: 99 }), expected: 99 },
]) {
  const before = structuredClone(input.problem);
  const checked = verify(input.problem, input.plan, input.problem.question);
  assert.equal(checked.status, "verified", `${name}: ${JSON.stringify(checked.issues)}`);
  assert.equal(checked.numericalAuthority?.value, expected, `${name}: source-derived count`);
  assert.equal(JSON.stringify(checked.problem), JSON.stringify(before), `${name}: complete AST is retained`);
  assert.deepEqual(input.problem, before, `${name}: caller AST is unchanged`);
}

function reject(name: string, problem: unknown, plan: unknown, code: string): void {
  const declined = verify(problem, plan);
  assert.equal(declined.status, "declined", `${name}: unsupported caller must decline`);
  assert.equal(declined.issues[0]?.code, code, `${name}: bounded refusal code`);
  assert.equal(declined.numericalAuthority, null, `${name}: no numerical authority escapes`);
}

const wrongSign = structuredClone(captured);
const wrongSignRoot = wrongSign.problem.expressions[0]!.root as Extract<ExpressionNodeIR, { kind: "binary" }>;
const wrongSignObserved = wrongSignRoot.left as Extract<ExpressionNodeIR, { kind: "binary" }>;
const wrongSignAdd = wrongSignObserved.left as Extract<ExpressionNodeIR, { kind: "binary" }>;
const wrongSignLiteral = wrongSignAdd.right as Extract<ExpressionNodeIR, { kind: "unary" }>;
wrongSignLiteral.operator = "+";
reject("wrong sign cannot borrow the answer", wrongSign.problem, wrongSign.plan, "expression_source_lineage_incomplete");

const constant = structuredClone(captured);
constant.problem.expressions[0]!.root = num(31);
reject("answer-valued constant has no source role", constant.problem, constant.plan, "expression_source_lineage_incomplete");

const cancellation = structuredClone(captured);
cancellation.problem.expressions[0]!.root = op("+", num(31), op("-", num(2.675), num(2.675)));
reject("canceling operands cannot stand in for source premises", cancellation.problem, cancellation.plan, "expression_source_lineage_incomplete");

const nestedSign = structuredClone(captured);
const nestedRoot = nestedSign.problem.expressions[0]!.root as Extract<ExpressionNodeIR, { kind: "binary" }>;
const nestedObserved = nestedRoot.left as Extract<ExpressionNodeIR, { kind: "binary" }>;
const nestedAdd = nestedObserved.left as Extract<ExpressionNodeIR, { kind: "binary" }>;
const signedAtom = nestedAdd.right as Extract<ExpressionNodeIR, { kind: "unary" }>;
nestedAdd.right = { kind: "unary", operator: "-", operand: signedAtom };
reject("nested sign arithmetic is outside the signed atom proof", nestedSign.problem, nestedSign.plan, "expression_source_lineage_incomplete");

const wrongInstrument = structuredClone(captured);
wrongInstrument.problem.entities[1]!.label = "vernier caliper";
reject("unsupported instrument remains declined", wrongInstrument.problem, wrongInstrument.plan, "unsupported_entity");

const extraProblemField = structuredClone(captured.problem) as ProblemIR & { hidden: boolean };
extraProblemField.hidden = true;
reject("closed ProblemIR fields stay enforced", extraProblemField, captured.plan, "uncovered_problem_field");
const extraPlanField = structuredClone(captured.plan) as TurnPlanV3 & { hidden: boolean };
extraPlanField.hidden = true;
reject("closed Plan fields stay enforced", captured.problem, extraPlanField, "uncovered_plan_field");

let accessorExecuted = false;
const accessorPlan = structuredClone(captured.plan);
Object.defineProperty(accessorPlan, "hidden", { enumerable: true, get() { accessorExecuted = true; return 1; } });
reject("own accessors are rejected before execution", captured.problem, accessorPlan, "invalid_source_data");
assert.equal(accessorExecuted, false);
const inheritedPlan = structuredClone(captured.plan);
Object.setPrototypeOf(inheritedPlan, { hidden: true });
reject("inherited caller data is rejected", captured.problem, inheritedPlan, "invalid_source_data");

console.log(`Signed measurement source proof passed: actual capture + 3 independent sign/zero/crossing cases and 9 refusal/guard controls (${built ? "built ESM" : "TypeScript source"}).`);
