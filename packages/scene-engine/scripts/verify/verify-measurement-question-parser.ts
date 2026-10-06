import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import type * as Authority from "../../src/ir/measurementSourceAuthority";
import type { ExpressionNodeIR, ProblemFact, ProblemIR } from "../../src/ir/problemIR";

const built = process.argv.includes("--built");
const { readScrewGaugeQuestion: parse, readScrewGaugeSource: join, verifyMeasurementSourceAuthority: verify } = await import(built
  ? "../../dist/w3/measurementSourceAuthority.js"
  : "../../src/ir/measurementSourceAuthority.ts") as typeof Authority;
const native = JSON.parse(readFileSync(new URL("fixtures/w3-measurements-native.json", import.meta.url), "utf8")) as {
  question_options_and_source_answer_verbatim: string; verbatim_question_block_sha256: string;
};
assert.equal(createHash("sha256").update(native.question_options_and_source_answer_verbatim).digest("hex"), native.verbatim_question_block_sha256);
assert.equal(native.verbatim_question_block_sha256, "2d12b0d5c223fe9713f8a31a6fa8ce17dc6cd946fb4e88e446cce98895409f01");

function question(pitch: string, least: string, diameter: string, zero: string): string {
  return `Pitch of the screw gauge is ${pitch} and least count is ${least}. A wire of true diameter ${diameter} is measured with the screw gauge. What is the circular scale reading in divisions, if the zero error of the screw gauge is ${zero}?`;
}
// Fixed independent oracles in mm: observed=true+error, sleeve from observed,
// circular count=(observed-sleeve)/LC. These literals do not read parser values.
const cores = [
  { name: "native OCR", question: native.question_options_and_source_answer_verbatim, p: 0.5, lc: 0.005, d: 2.675, e: 0.02, observed: 2.695, main: 2.5, count: 39, divisions: 100 },
  { name: "negative error", question: question("0.5 mm", "0.005 mm", "2.675 mm", "-0.02 mm"), p: 0.5, lc: 0.005, d: 2.675, e: -0.02, observed: 2.655, main: 2.5, count: 31, divisions: 100 },
  { name: "positive mark crossing", question: question("0.5 mm", "0.01 mm", "0.99 mm", "+0.05 mm"), p: 0.5, lc: 0.01, d: 0.99, e: 0.05, observed: 1.04, main: 1, count: 4, divisions: 50 },
  { name: "negative mark crossing", question: question("0.5 mm", "0.005 mm", "0.51 mm", "-0.05 mm"), p: 0.5, lc: 0.005, d: 0.51, e: -0.05, observed: 0.46, main: 0, count: 92, divisions: 100 },
  { name: "mixed metric holdout", question: question("0.08 cm", "0.00001 m", "0.00235 m", "+0.002 cm"), p: 0.8, lc: 0.01, d: 2.35, e: 0.02, observed: 2.37, main: 1.6, count: 77, divisions: 80 },
];
let checks = 0;
function check(name: string, run: () => void): void {
  try { run(); checks++; } catch (error) { throw new Error(name, { cause: error }); }
}
function success(q: string): Extract<Authority.MeasurementQuestionResult, { status: "ok" }> {
  const result = parse(q);
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.ok(result.status === "ok");
  assert.equal("problem" in result, false);
  assert.equal("numericalAuthority" in result, false);
  assert.deepEqual(Object.keys(result.evidence).sort(), ["pitch", "least_count", "true_reading", "zero_error", "circular_reading"].sort());
  for (const [role, value] of Object.entries(result.values)) {
    assert.equal(value.role, role);
    assert.equal("factId" in value, false, "source parsing cannot invent actual fact IDs");
  }
  for (const spans of Object.values(result.evidence)) for (const span of spans) {
    assert.equal(span.source, "question");
    assert.ok(Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start && span.end <= q.length);
    assert.equal(q.slice(span.start, span.end), span.quote, "exact caller-source span, never collapsed OCR text");
  }
  assert.deepEqual(parse(q), result, "pure and deterministic");
  return result;
}
for (const core of cores) check(core.name, () => {
  const r = success(core.question);
  const expected = { pitch: core.p, least_count: core.lc, true_reading: core.d, zero_error: core.e, observed_reading: core.observed, main_scale_reading: core.main, circular_reading: core.count, circular_divisions: core.divisions };
  for (const [role, value] of Object.entries(expected)) {
    const actual = r.values[role as Authority.MeasurementRole].value;
    assert.ok(Math.abs(actual - value) <= 1e-12 * Math.abs(value) || actual === value, `${role}: ${actual} != ${value}`);
  }
  assert.match(r.evidence.pitch[0]!.quote, /^(?:Least count corresponding|Pitch of)/);
  assert.deepEqual(r.evidence.pitch, r.evidence.least_count);
  assert.match(r.evidence.true_reading[0]!.quote, /^A wire of (?:true )?diameter/);
  assert.match(r.evidence.true_reading[1]!.quote, /is measured with the screw gauge\.$/);
  assert.match(r.evidence.zero_error[0]!.quote.replace(/\s+/g, " "), /^zero error of the screw gauge is [+-]/);
  assert.match(r.evidence.circular_reading[0]!.quote, /^What/);
  assert.match(r.evidence.circular_reading[0]!.quote, /\?$/);
});
for (const sign of ["+", "-"]) check(`${sign}0 source preserved`, () => {
  const r = success(question("0.5 mm", "0.005 mm", "2.675 mm", `${sign}0 mm`));
  assert.ok(Object.is(r.values.zero_error.value, sign === "-" ? -0 : 0));
  assert.equal(r.values.circular_reading.value, 35);
  assert.ok(r.evidence.zero_error[0]!.quote.includes(`${sign}0`));
});
check("exact sleeve boundary", () => {
  const r = success(question("0.5 mm", "0.005 mm", "0.5 mm", "+0 mm"));
  assert.equal(r.values.main_scale_reading.value, 0.5); assert.equal(r.values.circular_reading.value, 0);
});
check("OCR spans and arbitrary metadata IDs", () => {
  const q = native.question_options_and_source_answer_verbatim.replace(/Question Number\s*:\s*\d+/, "Question Number : 98765").replace(/Question Id\s*:\s*\d+/i, "Question Id : 55555").replace(/\s+/g, "\r\n\t  ");
  const r = success(q); assert.equal(r.values.circular_reading.value, 39);
  assert.ok(r.evidence.pitch[0]!.quote.includes("\r\n\t"));
  assert.ok(r.evidence.pitch[0]!.start > 0);
});
check("returned source evidence is fresh", () => {
  const q = cores[1]!.question; const r = success(q);
  r.values.circular_reading.value = 999; r.evidence.pitch[0]!.quote = "changed";
  assert.equal(success(q).values.circular_reading.value, 31);
});

const base = question("0.5 mm", "0.005 mm", "2.675 mm", "+0.02 mm");
const declines: [string, string, string][] = [
  ["unsupported hyphenated instrument wording", "Measure a wire with a screw-gauge.", "incomplete_instrument_source"],
  ["unsupported micrometer wording", "Measure a wire with a micrometer.", "incomplete_instrument_source"],
  ["missing pitch", base.replace("Pitch of the screw gauge is 0.5 mm and ", ""), "incomplete_instrument_source"],
  ["missing wire", base.replace("A wire of true diameter 2.675 mm is measured with the screw gauge. ", ""), "incomplete_measurement_source"],
  ["unsigned error", base.replace("+0.02", "0.02"), "unconsumed_source_clause"],
  ["double error sign", base.replace("+0.02", "+-0.02"), "unconsumed_source_clause"],
  ["exponent unsupported", base.replace("+0.02", "+2e-2"), "unconsumed_source_clause"],
  ["zero error underflow", base.replace("+0.02", `+0.${"0".repeat(330)}1`), "unrepresentable_measurement_literal"],
  ["wire underflow", base.replace("2.675", `0.${"0".repeat(330)}1`), "unrepresentable_measurement_literal"],
  ["pitch overflow", base.replace("0.5 mm", `${"9".repeat(320)} mm`), "unrepresentable_measurement_literal"],
  ["metric case", base.replace("0.5 mm", "0.5 MM"), "invalid_measurement"],
  ["zero pitch", base.replace("0.5 mm", "0 mm"), "invalid_measurement"],
  ["negative diameter", base.replace("2.675 mm", "-2.675 mm"), "invalid_measurement"],
  ["negative observed", base.replace("+0.02", "-3"), "invalid_observed_reading"],
  ["nonintegral divisions", base.replace("0.005 mm", "0.003 mm"), "nonintegral_division_count"],
  ["unbounded divisions", base.replace("0.005 mm", "0.0000001 mm"), "nonintegral_division_count"],
  ["fractional reading", base.replace("2.675", "2.676"), "off_scale_reading"],
  ["hidden prefix", `The wire is heated. ${base}`, "incomplete_instrument_source"],
  ["hidden middle", base.replace("A wire", "The wire is elastic. A wire"), "incomplete_measurement_source"],
  ["hidden suffix", `${base} Assume elasticity.`, "unconsumed_source_clause"],
  ["hidden second ask", `${base} What is its colour?`, "unconsumed_source_clause"],
  ["hidden ask before question mark", base.replace("?", " and what is the pitch?"), "unconsumed_source_clause"],
  ["malformed header", `Question Number : 1 ${base}`, "incomplete_instrument_source"],
  ["options hidden obligation", `${base} Options : 1. 39 2. 35 Calculate tension.`, "unsupported_source_metadata"],
  ["duplicate option IDs", `${base} Options : 1. 39 1. 35`, "unsupported_source_metadata"],
];
for (const [name, q, code] of declines) check(name, () => {
  const r = parse(q); assert.deepEqual(r, { status: "declined", issue: { code, message: r.status === "declined" ? r.issue.message : "" } });
  assert.equal("values" in r, false); assert.equal("evidence" in r, false);
});
for (const q of ["", "Find the area of a circle of radius 3 mm.", "A vernier caliper has zero error +0.02 mm.", "Expand (x+2)^3."]) check(`unrelated: ${q}`, () => assert.deepEqual(parse(q), { status: "none" }));

// This is a complete caller IR for the actual base question, never input to the
// pure parser. Fixed manual spans/roles and AST exercise the separate trust join.
function caller(): { problem: ProblemIR; plan: TurnPlanV3 } {
  const quoted = (text: string) => { const start = base.indexOf(text); assert.ok(start >= 0); return { source: "question" as const, start, end: start + text.length, quote: text }; };
  const facts: ProblemFact[] = [
    { id: "actualPitch", kind: "given", statement: "pitch", evidence: quoted("Pitch of the screw gauge is 0.5 mm and least count is 0.005 mm.") },
    { id: "actualLC", kind: "given", statement: "least count", evidence: quoted("Pitch of the screw gauge is 0.5 mm and least count is 0.005 mm.") },
    { id: "actualDiameter", kind: "given", statement: "wire diameter", evidence: quoted("A wire of true diameter 2.675 mm") },
    { id: "actualZero", kind: "given", statement: "zero error", evidence: quoted("zero error of the screw gauge is +0.02 mm") },
    { id: "actualAsk", kind: "requested", statement: "circular scale divisions", evidence: quoted("What is the circular scale reading in divisions, if the zero error of the screw gauge is +0.02 mm?") },
  ];
  const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
  const b = (operator: "+" | "-" | "*" | "/", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
  const ids = facts.map(f => f.id);
  const problem: ProblemIR = { schemaVersion: "problem-ir/v1", id: "actualCaller", question: base, facts,
    entities: [{ id: "callerWire", kind: "body", label: "wire", evidenceFactIds: ["actualDiameter"] }],
    expressions: [{ id: "callerExpression", valueType: "scalar", root: b("/", b("-", b("+", n(2.675), n(0.02)), b("*", n(0.5), n(5))), n(0.005)), evidenceFactIds: ids }],
    constraints: [], representationIntents: [], solveRequests: [{ id: "callerAsk", kind: "evaluate", expressionId: "callerExpression", resultBinding: { turnPlanQuantityId: "callerCount", symbol: "n", unit: "division", evidenceFactIds: ids } }] };
  const givens: TurnPlanV3["givens"] = [
    { id: "callerPitch", symbol: "p", value: 0.5, unit: "mm", provenance: "given", sourceText: facts[0]!.evidence.quote },
    { id: "callerLC", symbol: "LC", value: 0.005, unit: "mm", provenance: "given", sourceText: facts[1]!.evidence.quote },
    { id: "callerDiameter", symbol: "d", value: 2.675, unit: "mm", provenance: "given", sourceText: facts[2]!.evidence.quote },
    { id: "callerZero", symbol: "e_0", value: 0.02, unit: "mm", provenance: "given", sourceText: facts[3]!.evidence.quote },
  ];
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: base, givens,
    derived: [{ id: "callerCount", symbol: "n", value: 35, unit: "division", provenance: "derived", dependsOn: givens.map(g => g.id), sourceText: facts.map(f => f.evidence.quote).join(" | ") }],
    unknowns: [{ id: "callerCount", symbol: "n", unit: "division" }], qualitativeClaims: [], lawIds: ["micrometer_reading"], assumptions: [], visualRequirement: "none" };
  return { problem, plan };
}
check("complete actual join and certification", () => {
  const { problem, plan } = caller(); const before = structuredClone({ problem, plan });
  const r = join(problem); assert.ok("values" in r); assert.equal(r.values.pitch.factId, "actualPitch"); assert.equal(r.values.circular_reading.factId, "actualAsk");
  const certified = verify(problem, plan, base); assert.equal(certified.status, "verified", JSON.stringify(certified.issues));
  assert.equal(certified.problem, problem); assert.equal(certified.numericalAuthority?.value, 39);
  assert.deepEqual({ problem, plan }, before);
});
const joinMutations: [string, (problem: ProblemIR) => void][] = [
  ["missing facts", p => { p.facts = []; }],
  ["noncanonical role", p => { p.facts[0]!.statement = "pitch and wire tension"; }],
  ["wrong source span", p => { p.facts[0]!.evidence.start++; }],
  ["duplicate fact", p => { p.facts.push({ ...p.facts[0]!, id: "duplicate" }); }],
  ["extra assumption", p => { p.facts.push({ id: "hidden", kind: "assumption", statement: "elasticity", evidence: { ...p.facts[2]!.evidence } }); }],
];
for (const [name, mutate] of joinMutations) check(`source eligibility survives ${name}, authority does not`, () => {
  const { problem, plan } = caller(); mutate(problem); const before = structuredClone(problem);
  assert.equal(parse(problem.question).status, "ok"); assert.ok("issue" in join(problem));
  const r = verify(problem, plan, base); assert.equal(r.status, "declined"); assert.equal(r.numericalAuthority, null);
  assert.deepEqual(problem, before);
});
check("malformed actual facts cannot block source recognition or certify", () => {
  const { problem, plan } = caller(); const malformed = { ...problem, facts: [{ id: "bad", statement: 17, evidence: null }] };
  assert.equal(parse(malformed.question).status, "ok");
  const r = verify(malformed, plan, base); assert.equal(r.status, "declined"); assert.equal(r.issues[0]?.code, "invalid_problem_ir"); assert.equal(r.numericalAuthority, null);
});
check("numeric source-only evidence cannot certify a scalar-coincidence AST", () => {
  const { problem, plan } = caller(); problem.expressions[0]!.root = { kind: "number", value: 39 };
  assert.equal(parse(problem.question).status, "ok"); assert.ok("values" in join(problem));
  const r = verify(problem, plan, base); assert.equal(r.status, "declined"); assert.equal(r.issues[0]?.code, "expression_source_lineage_incomplete"); assert.equal(r.numericalAuthority, null);
});
check("source-proven main literal with complete actual evidence", () => {
  const { problem, plan } = caller();
  const root = problem.expressions[0]!.root;
  assert.ok(root.kind === "binary" && root.left.kind === "binary");
  root.left.right = { kind: "number", value: 2.5 };
  problem.expressions.push({ id: "actualMain", valueType: "scalar", root: { kind: "number", value: 2.5 }, evidenceFactIds: ["actualPitch", "actualDiameter", "actualZero"] });
  const r = verify(problem, plan, base); assert.equal(r.status, "verified", JSON.stringify(r.issues)); assert.equal(r.numericalAuthority?.value, 39);
});
for (const [name, main, evidence] of [
  ["wrong main literal", 2, ["actualPitch", "actualDiameter", "actualZero"]],
  ["missing main premise", 2.5, ["actualPitch", "actualDiameter"]],
  ["unrelated main evidence", 2.5, ["actualLC", "actualDiameter", "actualZero"]],
] as const) check(name, () => {
  const { problem, plan } = caller();
  problem.expressions.push({ id: "actualMain", valueType: "scalar", root: { kind: "number", value: main }, evidenceFactIds: [...evidence] });
  const r = verify(problem, plan, base); assert.equal(r.status, "declined"); assert.equal(r.numericalAuthority, null);
  assert.equal(r.issues[0]?.code, "expression_source_lineage_incomplete");
});
console.log(`Measurement question parser ${built ? "built ESM" : "source"}: ${checks}/${checks} checks; 5 independent cores; exact source roles; no surrogate IR/certification.`);
