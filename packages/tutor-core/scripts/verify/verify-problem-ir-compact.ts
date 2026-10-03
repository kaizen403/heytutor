/**
 * The compact ProblemIR wire format (4 Oct 2026), with origin/main's numeric
 * semantics: the model still sees the validated plan.
 *
 * Measured on 14 live calls, the pretty problem-ir/v1 object cost a median
 * 1,088 completion tokens at ~72 tok/s on DeepSeek V4.1 Flash, so the call ran
 * 14.5s median and 3 of 14 passed the client's 18s deadline. The model now
 * writes facts as a quote, expressions as bounded infix, and skips the
 * constant and echoed fields. This gate proves the compact form lifts to the
 * same validated problem-ir/v1 and that nothing about the authority weakened.
 * Every numeric case runs the live hook's order (reconcile, then audit),
 * because reconcile rewrites plan values before the audit can see them: a
 * wrong formulation must never come out `verified` with a changed value.
 */
import { strict as assert } from "node:assert";
import {
  reconcileTurnPlanWithSolver,
  validateProblemIR,
  verifyTurnPlanAgainstSolver,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  bindProblemIRToTurnPlan,
  normalizeProblemIRModelOutput,
  parseInfixExpression,
  planAndSolveProblemV1,
  planValueRoundsSolverValue,
  problemIRUserMessage,
  withdrawDisagreeingBindings,
  type ProblemAuthorityV1Response,
} from "../../src/planners/problemPlannerV1";

const question =
  "A ball is projected at 20 m/s at 30 degrees above the horizontal from level ground. " +
  "Find the time of flight, the maximum height and the range. Take g = 10 m/s^2.";
const range = (20 ** 2 * Math.sin((60 * Math.PI) / 180)) / 10;

const turnPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question,
  givens: [],
  unknowns: [
    { id: "T", symbol: "T", unit: "s" },
    { id: "H", symbol: "H", unit: "m" },
    { id: "R", symbol: "R", unit: "m" },
  ],
  derived: [
    { id: "T", symbol: "T", value: 2, unit: "s", provenance: "derived", sourceText: "T = 2 u sin(theta) / g" },
    { id: "H", symbol: "H", value: 5, unit: "m", provenance: "derived", sourceText: "H = (u sin(theta))^2 / (2 g)" },
    { id: "R", symbol: "R", value: 34.64, unit: "m", provenance: "derived", sourceText: "R = u^2 sin(2 theta) / g" },
  ],
  qualitativeClaims: [],
  lawIds: ["projectile_motion"],
  assumptions: [],
  visualRequirement: "optional",
};

function compactOutput(rangeExpr: string, extra: Record<string, unknown> = {}) {
  return {
    facts: [
      { id: "fSpeed", kind: "given", statement: "initial speed 20 m/s", quote: "20 m/s" },
      { id: "fAngle", kind: "given", statement: "angle 30 degrees", quote: "30 degrees" },
      { id: "fG", kind: "given", statement: "g is 10", quote: "g = 10 m/s^2" },
      { id: "fTime", kind: "requested", statement: "time of flight", quote: "Find the time of flight" },
      { id: "fHeight", kind: "requested", statement: "maximum height", quote: "the maximum height" },
      { id: "fRange", kind: "requested", statement: "range", quote: "the range" },
    ],
    entities: [
      { id: "ball", kind: "body", label: "ball", evidenceFactIds: ["fSpeed"] },
    ],
    expressions: [
      { id: "eTime", valueType: "scalar", expr: "2*20*sin(30*pi/180)/10", evidenceFactIds: ["fSpeed", "fAngle", "fG"] },
      { id: "eHeight", valueType: "scalar", expr: "(20*sin(30*pi/180))^2/(2*10)", evidenceFactIds: ["fSpeed", "fAngle", "fG"] },
      { id: "eRange", valueType: "scalar", expr: rangeExpr, evidenceFactIds: ["fSpeed", "fAngle", "fG"] },
    ],
    constraints: [],
    representationIntents: [
      { id: "iPath", kind: "graph", entityIds: ["ball"], evidenceFactIds: ["fSpeed"] },
    ],
    solveRequests: [
      { id: "sTime", kind: "evaluate", expressionId: "eTime", resultBinding: { turnPlanQuantityId: "T", symbol: "T", unit: "s", evidenceFactIds: ["fTime"] } },
      { id: "sHeight", kind: "evaluate", expressionId: "eHeight", resultBinding: { turnPlanQuantityId: "H", symbol: "H", unit: "m", evidenceFactIds: ["fHeight"] } },
      { id: "sRange", kind: "evaluate", expressionId: "eRange", resultBinding: { turnPlanQuantityId: "R", symbol: "R", unit: "m", evidenceFactIds: ["fRange"] } },
    ],
    ...extra,
  };
}

function modelReturns(content: unknown, seen?: { body?: { messages: Array<{ content: string }> } }): typeof fetch {
  return async (_input, init) => {
    if (seen) seen.body = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] });
  };
}

const options = (fetchImpl: typeof fetch) => ({ proxyUrl: "http://localhost/api/chat", timeoutMs: 2_000, fetchImpl });

/** Exactly what useQuestionHandler and the lecture pipeline do with a result. */
function liveOutcome(result: ProblemAuthorityV1Response | null, plan: TurnPlanV3 = turnPlan) {
  if (!result) return { status: "null" as const, taught: plan.derived };
  const reconciled = reconcileTurnPlanWithSolver(plan, result.problemIR, result.solverResult);
  const audit = verifyTurnPlanAgainstSolver(result.problemIR, result.solverResult, reconciled, question);
  return { status: audit.status, taught: reconciled.derived };
}

/** A verified lesson may only sharpen a rounded plan value, never change it. */
function assertNoChangedAnswer(outcome: ReturnType<typeof liveOutcome>, label: string, plan: TurnPlanV3 = turnPlan) {
  for (const quantity of outcome.taught) {
    const original = plan.derived.find((candidate) => candidate.id === quantity.id)!;
    if (outcome.status === "verified") {
      assert.ok(planValueRoundsSolverValue(original.value, quantity.value), `${label}: verified ${quantity.id} moved from ${original.value} to ${quantity.value}`);
    } else {
      assert.equal(quantity.value, original.value, `${label}: an unverified turn must keep the plan's ${quantity.id}`);
    }
  }
}

// 1. The compact form lifts to valid problem-ir/v1 and verifies a correct plan.
const seen: { body?: { messages: Array<{ content: string }> } } = {};
const verified = await planAndSolveProblemV1(
  question,
  turnPlan,
  options(modelReturns(compactOutput("20^2*sin(2*30*pi/180)/10"), seen)),
);
// The planner's own audit runs before reconcile, so a rounded plan value reads
// as a contradiction there; the live hook's order is what a student sees.
assert.ok(verified, "compact output must solve");
const verifiedLive = liveOutcome(verified);
assert.equal(verifiedLive.status, "verified", "reconcile sharpens the rounded 34.64 and the audit agrees");
assert.ok(Math.abs(verifiedLive.taught.find((quantity) => quantity.id === "R")!.value - range) < 1e-9);
assertNoChangedAnswer(verifiedLive, "correct formula");
assert.equal(verified?.problemIR.schemaVersion, "problem-ir/v1");
assert.equal(verified?.problemIR.question, question, "an absent question is the submitted question");
assert.ok(validateProblemIR(verified?.problemIR, question).valid, "the lifted object is canonical problem-ir/v1");
const speedFact = verified?.problemIR.facts.find((fact) => fact.id === "fSpeed");
assert.equal(question.slice(speedFact!.evidence.start, speedFact!.evidence.end), "20 m/s", "a repeated quote takes its first span");
assert.ok(verified?.problemIR.expressions.every((expression) => !("expr" in expression)), "expr is replaced by the typed AST");
// The model sees the validated plan exactly as origin/main sent it.
const userContent = seen.body!.messages[1]!.content;
assert.ok(userContent.includes(`VALIDATED TURN PLAN V3\n${JSON.stringify(turnPlan)}`));
assert.ok(seen.body!.messages[0]!.content.includes("minified JSON"));

// 2. A wrong formulation never comes out verified with a changed value.
for (const wrongRange of ["20^2/10", "2*20^2*sin(30*pi/180)/10", "20^2*sin(2*30)/10", "20^2*sin(60)/10", "e*1000"]) {
  const wrong = await planAndSolveProblemV1(question, turnPlan, options(modelReturns(compactOutput(wrongRange))));
  const outcome = liveOutcome(wrong);
  assert.notEqual(outcome.status, "verified", `${wrongRange} must not verify`);
  assert.notEqual(outcome.status, "contradiction", `${wrongRange} is an absent second opinion, not a stopped lesson`);
  assertNoChangedAnswer(outcome, wrongRange);
}
const lawSlip = await planAndSolveProblemV1(question, turnPlan, options(modelReturns(compactOutput("20^2/10"))));
assert.equal(lawSlip?.problemIR.solveRequests.find((request) => request.id === "sRange")?.resultBinding, undefined, "the disagreeing binding is withdrawn");
assert.equal(lawSlip?.audit.status, "incomplete");
assert.equal(lawSlip?.projection, null);
// A plan written to two decimals or one still counts as the solver's value rounded.
assert.equal(planValueRoundsSolverValue(1.8, 1.846), true);
assert.equal(planValueRoundsSolverValue(2, 2.4), false, "an integer plan value is not a rounded 2.4");
assert.equal(planValueRoundsSolverValue(40, range), false);

// 2b. Unknown kinds keep origin/main's rejection: a mapped `other` entity
// labelled "battery" would count as a circuit source in family routing.
for (const extra of [
  { entities: [{ id: "battery", kind: "battery", evidenceFactIds: ["fSpeed"] }] },
  { representationIntents: [{ id: "iBogus", kind: "trajectory_plot", entityIds: ["ball"], evidenceFactIds: ["fSpeed"] }] },
]) {
  assert.equal(
    await planAndSolveProblemV1(question, turnPlan, options(modelReturns(compactOutput("20^2*sin(2*30*pi/180)/10", extra)))),
    null,
    "an unknown kind rejects the formulation as before",
  );
}

// 3. `{}` is a refusal, not an empty solved authority.
assert.equal(await planAndSolveProblemV1(question, turnPlan, options(modelReturns("{}"))), null);

// 4. A present question that differs still rejects the formulation.
const otherQuestion = await planAndSolveProblemV1(
  question,
  turnPlan,
  options(modelReturns(compactOutput("20^2*sin(2*30*pi/180)/10", { question: "A ball is projected at 25 m/s." }))),
);
assert.equal(otherQuestion, null);

// 5. The infix grammar is the AST's grammar and nothing more.
for (const accepted of ["2*20*sin(30*pi/180)/10", "-2^2", "2^-1", "1.5e3/3", "exp(1)^2", "x^2-4"]) {
  assert.ok(parseInfixExpression(accepted), `${accepted} parses`);
}
assert.deepEqual(parseInfixExpression("-2^2"), {
  kind: "unary",
  operator: "-",
  operand: { kind: "binary", operator: "^", left: { kind: "number", value: 2 }, right: { kind: "number", value: 2 } },
});
for (const rejected of ["2x", "foo(3)", "eval(1)", "2**3", "sin 3", "3+", "sin()", "(2", "2)", "x;y", "process.exit(1)", "", "1".repeat(300), "2π"]) {
  assert.equal(parseInfixExpression(rejected), null, `${JSON.stringify(rejected.slice(0, 20))} must reject`);
}
// `e` is an identifier, never Euler's number: e*1000 is the elementary charge.
assert.deepEqual(parseInfixExpression("e*1000"), {
  kind: "binary", operator: "*", left: { kind: "variable", name: "e" }, right: { kind: "number", value: 1000 },
});
// Typeset symbols map to the grammar's own.
assert.deepEqual(parseInfixExpression("2*π×3−1"), parseInfixExpression("2*pi*3-1"));
assert.deepEqual(parseInfixExpression("6÷2·3"), parseInfixExpression("6/2*3"));
// Depth is counted per parenthesis, matching ProblemIR's 24 level ceiling.
assert.ok(parseInfixExpression(`${"(".repeat(24)}1${")".repeat(24)}`));
assert.equal(parseInfixExpression(`${"(".repeat(25)}1${")".repeat(25)}`), null);
assert.ok(parseInfixExpression(Array.from({ length: 40 }, () => "1").join("+")), "a long flat sum is not deep");
// Trig of a bare literal beyond one turn is degrees read as radians: refused.
const trig = (expr: string) => (normalizeProblemIRModelOutput(compactOutput(expr), question, turnPlan) as {
  expressions: Array<{ id: string }>;
}).expressions.some((expression) => expression.id === "eRange");
assert.equal(trig("20^2*sin(60)/10"), false);
assert.equal(trig("20^2*sin(2*30)/10"), false);
assert.equal(trig("20^2*cos(-45)/10"), false);
assert.equal(trig("20^2*sin(2*30*pi/180)/10"), true);
assert.equal(trig("20^2*sin(1.2)/10"), true, "a radian argument within one turn stays");
const twoVariables = normalizeProblemIRModelOutput(
  compactOutput("u^2*sin(2*theta)/g"),
  question,
  turnPlan,
) as { expressions: Array<{ id: string }>; solveRequests: Array<{ id: string }> };
assert.ok(!twoVariables.expressions.some((expression) => expression.id === "eRange"), "a symbolic expression is not solvable");
assert.ok(!twoVariables.solveRequests.some((request) => request.id === "sRange"));

// 6. `args: [x]` is the same one-argument call as `argument: x`.
const argsAlias = normalizeProblemIRModelOutput({
  ...compactOutput("1"),
  expressions: [{
    id: "eRange",
    valueType: "scalar",
    root: { kind: "call", name: "sqrt", args: [{ kind: "number", value: 4 }] },
    evidenceFactIds: ["fRange"],
  }],
}, question, turnPlan) as { expressions: Array<{ root: Record<string, unknown> }> };
assert.deepEqual(argsAlias.expressions[0]?.root, { kind: "call", function: "sqrt", argument: { kind: "number", value: 4 } });
const twoArgs = normalizeProblemIRModelOutput({
  ...compactOutput("1"),
  expressions: [{
    id: "eRange",
    valueType: "scalar",
    root: { kind: "call", name: "sqrt", args: [{ kind: "number", value: 4 }, { kind: "number", value: 9 }] },
    evidenceFactIds: ["fRange"],
  }],
}, question, turnPlan) as { expressions: unknown[] };
assert.equal(twoArgs.expressions.length, 0, "any other arity is dropped");

// 7. Question alone: solved, never audited, until bound to the plan.
const aloneSeen: { body?: { messages: Array<{ content: string }> } } = {};
const aloneOutput = compactOutput("20^2*sin(2*30*pi/180)/10");
aloneOutput.solveRequests = aloneOutput.solveRequests.map((request) => ({
  ...request,
  resultBinding: { ...request.resultBinding, turnPlanQuantityId: `own${request.resultBinding.turnPlanQuantityId}` },
}));
const alone = await planAndSolveProblemV1(question, null, options(modelReturns(aloneOutput, aloneSeen)));
assert.ok(aloneSeen.body!.messages[1]!.content.includes("VALIDATED TURN PLAN V3\nnone"));
assert.equal(problemIRUserMessage(question, null).includes("turn-plan"), false);
assert.equal(alone?.audit.status, "incomplete", "no plan means no authority yet");
assert.equal(alone?.audit.issues[0]?.code, "turn_plan_pending");
assert.equal(alone?.projection, null);
const bound = bindProblemIRToTurnPlan(alone!.problemIR, turnPlan);
assert.deepEqual(bound.solveRequests.map((request) => request.resultBinding?.turnPlanQuantityId), ["T", "H", "R"]);
// After the join the integration withdraws disagreeing bindings, then runs
// the hook's reconcile and audit, exactly as for a plan-aware result.
const joined = (problem: typeof bound, plan: TurnPlanV3) =>
  liveOutcome({ ...alone!, problemIR: withdrawDisagreeingBindings(problem, alone!.solverResult, plan) }, plan);
assert.equal(joined(bound, turnPlan).status, "verified");

// An ambiguous or unit-mismatched join drops the binding: incomplete, never a contradiction.
const ambiguousPlan: TurnPlanV3 = {
  ...turnPlan,
  unknowns: [...turnPlan.unknowns, { id: "R2", symbol: "R", unit: "m" }],
  derived: [...turnPlan.derived, { id: "R2", symbol: "R", value: 1, unit: "m", provenance: "derived", sourceText: "R2 = 1" }],
};
const ambiguous = bindProblemIRToTurnPlan(alone!.problemIR, ambiguousPlan);
assert.equal(ambiguous.solveRequests.find((request) => request.id === "sRange")?.resultBinding, undefined);
assert.equal(joined(ambiguous, ambiguousPlan).status, "incomplete");
const unitPlan: TurnPlanV3 = {
  ...turnPlan,
  unknowns: turnPlan.unknowns.map((unknown) => unknown.id === "R" ? { ...unknown, unit: "km" } : unknown),
  derived: turnPlan.derived.map((quantity) => quantity.id === "R" ? { ...quantity, unit: "km", value: range / 1000 } : quantity),
};
const unitMismatch = bindProblemIRToTurnPlan(alone!.problemIR, unitPlan);
assert.equal(unitMismatch.solveRequests.find((request) => request.id === "sRange")?.resultBinding, undefined);
assert.equal(joined(unitMismatch, unitPlan).status, "incomplete");

// Question-alone join keys keep case and script: T is not t, Δv is not v.
const caseProblem = {
  ...alone!.problemIR,
  solveRequests: alone!.problemIR.solveRequests.map((request) =>
    request.id === "sTime" ? { ...request, resultBinding: { ...request.resultBinding!, symbol: "t" } } : request),
};
assert.equal(bindProblemIRToTurnPlan(caseProblem, turnPlan).solveRequests.find((request) => request.id === "sTime")?.resultBinding, undefined);
const deltaPlan: TurnPlanV3 = {
  ...turnPlan,
  unknowns: [{ id: "dv", symbol: "Δv", unit: "m/s" }],
  derived: [{ id: "dv", symbol: "Δv", value: 3, unit: "m/s", provenance: "derived", sourceText: "dv = 3" }],
};
const deltaProblem = (symbol: string) => ({
  ...alone!.problemIR,
  solveRequests: [{ ...alone!.problemIR.solveRequests[0]!, resultBinding: { turnPlanQuantityId: "own", symbol, unit: "m/s", evidenceFactIds: ["fTime"] } }],
});
assert.equal(bindProblemIRToTurnPlan(deltaProblem("v"), deltaPlan).solveRequests[0]?.resultBinding, undefined, "v must not bind Δv");
assert.equal(bindProblemIRToTurnPlan(deltaProblem("\\Delta v"), deltaPlan).solveRequests[0]?.resultBinding?.turnPlanQuantityId, "dv");
assert.equal(bindProblemIRToTurnPlan(deltaProblem("β"), { ...deltaPlan, unknowns: [{ id: "dv", symbol: "α", unit: "m/s" }] }).solveRequests[0]?.resultBinding, undefined);

console.log("problem IR compact wire format verification passed");
