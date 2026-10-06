import { validateTurnPlanV3, type TurnPlanQuantityV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { expressionToSafeSource, validateProblemIR, type ExpressionNodeIR, type ProblemIR } from "./problemIR";
import { evaluateMathExpression } from "../math/expression";

/** Deliberately bounded authority for source-complete micrometer screw-gauge arithmetic. */
export type MeasurementRole = "pitch" | "circular_divisions" | "least_count" | "true_reading" | "zero_error" | "observed_reading" | "main_scale_reading" | "circular_reading";
export interface MeasurementValue { role: MeasurementRole; value: number; unit: string; factId: string }
export interface MeasurementAuthorityIssue { code: string; message: string; quantityId?: string }
export interface MeasurementAuthorityResult {
  status: "verified" | "declined";
  /** The validated caller graph is returned whole, never replaced with a selected subproblem. */
  problem: ProblemIR | null;
  plan: unknown;
  values: Partial<Record<MeasurementRole, MeasurementValue>>;
  issues: MeasurementAuthorityIssue[];
  numericalAuthority: { kind: "screw_gauge"; sourceProblemId: string; quantityId: string; symbol: string; unit: string; value: number } | null;
}

export type MeasurementSourceRole = "pitch" | "least_count" | "true_reading" | "zero_error" | "circular_reading";
export interface MeasurementQuestionEvidence { source: "question"; start: number; end: number; quote: string }
/** Early source correction evidence only: no invented IDs, IR, solver or scene certification. */
export type MeasurementQuestionResult =
  | { status: "none" }
  | { status: "declined"; issue: MeasurementAuthorityIssue }
  | { status: "ok"; values: Record<MeasurementRole, Omit<MeasurementValue, "factId">>; evidence: Record<MeasurementSourceRole, MeasurementQuestionEvidence[]> };

/** General source/evidence operators for a parent-owned planner prompt; never a fixture dispatch. */
export const SCREW_GAUGE_QUESTION_GUIDANCE = [
  "For supported whole-question micrometer arithmetic, preserve the actual question and whole caller IR; never rewrite a smaller graph. Use law micrometer_reading, no assumptions, and visualRequirement none only when the source has no figure ask; apparatus asks remain unsupported.",
  "Exactly four given roles: pitch (p), least count (LC), wire diameter (d), signed zero error (e0). Use those fact statements and distinct actual fact IDs; the requested fact statement is circular scale divisions. Quote exact whole source clauses with original question spans: the complete pitch/least-count clause for both scale facts, wire measurement clause, signed zero-error clause, and complete circular-count ask. Given sourceText equals its fact quote, provenance given, metric units mm/cm/m.",
  "The requested derived and unknown share the actual caller ID/symbol and unit division. Derived provenance is derived; dependsOn contains all four actual given IDs; sourceText is all five actual fact quotes in caller fact order joined by ' | '. The evaluate resultBinding uses that same identity and all five evidenceFactIds.",
  "Retain the wire body labelled wire with diameter evidence; an optional component labelled screw gauge uses pitch/least-count/zero-error evidence. Retain every actual entity, expression, constraint and ask; unsupported obligations decline.",
  "Normalize lengths to mm. Scalar number/binary +,-,*,/ operators prove observed=d+signed_error; main=p*integer_mark selected from observed/p; circular=(observed-main)/LC. A main-scale numeric literal is allowed only when independently source-proven. Observed evidence joins diameter/error; main joins pitch/diameter/error; circular joins all five facts. Source-only numbers correct early evidence; whole-graph certification still requires every actual premise/obligation join.",
].join("\n");

type GivenRole = "pitch" | "least_count" | "true_reading" | "zero_error";
const GIVEN_ROLES: GivenRole[] = ["pitch", "least_count", "true_reading", "zero_error"];
const UNIT_FACTORS: Record<string, number> = { mm: 1, cm: 10, m: 1000 };
const sourceSpace = (s: string): string => s.replace(/\s+/g, " ").trim();
const normalize = (s: string): string => sourceSpace(s).toLowerCase();
function isRepresentableDecimalLiteral(raw: string): boolean {
  const value = Number(raw);
  return Number.isFinite(value) && (value !== 0 || !/[1-9]/.test(raw));
}
// Relative comparisons never turn a small nonzero given into zero authority.
const close = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 64 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
const sameIds = (actual: string[] | undefined, expected: string[]): boolean => Boolean(actual && actual.length === expected.length && new Set(actual).size === actual.length && expected.every(id => actual.includes(id)));
const STATEMENTS: Record<GivenRole | "circular_reading", string[]> = {
  pitch: ["pitch", "main scale pitch", "main scale interval"], least_count: ["least count", "lc"],
  true_reading: ["wire diameter", "true diameter", "diameter"], zero_error: ["zero error"],
  circular_reading: ["circular scale divisions", "circular-scale divisions", "reading of divisions on circular scale"],
};
const SYMBOLS: Record<GivenRole, string[]> = { pitch: ["p", "pitch"], least_count: ["LC", "lc"], true_reading: ["d", "diameter"], zero_error: ["e_0", "e0", "zero_error"] };
const PREFIXES: Record<GivenRole, string[]> = { pitch: ["pitch", "main scale pitch"], least_count: ["least count", "LC"], true_reading: ["diameter", "wire diameter"], zero_error: ["zero error"] };

type SourceRead = { values: Record<MeasurementRole, MeasurementValue> } | { issue: MeasurementAuthorityIssue };
/**
 * This is a full bounded grammar, not a clause search or a topic router. Native
 * OCR headers/options are lexical metadata; their IDs never select a behavior.
 * Every other character must belong to the four-premise, one-ask sentence.
 */
export function readScrewGaugeQuestion(question: string): MeasurementQuestionResult {
  // Recognition is independent of planner facts, and grants no authority itself.
  if (!/\b(?:screw(?:\s+|-)gauge|micrometer)\b/i.test(question)) return { status: "none" };
  const reject = (code: string, message: string): MeasurementQuestionResult => ({ status: "declined", issue: { code, message } });
  const lexical = questionLexemes(question);
  let stem = lexical.text;
  const metadata = /^question number : \d+ question id : \d+ question type : mcq option shuffling : (?:yes|no) is question mandatory : (?:yes|no) correct marks : \d+ wrong marks : \d+ /i;
  const headerLength = metadata.exec(stem)?.[0].length ?? 0;
  stem = stem.slice(headerLength);
  const optionsAt = stem.search(/ options :/i);
  if (optionsAt >= 0) {
    const options = stem.slice(optionsAt + " options :".length).trim();
    if (!/^(?:\d+\. [+-]?\d+)(?: \d+\. [+-]?\d+){1,9}$/.test(options)) return reject("unsupported_source_metadata", "Options must consist entirely of numeric option-ID/count pairs.");
    const ids = [...options.matchAll(/(?:^| )(\d+)\. /g)].map(m => m[1]!);
    if (new Set(ids).size !== ids.length) return reject("unsupported_source_metadata", "Duplicate option identifiers are ambiguous metadata.");
    stem = stem.slice(0, optionsAt);
  }
  const n = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))";
  const u = "(mm|cm|m)";
  const scales = `least count corresponding to the main scale and circular scale of a screw gauge are ${n} ${u} and ${n} ${u}, respectively\\.`;
  const alternative = `pitch of the screw gauge is ${n} ${u} and least count is ${n} ${u}\\.`;
  const scale = new RegExp(`^(?:${scales}|${alternative}) `, "i").exec(stem);
  if (!scale) return reject("incomplete_instrument_source", "The entire source must begin with supported explicit pitch/least-count premises or complete native OCR metadata.");
  const pitchRaw = scale[1] ?? scale[5]!; const pitchUnit = scale[2] ?? scale[6]!;
  const leastRaw = scale[3] ?? scale[7]!; const leastUnit = scale[4] ?? scale[8]!;
  const tail = stem.slice(scale[0].length);
  const wire = new RegExp(`^(a wire of (?:true )?diameter ${n} ${u}) is measured with the screw gauge\\. `, "i").exec(tail);
  if (!wire) return reject("incomplete_measurement_source", "Exactly one wire diameter and its screw-gauge measurement are required.");
  const ask = tail.slice(wire[0].length);
  const request = new RegExp(`^(?:what would be the reading of divisions on circular scale of the screw gauge|what is the circular scale reading in divisions), if the (zero error of the screw gauge is ([+-])\\s*(\\d+(?:\\.\\d*)?|\\.\\d+) ${u})\\s*\\?$`, "i").exec(ask);
  if (!request) return reject("unconsumed_source_clause", "The remaining source must be exactly one circular-division ask with an explicitly signed zero error; hidden clauses and further asks are unsupported.");
  if (![pitchRaw, leastRaw, wire[2]!, request[3]!].every(isRepresentableDecimalLiteral)) return reject("unrepresentable_measurement_literal", "Every source decimal must be finite and any lexically nonzero value must remain nonzero before unit conversion.");
  const length = (raw: string, unit: string): number => Number(raw) * UNIT_FACTORS[unit]!;
  const pitch = length(pitchRaw, pitchUnit); const least = length(leastRaw, leastUnit);
  const trueReading = length(wire[2]!, wire[3]!);
  const zeroMagnitude = length(request[3]!, request[4]!);
  if (![pitch, least, trueReading].every(v => Number.isFinite(v) && v > 0) || !Number.isFinite(zeroMagnitude) || zeroMagnitude < 0 || (Number(request[3]) !== 0 && zeroMagnitude === 0)) return reject("invalid_measurement", "Positive finite metric lengths and a finite signed zero error are required.");
  const zeroError = (request[2] === "-" ? -1 : 1) * zeroMagnitude;
  const ratio = pitch / least; const divisions = Math.round(ratio);
  if (!Number.isSafeInteger(divisions) || divisions < 1 || divisions > 100000 || !close(ratio, divisions)) return reject("nonintegral_division_count", "Pitch/least count must define an integral, bounded division count.");
  const observed = trueReading + zeroError;
  if (!Number.isFinite(observed) || observed < 0) return reject("invalid_observed_reading", "The source-derived observed reading must be finite and nonnegative.");
  // The sleeve mark is determined by the OBSERVED reading, including crossings.
  const markRatio = observed / pitch; const nearestMark = Math.round(markRatio);
  const mainDivisions = close(markRatio, nearestMark) ? nearestMark : Math.floor(markRatio);
  const main = mainDivisions * pitch;
  const quotient = (observed - main) / least;
  const count = Math.round(quotient);
  const roundoff = 64 * Number.EPSILON * (Math.abs(trueReading) + Math.abs(zeroError) + Math.abs(main)) / least;
  if (!Number.isFinite(roundoff) || roundoff >= 0.25 || !Number.isSafeInteger(mainDivisions) || !Number.isSafeInteger(count) || count < 0 || count >= divisions || Math.abs(quotient - count) > roundoff) return reject("off_scale_reading", "The observed reading must land on an exact in-range circular division.");
  // Offsets are in the caller question, including native OCR whitespace/header.
  const span = (offset: number, text: string): MeasurementQuestionEvidence => lexical.span(headerLength + offset, text.trim().length);
  const wireOffset = scale[0].length;
  const askOffset = wireOffset + wire[0].length;
  const evidence: Record<MeasurementSourceRole, MeasurementQuestionEvidence[]> = {
    pitch: [span(0, scale[0])], least_count: [span(0, scale[0])],
    true_reading: [span(wireOffset, wire[1]!), span(wireOffset, wire[0])],
    zero_error: [span(askOffset + ask.indexOf(request[1]!), request[1]!)],
    circular_reading: [span(askOffset, ask)],
  };
  const rawValues: Record<MeasurementRole, number> = {
    pitch, least_count: least, true_reading: trueReading, zero_error: zeroError,
    circular_reading: count, circular_divisions: divisions, observed_reading: observed, main_scale_reading: main,
  };
  const values = {} as Record<MeasurementRole, Omit<MeasurementValue, "factId">>;
  for (const role of Object.keys(rawValues) as MeasurementRole[]) {
    values[role] = { role, value: rawValues[role], unit: role === "circular_reading" || role === "circular_divisions" ? "division" : "mm" };
  }
  return { status: "ok", values, evidence };
}

/** Collapse whitespace for grammar only; map every evidence span back to exact source offsets (UTF-16). */
function questionLexemes(question: string): { text: string; span: (start: number, length: number) => MeasurementQuestionEvidence } {
  let text = "";
  const positions: number[] = [];
  for (const match of question.matchAll(/\S+/g)) {
    if (text.length) { text += " "; positions.push(match.index - 1); }
    text += match[0];
    for (let i = 0; i < match[0].length; i++) positions.push(match.index + i);
  }
  return { text, span: (offset, length) => {
    const start = positions[offset]!; const end = positions[offset + length - 1]! + 1;
    return { source: "question", start, end, quote: question.slice(start, end) };
  } };
}

/** Join only the actual complete facts onto parsed source; this join is not IR certification. */
export function readScrewGaugeSource(problem: ProblemIR): SourceRead {
  const parsed = readScrewGaugeQuestion(problem.question);
  if (parsed.status === "declined") return { issue: parsed.issue };
  if (parsed.status === "none") return decline("incomplete_instrument_source", "The entire source must begin with supported explicit pitch/least-count premises or complete native OCR metadata.");
  const { evidence } = parsed;
  const values = {} as Record<MeasurementRole, MeasurementValue>;
  const usedFacts = new Set<string>();
  for (const role of [...GIVEN_ROLES, "circular_reading"] as const) {
    const facts = problem.facts.filter(f => f.kind === (role === "circular_reading" ? "requested" : "given") && STATEMENTS[role].includes(normalize(f.statement)) && evidence[role].map(item => normalize(item.quote)).includes(normalize(f.evidence.quote)) && f.evidence.start >= 0 && f.evidence.end > f.evidence.start && f.evidence.end <= problem.question.length && problem.question.slice(f.evidence.start, f.evidence.end) === f.evidence.quote);
    if (facts.length !== 1 || usedFacts.has(facts[0]!.id)) return decline("source_fact_role_unbound", `Exactly one correctly quoted, distinct ${role} fact with its complete semantic role is required.`);
    usedFacts.add(facts[0]!.id);
    values[role] = { role, value: parsed.values[role].value, unit: parsed.values[role].unit, factId: facts[0]!.id };
  }
  if (problem.facts.length !== usedFacts.size) return decline("unsupported_fact", "Every actual fact must join a source premise or the single requested count.");
  values.circular_divisions = { role: "circular_divisions", value: parsed.values.circular_divisions.value, unit: "division", factId: values.pitch.factId };
  values.observed_reading = { role: "observed_reading", value: parsed.values.observed_reading.value, unit: "mm", factId: values.true_reading.factId };
  values.main_scale_reading = { role: "main_scale_reading", value: parsed.values.main_scale_reading.value, unit: "mm", factId: values.pitch.factId };
  return { values };
}

/** Audit all actual IR obligations before granting or correcting bound authority. */
export function verifyMeasurementSourceAuthority(problemRaw: unknown, planRaw: unknown, expectedQuestion?: string): MeasurementAuthorityResult {
  const problemResult = validateProblemIR(problemRaw, expectedQuestion);
  const problem = problemResult.problem;
  const fail = (code: string, message: string, values: Partial<Record<MeasurementRole, MeasurementValue>> = {}): MeasurementAuthorityResult => ({ status: "declined", problem, plan: withdrawUnsupported(planRaw), values, issues: [{ code, message }], numericalAuthority: null });
  if (!problem) return fail("invalid_problem_ir", problemResult.issues.map(i => `${i.path}: ${i.message}`).join("; "));
  const planResult = validateTurnPlanV3(planRaw, expectedQuestion ?? problem.question);
  if (!planResult.plan) return fail("invalid_turn_plan", planResult.issues.map(i => i.message).join("; "));
  const plan = planResult.plan;
  if (problem.entities.some(entity => entity.label !== undefined && typeof entity.label !== "string")) return fail("invalid_entity_label", "Every supplied entity label must be a string before source-role normalization.");
  if (plan.givens.some(row => row.sourceText !== undefined && typeof row.sourceText !== "string") || plan.derived.some(row => row.sourceText !== undefined && typeof row.sourceText !== "string")) return fail("invalid_plan_source_text", "Every supplied plan sourceText field must be a string before source-role normalization.");
  if (sourceSpace(plan.question) !== sourceSpace(problem.question)) return fail("question_mismatch", "Plan source text must retain the actual caller question, including unit case.");
  const read = readScrewGaugeSource(problem);
  if ("issue" in read) return fail(read.issue.code, read.issue.message);
  const v = read.values;
  const ids = (roles: MeasurementRole[]) => roles.map(r => v[r].factId);
  const allFacts = ids([...GIVEN_ROLES, "circular_reading"]);
  const irIssue = inspectWholeIR(problem, v);
  if (irIssue) return fail(irIssue.code, irIssue.message, v);
  // A visual instrument profile is explicitly unsupported, never silently text-only.
  if (plan.visualRequirement !== "none") return fail("visual_instrument_profile_gap", "This bounded arithmetic authority has no verified instrument-readout scene profile.", v);
  if (plan.assumptions.length || plan.lawIds.some(law => law !== "micrometer_reading") || plan.teachingSequenceHints?.length) return fail("unsupported_plan_obligation", "Additional assumptions, laws or visual sequence obligations are unsupported.", v);
  const request = problem.solveRequests[0]!;
  if (request.kind !== "evaluate" || !request.resultBinding) return fail("numerical_authority_missing", "The sole ask must have an explicit evaluate binding.", v);
  const binding = request.resultBinding;
  const unknown = plan.unknowns.find(row => row.id === binding.turnPlanQuantityId);
  const target = plan.derived.find(row => row.id === binding.turnPlanQuantityId);
  if (!unknown || !target || plan.givens.some(row => row.symbol === binding.symbol) || binding.symbol.trim() === "" || unknown.symbol !== binding.symbol || target.symbol !== binding.symbol || ![unknown.unit, target.unit, binding.unit].every(countUnit) || !sameIds(binding.evidenceFactIds, allFacts)) return fail("plan_binding_incomplete", "The actual requested unknown and derived row must share the explicit caller identity, symbol, count unit and every source fact.", v);
  if (plan.givens.length !== 4) return fail("source_given_premises_incomplete", "Exactly four actual source givens are required.", v);
  const givenIds: string[] = [];
  for (const role of GIVEN_ROLES) {
    const fact = problem.facts.find(f => f.id === v[role].factId)!;
    const rows = plan.givens.filter(row => SYMBOLS[role].includes(row.symbol) && row.provenance === "given" && signedMetricEqual(row, v[role].value) && sourceTextForGiven(row.sourceText, fact.evidence.quote, role) && !(row.dependsOn?.length) && row.uncertainty === undefined && signMatches(row));
    if (rows.length !== 1 || givenIds.includes(rows[0]!.id)) return fail("source_given_role_unbound", `The actual ${role} given requires its symbol, signed metric value and exact role evidence, without assumed dependencies or uncertainty.`, v);
    givenIds.push(rows[0]!.id);
  }
  const expectedText = problem.facts.map(f => f.evidence.quote).join(" | ");
  if (!sameIds(target.dependsOn, givenIds) || target.provenance !== "derived" || sourceSpace(target.sourceText ?? "") !== sourceSpace(expectedText) || target.uncertainty !== undefined || !signMatches(target)) return fail("plan_binding_incomplete", "The bound derived row must consume all four unique actual given IDs and only their full source/ask evidence.", v);
  const expected = v.circular_reading.value;
  const corrected = !close(target.value, expected);
  // Inspect/withdraw every unsupported numeric row, unknown, and linked claim,
  // even if the chosen scalar was already correct. The unknown+derived same ID
  // is a legitimate pair, not a duplicate quantity.
  const clean = retainBoundPlan(plan, target, expected, corrected);
  return { status: "verified", problem, plan: clean, values: v,
    issues: [
      ...(corrected ? [{ code: "source_value_corrected", quantityId: target.id, message: `Corrected the fully joined circular division count to ${expected}.` }] : []),
      ...(clean.derived.length !== plan.derived.length || clean.unknowns.length !== plan.unknowns.length || clean.qualitativeClaims.length !== plan.qualitativeClaims.length ? [{ code: "unsupported_plan_outputs_withdrawn", message: "Withdrew all unsupported numeric outputs, unknowns and claims; retained only the fully proved requested count." }] : []),
    ],
    numericalAuthority: { kind: "screw_gauge", sourceProblemId: problem.id, quantityId: target.id, symbol: target.symbol, unit: "division", value: expected } };
}

function inspectWholeIR(problem: ProblemIR, v: Record<MeasurementRole, MeasurementValue>): MeasurementAuthorityIssue | null {
  const issue = (code: string, message: string) => ({ code, message });
  const facts = (roles: MeasurementRole[]) => roles.map(r => v[r].factId);
  const entityRoles = new Map<string, "wire" | "instrument">();
  for (const e of problem.entities) {
    const label = normalize(e.label ?? "");
    const role = e.kind === "body" && label === "wire" && sameIds(e.evidenceFactIds, facts(["true_reading"])) ? "wire"
      : e.kind === "component" && label === "screw gauge" && sameIds(e.evidenceFactIds, facts(["pitch", "least_count", "zero_error"])) ? "instrument" : null;
    if (!role || [...entityRoles.values()].includes(role)) return issue("unsupported_entity", "Every actual entity must be the unique source wire or screw-gauge instrument with its complete role evidence.");
    entityRoles.set(e.id, role);
  }
  if (![...entityRoles.values()].includes("wire")) return issue("wire_entity_missing", "The measured wire must remain in the full caller IR.");
  for (const intent of problem.representationIntents) {
    if (intent.kind !== "conceptual" || intent.entityIds.length !== 1 || entityRoles.get(intent.entityIds[0]!) !== "wire" || !sameIds(intent.evidenceFactIds, facts(["true_reading"]))) return issue("unsupported_intent", "Only a source-grounded conceptual wire intent is supported; actual apparatus profiles are a visual gap.");
  }
  if (problem.solveRequests.length !== 1) return issue("unsupported_solve_request", "All solve requests must reduce to the single source circular-division ask.");
  const request = problem.solveRequests[0]!;
  if (request.kind !== "evaluate" || !request.resultBinding || !sameIds(request.resultBinding.evidenceFactIds, facts([...GIVEN_ROLES, "circular_reading"]))) return issue("unsupported_solve_request", "The actual request must explicitly bind every premise and the requested count.");
  const roles = new Map<string, MeasurementRole>();
  for (const expression of problem.expressions) {
    if (expression.valueType !== "scalar") return issue("unsupported_expression", "Every actual expression must be a supported scalar measurement step.");
    const role = expressionRole(expression.root, expression.evidenceFactIds, v);
    if (!role) return issue("expression_source_lineage_incomplete", `Expression ${expression.id} has no complete supported measurement AST/proof, regardless of scalar coincidence.`);
    let scalar: number;
    try { scalar = evaluateMathExpression(expressionToSafeSource(expression.root), 0); } catch { return issue("expression_not_evaluable", `Expression ${expression.id} is not evaluable.`); }
    const tolerance = 64 * Number.EPSILON * (Math.abs(v.true_reading.value) + Math.abs(v.zero_error.value) + Math.abs(v.main_scale_reading.value)) / v.least_count.value;
    if (!close(scalar, v[role].value) && !(role === "circular_reading" && Math.abs(scalar - v[role].value) <= tolerance)) return issue("ir_expression_conflict", `Expression ${expression.id} contradicts its independent measurement proof.`);
    roles.set(expression.id, role);
  }
  if (roles.get(request.expressionId) !== "circular_reading") return issue("expression_source_lineage_incomplete", "The bound expression must prove the requested circular reading.");
  for (const c of problem.constraints) {
    if (c.kind !== "equation") return issue("unsupported_constraint", "Only equations between checked steps of the same measurement role are supported.");
    const left = roles.get(c.leftExpressionId); const right = roles.get(c.rightExpressionId);
    if (!left || left !== right || !sameIds(c.evidenceFactIds, rolePremises(left, v))) return issue("constraint_proof_conflict", "Every equation must equate independently proved expressions of the same role with exact premise evidence.");
  }
  return null;
}
function rolePremises(role: MeasurementRole, v: Record<MeasurementRole, MeasurementValue>): string[] {
  const roles: MeasurementRole[] = role === "observed_reading" ? ["true_reading", "zero_error"]
    : role === "main_scale_reading" ? ["pitch", "true_reading", "zero_error"]
    : role === "circular_reading" ? [...GIVEN_ROLES, "circular_reading"]
    : role === "circular_divisions" ? ["pitch", "least_count"] : [role];
  return roles.map(r => v[r].factId);
}
function expressionRole(root: ExpressionNodeIR, evidence: string[], v: Record<MeasurementRole, MeasurementValue>): MeasurementRole | null {
  const literal = (node: ExpressionNodeIR, value: number) => node.kind === "number" && close(node.value, value);
  const observed = (node: ExpressionNodeIR) => node.kind === "binary" && node.operator === "+" && literal(node.left, v.true_reading.value) && literal(node.right, v.zero_error.value);
  // The independently parsed observed reading proves the sleeve value. A
  // literal is admissible only for this role, still with exact premise joins;
  // observed/count scalar coincidences remain unsupported.
  const main = (node: ExpressionNodeIR) => literal(node, v.main_scale_reading.value) || (node.kind === "binary" && node.operator === "*" && literal(node.left, v.pitch.value) && literal(node.right, Math.round(v.main_scale_reading.value / v.pitch.value)));
  const circular = root.kind === "binary" && root.operator === "/" && root.left.kind === "binary" && root.left.operator === "-" && observed(root.left.left) && main(root.left.right) && literal(root.right, v.least_count.value);
  const matches: MeasurementRole[] = [];
  for (const role of GIVEN_ROLES) if (literal(root, v[role].value)) matches.push(role);
  if (observed(root)) matches.push("observed_reading");
  if (main(root)) matches.push("main_scale_reading");
  if (circular) matches.push("circular_reading");
  if (root.kind === "binary" && root.operator === "/" && literal(root.left, v.pitch.value) && literal(root.right, v.least_count.value)) matches.push("circular_divisions");
  const joined = matches.filter(role => sameIds(evidence, rolePremises(role, v)));
  return joined.length === 1 ? joined[0]! : null;
}
function signedMetricEqual(row: TurnPlanQuantityV3, expected: number): boolean {
  const factor = UNIT_FACTORS[row.unit ?? ""];
  return factor !== undefined && close(row.value * factor, expected);
}
function signMatches(row: TurnPlanQuantityV3): boolean {
  return row.sign === undefined || row.sign === (row.value > 0 ? "positive" : row.value < 0 ? "negative" : "zero");
}
function countUnit(unit: string | undefined): boolean { return unit === "division" || unit === "divisions" || unit === "1" || unit === "dimensionless"; }
function sourceTextForGiven(text: string | undefined, quote: string, role: GivenRole): boolean {
  const actual = sourceSpace(text ?? ""); const evidence = sourceSpace(quote);
  return actual === evidence || PREFIXES[role].some(prefix => actual === `${prefix} ${evidence}`);
}
function retainBoundPlan(plan: TurnPlanV3, target: TurnPlanQuantityV3, expected: number, corrected: boolean): TurnPlanV3 {
  const derived = [{ ...target, value: expected, ...(target.sign === undefined ? {} : { sign: expected === 0 ? "zero" as const : "positive" as const }) }];
  const unknowns = plan.unknowns.filter(row => row.id === target.id);
  const qualitativeClaims = corrected ? [] : plan.qualitativeClaims.filter(claim => claim.claim === "circular_divisions" && claim.expected === expected && sameIds(claim.relatedQuantityIds, [target.id]) && !claim.relatedEntityHints?.length);
  return { ...plan, derived, unknowns, qualitativeClaims };
}
/** Decline gives no residual numeric answer/unknown/claim authority, including malformed plans. */
function withdrawUnsupported(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  return { ...raw, derived: [], unknowns: [], qualitativeClaims: [] };
}
function decline(code: string, message: string): { issue: MeasurementAuthorityIssue } { return { issue: { code, message } }; }
