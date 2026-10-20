import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  LocalDeterministicSolverProvider, verifyTurnPlanAgainstSolver,
  type ProblemIR, type TurnPlanV3,
} from "@heytutor/scene-engine";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";

// This is the same pure selector the live hook uses after local solving.
// No planner, model, fetch, HTTP or persisted artifact is involved.
const records: Array<{ rowId: string; expected: string; turnPlan: TurnPlanV3; problemIR: ProblemIR }> = JSON.parse(readFileSync(
  new URL("../../../../packages/scene-engine/scripts/verify/fixtures/region-solver-recorded.json", import.meta.url), "utf8",
));
const provider = new LocalDeterministicSolverProvider();
let checks = 0;
async function admission(record: typeof records[number], turnPlan = record.turnPlan, problemIR = record.problemIR) {
  const result = await provider.solve(problemIR);
  const audit = verifyTurnPlanAgainstSolver(problemIR, result, turnPlan, turnPlan.question);
  const selection = selectProductionScene({
    question: turnPlan.question, turnPlan, problemIR,
    solverAuthorityBlocked: audit.status === "contradiction",
  });
  return { audit, selection };
}
for (const record of records) {
  const { audit, selection } = await admission(record);
  if (record.expected === "source_rejected") {
    assert.equal(Boolean(selection.representation), false, `${record.rowId}: original wrong source scalar must remain blocked`);
    assert.equal(selection.visualStatus, "retry_required"); checks += 2;
  } else {
    assert.equal(audit.status, record.expected);
    assert.equal(selection.visualStatus, "validated", `${record.rowId}: ${selection.reason}`);
    assert.ok(selection.representation?.renderScene.primitives.length); checks += 3;
  }
  if (record.expected !== "source_rejected") for (const quantity of record.turnPlan.derived) {
    const wrong = structuredClone(record.turnPlan);
    wrong.derived.find(item => item.id === quantity.id)!.value += 1;
    const negative = await admission(record, wrong);
    assert.equal(Boolean(negative.selection.representation), false, `${record.rowId}: stale ${quantity.symbol} cannot enter live selection`); checks++;
  }
}
const union = records.find(record => record.expected === "incomplete")!;
for (const provenance of ["given", "derived"] as const) for (const value of [99, -1]) {
  const disguised = structuredClone(union.turnPlan);
  disguised.unknowns = disguised.unknowns.filter(quantity => quantity.id !== "s");
  if (provenance === "given") disguised.givens.push({ id: "s", symbol: "S", value, sourceText: `S=${value}`, provenance });
  else disguised.derived.push({ id: "s", symbol: "S", value, provenance });
  const wrongSet = await admission(union, disguised);
  assert.equal(Boolean(wrongSet.selection.representation), false, `The source's whole solution set S cannot become finite ${value} through ${provenance} provenance`); checks++;
}
for (const value of [99, -1]) {
  const pruned = structuredClone(union.turnPlan);
  pruned.unknowns = pruned.unknowns.filter(quantity => quantity.id === "s");
  pruned.derived.push({ id: "s", symbol: "S", value, provenance: "derived" });
  const wrongSet = await admission(union, pruned);
  assert.equal(wrongSet.audit.status, "contradiction", "Moving genuine boundaries to intermediate quantities cannot authorize a finite whole-set answer");
  assert.equal(Boolean(wrongSet.selection.representation), false, `Finite S=${value} must be refused with boundaries absent from unknowns`); checks += 2;
}
const scalarSet = structuredClone(union.turnPlan);
scalarSet.derived.push({ id: "s", symbol: "S", value: 99, provenance: "derived" });
const unbound = await admission(union, scalarSet);
assert.equal(unbound.audit.status, "contradiction", "An unbound numeric answer cannot hide behind the symbolic-set exception");
assert.equal(Boolean(unbound.selection.representation), false, "The actual live/lab selector must reject this scalar plan"); checks += 2;
const irrelevantIR = structuredClone(union.problemIR);
irrelevantIR.expressions.push({ id: "unprovedSetScalar", valueType: "scalar", root: { kind: "number", value: 99 }, evidenceFactIds: ["fSet"] });
irrelevantIR.solveRequests.push({ id: "unrelatedSetAnswer", kind: "evaluate", expressionId: "unprovedSetScalar", resultBinding: { turnPlanQuantityId: "s", symbol: "S", evidenceFactIds: ["fSet"] } });
const irrelevant = await admission(union, scalarSet, irrelevantIR);
assert.equal(irrelevant.audit.status, "contradiction", "A valid but irrelevant scalar result binding cannot prove numeric S");
assert.equal(Boolean(irrelevant.selection.representation), false, "Irrelevant scalar bindings cannot admit a wrong set answer in production"); checks += 2;
const prunedBound = structuredClone(scalarSet);
prunedBound.unknowns = prunedBound.unknowns.filter(quantity => quantity.id === "s");
const prunedIrrelevant = await admission(union, prunedBound, irrelevantIR);
assert.equal(prunedIrrelevant.audit.status, "contradiction", "A coincident evaluate result cannot certify S after boundary requests become intermediates");
assert.equal(Boolean(prunedIrrelevant.selection.representation), false); checks += 2;
const boundarySet = structuredClone(union.turnPlan);
boundarySet.derived.push({ id: "s", symbol: "S", value: -1, provenance: "derived" });
const boundarySetIR = structuredClone(union.problemIR);
const leftBoundary = structuredClone(boundarySetIR.solveRequests[0]!);
leftBoundary.id = "boundaryForgedAsSet";
leftBoundary.resultBinding = { turnPlanQuantityId: "s", symbol: "S", evidenceFactIds: ["fBounds"] };
boundarySetIR.solveRequests.push(leftBoundary);
const forgedSet = await admission(union, boundarySet, boundarySetIR);
assert.equal(forgedSet.audit.status, "contradiction", "An exact left-boundary value is not a scalar answer for the named whole solution set S");
assert.equal(Boolean(forgedSet.selection.representation), false, "Genuine boundary mathematics cannot authorize a forged whole-set role in production"); checks += 2;
const nearBoundary = structuredClone(union.turnPlan);
nearBoundary.derived[0]!.value = -0.9999999995; delete nearBoundary.derived[0]!.sourceText;
const near = await admission(union, nearBoundary);
assert.equal(near.audit.status, "contradiction", "A visibly rounded-looking scalar cannot change the exact source boundary");
assert.equal(Boolean(near.selection.representation), false); checks += 2;

// Independent zero/small-value sources catch absolute epsilon floors. These
// are class fixtures, not claimed original model outputs.
for (const boundary of [0, 1e-8]) {
  const inequality = `x>${boundary}`, question = `For real x, solve ${inequality}. Show its finite boundary on a number line.`;
  const start = question.indexOf(inequality), requestedStart = question.indexOf("Show");
  const problemIR: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: "precisionBoundary", question,
    facts: [
      { id: "given", kind: "given", statement: inequality, evidence: { source: "question", start, end: start + inequality.length, quote: inequality } },
      { id: "query", kind: "requested", statement: question.slice(requestedStart), evidence: { source: "question", start: requestedStart, end: question.length, quote: question.slice(requestedStart) } },
    ],
    entities: [], representationIntents: [],
    expressions: [
      { id: "difference", valueType: "function", root: { kind: "binary", operator: "-", left: { kind: "variable", name: "x" }, right: { kind: "number", value: boundary } }, evidenceFactIds: ["given"] },
      { id: "zero", valueType: "scalar", root: { kind: "number", value: 0 }, evidenceFactIds: ["given"] },
    ],
    constraints: [{ id: "sourceInequality", kind: "inequality", leftExpressionId: "difference", rightExpressionId: "zero", relation: ">", evidenceFactIds: ["given"] }],
    solveRequests: [{ id: "boundary", kind: "roots", expressionId: "difference", variable: "x", domain: { min: -1, max: 1 }, resultBinding: { turnPlanQuantityId: "boundary", symbol: "boundary", evidenceFactIds: ["query", "given"] } }],
  };
  const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [{ id: "boundary", symbol: "boundary" }], derived: [{ id: "boundary", symbol: "boundary", value: boundary, provenance: "derived" }], qualitativeClaims: [], lawIds: [], assumptions: [] };
  const fixture = { rowId: "precisionBoundary", expected: "verified", problemIR, turnPlan };
  const exact = await admission(fixture);
  assert.equal(exact.audit.status, "verified", JSON.stringify({ boundary, audit: exact.audit })); assert.equal(exact.selection.visualStatus, "validated"); checks += 2;
  for (const value of boundary === 0 ? [1e-20, -1e-20] : [0, 2e-8, 1e-8 + 5e-10]) {
    const wrong = structuredClone(turnPlan); wrong.derived[0]!.value = value;
    const rejected = await admission(fixture, wrong);
    assert.equal(rejected.audit.status, "contradiction", `Exact ${boundary} must reject finite ${value}`);
    assert.equal(Boolean(rejected.selection.representation), false); checks += 2;
  }
  if (boundary !== 0) {
    const rounded = structuredClone(turnPlan); rounded.derived[0]!.value = boundary * (1 + Number.EPSILON);
    const accepted = await admission(fixture, rounded);
    assert.equal(accepted.audit.status, "verified"); assert.equal(accepted.selection.visualStatus, "validated"); checks += 2;
  }
}
console.log(`recorded region solver admission: ${checks} passed through the production selector`);
