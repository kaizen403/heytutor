/**
 * Differential gate: the live ProblemIR normalizer against a frozen copy of
 * origin/main's (scripts/verify/fixtures/originProblemPlannerV1.ts).
 *
 * 1. Canonical outputs (problem-ir/v1 with `evidence` and `root`) must take
 *    origin/main's path exactly: identical normalized object, ProblemIR,
 *    solver result, planner audit, and the live hook's outcome (reconcile,
 *    then audit), including the cases where main is lenient or strict.
 * 2. Compact outputs (`quote`, `expr`, omitted constant fields) must lift to
 *    the canonical object main would produce from the equivalent canonical
 *    output, and reach the same live outcome.
 *
 * The corpus includes every probe from the 4 Oct 2026 review of this branch.
 */
import { strict as assert } from "node:assert";
import {
  reconcileTurnPlanWithSolver,
  verifyTurnPlanAgainstSolver,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import * as Live from "../../src/planners/problemPlannerV1";
import * as Main from "./fixtures/originProblemPlannerV1";

type Json = Record<string, unknown>;
type Planner = typeof Main.planAndSolveProblemV1;

const reply = (content: unknown): typeof fetch => async () =>
  Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
const options = (content: unknown) => ({ proxyUrl: "http://localhost/api/chat", timeoutMs: 5_000, fetchImpl: reply(content) });

async function outcome(planner: Planner, question: string, plan: TurnPlanV3, output: unknown) {
  const result = await planner(question, plan, options(output));
  if (!result) return null;
  const reconciled = reconcileTurnPlanWithSolver(plan, result.problemIR, result.solverResult);
  const audit = verifyTurnPlanAgainstSolver(result.problemIR, result.solverResult, reconciled, question);
  return {
    problemIR: result.problemIR,
    solverResult: result.solverResult,
    plannerAudit: result.audit,
    projection: result.projection,
    live: { status: audit.status, issues: audit.issues, derived: reconciled.derived },
  };
}

let canonicalCases = 0;
async function sameAsMain(label: string, question: string, plan: TurnPlanV3, output: unknown) {
  canonicalCases += 1;
  assert.deepEqual(
    Live.normalizeProblemIRModelOutput(structuredClone(output), question, plan),
    Main.normalizeProblemIRModelOutput(structuredClone(output), question, plan),
    `${label}: normalized object differs from origin/main`,
  );
  assert.deepEqual(
    await outcome(Live.planAndSolveProblemV1 as Planner, question, plan, output),
    await outcome(Main.planAndSolveProblemV1, question, plan, output),
    `${label}: outcome differs from origin/main`,
  );
}

let compactCases = 0;
async function compactLiftsToMain(label: string, question: string, plan: TurnPlanV3, compact: unknown, canonical: unknown) {
  compactCases += 1;
  assert.deepEqual(
    Live.normalizeProblemIRModelOutput(structuredClone(compact), question, plan),
    Main.normalizeProblemIRModelOutput(structuredClone(canonical), question, plan),
    `${label}: compact form does not lift to main's canonical object`,
  );
  const live = await outcome(Live.planAndSolveProblemV1 as Planner, question, plan, compact);
  const main = await outcome(Main.planAndSolveProblemV1, question, plan, canonical);
  assert.deepEqual(live, main, `${label}: compact outcome differs from main's canonical outcome`);
  return live;
}

const n = (value: number): Json => ({ kind: "number", value });
const pi: Json = { kind: "constant", name: "pi" };
const variable = (name: string): Json => ({ kind: "variable", name });
const bin = (operator: string, left: Json, right: Json): Json => ({ kind: "binary", operator, left, right });
const call = (fn: string, argument: Json): Json => ({ kind: "call", function: fn, argument });

function planFor(question: string, id: string, symbol: string, unit: string, value: number): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens: [],
    unknowns: [{ id, symbol, unit }],
    derived: [{ id, symbol, value, unit, provenance: "derived", sourceText: symbol }],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: [],
    visualRequirement: "optional",
  };
}

// --- Review probes: projectile range, with a repeated "the range" quote. ---
const q = "A ball is projected at 20 m/s at 30 degrees. Find the range. Take g = 10 m/s^2. Also state the range in words.";
const plan = planFor(q, "R", "R", "m", 34.641);
const span = (quote: string, source = true) => {
  const start = q.indexOf(quote);
  return { ...(source ? { source: "question" } : {}), start, end: start + quote.length, quote };
};
const canon = (root: Json, requestQuote = "Find the range", source = true, extra: Json = {}): Json => ({
  schemaVersion: "problem-ir/v1",
  id: "p",
  question: q,
  facts: [
    { id: "fU", kind: "given", statement: "u", evidence: span("20 m/s", source) },
    { id: "fR", kind: "requested", statement: "range", evidence: span(requestQuote, source) },
  ],
  entities: [],
  expressions: [{ id: "eR", valueType: "scalar", root, evidenceFactIds: ["fU"] }],
  constraints: [],
  representationIntents: [],
  solveRequests: [{
    id: "sR",
    kind: "evaluate",
    expressionId: "eR",
    resultBinding: { turnPlanQuantityId: "R", symbol: "R", unit: "m", evidenceFactIds: ["fR"] },
  }],
  ...extra,
});
const degrees = (value: number) => bin("/", bin("*", n(value), pi), n(180));
const right = bin("/", bin("*", n(400), call("sin", degrees(60))), n(10));
const wrong = bin("/", bin("*", n(400), call("sin", degrees(30))), n(10));

await sameAsMain("right formula", q, plan, canon(right));
await sameAsMain("wrong formula", q, plan, canon(wrong));
await sameAsMain("repeated quote", q, plan, canon(wrong, "the range"));
await sameAsMain("evidence without source", q, plan, canon(wrong, "Find the range", false));
await sameAsMain("sin(60) literal", q, plan, canon(bin("/", bin("*", n(400), call("sin", n(60))), n(10))));
await sameAsMain("args alias", q, plan, canon(bin("/", bin("*", n(400), { kind: "call", function: "sin", args: [degrees(30)] }), n(10))));
await sameAsMain("all facts ungrounded", q, plan, {
  ...canon(right),
  facts: [{ id: "fX", kind: "given", statement: "x", evidence: { source: "question", start: 0, end: 3, quote: "zzz" } }],
});
await sameAsMain("missing schemaVersion", q, plan, { ...canon(right), schemaVersion: undefined });
await sameAsMain("bad id", q, plan, { ...canon(right), id: "bad id!" });
await sameAsMain("missing id", q, plan, { ...canon(right), id: undefined });
await sameAsMain("missing question", q, plan, { ...canon(right), question: undefined });
await sameAsMain("empty object", q, plan, {});
{
  const output = canon(wrong, "the range") as { facts: Array<{ evidence: Json }> };
  output.facts[1]!.evidence.start = 0;
  output.facts[1]!.evidence.end = 9;
  await sameAsMain("repeated quote with a wrong span", q, plan, output);
}
const integral = (upper: unknown, root: Json = call("sin", variable("x"))): Json => ({
  ...canon(right),
  expressions: [
    { id: "eR", valueType: "scalar", root: right, evidenceFactIds: ["fU"] },
    { id: "eF", valueType: "function", root, evidenceFactIds: ["fU"] },
  ],
  solveRequests: [{ id: "sI", kind: "definite_integral", expressionId: "eF", variable: "x", lower: 0, upper }],
});
await sameAsMain("string integral bound pi", q, plan, integral("pi"));
await sameAsMain("numeric integral bound", q, plan, integral(Math.PI));
await sameAsMain("x^2 on 0..3", q, plan, integral(3, bin("^", variable("x"), n(2))));
await sameAsMain("x^2 on 0..'3'", q, plan, integral("3", bin("^", variable("x"), n(2))));
await sameAsMain("Euler constant", q, plan, canon(bin("*", { kind: "constant", name: "e" }, n(10))));
await sameAsMain("unknown entity kind", q, plan, canon(right, "Find the range", true, {
  entities: [{ id: "cell", kind: "battery", evidenceFactIds: ["fU"] }],
}));
await sameAsMain("unknown intent kind", q, plan, canon(right, "Find the range", true, {
  entities: [{ id: "ball", kind: "body", evidenceFactIds: ["fU"] }],
  representationIntents: [{ id: "iX", kind: "trajectory_plot", entityIds: ["ball"], evidenceFactIds: ["fU"] }],
}));
await sameAsMain("two variable expression", q, plan, canon(bin("*", variable("u"), variable("g"))));
await sameAsMain("inline expression on the request", q, plan, {
  ...canon(right),
  solveRequests: [{ id: "sR", kind: "evaluate", expression: right, resultBinding: { turnPlanQuantityId: "R", symbol: "R", unit: "m", evidenceFactIds: ["fR"] } }],
});
await sameAsMain("binding to a renamed id", q, plan, {
  ...canon(right),
  solveRequests: [{ id: "sR", kind: "evaluate", expressionId: "eR", resultBinding: { turnPlanQuantityId: "range", symbol: "R", unit: "m", evidenceFactIds: ["fR"] } }],
});

// --- Review probe: simple harmonic motion, a correct radian literal. ---
const shmQuestion = "A particle moves as x = 0.1 sin(5t) metres. Find x at t = 2 s.";
const shmPlan = planFor(shmQuestion, "x", "x", "m", 0.1 * Math.sin(10));
const shmSpan = (quote: string) => {
  const start = shmQuestion.indexOf(quote);
  return { source: "question", start, end: start + quote.length, quote };
};
const shmRequests = [{
  id: "s",
  kind: "evaluate",
  expressionId: "e",
  resultBinding: { turnPlanQuantityId: "x", symbol: "x", unit: "m", evidenceFactIds: ["fT"] },
}];
const shmFacts = [
  { id: "fX", kind: "given", statement: "x", quote: "x = 0.1 sin(5t)" },
  { id: "fT", kind: "requested", statement: "t", quote: "Find x at t = 2 s" },
];
const shmCanonical = {
  schemaVersion: "problem-ir/v1",
  id: "problem",
  question: shmQuestion,
  facts: shmFacts.map(({ quote, ...fact }) => ({ ...fact, evidence: shmSpan(quote) })),
  entities: [],
  constraints: [],
  representationIntents: [],
  expressions: [{ id: "e", valueType: "scalar", root: bin("*", n(0.1), call("sin", bin("*", n(5), n(2)))), evidenceFactIds: ["fX"] }],
  solveRequests: shmRequests,
};
await sameAsMain("SHM canonical", shmQuestion, shmPlan, shmCanonical);
const shm = await compactLiftsToMain("SHM compact", shmQuestion, shmPlan, {
  facts: shmFacts,
  entities: [],
  constraints: [],
  representationIntents: [],
  expressions: [{ id: "e", valueType: "scalar", expr: "0.1*sin(5*2)", evidenceFactIds: ["fX"] }],
  solveRequests: shmRequests,
}, shmCanonical);
assert.equal(shm?.live.status, "verified", "a correct radian answer verifies");

// --- Compact forms of the projectile probes lift to main's canonical object. ---
const compactOf = (expr: string, requestQuote = "Find the range"): Json => ({
  facts: [
    { id: "fU", kind: "given", statement: "u", quote: "20 m/s" },
    { id: "fR", kind: "requested", statement: "range", quote: requestQuote },
  ],
  entities: [],
  expressions: [{ id: "eR", valueType: "scalar", expr, evidenceFactIds: ["fU"] }],
  constraints: [],
  representationIntents: [],
  solveRequests: (canon(right).solveRequests as unknown[]),
});
const asCanonical = (root: Json, requestQuote = "Find the range") => ({ ...canon(root, requestQuote), id: "problem" });
const rightLive = await compactLiftsToMain("compact right formula", q, plan, compactOf("400*sin(60*pi/180)/10"), asCanonical(right));
assert.equal(rightLive?.live.status, "verified");
await compactLiftsToMain("compact wrong formula", q, plan, compactOf("400*sin(30*pi/180)/10"), asCanonical(wrong));
await compactLiftsToMain(
  "compact repeated quote takes its first span",
  q,
  plan,
  compactOf("400*sin(30*pi/180)/10", "the range"),
  asCanonical(wrong, "the range"),
);
await compactLiftsToMain(
  "compact typeset symbols",
  q,
  plan,
  compactOf("400×sin(60·π/180)÷10"),
  asCanonical(right),
);
await compactLiftsToMain(
  "compact sin(60) literal",
  q,
  plan,
  compactOf("400*sin(60)/10"),
  asCanonical(bin("/", bin("*", n(400), call("sin", n(60))), n(10))),
);
{
  const compact = compactOf("400*sin(60*pi/180)/10");
  compact.expressions = [
    ...(compact.expressions as unknown[]),
    { id: "eF", valueType: "function", expr: "sin(x)", evidenceFactIds: ["fU"] },
  ];
  compact.solveRequests = [{ id: "sI", kind: "definite_integral", expressionId: "eF", variable: "x", lower: 0, upper: "pi" }];
  const canonical = {
    ...asCanonical(right),
    expressions: [
      { id: "eR", valueType: "scalar", root: right, evidenceFactIds: ["fU"] },
      { id: "eF", valueType: "function", root: call("sin", variable("x")), evidenceFactIds: ["fU"] },
    ],
    solveRequests: [{ id: "sI", kind: "definite_integral", expressionId: "eF", variable: "x", lower: 0, upper: pi }],
  };
  await compactLiftsToMain("compact string integral bound", q, plan, compact, canonical);
}
// A compact `e` is a variable, so main's canonical twin is the variable too
// (never the Euler constant): both drop the request as an unsolvable scalar.
await compactLiftsToMain("compact e is a variable", q, plan, compactOf("e*1000"), asCanonical(bin("*", variable("e"), n(1000))));

console.log(`problem IR differential verification passed (${canonicalCases} canonical cases identical to origin/main, ${compactCases} compact cases lift to main's canonical object)`);
