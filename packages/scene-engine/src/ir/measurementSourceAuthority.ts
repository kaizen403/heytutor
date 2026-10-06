import { validateTurnPlanV3, type TurnPlanQuantityV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { expressionToSafeSource, validateProblemIR, type ProblemExpression, type ProblemIR } from "./problemIR";
import { evaluateMathExpression } from "../math/expression";

/** Deliberately bounded authority for source-complete micrometer screw-gauge arithmetic. */
export type MeasurementRole = "pitch" | "circular_divisions" | "least_count" | "true_reading" | "zero_error" | "observed_reading" | "main_scale_reading" | "circular_reading";
export interface MeasurementValue { role: MeasurementRole; value: number; unit: string; factId: string }
export interface MeasurementAuthorityIssue { code: string; message: string; quantityId?: string }
export interface MeasurementAuthorityResult {
  status: "verified" | "declined";
  /** The validated complete ProblemIR is retained intact for downstream solver/teaching paths. */
  problem: ProblemIR | null;
  /** Full plan clone after a bound result correction or unsafe dependent-row withdrawal. */
  plan: unknown;
  values: Partial<Record<MeasurementRole, MeasurementValue>>;
  issues: MeasurementAuthorityIssue[];
  numericalAuthority: { kind: "screw_gauge"; sourceProblemId: string; quantityId: string; symbol: string; unit: string; value: number } | null;
}

type Unit = { canonical: "mm"; toMm: number };
const UNITS: Record<string, Unit> = { mm: { canonical: "mm", toMm: 1 }, millimeter: { canonical: "mm", toMm: 1 }, millimeters: { canonical: "mm", toMm: 1 }, millimetre: { canonical: "mm", toMm: 1 }, millimetres: { canonical: "mm", toMm: 1 }, cm: { canonical: "mm", toMm: 10 }, m: { canonical: "mm", toMm: 1000 } };
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 32 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Read only a complete, unambiguous screw-gauge stem. Input clauses must state
 * pitch, divisions or a derivable pitch/least-count pair, true size, zero-error
 * sign, and request the circular-scale division count. Additional measurement
 * clauses, instruments, objects, or a contradictory reading cause a decline.
 */
export function readScrewGaugeSource(problem: ProblemIR): { values: Record<MeasurementRole, MeasurementValue> } | { issue: MeasurementAuthorityIssue } {
  const question = problem.question;
  const stem = question.split(/\n\s*Options\s*:/i, 1)[0]!.trim();
  if (/\b(?:vernier|ruler|stopwatch|balance|caliper|micrometer)s?\b/i.test(stem.replace(/screw gauge/gi, ""))) return decline("unsupported_instrument", "Only a single screw gauge is in this bounded source reader.");
  if (/\b(?:another|second|two|both|each|respectively)\s+(?:wire|rod|object|reading|instrument)s?\b/i.test(stem)) return decline("multiple_measurements", "Multiple measured objects or instruments are outside this source contract.");

  const nativeScales = /least count corresponding to the main scale and circular scale of a screw\s*gauge are\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)\s+and\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m),\s*respectively/i.exec(stem);
  const canonicalScales = /(?:pitch|main scale interval)\s*(?:is|of|=|:)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)\s*(?:,|and)\s*(?:the\s*)?(?:circular scale\s*)?(?:has\s*)?([1-9]\d{0,5})\s*(?:circular[- ]scale\s*)?divisions?\s*(?:and\s*)?(?:least count|LC)\s*(?:is|of|=|:)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)/i.exec(stem);
  let pitchRaw: string, pitchUnit: string, divisions: number | undefined, leastRaw: string, leastUnit: string;
  if (nativeScales) {
    pitchRaw = nativeScales[1]!; pitchUnit = nativeScales[2]!; leastRaw = nativeScales[3]!; leastUnit = nativeScales[4]!;
  } else if (canonicalScales) {
    pitchRaw = canonicalScales[1]!; pitchUnit = canonicalScales[2]!; divisions = Number(canonicalScales[3]); leastRaw = canonicalScales[4]!; leastUnit = canonicalScales[5]!;
  } else return decline("incomplete_instrument_source", "Pitch and least count must be explicitly source-grounded in a supported screw-gauge clause.");
  const clauses = stem.slice(stem.search(/least count corresponding|(?:pitch|main scale interval)/i));
  const numericTokens = [...clauses.matchAll(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g)];
  if (numericTokens.length !== (nativeScales ? 4 : 5)) return decline("extra_measurement_clause", "The bounded screw-gauge source must contain only its pitch, least count, true size, signed zero error, and optional division count.");

  const trueMatch = /(?:wire|rod|object)\s+(?:of\s+)?(?:true\s+)?(?:diameter|size|reading)\s*(?:of|is|=)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)/i.exec(stem)
    ?? /(?:true\s+)?(?:diameter|size|reading)\s*(?:of|is|=)\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)/i.exec(stem);
  const zeroMatch = /zero\s+error\s+(?:of\s+the\s+screw\s*gauge\s*)?(?:is|=|of)?\s*([+-])\s*(\d+(?:\.\d*)?|\.\d+)\s*(mm|cm|m)/i.exec(stem);
  if (!trueMatch || !zeroMatch || !/circular[- ]scale\s+(?:reading\s+of\s+)?divisions?|reading\s+of\s+divisions?\s+on\s+(?:the\s+)?circular[- ]scale/i.test(stem)) return decline("incomplete_measurement_source", "True size, signed zero error, and a circular-division ask are all required.");
  if (!/screw\s*gauge/i.test(stem)) return decline("instrument_role_missing", "The source must identify the screw gauge explicitly.");
  if (/\b(?:least count|LC)\b[^.\n]*\b(?:wrong|unknown|uncertain|approximately)\b/i.test(stem)) return decline("ambiguous_least_count", "Uncertain least-count wording is outside the exact source contract.");

  const mm = (raw: string, unit: string, allowZero = false): number => {
    const factor = UNITS[unit.toLowerCase()];
    if (!factor) throw new Error("unsupported unit");
    const value = Number(raw) * factor.toMm;
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error("finite nonnegative error or positive measurement required");
    return value;
  };
  let pitch: number, least: number, trueReading: number, zeroMagnitude: number;
  try {
    pitch = mm(pitchRaw!, pitchUnit!); least = mm(leastRaw!, leastUnit!); trueReading = mm(trueMatch[1]!, trueMatch[2]!);
    zeroMagnitude = mm(zeroMatch[2]!, zeroMatch[3]!, true);
  } catch { return decline("invalid_measurement", "Screw-gauge lengths must be positive finite values in supported metric units."); }
  const zeroError = (zeroMatch[1] === "-" ? -1 : 1) * zeroMagnitude;
  const implied = pitch / least;
  if (!Number.isInteger(implied) || implied < 1 || implied > 100000 || (divisions !== undefined && divisions !== implied)) return decline("nonintegral_division_count", "Pitch divided by least count must be a positive integer equal to any stated division count.");
  const observed = trueReading + zeroError;
  if (!(observed > 0)) return decline("invalid_observed_reading", "Zero-error correction produces a nonpositive observed reading.");
  const main = Math.floor((trueReading + 32 * Number.EPSILON * trueReading) / pitch) * pitch;
  const quotient = (observed - main) / least;
  const count = Math.round(quotient);
  if (!Number.isInteger(count) || count < 0 || count >= implied || !close(quotient, count)) return decline("off_scale_reading", "The source-derived circular reading is not an exact in-range division count.");

  const roleFacts: Array<[MeasurementRole, number, string, RegExp]> = [
    ["pitch", pitch, "mm", /(?:pitch|main scale)/i], ["least_count", least, "mm", /least count|\bLC\b/i],
    ["true_reading", trueReading, "mm", /diameter|true size|true reading/i], ["zero_error", zeroError, "mm", /zero error/i],
  ];
  const values = {} as Record<MeasurementRole, MeasurementValue>;
  for (const [role, value, unit, semantic] of roleFacts) {
    const match = problem.facts.filter((fact) => fact.kind === "given" && semantic.test(fact.statement) && containsNumber(fact.evidence.quote, value, unit));
    if (match.length !== 1) return decline("source_fact_role_unbound", `ProblemIR must contain exactly one source-grounded given for ${role}.`);
    values[role] = { role, value, unit, factId: match[0]!.id };
  }
  const askFacts = problem.facts.filter((fact) => fact.kind === "requested" && /circular[- ]scale.*divisions?|divisions?.*circular[- ]scale/i.test(`${fact.statement} ${fact.evidence.quote}`));
  if (askFacts.length !== 1) return decline("ask_role_unbound", "ProblemIR must preserve exactly one source-grounded circular-scale division ask.");
  values.circular_divisions = { role: "circular_divisions", value: implied, unit: "division", factId: values.pitch.factId };
  values.observed_reading = { role: "observed_reading", value: observed, unit: "mm", factId: values.true_reading.factId };
  values.main_scale_reading = { role: "main_scale_reading", value: main, unit: "mm", factId: values.pitch.factId };
  values.circular_reading = { role: "circular_reading", value: count, unit: "division", factId: askFacts[0]!.id };
  return { values };
}

/** Audit a complete ProblemIR and explicitly bound TurnPlanV3 against source arithmetic. */
export function verifyMeasurementSourceAuthority(problemRaw: unknown, planRaw: unknown, expectedQuestion?: string): MeasurementAuthorityResult {
  const problemResult = validateProblemIR(problemRaw, expectedQuestion);
  if (!problemResult.problem) return result("declined", null, planRaw, {}, "invalid_problem_ir", problemResult.issues.map((item) => `${item.path}: ${item.message}`).join("; "));
  const planResult = validateTurnPlanV3(planRaw, expectedQuestion);
  if (!planResult.plan) return result("declined", problemResult.problem, planRaw, {}, "invalid_turn_plan", planResult.issues.map((item) => item.message).join("; "));
  const read = readScrewGaugeSource(problemResult.problem);
  if ("issue" in read) return { status: "declined", problem: problemResult.problem, plan: withdrawUnsupported(planResult.plan), values: {}, issues: [read.issue], numericalAuthority: null };
  const values = read.values;
  const sourceIds = new Set([values.pitch.factId, values.least_count.factId, values.true_reading.factId, values.zero_error.factId]);
  const requiredSourceIds = [...sourceIds];
  const requestCandidates = problemResult.problem.solveRequests.filter((request): request is Extract<ProblemIR["solveRequests"][number], { kind: "evaluate" }> & { resultBinding: NonNullable<Extract<ProblemIR["solveRequests"][number], { kind: "evaluate" }>["resultBinding"]> } => request.kind === "evaluate" && request.resultBinding !== undefined && request.resultBinding.evidenceFactIds.includes(values.circular_reading.factId));
  if (requestCandidates.length !== 1) return { status: "declined", problem: problemResult.problem, plan: withdrawUnsupported(planResult.plan), values, issues: [{ code: "numerical_authority_missing", message: "A unique evaluate request must bind the source division ask." }], numericalAuthority: null };
  const request = requestCandidates[0]!;
  const expression = problemResult.problem.expressions.find((entry) => entry.id === request.expressionId)!;
  const allFacts = [...requiredSourceIds, values.circular_reading.factId];
  if (expression.valueType !== "scalar" || allFacts.some((id) => !expression.evidenceFactIds.includes(id)) || !matchesScrewGaugeFormula(expression, values)) {
    return { status: "declined", problem: problemResult.problem, plan: withdrawUnsupported(planResult.plan), values, issues: [{ code: "expression_source_lineage_incomplete", message: "The full result AST must encode (true size + signed zero error - pitch × source-derived main divisions) ÷ least count and retain every source fact link." }], numericalAuthority: null };
  }
  let astValue: number;
  try { astValue = evaluateMathExpression(expressionToSafeSource(expression.root), 0); }
  catch { return { status: "declined", problem: problemResult.problem, plan: withdrawUnsupported(planResult.plan), values, issues: [{ code: "expression_not_evaluable", message: "The bound full-IR expression cannot be evaluated as a scalar." }], numericalAuthority: null }; }
  const expected = values.circular_reading.value;
  if (!close(astValue, expected)) return { status: "declined", problem: problemResult.problem, plan: withdrawUnsupported(planResult.plan), values, issues: [{ code: "ir_expression_conflict", message: "The source-linked ProblemIR expression contradicts the independently recomputed division count." }], numericalAuthority: null };

  const binding = request.resultBinding!;
  const unknown = planResult.plan.unknowns.find((item) => item.id === binding.turnPlanQuantityId);
  const derived = planResult.plan.derived.find((item) => item.id === binding.turnPlanQuantityId);
  if (!unknown || !derived) return { status: "declined", problem: problemResult.problem, plan: withdrawUnsupported(planResult.plan), values, issues: [{ code: "plan_binding_incomplete", message: "The solve request must bind a numeric unknown and a derived plan row." }], numericalAuthority: null };
  const givenSources = sourceIdsInPlan(planResult.plan, values);
  const planLineage = { unknown: Boolean(unknown), derived: Boolean(derived), symbols: Boolean(unknown && derived && unknown.symbol === binding.symbol && derived.symbol === binding.symbol), units: Boolean(unknown && derived && sameUnit(unknown.unit, "division") && sameUnit(binding.unit, "division") && sameUnit(derived.unit, "division")), provenance: derived?.provenance === "derived", dependencies: Boolean(derived?.dependsOn?.length && derived.dependsOn.every((id) => givenSources.has(id))), evidence: allFacts.every((id) => binding.evidenceFactIds.includes(id)), sourceText: Boolean(derived && sourceTextBacked(derived.sourceText, problemResult.problem, allFacts)) };
  if (Object.values(planLineage).some((valid) => !valid)) {
    return { status: "declined", problem: problemResult.problem, plan: withdrawUnsupported(planResult.plan), values, issues: [{ code: "plan_binding_incomplete", message: `The result plan row must bind its ask, units, derived role, source evidence, and dependencies on all source-given measurement quantities (${JSON.stringify(planLineage)}).` }], numericalAuthority: null };
  }
  if (close(derived.value, expected)) return { status: "verified", problem: problemResult.problem, plan: planResult.plan, values, issues: [], numericalAuthority: { kind: "screw_gauge", sourceProblemId: problemResult.problem.id, quantityId: derived.id, symbol: derived.symbol, unit: "division", value: expected } };

  const correctedPlan = correctBoundValue(planResult.plan, derived, expected);
  const issues = [{ code: "source_value_corrected", quantityId: derived.id, message: `Corrected source-bound circular division count to ${expected}.` }];
  return { status: "verified", problem: problemResult.problem, plan: correctedPlan, values, issues, numericalAuthority: { kind: "screw_gauge", sourceProblemId: problemResult.problem.id, quantityId: derived.id, symbol: derived.symbol, unit: "division", value: expected } };
}

function sourceIdsInPlan(plan: TurnPlanV3, values: Record<MeasurementRole, MeasurementValue>): Set<string> {
  const output = new Set<string>();
  const rows = [...plan.givens, ...plan.derived];
  for (const role of ["pitch", "least_count", "true_reading", "zero_error"] as const) {
    const sourceFact = values[role];
    const factRows = rows.filter((row) => row.provenance === "given" && unitValueInMm(row.value, row.unit) !== null && close(Math.abs(unitValueInMm(row.value, row.unit)!), Math.abs(sourceFact.value)) && (row.sourceText ?? "").toLowerCase().includes(sourceFact.role === "true_reading" ? "diameter" : sourceFact.role === "zero_error" ? "zero error" : sourceFact.role === "least_count" ? "least count" : "pitch"));
    if (factRows.length === 1) output.add(factRows[0]!.id);
  }
  return output;
}
function correctBoundValue(plan: TurnPlanV3, target: TurnPlanQuantityV3, value: number): TurnPlanV3 {
  const dependent = new Set<string>([target.id]);
  let changed = true;
  while (changed) { changed = false; for (const row of plan.derived) if (!dependent.has(row.id) && row.dependsOn?.some((id) => dependent.has(id))) { dependent.add(row.id); changed = true; } }
  const derived = plan.derived.filter((row) => row.id === target.id || !dependent.has(row.id)).map((row) => row.id === target.id ? { ...row, value } : row);
  const qualitativeClaims = plan.qualitativeClaims.filter((claim) => !claim.relatedQuantityIds?.some((id) => dependent.has(id)));
  return { ...plan, derived, qualitativeClaims };
}
function withdrawUnsupported(plan: TurnPlanV3): TurnPlanV3 {
  const ids = new Set(plan.derived.filter((row) => /division|least.?count|zero.?error|screw.?gauge/i.test(`${row.symbol} ${row.sourceText ?? ""}`)).map((row) => row.id));
  let changed = true; while (changed) { changed = false; for (const row of plan.derived) if (!ids.has(row.id) && row.dependsOn?.some((id) => ids.has(id))) { ids.add(row.id); changed = true; } }
  return { ...plan, derived: plan.derived.filter((row) => !ids.has(row.id)), qualitativeClaims: plan.qualitativeClaims.filter((claim) => !claim.relatedQuantityIds?.some((id) => ids.has(id))) };
}
function sourceTextBacked(sourceText: string | undefined, problem: ProblemIR, factIds: string[]): boolean { return Boolean(sourceText && factIds.every((id) => sourceText.includes(problem.facts.find((fact) => fact.id === id)!.evidence.quote))); }
function containsNumber(quote: string, valueMm: number, _unit: string): boolean {
  const pattern = /([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|m)\b/gi; let match: RegExpExecArray | null;
  while ((match = pattern.exec(quote))) { const factor = UNITS[match[2]!.toLowerCase()]?.toMm; if (factor !== undefined && close(Math.abs(Number(match[1]) * factor), Math.abs(valueMm))) return true; }
  return false;
}
function matchesScrewGaugeFormula(expression: ProblemExpression, values: Record<MeasurementRole, MeasurementValue>): boolean {
  const root = expression.root;
  if (root.kind !== "binary" || root.operator !== "/" || root.left.kind !== "binary" || root.left.operator !== "-") return false;
  const observed = root.left.left; const main = root.left.right; const denominator = root.right;
  if (observed.kind !== "binary" || observed.operator !== "+" || main.kind !== "binary" || main.operator !== "*") return false;
  const literal = (node: ProblemExpression["root"], expected: number): boolean => node.kind === "number" && close(node.value, expected);
  const pitch = values.pitch.value; const trueSize = values.true_reading.value; const zero = values.zero_error.value;
  const mainDivisions = Math.floor((trueSize + 32 * Number.EPSILON * trueSize) / pitch);
  return literal(observed.left, trueSize) && literal(observed.right, zero) && literal(main.left, pitch) && literal(main.right, mainDivisions) && literal(denominator, values.least_count.value);
}
function sameUnit(a: string | undefined, b: string): boolean { return (a ?? "").trim().toLowerCase().replace(/s$/, "") === b.toLowerCase().replace(/s$/, ""); }
function unitValueInMm(value: number, unit: string | undefined): number | null { const descriptor = unit ? UNITS[unit.trim().toLowerCase()] : undefined; return descriptor ? value * descriptor.toMm : null; }
function decline(code: string, message: string): { issue: MeasurementAuthorityIssue } { return { issue: { code, message } }; }
function result(status: "verified" | "declined", problem: ProblemIR | null, plan: unknown, values: Partial<Record<MeasurementRole, MeasurementValue>>, code: string, message: string): MeasurementAuthorityResult { return { status, problem, plan, values, issues: [{ code, message }], numericalAuthority: null }; }
