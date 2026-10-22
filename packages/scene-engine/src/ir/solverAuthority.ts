import { expressionToSafeSource, validateProblemIR, type ProblemIR } from "./problemIR";
import { evaluateMathExpression } from "../math/expression";
import { validateSolverResult, type SolverResult, type SolverValue } from "./solver";
import { validateTurnPlanV3, type TurnPlanV3 } from "../contracts/contractsV3";
import { selectSourceLinearScalar, type SourceLinearScalarSelection } from "./linearScalarBinding";
import { readLinearSourceSetAliases } from "../compile/linearRegionSource";

export type SolverAuthorityStatus =
  | "verified"
  | "not_applicable"
  | "incomplete"
  | "contradiction";

export interface SolverAuthorityIssue {
  code: string;
  message: string;
  requestId?: string;
  quantityId?: string;
}

export interface SolverAuthorityBinding {
  requestId: string;
  quantityId: string;
  symbol: string;
  unit?: string;
  approximate: number | number[];
  exact?: SolverValue["exact"];
  errorBound: number;
  selection?: SourceLinearScalarSelection;
}

export interface SolverAuthorityAudit {
  status: SolverAuthorityStatus;
  issues: SolverAuthorityIssue[];
  bindings: SolverAuthorityBinding[];
}

/**
 * Cross-check model formulation against an independently evaluated result.
 * Authority is established only through explicit result bindings; request ids,
 * labels, and natural-language similarity are never used as joins.
 */
/**
 * Validator codes that mean the inputs state numbers which disagree with each
 * other, rather than merely failing to parse. These stop a lesson; everything
 * else only withdraws the second opinion.
 */
const NUMERIC_CONTRADICTION_CODES = new Set<string>([
  "source_text_value_mismatch",
  "source_text_arithmetic_conflict",
  "sign_mismatch",
  "claim_quantity_mismatch",
  "scene_quantity_mismatch",
  "scene_unit_mismatch",
]);

export function verifyTurnPlanAgainstSolver(
  problem: unknown,
  result: unknown,
  plan: unknown,
  expectedQuestion?: string,
): SolverAuthorityAudit {
  const problemValidation = validateProblemIR(problem, expectedQuestion);
  const planValidation = validateTurnPlanV3(plan, expectedQuestion);
  if (!problemValidation.problem || !planValidation.plan) {
    const inputIssues = [...problemValidation.issues, ...planValidation.issues];
    const message = inputIssues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    // Two very different failures used to share one verdict.
    //
    // A plan whose own numbers disagree — a derived value contradicting the
    // arithmetic in its own sourceText — is a real contradiction and must stop
    // the lesson; teaching a wrong scalar is the one thing this pipeline exists
    // to prevent.
    //
    // A formulation that merely failed to parse is an ABSENT second opinion,
    // not a conflicting one. Reporting that as a disagreement cost whole
    // lessons: one live turn was rejected over ten `ungrounded_fact` issues
    // whose quotes all appeared in the question verbatim, at sloppy offsets.
    const contradicted = inputIssues.some((issue) =>
      NUMERIC_CONTRADICTION_CODES.has(issue.code),
    );
    return {
      status: contradicted ? "contradiction" : "incomplete",
      issues: [{
        code: contradicted ? "authority_input_contradiction" : "invalid_authority_input",
        message,
      }],
      bindings: [],
    };
  }
  const solverValidation = validateSolverResult(result, problemValidation.problem);
  if (!solverValidation.result || solverValidation.result.status !== "solved") {
    // A missing or partial solver result is an absent second opinion, not a
    // conflicting one. Nothing has been contradicted.
    return {
      status: "incomplete",
      issues: [{ code: "invalid_solver_result", message: "solver result is not a complete validated solution" }],
      bindings: [],
    };
  }
  const validatedProblem = problemValidation.problem;
  const validatedPlan = planValidation.plan;
  const valuesByRequest = new Map(solverValidation.result.values.map((value) => [value.requestId, value]));
  const selectionsByRequest = new Map<string, SourceLinearScalarSelection>();
  for (const request of validatedProblem.solveRequests) {
    const value = valuesByRequest.get(request.id);
    if (!value) continue;
    const selected = selectSourceLinearScalar(validatedProblem, request, value, expectedQuestion);
    if (selected) {
      valuesByRequest.set(request.id, selected.value);
      selectionsByRequest.set(request.id, selected.selection);
    }
  }
  const boundaryProjectionIssues = retainCompleteBoundaryProjections(validatedProblem, validatedPlan, solverValidation.result, valuesByRequest, selectionsByRequest);
  const seenQuantityIds = new Set<string>();
  const bindings: SolverAuthorityBinding[] = [];
  const issues: SolverAuthorityIssue[] = [...boundaryProjectionIssues];
  const givenFactIds = new Set(validatedProblem.facts.filter((fact) => fact.kind === "given").map((fact) => fact.id));
  const expressionsById = new Map(validatedProblem.expressions.map((expression) => [expression.id, expression]));
  for (const constraint of validatedProblem.constraints) {
    if (constraint.kind !== "equation" || !constraint.evidenceFactIds.some((id) => givenFactIds.has(id))) continue;
    const left = expressionsById.get(constraint.leftExpressionId)!;
    const right = expressionsById.get(constraint.rightExpressionId)!;
    if (left.valueType !== "scalar" || right.valueType !== "scalar") continue;
    // A source relation with free variables (a line, circle or locus equation)
    // is not a closed scalar claim. It keeps base behaviour unless one of its
    // sides is itself a result-bound expression the plan reports a value for.
    const resultBound = [left, right].some((expression) => validatedProblem.solveRequests.some((request) =>
      request.kind === "evaluate" && request.expressionId === expression.id && request.resultBinding));
    if (!resultBound && [left.root, right.root].some(hasFreeVariable)) continue;
    try {
      const pending = [left.root, right.root];
      while (pending.length > 0) {
        const node = pending.pop()!;
        if (node.kind === "variable") throw new Error(`unsupported free variable ${node.name}`);
        if (node.kind === "binary") pending.push(node.left, node.right);
        else if (node.kind === "unary") pending.push(node.operand);
        else if (node.kind === "call") pending.push(node.argument);
      }
      const units = [left, right].map((expression) => {
        const requests = validatedProblem.solveRequests.filter((request) => request.kind === "evaluate" && request.expressionId === expression.id && request.resultBinding);
        if (requests.length !== 1) throw new Error(`Expression ${expression.id} requires one explicit output-unit binding`);
        const binding = requests[0]!.resultBinding!;
        const unknown = validatedPlan.unknowns.find((quantity) => quantity.id === binding.turnPlanQuantityId);
        const derived = validatedPlan.derived.find((quantity) => quantity.id === binding.turnPlanQuantityId);
        if (!binding.unit?.trim() || !unknown || !derived || normalizeSymbol(binding.symbol) !== normalizeSymbol(unknown.symbol) || normalizeSymbol(binding.symbol) !== normalizeSymbol(derived.symbol) || normalizeUnit(binding.unit) !== normalizeUnit(unknown.unit) || normalizeUnit(binding.unit) !== normalizeUnit(derived.unit)) {
          throw new Error(`Expression ${expression.id} has no verified declared output unit`);
        }
        return binding.unit.trim();
      });
      if (units[0] !== units[1]) throw new Error(`Given equation output units are not identical: ${units[0]}, ${units[1]}`);
      const leftValue = evaluateMathExpression(expressionToSafeSource(left.root), 0);
      const rightValue = evaluateMathExpression(expressionToSafeSource(right.root), 0);
      if ((leftValue === 0 || rightValue === 0) && (left.root.kind !== "number" || right.root.kind !== "number")) throw new Error("Zero comparison requires exactly represented scalar sides");
      const tolerance = 64 * Number.EPSILON * Math.max(Math.abs(leftValue), Math.abs(rightValue));
      if (leftValue !== rightValue && (leftValue === 0 || rightValue === 0 || Math.abs(leftValue - rightValue) > tolerance)) {
        issues.push({
          code: "given_equation_contradiction",
          message: `Given scalar equation ${constraint.id} disagrees: ${left.id}=${leftValue}, ${right.id}=${rightValue}`,
        });
      }
    } catch (error) {
      issues.push({
        code: "incomplete_given_equation",
        message: `Given scalar equation ${constraint.id} cannot be independently evaluated: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  // A symbolic formulation with no numeric requests has no numeric second
  // opinion. Still run the stated-equation checks above before preserving
  // this status; symbolic planner unknowns are not missing scalar answers.
  if (validatedProblem.solveRequests.length === 0 && issues.length === 0) {
    return { status: "not_applicable", issues: [], bindings: [] };
  }
  for (const request of validatedProblem.solveRequests) {
    const binding = request.resultBinding;
    if (!binding) continue;
    if (seenQuantityIds.has(binding.turnPlanQuantityId)) {
      issues.push({
        code: "duplicate_result_binding",
        message: `multiple solve requests bind ${binding.turnPlanQuantityId}`,
        requestId: request.id,
        quantityId: binding.turnPlanQuantityId,
      });
      continue;
    }
    seenQuantityIds.add(binding.turnPlanQuantityId);
    const value = valuesByRequest.get(request.id);
    if (!value) {
      issues.push({ code: "missing_solver_value", message: `missing result for ${request.id}`, requestId: request.id });
      continue;
    }
    bindings.push({
      requestId: request.id,
      quantityId: binding.turnPlanQuantityId,
      symbol: binding.symbol,
      ...(binding.unit ? { unit: binding.unit } : {}),
      approximate: value.approximate,
      ...(value.exact !== undefined ? { exact: value.exact } : {}),
      errorBound: value.errorBound,
      ...(selectionsByRequest.has(request.id) ? { selection: selectionsByRequest.get(request.id)! } : {}),
    });
  }

  for (const unknown of validatedPlan.unknowns) {
    const request = validatedProblem.solveRequests.find(
      (candidate) => candidate.resultBinding?.turnPlanQuantityId === unknown.id,
    );
    if (!request?.resultBinding) {
      issues.push({
        code: "unbound_unknown",
        message: `numeric unknown ${unknown.id} has no explicit solver binding`,
        quantityId: unknown.id,
      });
      continue;
    }
    const derived = validatedPlan.derived.find((quantity) => quantity.id === unknown.id);
    const value = valuesByRequest.get(request.id);
    if (!derived || !value) {
      issues.push({
        code: "incomplete_unknown",
        message: `numeric unknown ${unknown.id} has no derived plan value or solver value`,
        requestId: request.id,
        quantityId: unknown.id,
      });
      continue;
    }
    if (
      normalizeSymbol(request.resultBinding.symbol) !== normalizeSymbol(unknown.symbol) ||
      normalizeSymbol(derived.symbol) !== normalizeSymbol(unknown.symbol)
    ) {
      issues.push({
        code: "symbol_mismatch",
        message: `binding symbol disagrees for ${unknown.id}`,
        requestId: request.id,
        quantityId: unknown.id,
      });
      continue;
    }
    if (
      normalizeUnit(request.resultBinding.unit) !== normalizeUnit(unknown.unit) ||
      normalizeUnit(derived.unit) !== normalizeUnit(unknown.unit)
    ) {
      issues.push({
        code: "unit_mismatch",
        message: `binding unit disagrees for ${unknown.id}`,
        requestId: request.id,
        quantityId: unknown.id,
      });
      continue;
    }
    if (value.valueType !== "scalar" || typeof value.approximate !== "number") {
      issues.push({
        code: "value_type_mismatch",
        message: `bound TurnPlan quantity ${unknown.id} requires a scalar solver value`,
        requestId: request.id,
        quantityId: unknown.id,
      });
      continue;
    }
    const tolerance = selectionsByRequest.get(request.id)?.kind === "unique_source_linear_boundary"
      // Exact source boundaries allow machine rounding only, including at zero.
      ? 64 * Number.EPSILON * Math.max(Math.abs(value.approximate), Math.abs(derived.value))
      : Math.max(1e-9 * Math.max(1, Math.abs(value.approximate)), value.errorBound, derived.uncertainty ?? 0);
    if (Math.abs(derived.value - value.approximate) > tolerance) {
      issues.push({
        code: "solver_turnplan_contradiction",
        message: `TurnPlan value ${derived.value} disagrees with solver value ${value.approximate} for ${unknown.id}`,
        requestId: request.id,
        quantityId: unknown.id,
      });
    }
  }

  const contradictionCodes = new Set([
    "duplicate_result_binding", "symbol_mismatch", "unit_mismatch",
    "value_type_mismatch", "solver_turnplan_contradiction", "missing_solver_value", "given_equation_contradiction",
    "unproved_source_boundary_scalar",
  ]);
  if (issues.some((issue) => contradictionCodes.has(issue.code))) {
    return { status: "contradiction", issues, bindings };
  }
  if (issues.length > 0) return { status: "incomplete", issues, bindings };
  if (validatedProblem.solveRequests.length === 0) return { status: "not_applicable", issues: [], bindings };
  return { status: "verified", issues: [], bindings };
}

export function buildSolverAuthorityProjection(
  problem: ProblemIR,
  result: SolverResult,
  audit: SolverAuthorityAudit,
): Record<string, unknown> {
  return {
    schemaVersion: "solver-authority/v1",
    problemId: problem.id,
    status: audit.status,
    expressions: problem.expressions,
    constraints: problem.constraints,
    representationIntents: problem.representationIntents,
    bindings: audit.bindings,
    solverProviderId: result.providerId,
  };
}

/**
 * Correct only scalar arithmetic values whose explicit binding, symbol, and
 * unit already agree. Structural, formulation, symbol, and unit conflicts are
 * never repaired here.
 */
export function reconcileTurnPlanWithSolver(
  plan: TurnPlanV3,
  problem: ProblemIR,
  result: SolverResult,
): TurnPlanV3 {
  const valuesByRequest = new Map(result.values.map((value) => [value.requestId, value]));
  // Reconciliation consumes the same independently source-certified scalar
  // selection as the audit. A forged/partial provider result is not a scalar
  // correction source merely because its array happens to have one element.
  const validatedProblem = validateProblemIR(problem, plan.question).problem;
  const validatedResult = validatedProblem ? validateSolverResult(result, validatedProblem).result : null;
  const selections = new Map<string, SourceLinearScalarSelection>();
  const unsupportedSourceQuantities = new Set<string>();
  if (validatedProblem && validatedResult?.status === "solved") for (const request of validatedProblem.solveRequests) {
    const value = valuesByRequest.get(request.id);
    if (!value) continue;
    const selected = selectSourceLinearScalar(validatedProblem, request, value, plan.question);
    if (selected) {
      valuesByRequest.set(request.id, selected.value);
      selections.set(request.id, selected.selection);
    }
  }
  if (validatedProblem && validatedResult?.status === "solved") {
    for (const issue of retainCompleteBoundaryProjections(validatedProblem, plan, validatedResult, valuesByRequest, selections)) {
      if (issue.quantityId) unsupportedSourceQuantities.add(issue.quantityId);
    }
  }
  const unknownsById = new Map(plan.unknowns.map((unknown) => [unknown.id, unknown]));
  let changed = false;
  const derived = plan.derived.map((quantity) => {
    if (unsupportedSourceQuantities.has(quantity.id)) return quantity;
    const request = problem.solveRequests.find(
      (candidate) => candidate.resultBinding?.turnPlanQuantityId === quantity.id,
    );
    const binding = request?.resultBinding;
    const unknown = unknownsById.get(quantity.id);
    const value = request ? valuesByRequest.get(request.id) : undefined;
    if (
      !request || !binding || !unknown || !value ||
      value.valueType !== "scalar" || typeof value.approximate !== "number" ||
      normalizeSymbol(binding.symbol) !== normalizeSymbol(unknown.symbol) ||
      normalizeSymbol(quantity.symbol) !== normalizeSymbol(unknown.symbol) ||
      normalizeUnit(binding.unit) !== normalizeUnit(unknown.unit) ||
      normalizeUnit(quantity.unit) !== normalizeUnit(unknown.unit)
    ) return quantity;
    const tolerance = selections.get(request.id)?.kind === "unique_source_linear_boundary"
      ? 64 * Number.EPSILON * Math.max(Math.abs(value.approximate), Math.abs(quantity.value))
      : Math.max(1e-9 * Math.max(1, Math.abs(value.approximate)), value.errorBound);
    if (Math.abs(quantity.value - value.approximate) <= tolerance) return quantity;
    changed = true;
    return {
      ...quantity,
      value: value.approximate,
      uncertainty: Math.max(quantity.uncertainty ?? 0, value.errorBound),
      sourceText: `Solver-verified ${quantity.symbol} = ${value.approximate}${quantity.unit ? ` ${quantity.unit}` : ""}`,
    };
  });
  return changed ? { ...plan, derived } : plan;
}

/**
 * Existing auditor spelling compatibility only, not permission to bind a value.
 * Callers must independently enforce semantic identity, source, unit and value
 * authority. Keep this projection tied to the unchanged auditor comparison.
 */
export function solverAuthoritySymbolsAgree(first: string, second: string): boolean {
  return normalizeSymbol(first) === normalizeSymbol(second);
}

function normalizeSymbol(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\\(?:mathrm|text|operatorname)\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * A boundary certificate proves that boundary only. It cannot certify a
 * finite scalar attached to the whole solution set, even when an unrelated
 * evaluate request shares its id. Independent native scalar answers retain
 * their ordinary solver authority and do not need a boundary selection.
 * Symbolic set unknowns have no derived finite value and need no scalar proof.
 * Coordinate projections retain their existing independent native guard.
 */
function retainCompleteBoundaryProjections(
  problem: ProblemIR,
  plan: TurnPlanV3,
  result: SolverResult,
  values: Map<string, SolverValue>,
  selections: Map<string, SourceLinearScalarSelection>,
): SolverAuthorityIssue[] {
  const boundaryRequests = [...selections].filter(([, selection]) => selection.kind === "unique_source_linear_boundary");
  if (!boundaryRequests.length) return [];
  const sourceSetSymbols = new Set([...readLinearSourceSetAliases(problem.question)].map(normalizeSymbol));
  const wholeSetSymbol = (symbol: string): boolean => sourceSetSymbols.has(normalizeSymbol(symbol))
    || /^(?:solutionset|solutioninterval|set|interval)$/.test(normalizeSymbol(symbol));
  const unsupported = plan.unknowns.filter(unknown => {
    const derived = plan.derived.find(quantity => quantity.id === unknown.id);
    if (!derived) return false;
    const requests = problem.solveRequests.filter(request => request.resultBinding?.turnPlanQuantityId === unknown.id);
    if (requests.length !== 1) return true;
    const request = requests[0]!, binding = request.resultBinding!, value = values.get(request.id);
    const ownedScalar = normalizeSymbol(binding.symbol) === normalizeSymbol(unknown.symbol)
      && normalizeSymbol(derived.symbol) === normalizeSymbol(unknown.symbol)
      && normalizeUnit(binding.unit) === normalizeUnit(unknown.unit)
      && normalizeUnit(derived.unit) === normalizeUnit(unknown.unit)
      && value?.valueType === "scalar" && typeof value.approximate === "number";
    const wholeSetEvidence = binding.evidenceFactIds.some(id => {
      const fact = problem.facts.find(candidate => candidate.id === id);
      return fact?.kind === "requested"
        && /\b(?:solution\s+(?:set|interval)|(?:whole|complete)\s+(?:set|interval))\b/i.test(fact.evidence.quote)
        && !/\b(?:length|cardinality|number|count|membership|whether)\b/i.test(fact.evidence.quote);
    });
    const nativeScalar = request.kind !== "roots" && request.kind !== "intersections"
      && result.values.find(candidate => candidate.requestId === request.id)?.valueType === "scalar"
      && binding.evidenceFactIds.some(id => problem.facts.some(fact => fact.id === id && fact.kind === "requested"))
      && ![unknown.symbol, derived.symbol, binding.symbol].some(wholeSetSymbol) && !wholeSetEvidence;
    return !(ownedScalar && (selections.get(request.id)?.kind === "unique_source_linear_boundary" || nativeScalar));
  });
  if (!unsupported.length) return [];
  for (const [requestId] of boundaryRequests) {
    values.set(requestId, result.values.find(value => value.requestId === requestId)!);
    selections.delete(requestId);
  }
  // Boundaries can be intermediate derived quantities, so restoring their
  // set values alone does not guarantee that the unknown loop will reject.
  // Refuse the unsupported finite source role explicitly at this seam.
  return unsupported.map(unknown => ({
    code: "unproved_source_boundary_scalar",
    message: `Finite requested '${unknown.symbol}' has no independent scalar authority preserving its original-source role`,
    quantityId: unknown.id,
  }));
}

function normalizeUnit(value: string | undefined): string {
  // A blank unit and a missing unit both mean a dimensionless value.
  const unit = value?.trim() ? value : "1";
  return unit.toLowerCase().replace(/µ|μ/g, "u").replace(/\s+/g, "");
}

function hasFreeVariable(root: ProblemIR["expressions"][number]["root"]): boolean {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node.kind === "variable") return true;
    if (node.kind === "binary") pending.push(node.left, node.right);
    else if (node.kind === "unary") pending.push(node.operand);
    else if (node.kind === "call") pending.push(node.argument);
  }
  return false;
}
