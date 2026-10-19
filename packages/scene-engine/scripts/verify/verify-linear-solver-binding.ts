import { strict as assert } from "node:assert";
import { LocalDeterministicSolverProvider, type SolverResult } from "../../src/ir/solver";
import { verifyTurnPlanAgainstSolver, reconcileTurnPlanWithSolver } from "../../src/ir/solverAuthority";
import type { ProblemIR, ExpressionNodeIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

// Class reproductions. Old lab artifacts retained plan summaries, but not the
// full ProblemIR: these fixtures do not claim to replay missing model JSON.
const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const x: ExpressionNodeIR = { kind: "variable", name: "x" };
const bin = (operator: "+" | "-" | "*" | "/", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
function fixture(question: string, left: ExpressionNodeIR, right: ExpressionNodeIR, answer: number, symbol: string): { problem: ProblemIR; plan: TurnPlanV3 } {
  const evidence = { source: "question" as const, start: 0, end: question.length, quote: question };
  return {
    problem: {
      schemaVersion: "problem-ir/v1", id: "linearCoordinate", question,
      facts: [{ id: "given", kind: "given", statement: question, evidence }, { id: "requested", kind: "requested", statement: question, evidence }],
      entities: [], constraints: [], representationIntents: [],
      expressions: [
        { id: "first", valueType: "function", root: left, evidenceFactIds: ["given"] },
        { id: "second", valueType: "function", root: right, evidenceFactIds: ["given"] },
      ],
      solveRequests: [{ id: "findX", kind: "intersections", leftExpressionId: "first", rightExpressionId: "second", variable: "x", domain: { min: -100, max: 100 }, resultBinding: { turnPlanQuantityId: "xP", symbol, evidenceFactIds: ["requested"] } }],
    },
    plan: { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [{ id: "xP", symbol }], derived: [{ id: "xP", symbol, value: answer, provenance: "derived" }], qualitativeClaims: [], lawIds: [], assumptions: [] },
  };
}

const cases = [
  fixture("The lines 2x - y = 5 and -3x + 2y = -4 meet at P. Graph both lines, label P, and find its x-coordinate.", bin("-", bin("*", n(2), x), n(5)), bin("-", bin("/", bin("*", n(3), x), n(2)), n(2)), 6, "x_P"),
  fixture("Solve the pair x + y = 6 and x - y = 2 by the graphical method. Label their point of intersection.", bin("-", n(6), x), bin("-", x, n(2)), 4, "x"),
];
let checks = 0;
for (const symbol of ["x", "x_P"]) for (const tail of [
  "Mark Q=(1,1) and find the x-coordinate of Q.",
  "Mark Q=(1,1) and find its x-coordinate.",
  "P=(1,1). Find its x-coordinate.",
  "find the square of its x-coordinate.",
  "find twice its x-coordinate.",
  "find the negative of its x-coordinate.",
  "find its x-coordinate in centimeters.",
]) {
  const wrongQuery = fixture(`The lines x+y=6 and x-y=2 meet at P. Graph both lines. ${tail}`, bin("-", n(6), x), bin("-", x, n(2)), 4, symbol);
  const wrongQueryResult = await new LocalDeterministicSolverProvider().solve(wrongQuery.problem);
  assert.notEqual(verifyTurnPlanAgainstSolver(wrongQuery.problem, wrongQueryResult, wrongQuery.plan, wrongQuery.problem.question).status, "verified", `${symbol}: requested coordinate target/transformation/unit must match the selected intersection scalar: ${tail}`);
  checks++;
}
const provider = new LocalDeterministicSolverProvider();
for (const [index, { problem, plan }] of cases.entries()) {
  const result = await provider.solve(problem);
  assert.equal(result.status, "solved", JSON.stringify(result.issues));
  const audit = verifyTurnPlanAgainstSolver(problem, result, plan, problem.question);
  console.log(JSON.stringify({ case: index, result: result.values, audit }));
  assert.equal(audit.status, "verified", "A source-equivalent unique linear coordinate must bind as a scalar");
  assert.equal(audit.bindings[0]?.approximate, plan.derived[0]!.value);
  assert.equal(audit.bindings[0]?.selection?.kind, "unique_source_linear_coordinate");
  assert.equal(result.values[0]?.valueType, "set", "Provider output remains an explicit root set");
  checks += 4;
}

const original = cases[0]!;
const originalResult = await provider.solve(original.problem);
const tupleOnly = fixture("The lines x+y=6 and x-y=2 meet at P. Graph both lines and find the coordinates of P.", bin("-", n(6), x), bin("-", x, n(2)), 4, "x_P");
assert.notEqual(verifyTurnPlanAgainstSolver(tupleOnly.problem, await provider.solve(tupleOnly.problem), tupleOnly.plan, tupleOnly.plan.question).status, "verified", "Native tuple semantics do not authorize a set-to-scalar request selection"); checks++;
const rootRequest = structuredClone(original.problem);
rootRequest.expressions[0]!.root = bin("-", x, n(6));
rootRequest.solveRequests[0] = { id: "findX", kind: "roots", expressionId: "first", variable: "x", domain: { min: -100, max: 100 }, resultBinding: rootRequest.solveRequests[0]!.resultBinding };
const rootResult = await provider.solve(rootRequest);
assert.equal(verifyTurnPlanAgainstSolver(rootRequest, rootResult, original.plan, original.plan.question).status, "verified", "A source-certified affine root request also binds without trusting an elimination answer"); checks++;
async function refused(name: string, mutate: (problem: ProblemIR, plan: TurnPlanV3) => void, result?: SolverResult, question?: string) {
  const problem = structuredClone(original.problem), plan = structuredClone(original.plan);
  mutate(problem, plan);
  const solved = result ?? await provider.solve(problem);
  const audit = verifyTurnPlanAgainstSolver(problem, solved, plan, question ?? problem.question);
  assert.notEqual(audit.status, "verified", `${name} cannot establish scalar authority`);
  checks++;
}
await refused("wrong planner scalar", (_, plan) => { plan.derived[0]!.value = 99; });
await refused("wrong coordinate variable", (problem, plan) => {
  problem.solveRequests[0]!.resultBinding!.symbol = "y_P";
  plan.unknowns[0]!.symbol = plan.derived[0]!.symbol = "y_P";
});
await refused("wrong named intersection", (problem, plan) => {
  problem.solveRequests[0]!.resultBinding!.symbol = "x_Q";
  plan.unknowns[0]!.symbol = plan.derived[0]!.symbol = "x_Q";
});
await refused("ambiguous named intersections", (problem, plan) => {
  const question = problem.question.replace("meet at P.", "meet at P. The intersection is Q.");
  problem.question = plan.question = question;
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: question.length, quote: question };
});
await refused("named intersection contradicts original point tuple", (problem, plan) => {
  const question = `${problem.question} P = (1, 1).`;
  problem.question = plan.question = question;
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: question.length, quote: question };
});
await refused("source coordinate units unsupported", (problem, plan) => {
  problem.solveRequests[0]!.resultBinding!.unit = "cm";
  plan.unknowns[0]!.unit = plan.derived[0]!.unit = "cm";
});
await refused("given fact is not requested result evidence", problem => { problem.facts[1]!.kind = "given"; });
await refused("forged requested evidence", problem => { problem.facts[1]!.evidence.quote = "find its y-coordinate"; });
await refused("narrow given-description quote cannot hide different original target", (problem, plan) => {
  const question = "The lines 2x-y=5 and -3x+2y=-4 meet at P. The intersection is P. Mark Q=(1,1) and find the x-coordinate of Q.";
  problem.question = plan.question = question;
  problem.facts[0]!.evidence = { source: "question", start: 0, end: question.length, quote: question };
  const start = question.indexOf("intersection");
  problem.facts[1]!.evidence = { source: "question", start, end: start + "intersection".length, quote: "intersection" };
});
await refused("source asks a different coordinate", (problem, plan) => {
  const question = problem.question.replace("x-coordinate", "y-coordinate");
  problem.question = plan.question = question;
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: question.length, quote: question };
});
await refused("changed source equation", (problem, plan) => {
  const question = problem.question.replace("2y = -4", "2y = -3");
  problem.question = plan.question = question;
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: question.length, quote: question };
});
await refused("additional source inequality", (problem, plan) => {
  const question = `${problem.question} Also require x > 9.`;
  problem.question = plan.question = question;
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: question.length, quote: question };
});
await refused("third source equation", (problem, plan) => {
  const question = `${problem.question} Also require x = 8.`;
  problem.question = plan.question = question;
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: question.length, quote: question };
});
await refused("forged original source", problem => {
  problem.question = "Solve x+y=6 and x-y=2.";
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: problem.question.length, quote: problem.question };
}, originalResult, original.problem.question);
const missingSource = verifyTurnPlanAgainstSolver(original.problem, originalResult, original.plan);
assert.notEqual(missingSource.status, "verified", "Set-to-scalar selection requires explicit trusted original question"); checks++;

const forgedResult = structuredClone(originalResult);
forgedResult.values[0]!.approximate = [7];
forgedResult.values[0]!.exact = [{ kind: "integer", value: "7" }];
await refused("forged singleton coordinate", () => {}, forgedResult);
const multiResult = structuredClone(originalResult);
multiResult.values[0]!.approximate = [6, 7];
multiResult.values[0]!.exact = [{ kind: "integer", value: "6" }, { kind: "integer", value: "7" }];
await refused("multiple returned roots", () => {}, multiResult);
const noExact = structuredClone(originalResult); delete noExact.values[0]!.exact;
await refused("missing exact certificate", () => {}, noExact);
await refused("arbitrary singleton evaluate", problem => {
  problem.expressions[0]!.root = n(6);
  problem.solveRequests[0] = { id: "findX", kind: "evaluate", expressionId: "first", resultBinding: problem.solveRequests[0]!.resultBinding };
}, originalResult);
await refused("domain-limited nonlinear singleton", problem => {
  problem.expressions[0]!.root = { kind: "binary", operator: "^", left: x, right: n(2) };
  problem.expressions[1]!.root = n(36);
  const request = problem.solveRequests[0];
  if (request?.kind === "intersections") request.domain = { min: 0, max: 100 };
});
await refused("affine request solves different coordinate", problem => {
  problem.expressions[0]!.root = bin("-", x, n(7));
  problem.expressions[1]!.root = n(0);
});
await refused("no explicit result binding", problem => { delete problem.solveRequests[0]!.resultBinding; });
await refused("duplicate scalar bindings", problem => {
  problem.solveRequests.push({ ...problem.solveRequests[0]!, id: "alsoX" });
});
await refused("unit binding contradicts plan", problem => { problem.solveRequests[0]!.resultBinding!.unit = "cm"; });
await refused("parallel original equations", (problem, plan) => {
  const question = "The lines 2x - y = 5 and 4x - 2y = 11 meet at P. Graph both lines, label P, and find its x-coordinate.";
  problem.question = plan.question = question;
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: question.length, quote: question };
});
await refused("coincident original equations", (problem, plan) => {
  const question = "The lines 2x - y = 5 and 4x - 2y = 10 meet at P. Graph both lines, label P, and find its x-coordinate.";
  problem.question = plan.question = question;
  for (const fact of problem.facts) fact.evidence = { source: "question", start: 0, end: question.length, quote: question };
});

// Reconciliation replaces a stale scalar only with the exact selected source
// coordinate; it cannot consume a forged provider singleton or wrong query.
const stale = structuredClone(original.plan); stale.derived[0]!.value = 99;
assert.equal(verifyTurnPlanAgainstSolver(original.problem, originalResult, stale, stale.question).status, "contradiction"); checks++;
const reconciled = reconcileTurnPlanWithSolver(stale, original.problem, originalResult);
assert.equal(reconciled.derived[0]!.value, 6); checks++;
assert.equal(verifyTurnPlanAgainstSolver(original.problem, originalResult, reconciled, stale.question).status, "verified"); checks++;
assert.equal(reconcileTurnPlanWithSolver(stale, original.problem, forgedResult).derived[0]!.value, 99); checks++;

// Exact near-neighbors exercise both coordinates, scaling and rational output.
for (const [question, left, right, variable, symbol, answer] of [
  ["Solve the pair x + y = 6 and x - y = 2 by the graphical method. Label their point of intersection.", bin("-", n(6), { kind: "variable", name: "y" }), bin("+", { kind: "variable", name: "y" }, n(2)), "y", "y", 2],
  ["The lines 4x - 2y = 10 and 6x - 4y = 8 meet at P. Graph both lines and find its x-coordinate.", bin("-", bin("*", n(2), x), n(5)), bin("-", bin("/", bin("*", n(3), x), n(2)), n(2)), "x", "x_P", 6],
  ["Solve the pair x + y = 1/2 and x - y = 1/6. Label their point of intersection.", bin("-", bin("/", n(1), n(2)), x), bin("-", x, bin("/", n(1), n(6))), "x", "x", 1/3],
  ["The lines x+y=6 and x-y=2 meet at P. Mark Q=(1,1) and find the x-coordinate of P.", bin("-", n(6), x), bin("-", x, n(2)), "x", "x_P", 4],
  ["The lines x+y=6 and x-y=2 meet at P. Find the x-coordinate of their intersection.", bin("-", n(6), x), bin("-", x, n(2)), "x", "x", 4],
] as const) {
  const { problem, plan } = fixture(question, left, right, answer, symbol);
  const request = problem.solveRequests[0];
  if (request?.kind === "intersections") request.variable = variable;
  const result = await provider.solve(problem), audit = verifyTurnPlanAgainstSolver(problem, result, plan, question);
  assert.equal(audit.status, "verified", `${question}: ${JSON.stringify(audit)}`); checks++;
  assert.equal(audit.bindings[0]?.approximate, answer); checks++;
}
console.log(`linear solver binding gate: ${checks} passed`);
