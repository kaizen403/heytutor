import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { verifyMeasurementSourceAuthority } from "../../src/ir/measurementSourceAuthority";
import type { ExpressionNodeIR, ProblemFact, ProblemIR } from "../../src/ir/problemIR";

type NativeFixture = { classification: string; native_id: string; topic_id: string; verbatim_question_block_sha256: string; question_options_and_source_answer_verbatim: string; source: { document_sha256: string; source_text_sha256: string }; independent_expected_oracle: { expected: string; basis: string } };
const native = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/w3-measurements-native.json"), "utf8")) as NativeFixture;
assert.equal(native.classification, "native_source_extract");
assert.equal(createHash("sha256").update(native.question_options_and_source_answer_verbatim).digest("hex"), native.verbatim_question_block_sha256, "native wording must retain its frozen exact block hash");
assert.equal(native.source.document_sha256, "1c777785cec72e5842ac6473b4d3a4685d6edcd63d012356ebb9427f2665e1de");
assert.equal(native.source.source_text_sha256, "ecdc0f539274cfcb9a2e13050962fc47d47eb1c691929cf0cefd31cb53d4b6b2");
assert.match(native.independent_expected_oracle.basis, /Independent calculation, not native answer/);

const cases = [
  { id: native.native_id, question: native.question_options_and_source_answer_verbatim, expected: 39, pitch: 0.5, pitchUnit: "mm", least: 0.005, leastUnit: "mm", trueValue: 2.675, trueUnit: "mm", zero: 0.02, zeroUnit: "mm", main: 2.5 },
  { id: "authored-negative-zero", question: "Least count corresponding to the main scale and circular scale of a screw gauge are 0.5 mm and 0.005 mm, respectively. A wire of diameter 2.675 mm is measured with the screw gauge. What would be the reading of divisions on circular scale of the screw gauge, if the zero error of the screw gauge is -0.02 mm?", expected: 31, pitch: 0.5, pitchUnit: "mm", least: 0.005, leastUnit: "mm", trueValue: 2.675, trueUnit: "mm", zero: -0.02, zeroUnit: "mm", main: 2.5 },
  { id: "authored-positive-zero", question: "Least count corresponding to the main scale and circular scale of a screw gauge are 0.5 mm and 0.01 mm, respectively. A wire of diameter 0.625 mm is measured with the screw gauge. What would be the reading of divisions on circular scale of the screw gauge, if the zero error of the screw gauge is +0.015 mm?", expected: 14, pitch: 0.5, pitchUnit: "mm", least: 0.01, leastUnit: "mm", trueValue: 0.625, trueUnit: "mm", zero: 0.015, zeroUnit: "mm", main: 0.5 },
  { id: "authored-prefix-conversion", question: "Least count corresponding to the main scale and circular scale of a screw gauge are 0.05 cm and 0.0005 cm, respectively. A wire of diameter 0.2675 cm is measured with the screw gauge. What would be the reading of divisions on circular scale of the screw gauge, if the zero error of the screw gauge is +0.002 cm?", expected: 39, pitch: 0.05, pitchUnit: "cm", least: 0.0005, leastUnit: "cm", trueValue: 0.2675, trueUnit: "cm", zero: 0.002, zeroUnit: "cm", main: 0.25 },
  { id: "authored-main-mark-boundary", question: "Least count corresponding to the main scale and circular scale of a screw gauge are 0.5 mm and 0.005 mm, respectively. A wire of diameter 0.5 mm is measured with the screw gauge. What would be the reading of divisions on circular scale of the screw gauge, if the zero error of the screw gauge is +0 mm?", expected: 0, pitch: 0.5, pitchUnit: "mm", least: 0.005, leastUnit: "mm", trueValue: 0.5, trueUnit: "mm", zero: 0, zeroUnit: "mm", main: 0.5 },
] as const;

function ast(n: number): ExpressionNodeIR { return { kind: "number", value: n }; }
function binary(operator: " + " | " - " | " / " | " * ", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR { return { kind: "binary", operator: operator.trim() as "+" | "-" | "/" | "*", left, right }; }
function makeInput(item: typeof cases[number], override: { expression?: ExpressionNodeIR; ask?: boolean; sourceExtra?: string; planValue?: number; planUnit?: string; zeroRole?: string } = {}): { problem: ProblemIR; plan: TurnPlanV3 } {
  const question = override.sourceExtra
    ? item.question.includes("Options :") ? item.question.replace(/\n\s*Options\s*:/i, `${override.sourceExtra}\n\nOptions :`) : item.question + override.sourceExtra
    : item.question;
  const quote = (text: string): { source: "question"; start: number; end: number; quote: string } => {
    const start = question.indexOf(text); assert.notEqual(start, -1, `fixture evidence must occur in source: ${text}`);
    return { source: "question", start, end: start + text.length, quote: text };
  };
  const scaleQuote = question.match(/Least count corresponding[\s\S]*?respectively\./i)?.[0] ?? "";
  const trueQuote = question.match(/A wire of diameter[\s\S]*?\d+(?:\.\d+)?\s*(?:mm|cm|m)/i)?.[0] ?? "";
  const zeroQuote = question.match(/zero error of the screw gauge is\s+[+-]\s*\d+(?:\.\d+)?\s*(?:mm|cm|m)/i)?.[0] ?? "";
  const askQuote = question.match(/What (?:would be|is) the reading[^?]*\?|What is the circular scale reading[^?]*\?/i)?.[0] ?? "";
  const facts: ProblemFact[] = [
    { id: "pitch", kind: "given", statement: "main scale pitch", evidence: quote(scaleQuote) },
    { id: "least", kind: "given", statement: "least count", evidence: quote(scaleQuote) },
    { id: "true", kind: "given", statement: "wire diameter", evidence: quote(trueQuote) },
    { id: "zero", kind: "given", statement: override.zeroRole ?? "zero error", evidence: quote(zeroQuote) },
    ...(override.ask === false ? [] : [{ id: "ask", kind: "requested" as const, statement: "circular scale divisions", evidence: quote(askQuote) }]),
  ];
  const sourceIds = ["pitch", "least", "true", "zero", ...(override.ask === false ? [] : ["ask"])];
  const signedZero = item.zero;
  const trueInMm = item.trueValue * (item.trueUnit === "cm" ? 10 : 1);
  const zeroInMm = signedZero * (item.zeroUnit === "cm" ? 10 : 1);
  const leastInMm = item.least * (item.leastUnit === "cm" ? 10 : 1);
  const pitchInMm = item.pitch * (item.pitchUnit === "cm" ? 10 : 1);
  const mainInMm = item.main * (item.pitchUnit === "cm" ? 10 : 1);
  const formula = override.expression ?? binary(" / ", binary(" - ", binary(" + ", ast(trueInMm), ast(zeroInMm)), binary(" * ", ast(pitchInMm), ast(mainInMm / pitchInMm))), ast(leastInMm));
  const problem: ProblemIR = {
    schemaVersion: "problem-ir/v1", id: item.id.replace(/[^A-Za-z0-9]/g, "").replace(/^([^A-Za-z])/, "p$1"), question,
    facts,
    entities: [{ id: "wire", kind: "body", label: "wire", evidenceFactIds: ["true"] }],
    expressions: [
      { id: "result", valueType: "scalar", root: formula, evidenceFactIds: sourceIds },
      { id: "observed", valueType: "scalar", root: binary(" + ", ast(trueInMm), ast(zeroInMm)), evidenceFactIds: ["true", "zero"] },
      { id: "truepluszero", valueType: "scalar", root: binary(" + ", ast(trueInMm), ast(zeroInMm)), evidenceFactIds: ["true", "zero"] },
      { id: "main", valueType: "scalar", root: binary(" * ", ast(pitchInMm), ast(mainInMm / pitchInMm)), evidenceFactIds: ["pitch", "true", "zero"] },
      { id: "leastExpression", valueType: "scalar", root: ast(leastInMm), evidenceFactIds: ["least"] },
    ],
    constraints: [{ id: "observedfromzero", kind: "equation", leftExpressionId: "observed", rightExpressionId: "truepluszero", evidenceFactIds: ["true", "zero"] }],
    representationIntents: [{ id: "measurementintent", kind: "conceptual", entityIds: ["wire"], evidenceFactIds: ["true"] }],
    solveRequests: override.ask === false ? [] : [{ id: "divisioncount", kind: "evaluate", expressionId: "result", resultBinding: { turnPlanQuantityId: "n", symbol: "n", unit: "division", evidenceFactIds: sourceIds } }],
  };
  const planRows = [
    { id: "pitch", symbol: "p", value: item.pitch, unit: item.pitchUnit, sourceText: `pitch ${scaleQuote}`, provenance: "given" as const },
    { id: "least", symbol: "LC", value: item.least, unit: item.leastUnit, sourceText: `least count ${scaleQuote}`, provenance: "given" as const },
    { id: "diameter", symbol: "d", value: item.trueValue, unit: item.trueUnit, sourceText: `diameter ${trueQuote}`, provenance: "given" as const },
    { id: "zero", symbol: "e_0", value: signedZero, unit: item.zeroUnit, sourceText: `zero error ${zeroQuote}`, provenance: "given" as const },
  ];
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question, givens: planRows, unknowns: [{ id: "n", symbol: "n", unit: override.planUnit ?? "division" }],
    derived: [{ id: "n", symbol: "n", value: override.planValue ?? item.expected, unit: override.planUnit ?? "division", sourceText: facts.map((fact) => fact.evidence.quote).join(" | "), provenance: "derived", dependsOn: ["pitch", "least", "diameter", "zero"] }],
    qualitativeClaims: [{ id: "claim-n", claim: "circular_divisions", expected: item.expected, relatedQuantityIds: ["n"] }], lawIds: ["micrometer_reading"], assumptions: [], visualRequirement: "none",
  };
  return { problem, plan };
}

for (const item of cases) {
  const { problem, plan } = makeInput(item);
  const audit = verifyMeasurementSourceAuthority(problem, plan, problem.question);
  assert.equal(audit.status, "verified", `${item.id}: ${JSON.stringify(audit.issues)}`);
  assert.equal(audit.numericalAuthority?.value, item.expected, `${item.id}: independent expected division count`);
  assert.equal(audit.problem, problem, "complete ProblemIR object graph remains the numerical authority input");
  assert.equal((audit.plan as TurnPlanV3).derived.find((row) => row.id === "n")?.value, item.expected);
  assert.equal((audit.plan as TurnPlanV3).visualRequirement, "none", "simple screw-gauge arithmetic remains text-only");
}

const nativeInput = makeInput(cases[0]!);
const wrongPlan = makeInput(cases[0]!, { planValue: 35 });
wrongPlan.plan.derived.push({ id: "twice", symbol: "2n", value: 70, unit: "division", sourceText: "twice n", provenance: "derived", dependsOn: ["n"] });
wrongPlan.plan.qualitativeClaims.push({ id: "claim-twice", claim: "twice_count", expected: 70, relatedQuantityIds: ["twice"] });
const corrected = verifyMeasurementSourceAuthority(wrongPlan.problem, wrongPlan.plan, wrongPlan.problem.question);
assert.equal(corrected.status, "verified");
assert.equal((corrected.plan as TurnPlanV3).derived.find((row) => row.id === "n")?.value, 39, "source authority corrects an explicitly bound wrong planner scalar");
assert.equal((corrected.plan as TurnPlanV3).derived.some((row) => row.id === "twice"), false, "unsupported dependent quantities withdraw with a corrected quantity");
assert.equal((corrected.plan as TurnPlanV3).qualitativeClaims.length, 0, "dependent claims withdraw with a corrected quantity");

const unboundAsk = makeInput(cases[0]!, { ask: false });
const missing = verifyMeasurementSourceAuthority(unboundAsk.problem, unboundAsk.plan, unboundAsk.problem.question);
assert.equal(missing.status, "declined", "missing source ask and numerical authority signal must decline");
assert.equal(missing.numericalAuthority, null);
assert.equal((missing.plan as TurnPlanV3).derived.some((row) => row.id === "n"), false, "unbound measurement output is withdrawn on decline");
assert.equal((missing.plan as TurnPlanV3).qualitativeClaims.length, 0, "claims linked to unbound measurement output withdraw");

const badAst = makeInput(cases[0]!, { expression: ast(39) });
assert.equal(verifyMeasurementSourceAuthority(badAst.problem, badAst.plan).status, "declined", "scalar coincidence without source-term lineage is rejected");

const disconnectedAst = makeInput(cases[0]!, { expression: binary(" + ", binary(" + ", binary(" + ", binary(" + ", ast(39), binary(" - ", ast(2.675), ast(2.675))), binary(" - ", ast(0.02), ast(0.02))), binary(" - ", ast(0.5), ast(0.5))), binary(" - ", ast(0.005), ast(0.005))) });
assert.equal(verifyMeasurementSourceAuthority(disconnectedAst.problem, disconnectedAst.plan).status, "declined", "a coincident scalar with all source numbers present but no reading AST is rejected");

const wrongRole = makeInput(cases[0]!, { zeroRole: "wire diameter" });
assert.equal(verifyMeasurementSourceAuthority(wrongRole.problem, wrongRole.plan).status, "declined", "role collision is rejected despite correct scalars");

const wrongUnit = makeInput(cases[0]!, { planUnit: "mm" });
assert.equal(verifyMeasurementSourceAuthority(wrongUnit.problem, wrongUnit.plan).status, "declined", "a length unit cannot bind a division-count ask");

const extraObject = makeInput(cases[0]!, { sourceExtra: " A second wire of diameter 1 mm is also measured." });
assert.equal(verifyMeasurementSourceAuthority(extraObject.problem, extraObject.plan).status, "declined", "extra objects or measurements fail closed");

const nonIntegerDivisions = makeInput({ ...cases[0]!, question: cases[0]!.question.replace("0.5 mm and 0.005 mm", "0.5 mm and 0.006 mm") });
assert.equal(verifyMeasurementSourceAuthority(nonIntegerDivisions.problem, nonIntegerDivisions.plan).status, "declined", "nonintegral pitch/least-count division ratio declines");

const ambiguousSign = makeInput({ ...cases[0]!, question: cases[0]!.question.replace("+0.02 mm", "0.02 mm") });
assert.equal(verifyMeasurementSourceAuthority(ambiguousSign.problem, ambiguousSign.plan).status, "declined", "unsigned zero error is ambiguous");

const incompatibleMain = makeInput({ ...cases[0]!, question: cases[0]!.question.replace("2.675 mm", "2.675 s") });
assert.equal(verifyMeasurementSourceAuthority(incompatibleMain.problem, incompatibleMain.plan).status, "declined", "dimensionally incompatible source units decline");

const belowZero = makeInput({ ...cases[0]!, question: cases[0]!.question.replace("+0.02 mm", "-3 mm") });
assert.equal(verifyMeasurementSourceAuthority(belowZero.problem, belowZero.plan).status, "declined", "negative observed measurement declines");
assert.ok(nativeInput.problem.facts.length === 5 && nativeInput.problem.expressions.length === 5 && nativeInput.problem.constraints.length === 1 && nativeInput.problem.representationIntents.length === 1 && nativeInput.problem.solveRequests.length === 1, "complete facts, ASTs, constraints, intents and solve ask retained in the native oracle");

console.log(`Wave3 measurements source authority passed: ${cases.length} source cases, native 39-division oracle, and 10 fail-closed controls.`);
