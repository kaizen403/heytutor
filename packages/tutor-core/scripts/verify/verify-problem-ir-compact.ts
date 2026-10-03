/**
 * The compact ProblemIR wire format (4 Oct 2026).
 *
 * Measured on 14 live calls, the pretty problem-ir/v1 object cost a median
 * 1,088 completion tokens at ~72 tok/s on DeepSeek V4.1 Flash, so the call ran
 * 14.5s median and 3 of 14 passed the client's 18s deadline. The model now
 * writes facts as a quote, expressions as bounded infix, and skips the
 * constant and echoed fields. This gate proves the compact form lifts to the
 * same validated problem-ir/v1 and that nothing about the authority weakened:
 * a wrong formula still contradicts, code still rejects, `{}` is still a
 * refusal, and a question-alone formulation never audits until it is bound.
 */
import { strict as assert } from "node:assert";
import {
  validateProblemIR,
  verifyTurnPlanAgainstSolver,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  bindProblemIRToTurnPlan,
  normalizeProblemIRModelOutput,
  parseInfixExpression,
  planAndSolveProblemV1,
  problemIRUserMessage,
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
    { id: "R", symbol: "R", value: range, unit: "m", provenance: "derived", sourceText: "R = u^2 sin(2 theta) / g" },
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
      { id: "launcher", kind: "projectile_launcher", evidenceFactIds: ["fAngle"] },
    ],
    expressions: [
      { id: "eTime", valueType: "scalar", expr: "2*20*sin(30*pi/180)/10", evidenceFactIds: ["fSpeed", "fAngle", "fG"] },
      { id: "eHeight", valueType: "scalar", expr: "(20*sin(30*pi/180))^2/(2*10)", evidenceFactIds: ["fSpeed", "fAngle", "fG"] },
      { id: "eRange", valueType: "scalar", expr: rangeExpr, evidenceFactIds: ["fSpeed", "fAngle", "fG"] },
    ],
    constraints: [],
    representationIntents: [
      { id: "iPath", kind: "graph", entityIds: ["ball"], evidenceFactIds: ["fSpeed"] },
      { id: "iBogus", kind: "trajectory_plot", entityIds: ["ball"], evidenceFactIds: ["fSpeed"] },
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

// 1. The compact form lifts to valid problem-ir/v1 and verifies a correct plan.
const seen: { body?: { messages: Array<{ content: string }> } } = {};
const verified = await planAndSolveProblemV1(
  question,
  turnPlan,
  options(modelReturns(compactOutput("20^2*sin(2*30*pi/180)/10"), seen)),
);
assert.equal(verified?.audit.status, "verified", "compact output must verify a correct plan");
assert.equal(verified?.problemIR.schemaVersion, "problem-ir/v1");
assert.equal(verified?.problemIR.question, question, "an absent question is the submitted question");
assert.ok(validateProblemIR(verified?.problemIR, question).valid, "the lifted object is canonical problem-ir/v1");
const speedFact = verified?.problemIR.facts.find((fact) => fact.id === "fSpeed");
assert.equal(question.slice(speedFact!.evidence.start, speedFact!.evidence.end), "20 m/s", "a repeated quote takes its first span");
assert.ok(verified?.problemIR.expressions.every((expression) => !("expr" in expression)), "expr is replaced by the typed AST");
assert.deepEqual(
  verified?.problemIR.entities.find((entity) => entity.id === "launcher"),
  { id: "launcher", kind: "other", label: "projectile_launcher", evidenceFactIds: ["fAngle"] },
  "an unknown entity kind is kept as other",
);
assert.deepEqual(verified?.problemIR.representationIntents.map((intent) => intent.id), ["iPath"]);
// The prompt carries answer slots, never the plan's values or arithmetic.
const userContent = seen.body!.messages[1]!.content;
assert.ok(userContent.includes('{"id":"R","symbol":"R","unit":"m"}'));
assert.ok(!userContent.includes("sin(2 theta)") && !userContent.includes('"value"'), "plan arithmetic must not reach the formulation");
assert.ok(seen.body!.messages[0]!.content.includes("minified JSON"));

// 2. A wrong formula in compact form still contradicts the plan.
const wrong = await planAndSolveProblemV1(question, turnPlan, options(modelReturns(compactOutput("20^2/10"))));
assert.equal(wrong?.audit.status, "contradiction", "R = u^2/g must contradict R = u^2 sin(2 theta)/g");
assert.equal(wrong?.projection, null);

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
for (const accepted of ["2*20*sin(30*pi/180)/10", "-2^2", "2^-1", "1.5e3/3", "e^2", "x^2-4"]) {
  assert.ok(parseInfixExpression(accepted), `${accepted} parses`);
}
assert.deepEqual(parseInfixExpression("-2^2"), {
  kind: "unary",
  operator: "-",
  operand: { kind: "binary", operator: "^", left: { kind: "number", value: 2 }, right: { kind: "number", value: 2 } },
});
for (const rejected of ["2x", "foo(3)", "eval(1)", "2**3", "sin 3", "3+", "sin()", "(2", "2)", "x;y", "process.exit(1)", "", "1".repeat(300)]) {
  assert.equal(parseInfixExpression(rejected), null, `${JSON.stringify(rejected.slice(0, 20))} must reject`);
}
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
assert.ok(aloneSeen.body!.messages[1]!.content.includes("ANSWER SLOTS\nnone"));
assert.equal(problemIRUserMessage(question, null).includes("turn-plan"), false);
assert.equal(alone?.audit.status, "incomplete", "no plan means no authority yet");
assert.equal(alone?.audit.issues[0]?.code, "turn_plan_pending");
assert.equal(alone?.projection, null);
const bound = bindProblemIRToTurnPlan(alone!.problemIR, turnPlan);
assert.deepEqual(bound.solveRequests.map((request) => request.resultBinding?.turnPlanQuantityId), ["T", "H", "R"]);
assert.equal(verifyTurnPlanAgainstSolver(bound, alone!.solverResult, turnPlan, question).status, "verified");

// An ambiguous or unit-mismatched join drops the binding: incomplete, never a contradiction.
const ambiguousPlan: TurnPlanV3 = {
  ...turnPlan,
  unknowns: [...turnPlan.unknowns, { id: "R2", symbol: "R", unit: "m" }],
  derived: [...turnPlan.derived, { id: "R2", symbol: "R", value: 1, unit: "m", provenance: "derived", sourceText: "R2 = 1" }],
};
const ambiguous = bindProblemIRToTurnPlan(alone!.problemIR, ambiguousPlan);
assert.equal(ambiguous.solveRequests.find((request) => request.id === "sRange")?.resultBinding, undefined);
assert.equal(verifyTurnPlanAgainstSolver(ambiguous, alone!.solverResult, ambiguousPlan, question).status, "incomplete");
const unitPlan: TurnPlanV3 = {
  ...turnPlan,
  unknowns: turnPlan.unknowns.map((unknown) => unknown.id === "R" ? { ...unknown, unit: "km" } : unknown),
  derived: turnPlan.derived.map((quantity) => quantity.id === "R" ? { ...quantity, unit: "km", value: range / 1000 } : quantity),
};
const unitMismatch = bindProblemIRToTurnPlan(alone!.problemIR, unitPlan);
assert.equal(unitMismatch.solveRequests.find((request) => request.id === "sRange")?.resultBinding, undefined);
assert.equal(verifyTurnPlanAgainstSolver(unitMismatch, alone!.solverResult, unitPlan, question).status, "incomplete");

console.log("problem IR compact wire format verification passed");
