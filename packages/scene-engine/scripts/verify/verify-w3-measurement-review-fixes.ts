import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type { verifyMeasurementSourceAuthority as Verify } from "../../src/ir/measurementSourceAuthority";
import type { ExpressionNodeIR, ProblemFact, ProblemIR } from "../../src/ir/problemIR";

const built = process.argv.includes("--built");
const { verifyMeasurementSourceAuthority: verify } = await import(built
  ? "../../dist/w3/measurementSourceAuthority.js"
  : "../../src/ir/measurementSourceAuthority.ts") as { verifyMeasurementSourceAuthority: typeof Verify };

const native = JSON.parse(readFileSync(new URL("fixtures/w3-measurements-native.json", import.meta.url), "utf8")) as {
  question_options_and_source_answer_verbatim: string;
  verbatim_question_block_sha256: string;
};
assert.equal(createHash("sha256").update(native.question_options_and_source_answer_verbatim).digest("hex"), native.verbatim_question_block_sha256, "frozen native 39 wording hash remains unchanged");
assert.equal(native.verbatim_question_block_sha256, "2d12b0d5c223fe9713f8a31a6fa8ce17dc6cd946fb4e88e446cce98895409f01");

type Input = { problem: ProblemIR; plan: TurnPlanV3 };
function num(value: number): ExpressionNodeIR { return { kind: "number", value }; }
function op(operator: "+" | "-" | "*" | "/", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR {
  return { kind: "binary", operator, left, right };
}
function input({ diameter = "2.675", zero = "0.02", signedZero = "+", pitch = "0.5", least = "0.005" } = {}): Input {
  const scale = `Least count corresponding to the main scale and circular scale of a screw gauge are ${pitch} mm and ${least} mm, respectively.`;
  const wire = `A wire of diameter ${diameter} mm`;
  const zeroClause = `zero error of the screw gauge is ${signedZero}${zero} mm`;
  const ask = `What would be the reading of divisions on circular scale of the screw gauge, if the ${zeroClause}?`;
  const question = `${scale} ${wire} is measured with the screw gauge. ${ask}`;
  const quote = (text: string) => {
    const start = question.indexOf(text);
    assert.notEqual(start, -1);
    return { source: "question" as const, start, end: start + text.length, quote: text };
  };
  const facts: ProblemFact[] = [
    { id: "pitch", kind: "given", statement: "main scale pitch", evidence: quote(scale) },
    { id: "least", kind: "given", statement: "least count", evidence: quote(scale) },
    { id: "diameter", kind: "given", statement: "wire diameter", evidence: quote(`${wire} is measured with the screw gauge.`) },
    { id: "zero", kind: "given", statement: "zero error", evidence: quote(zeroClause) },
    { id: "ask", kind: "requested", statement: "circular scale divisions", evidence: quote(ask) },
  ];
  const p = Number(pitch); const lc = Number(least); const d = Number(diameter); const e = signedZero === "-" ? -Number(zero) : Number(zero);
  const main = Math.floor((d + e) / p) * p;
  const observed = op("+", num(d), num(e));
  const mainStep = op("*", num(p), num(main / p));
  const answer = op("/", op("-", observed, mainStep), num(lc));
  const all = ["pitch", "least", "diameter", "zero", "ask"];
  const problem: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: "measurementReview", question, facts,
    entities: [{ id: "wire", kind: "body", label: "wire", evidenceFactIds: ["diameter"] }],
    expressions: [
      { id: "answer", valueType: "scalar", root: answer, evidenceFactIds: all },
      { id: "observed", valueType: "scalar", root: observed, evidenceFactIds: ["diameter", "zero"] },
      { id: "observedCopy", valueType: "scalar", root: structuredClone(observed), evidenceFactIds: ["diameter", "zero"] },
      { id: "main", valueType: "scalar", root: mainStep, evidenceFactIds: ["pitch", "diameter", "zero"] },
      { id: "leastValue", valueType: "scalar", root: num(lc), evidenceFactIds: ["least"] },
    ],
    constraints: [{ id: "observedEquality", kind: "equation", leftExpressionId: "observed", rightExpressionId: "observedCopy", evidenceFactIds: ["diameter", "zero"] }],
    representationIntents: [{ id: "wireIntent", kind: "conceptual", entityIds: ["wire"], evidenceFactIds: ["diameter"] }],
    solveRequests: [{ id: "countRequest", kind: "evaluate", expressionId: "answer", resultBinding: { turnPlanQuantityId: "count", symbol: "n", unit: "division", evidenceFactIds: all } }],
  };
  const givens = [
    { id: "pitch", symbol: "p", value: p, unit: "mm", sourceText: `pitch ${scale}`, provenance: "given" as const },
    { id: "least", symbol: "LC", value: lc, unit: "mm", sourceText: `least count ${scale}`, provenance: "given" as const },
    { id: "diameter", symbol: "d", value: d, unit: "mm", sourceText: `diameter ${wire} is measured with the screw gauge.`, provenance: "given" as const },
    { id: "zero", symbol: "e_0", value: e, unit: "mm", sourceText: `zero error ${zeroClause}`, provenance: "given" as const },
  ];
  const expected = Math.round((d + e - main) / lc);
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question, givens,
    unknowns: [{ id: "count", symbol: "n", unit: "division" }, { id: "extraUnknown", symbol: "x", unit: "division" }],
    derived: [
      { id: "count", symbol: "n", value: expected, unit: "division", sourceText: facts.map(f => f.evidence.quote).join(" | "), provenance: "derived", dependsOn: givens.map(row => row.id) },
      { id: "extraDerived", symbol: "x", value: 8, unit: "division", sourceText: "unsupported dependent value", provenance: "derived", dependsOn: ["count"] },
    ],
    qualitativeClaims: [
      { id: "countClaim", claim: "circular_divisions", expected, relatedQuantityIds: ["count"] },
      { id: "extraClaim", claim: "unsupported_claim", expected: 8, relatedQuantityIds: ["extraDerived"] },
    ],
    lawIds: ["micrometer_reading"], assumptions: [], visualRequirement: "none",
  };
  return { problem, plan };
}

function assertSafeDecline(source: string, current: Input, expectedCode: string): void {
  const problemBefore = structuredClone(current.problem);
  const planBefore = structuredClone(current.plan);
  const result = verify(current.problem, current.plan, current.problem.question);
  assert.equal(result.status, "declined", `${source}: malformed or unrepresentable input must decline`);
  assert.equal(result.issues[0]?.code, expectedCode, `${source}: explicit bounded rejection (${JSON.stringify(result.issues)})`);
  assert.equal(result.problem, current.problem, `${source}: preserve the caller's complete IR object`);
  assert.deepEqual(current.problem, problemBefore, `${source}: do not mutate the caller IR`);
  assert.deepEqual(current.plan, planBefore, `${source}: do not mutate the caller plan`);
  assert.deepEqual(result.values, {}, `${source}: decline carries no partial measurement values`);
  assert.equal(result.numericalAuthority, null, `${source}: decline has no numeric authority`);
  const declinedPlan = result.plan as TurnPlanV3;
  assert.deepEqual(declinedPlan.derived, [], `${source}: withdraw every derived output`);
  assert.deepEqual(declinedPlan.unknowns, [], `${source}: withdraw every unknown`);
  assert.deepEqual(declinedPlan.qualitativeClaims, [], `${source}: withdraw every linked or unsupported claim`);
}
function assertSignedZero(sign: "+" | "-"): void {
  const current = input({ zero: "0", signedZero: sign });
  const result = verify(current.problem, current.plan, current.problem.question);
  assert.equal(result.status, "verified", `${sign}0 remains a valid exact zero literal`);
  assert.equal(result.numericalAuthority?.value, 35, `${sign}0 retains the source-derived count`);
  assert.equal(Object.is(result.values.zero_error?.value, sign === "-" ? -0 : 0), true, `${sign}0 sign survives numeric authority`);
}

const underflow = input({ diameter: "2.4", zero: `0.${"0".repeat(330)}1`, pitch: "0.8", least: "0.01" });
assertSafeDecline("nonzero-underflow-at-integral-count", underflow, "unrepresentable_measurement_literal");

const badLabel = input();
(badLabel.problem.entities[0] as { label?: unknown }).label = 17;
assertSafeDecline("malformed-entity-label", badLabel, "invalid_entity_label");

const badGivenSource = input();
(badGivenSource.plan.givens[0] as { sourceText?: unknown }).sourceText = 17;
assertSafeDecline("malformed-given-source-text", badGivenSource, "invalid_plan_source_text");
assertSignedZero("+");
assertSignedZero("-");

console.log(`W3 measurement review fixes passed: 3 decline controls and +0/-0 preservation (${built ? "built ESM" : "TypeScript source"}); native wording hash preserved.`);
