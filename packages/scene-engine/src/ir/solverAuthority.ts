import { validateProblemIR, type ProblemIR } from "./problemIR";
import { validateSolverResult, type SolverResult, type SolverValue } from "./solver";
import { validateTurnPlanV3, type TurnPlanV3 } from "../contracts/contractsV3";

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
export function verifyTurnPlanAgainstSolver(
  problem: unknown,
  result: unknown,
  plan: unknown,
  expectedQuestion?: string,
): SolverAuthorityAudit {
  const problemValidation = validateProblemIR(problem, expectedQuestion);
  const planValidation = validateTurnPlanV3(plan, expectedQuestion);
  if (!problemValidation.problem || !planValidation.plan) {
    return {
      status: "contradiction",
      issues: [{
        code: "invalid_authority_input",
        message: [
          ...problemValidation.issues.map((issue) => `${issue.path}: ${issue.message}`),
          ...planValidation.issues.map((issue) => `${issue.path}: ${issue.message}`),
        ].join("; "),
      }],
      bindings: [],
    };
  }
  const solverValidation = validateSolverResult(result, problemValidation.problem);
  if (!solverValidation.result || solverValidation.result.status !== "solved") {
    return {
      status: "contradiction",
      issues: [{ code: "invalid_solver_result", message: "solver result is not a complete validated solution" }],
      bindings: [],
    };
  }
  const validatedProblem = problemValidation.problem;
  const validatedPlan = planValidation.plan;
  if (validatedProblem.solveRequests.length === 0) {
    return { status: "not_applicable", issues: [], bindings: [] };
  }

  const valuesByRequest = new Map(solverValidation.result.values.map((value) => [value.requestId, value]));
  const seenQuantityIds = new Set<string>();
  const bindings: SolverAuthorityBinding[] = [];
  const issues: SolverAuthorityIssue[] = [];
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
    const tolerance = Math.max(
      1e-9 * Math.max(1, Math.abs(value.approximate)),
      value.errorBound,
      derived.uncertainty ?? 0,
    );
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
    "value_type_mismatch", "solver_turnplan_contradiction", "missing_solver_value",
  ]);
  if (issues.some((issue) => contradictionCodes.has(issue.code))) {
    return { status: "contradiction", issues, bindings };
  }
  if (issues.length > 0) return { status: "incomplete", issues, bindings };
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
  const unknownsById = new Map(plan.unknowns.map((unknown) => [unknown.id, unknown]));
  let changed = false;
  const derived = plan.derived.map((quantity) => {
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
    const tolerance = Math.max(1e-9 * Math.max(1, Math.abs(value.approximate)), value.errorBound);
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

function normalizeSymbol(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\\(?:mathrm|text|operatorname)\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeUnit(value: string | undefined): string {
  return String(value ?? "1").toLowerCase().replace(/µ|μ/g, "u").replace(/\s+/g, "");
}
