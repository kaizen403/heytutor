import { parseMathExpression } from "./expression";
import {
  expressionToSafeSource,
  validateProblemIR,
  type ExpressionNodeIR,
  type ProblemExpression,
  type ProblemIR,
  type ProblemIRIssue,
  type SolveRequest,
} from "./problemIR";

export const SOLVER_RESULT_VERSION = "solver-result/v1" as const;
export const LOCAL_SOLVER_PROVIDER_ID = "local-deterministic/v1" as const;

const ROOT_TOLERANCE = 1e-9;
const MAX_POLYNOMIAL_DEGREE = 8;
const MAX_INTEGER_BITS = 256;

export interface ExactSolverValue {
  kind: "integer" | "rational" | "radical" | "symbolic";
  value: string;
}

export interface SolverValue {
  id: string;
  requestId: string;
  valueType: "scalar" | "set";
  exact?: ExactSolverValue | ExactSolverValue[];
  approximate: number | number[];
  errorBound: number;
}

export interface SolverProofEvidence {
  id: string;
  requestId: string;
  method: "exact_arithmetic" | "polynomial_roots" | "numeric_bracketing" | "exact_polynomial_integral" | "numeric_quadrature";
  expressionIds: string[];
  verified: boolean;
  residual: number;
  tolerance: number;
  detail: string;
}

export interface SolverResult {
  schemaVersion: typeof SOLVER_RESULT_VERSION;
  problemId: string;
  providerId: string;
  status: "solved" | "partial" | "failed";
  values: SolverValue[];
  proofs: SolverProofEvidence[];
  issues: SolverIssue[];
}

export interface SolverIssue {
  code: string;
  path: string;
  message: string;
  requestId?: string;
}

export interface SolverResultValidation {
  valid: boolean;
  result: SolverResult | null;
  issues: SolverIssue[];
}

export interface SolverProvider {
  readonly id: string;
  solve(problem: unknown, context?: SolverExecutionContext): Promise<SolverResult>;
}

export interface SolverExecutionContext {
  /** Remote implementations must stop network and compute work when aborted. */
  signal: AbortSignal;
  /** Absolute Unix timestamp after which work is no longer authoritative. */
  deadlineMs: number;
}

export class LocalDeterministicSolverProvider implements SolverProvider {
  readonly id = LOCAL_SOLVER_PROVIDER_ID;

  async solve(raw: unknown, context?: SolverExecutionContext): Promise<SolverResult> {
    if (context?.signal.aborted || (context && Date.now() >= context.deadlineMs)) {
      return failedExecution(raw, this.id, "deadline_exceeded", "solver request was cancelled before execution");
    }
    const validation = validateProblemIR(raw);
    if (!validation.problem) return failedProblem(validation.issues, raw, this.id);
    const problem = validation.problem;
    const expressions = new Map(problem.expressions.map((expression) => [expression.id, expression]));
    const values: SolverValue[] = [];
    const proofs: SolverProofEvidence[] = [];
    const issues: SolverIssue[] = [];

    for (const request of problem.solveRequests) {
      if (context?.signal.aborted || (context && Date.now() >= context.deadlineMs)) {
        issues.push({ code: "deadline_exceeded", path: "solveRequests", message: "solver deadline exceeded", requestId: request.id });
        break;
      }
      try {
        const solved = solveRequest(request, expressions);
        values.push(solved.value);
        proofs.push(solved.proof);
      } catch (error) {
        issues.push({
          code: "unsupported_or_invalid_request",
          path: `solveRequests.${request.id}`,
          message: error instanceof Error ? error.message : String(error),
          requestId: request.id,
        });
      }
    }

    return {
      schemaVersion: SOLVER_RESULT_VERSION,
      problemId: problem.id,
      providerId: this.id,
      status: issues.length === 0 ? "solved" : values.length > 0 ? "partial" : "failed",
      values,
      proofs,
      issues,
    };
  }
}

/**
 * Execute any local or remote provider behind a hard client deadline. Remote
 * providers receive an AbortSignal and cannot hold up the teaching turn even
 * when their transport ignores its own timeout configuration.
 */
export async function solveWithDeadline(
  provider: SolverProvider,
  problem: unknown,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<SolverResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("solver timeout must be between 1 and 60000 milliseconds");
  }
  const controller = new AbortController();
  const deadlineMs = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onExternalAbort: (() => void) | undefined;
  const timeoutResult = new Promise<SolverResult>((resolve) => {
    const abort = (message: string) => {
      controller.abort();
      resolve(failedExecution(problem, provider.id, "deadline_exceeded", message));
    };
    timer = setTimeout(() => abort("solver provider exceeded its hard deadline"), timeoutMs);
    if (externalSignal) {
      onExternalAbort = () => abort("solver provider was cancelled");
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  });
  try {
    return await Promise.race([
      provider.solve(problem, { signal: controller.signal, deadlineMs }),
      timeoutResult,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (externalSignal && onExternalAbort) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

export function validateSolverResult(raw: unknown, problem?: ProblemIR): SolverResultValidation {
  const issues: SolverIssue[] = [];
  if (!isRecord(raw)) return { valid: false, result: null, issues: [{ code: "invalid_result", path: "$", message: "SolverResult must be an object" }] };
  if (raw.schemaVersion !== SOLVER_RESULT_VERSION) add(issues, "schema_version", "schemaVersion", `Expected ${SOLVER_RESULT_VERSION}`);
  if (typeof raw.problemId !== "string" || raw.problemId === "") add(issues, "invalid_problem_id", "problemId", "problemId must be non-empty");
  else if (problem && raw.problemId !== problem.id) add(issues, "problem_mismatch", "problemId", "result does not belong to this problem");
  if (typeof raw.providerId !== "string" || raw.providerId === "") add(issues, "invalid_provider", "providerId", "providerId must be non-empty");
  if (!["solved", "partial", "failed"].includes(String(raw.status))) add(issues, "invalid_status", "status", "invalid solver status");
  if (!Array.isArray(raw.values) || !Array.isArray(raw.proofs) || !Array.isArray(raw.issues)) {
    add(issues, "missing_array", "$", "values, proofs, and issues must be arrays");
    return { valid: false, result: null, issues };
  }

  const requestIds = new Set(problem?.solveRequests.map((request) => request.id) ?? []);
  const expressionIds = new Set(problem?.expressions.map((expression) => expression.id) ?? []);
  const valueRequestIds = new Set<string>();
  for (const [index, value] of raw.values.entries()) {
    const path = `values[${index}]`;
    if (!isRecord(value)) {
      add(issues, "invalid_value", path, "value must be an object");
      continue;
    }
    validateResultId(value.id, `${path}.id`, issues);
    validateRequestId(value.requestId, requestIds, `${path}.requestId`, issues, problem !== undefined);
    if (typeof value.requestId === "string") {
      if (valueRequestIds.has(value.requestId)) add(issues, "duplicate_value", `${path}.requestId`, `duplicate value for ${value.requestId}`);
      valueRequestIds.add(value.requestId);
    }
    if (value.valueType !== "scalar" && value.valueType !== "set") add(issues, "invalid_value_type", `${path}.valueType`, "valueType must be scalar or set");
    if (!validApproximate(value.approximate, value.valueType === "set")) add(issues, "invalid_approximate", `${path}.approximate`, "approximate value must be finite and match valueType");
    if (typeof value.errorBound !== "number" || !Number.isFinite(value.errorBound) || value.errorBound < 0) add(issues, "invalid_error_bound", `${path}.errorBound`, "errorBound must be finite and non-negative");
    if (value.exact !== undefined) {
      validateExact(value.exact, value.valueType === "set", `${path}.exact`, issues);
      validateExactAgreement(value.exact, value.approximate, value.valueType === "set", typeof value.errorBound === "number" ? value.errorBound : 0, path, issues);
    }
  }

  const proofRequestIds = new Set<string>();
  for (const [index, proof] of raw.proofs.entries()) {
    const path = `proofs[${index}]`;
    if (!isRecord(proof)) {
      add(issues, "invalid_proof", path, "proof must be an object");
      continue;
    }
    validateResultId(proof.id, `${path}.id`, issues);
    validateRequestId(proof.requestId, requestIds, `${path}.requestId`, issues, problem !== undefined);
    if (typeof proof.requestId === "string") {
      if (proofRequestIds.has(proof.requestId)) add(issues, "duplicate_proof", `${path}.requestId`, `duplicate proof for ${proof.requestId}`);
      proofRequestIds.add(proof.requestId);
    }
    if (!["exact_arithmetic", "polynomial_roots", "numeric_bracketing", "exact_polynomial_integral", "numeric_quadrature"].includes(String(proof.method))) add(issues, "invalid_proof_method", `${path}.method`, "invalid proof method");
    if (!Array.isArray(proof.expressionIds) || proof.expressionIds.length === 0 || proof.expressionIds.some((id) => typeof id !== "string" || (problem !== undefined && !expressionIds.has(id)))) {
      add(issues, "invalid_proof_inputs", `${path}.expressionIds`, "expressionIds must reference known expressions");
    } else if (problem && typeof proof.requestId === "string") {
      const request = problem.solveRequests.find((candidate) => candidate.id === proof.requestId);
      const requiredIds = requestExpressionIds(request);
      if (requiredIds.some((id) => !(proof.expressionIds as unknown[]).includes(id))) add(issues, "ungrounded_proof", `${path}.expressionIds`, "proof does not cite every expression used by its request");
    }
    if (proof.verified !== true) add(issues, "unverified_proof", `${path}.verified`, "authoritative proof must be verified");
    if (typeof proof.residual !== "number" || !Number.isFinite(proof.residual) || proof.residual < 0 || typeof proof.tolerance !== "number" || !Number.isFinite(proof.tolerance) || proof.tolerance < 0 || proof.residual > proof.tolerance) add(issues, "invalid_residual", path, "proof residual must be finite and within tolerance");
    if (typeof proof.detail !== "string" || proof.detail === "") add(issues, "invalid_proof_detail", `${path}.detail`, "proof detail must be non-empty");
  }

  for (const requestId of valueRequestIds) {
    if (!proofRequestIds.has(requestId)) add(issues, "missing_proof", "proofs", `value for ${requestId} has no proof evidence`);
  }
  if (raw.status === "solved" && problem && problem.solveRequests.some((request) => !valueRequestIds.has(request.id))) {
    add(issues, "incomplete_solved_result", "status", "solved result must contain every requested value");
  }
  if (raw.status === "solved" && raw.issues.length > 0) add(issues, "solved_with_issues", "status", "solved result cannot contain issues");
  raw.issues.forEach((issue, index) => {
    if (!isRecord(issue) || typeof issue.code !== "string" || issue.code === "" || typeof issue.path !== "string" || typeof issue.message !== "string" || issue.message === "") {
      add(issues, "invalid_solver_issue", `issues[${index}]`, "solver issue must contain code, path, and message");
    }
  });

  return issues.length === 0
    ? { valid: true, result: raw as unknown as SolverResult, issues: [] }
    : { valid: false, result: null, issues };
}

function solveRequest(request: SolveRequest, expressions: Map<string, ProblemExpression>): { value: SolverValue; proof: SolverProofEvidence } {
  if (request.kind === "evaluate") {
    const expression = requiredExpression(expressions, request.expressionId);
    const source = expressionToSafeSource(expression.root);
    const approximate = parseMathExpression(source).evaluate(0);
    const exactFraction = fractionExpression(expression.root);
    return solvedScalar(request.id, approximate, exactFraction ? exactValue(exactFraction) : undefined, "exact_arithmetic", [expression.id], 0, "Evaluated the typed, variable-free expression with the audited local evaluator.");
  }
  if (request.kind === "roots") {
    const expression = requiredExpression(expressions, request.expressionId);
    return solveRoots(request, expression, undefined);
  }
  if (request.kind === "intersections") {
    const left = requiredExpression(expressions, request.leftExpressionId);
    const right = requiredExpression(expressions, request.rightExpressionId);
    return solveRoots(request, left, right);
  }
  const expression = requiredExpression(expressions, request.expressionId);
  const polynomial = polynomialExpression(expression.root, request.variable);
  if (polynomial) {
    const exact = integratePolynomial(polynomial, fractionFromNumber(request.lower), fractionFromNumber(request.upper));
    const approximate = fractionNumber(exact);
    return solvedScalar(request.id, approximate, exactValue(exact), "exact_polynomial_integral", [expression.id], 0, "Integrated exact rational polynomial coefficients over exact rational bounds.");
  }
  const parsed = parseMathExpression(expressionToSafeSource(expression.root, request.variable));
  const min = Math.min(request.lower, request.upper);
  const max = Math.max(request.lower, request.upper);
  parsed.assertContinuousOn(min, max);
  const coarse = compositeSimpson(parsed.evaluate, request.lower, request.upper, 1024);
  const fine = compositeSimpson(parsed.evaluate, request.lower, request.upper, 2048);
  const error = Math.max(Math.abs(fine - coarse) / 15, Number.EPSILON * Math.max(1, Math.abs(fine)) * 32);
  return solvedScalar(request.id, fine, undefined, "numeric_quadrature", [expression.id], error, "Composite Simpson quadrature converged at two deterministic resolutions.", error);
}

function solveRoots(request: Extract<SolveRequest, { kind: "roots" | "intersections" }>, left: ProblemExpression, right?: ProblemExpression): { value: SolverValue; proof: SolverProofEvidence } {
  const leftPolynomial = polynomialExpression(left.root, request.variable);
  const rightPolynomial = right ? polynomialExpression(right.root, request.variable) : [fraction(0n)] as Fraction[];
  const expressionIds = right ? [left.id, right.id] : [left.id];
  if (leftPolynomial && rightPolynomial) {
    const coefficients = polynomialSubtract(leftPolynomial, rightPolynomial);
    let approximate = realPolynomialRoots(coefficients.map(fractionNumber), request.domain.min, request.domain.max);
    const exact = exactPolynomialRoots(coefficients, approximate)?.filter((value) => {
      const numeric = exactNumber(value);
      return numeric === null || (
        numeric >= request.domain.min - ROOT_TOLERANCE &&
        numeric <= request.domain.max + ROOT_TOLERANCE
      );
    });
    const exactApproximations = exact?.map(exactNumber);
    if (exactApproximations?.length === approximate.length && exactApproximations.every((value) => value !== null)) {
      approximate = (exactApproximations as number[]).filter((value) => value >= request.domain.min && value <= request.domain.max);
    }
    const residual = maximumResidual(approximate, (x) => evaluatePolynomial(coefficients.map(fractionNumber), x));
    return solvedSet(request.id, approximate, exact, "polynomial_roots", expressionIds, residual, Math.max(ROOT_TOLERANCE, residual), "Isolated all real polynomial roots between derivative critical points and verified residuals.");
  }
  const leftParsed = parseMathExpression(expressionToSafeSource(left.root, request.variable));
  const rightParsed = right ? parseMathExpression(expressionToSafeSource(right.root, request.variable)) : null;
  leftParsed.assertContinuousOn(request.domain.min, request.domain.max);
  rightParsed?.assertContinuousOn(request.domain.min, request.domain.max);
  const difference = (x: number) => leftParsed.evaluate(x) - (rightParsed?.evaluate(x) ?? 0);
  const approximate = bracketedRoots(difference, request.domain.min, request.domain.max);
  const residual = maximumResidual(approximate, difference);
  return solvedSet(request.id, approximate, undefined, "numeric_bracketing", expressionIds, residual, Math.max(ROOT_TOLERANCE, residual), "Detected sign-changing roots on a deterministic bounded grid; tangential non-polynomial roots are outside this provider's completeness guarantee.");
}

function solvedScalar(requestId: string, approximate: number, exact: ExactSolverValue | undefined, method: SolverProofEvidence["method"], expressionIds: string[], residual: number, detail: string, errorBound = 0): { value: SolverValue; proof: SolverProofEvidence } {
  return {
    value: { id: `value_${requestId}`, requestId, valueType: "scalar", ...(exact ? { exact } : {}), approximate, errorBound },
    proof: proof(requestId, method, expressionIds, residual, Math.max(errorBound, ROOT_TOLERANCE), detail),
  };
}

function solvedSet(requestId: string, approximate: number[], exact: ExactSolverValue[] | undefined, method: SolverProofEvidence["method"], expressionIds: string[], residual: number, tolerance: number, detail: string): { value: SolverValue; proof: SolverProofEvidence } {
  return {
    value: { id: `value_${requestId}`, requestId, valueType: "set", ...(exact ? { exact } : {}), approximate, errorBound: tolerance },
    proof: proof(requestId, method, expressionIds, residual, tolerance, detail),
  };
}

function proof(requestId: string, method: SolverProofEvidence["method"], expressionIds: string[], residual: number, tolerance: number, detail: string): SolverProofEvidence {
  return { id: `proof_${requestId}`, requestId, method, expressionIds, verified: true, residual, tolerance, detail };
}

type Fraction = { numerator: bigint; denominator: bigint };

function fraction(numerator: bigint, denominator = 1n): Fraction {
  if (denominator === 0n) throw new Error("division by zero");
  if (denominator < 0n) return fraction(-numerator, -denominator);
  const divisor = gcd(abs(numerator), denominator);
  const value = { numerator: numerator / divisor, denominator: denominator / divisor };
  if (bitLength(value.numerator) > MAX_INTEGER_BITS || bitLength(value.denominator) > MAX_INTEGER_BITS) throw new Error("exact arithmetic exceeded size limits");
  return value;
}

function fractionFromNumber(value: number): Fraction {
  if (!Number.isFinite(value)) throw new Error("non-finite exact value");
  const source = String(value).toLowerCase();
  const [mantissa, exponentSource] = source.split("e");
  const exponent = Number(exponentSource ?? 0);
  const [whole, decimal = ""] = mantissa!.split(".");
  const digits = BigInt(`${whole}${decimal}`);
  const scale = decimal.length - exponent;
  return scale >= 0 ? fraction(digits, 10n ** BigInt(scale)) : fraction(digits * 10n ** BigInt(-scale));
}

function fractionExpression(node: ExpressionNodeIR): Fraction | null {
  switch (node.kind) {
    case "number": return fractionFromNumber(node.value);
    case "constant":
    case "variable": return null;
    case "call": return null;
    case "unary": {
      const value = fractionExpression(node.operand);
      return value && node.operator === "-" ? fraction(-value.numerator, value.denominator) : value;
    }
    case "binary": {
      const left = fractionExpression(node.left);
      const right = fractionExpression(node.right);
      if (!left || !right) return null;
      if (node.operator === "+") return addFraction(left, right);
      if (node.operator === "-") return subtractFraction(left, right);
      if (node.operator === "*") return multiplyFraction(left, right);
      if (node.operator === "/") return divideFraction(left, right);
      if (right.denominator !== 1n || right.numerator < 0n || right.numerator > 32n) return null;
      return powerFraction(left, Number(right.numerator));
    }
  }
}

function polynomialExpression(node: ExpressionNodeIR, variable: string): Fraction[] | null {
  switch (node.kind) {
    case "number": return [fractionFromNumber(node.value)];
    case "constant": return null;
    case "variable": return node.name === variable ? [fraction(0n), fraction(1n)] : null;
    case "call": return null;
    case "unary": {
      const value = polynomialExpression(node.operand, variable);
      return value && node.operator === "-" ? value.map((coefficient) => fraction(-coefficient.numerator, coefficient.denominator)) : value;
    }
    case "binary": {
      const left = polynomialExpression(node.left, variable);
      if (!left) return null;
      if (node.operator === "^") {
        const exponent = fractionExpression(node.right);
        if (!exponent || exponent.denominator !== 1n || exponent.numerator < 0n || exponent.numerator > BigInt(MAX_POLYNOMIAL_DEGREE)) return null;
        return polynomialPower(left, Number(exponent.numerator));
      }
      const right = polynomialExpression(node.right, variable);
      if (!right) return null;
      if (node.operator === "+") return polynomialAdd(left, right);
      if (node.operator === "-") return polynomialSubtract(left, right);
      if (node.operator === "*") return polynomialMultiply(left, right);
      if (node.operator === "/" && right.length === 1) return left.map((coefficient) => divideFraction(coefficient, right[0]!));
      return null;
    }
  }
}

function polynomialAdd(left: Fraction[], right: Fraction[]): Fraction[] {
  return trimPolynomial(Array.from({ length: Math.max(left.length, right.length) }, (_, index) => addFraction(left[index] ?? fraction(0n), right[index] ?? fraction(0n))));
}

function polynomialSubtract(left: Fraction[], right: Fraction[]): Fraction[] {
  return trimPolynomial(Array.from({ length: Math.max(left.length, right.length) }, (_, index) => subtractFraction(left[index] ?? fraction(0n), right[index] ?? fraction(0n))));
}

function polynomialMultiply(left: Fraction[], right: Fraction[]): Fraction[] {
  if (left.length + right.length - 2 > MAX_POLYNOMIAL_DEGREE) throw new Error("polynomial degree exceeds local provider limit");
  const result = Array.from({ length: left.length + right.length - 1 }, () => fraction(0n));
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      result[leftIndex + rightIndex] = addFraction(result[leftIndex + rightIndex]!, multiplyFraction(left[leftIndex]!, right[rightIndex]!));
    }
  }
  return trimPolynomial(result);
}

function polynomialPower(value: Fraction[], exponent: number): Fraction[] {
  let result = [fraction(1n)];
  for (let index = 0; index < exponent; index += 1) result = polynomialMultiply(result, value);
  return result;
}

function integratePolynomial(coefficients: Fraction[], lower: Fraction, upper: Fraction): Fraction {
  let result = fraction(0n);
  for (let degree = 0; degree < coefficients.length; degree += 1) {
    const exponent = degree + 1;
    const factor = divideFraction(coefficients[degree]!, fraction(BigInt(exponent)));
    result = addFraction(result, multiplyFraction(factor, subtractFraction(powerFraction(upper, exponent), powerFraction(lower, exponent))));
  }
  return result;
}

function exactPolynomialRoots(coefficients: Fraction[], approximate: number[]): ExactSolverValue[] | undefined {
  const degree = coefficients.length - 1;
  if (degree === 0) return [];
  if (degree === 1) return [exactValue(divideFraction(fraction(-coefficients[0]!.numerator, coefficients[0]!.denominator), coefficients[1]!))];
  if (degree !== 2) return undefined;
  const [c, b, a] = coefficients;
  const discriminant = subtractFraction(multiplyFraction(b!, b!), multiplyFraction(fraction(4n), multiplyFraction(a!, c!)));
  if (discriminant.numerator < 0n) return [];
  const squareRoot = sqrtFraction(discriminant);
  if (squareRoot) {
    const denominator = multiplyFraction(fraction(2n), a!);
    const negativeB = fraction(-b!.numerator, b!.denominator);
    return [
      divideFraction(subtractFraction(negativeB, squareRoot), denominator),
      divideFraction(addFraction(negativeB, squareRoot), denominator),
    ].sort((left, right) => fractionNumber(left) - fractionNumber(right))
      .map(exactValue)
      .filter((value, index, values) => index === 0 || value.value !== values[index - 1]!.value);
  }
  const base = `(${fractionText(fraction(-b!.numerator, b!.denominator))}`;
  const radical = `sqrt(${fractionText(discriminant)})`;
  const denominator = fractionText(multiplyFraction(fraction(2n), a!));
  const values = [`${base}-${radical})/${denominator}`, `${base}+${radical})/${denominator}`]
    .map((value) => ({ kind: "radical" as const, value }));
  return approximate.length === 2 ? values : undefined;
}

function realPolynomialRoots(coefficients: number[], min: number, max: number): number[] {
  const trimmed = trimNumericPolynomial(coefficients);
  const degree = trimmed.length - 1;
  if (degree <= 0) return [];
  if (degree === 1) {
    const root = -trimmed[0]! / trimmed[1]!;
    return root >= min - ROOT_TOLERANCE && root <= max + ROOT_TOLERANCE ? [clamp(root, min, max)] : [];
  }
  const derivative = trimmed.slice(1).map((coefficient, index) => coefficient * (index + 1));
  const critical = realPolynomialRoots(derivative, min, max);
  const points = uniqueSorted([min, ...critical, max]);
  const roots = critical.filter((point) => nearZero(evaluatePolynomial(trimmed, point), trimmed, point));
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!;
    const right = points[index]!;
    const leftValue = evaluatePolynomial(trimmed, left);
    const rightValue = evaluatePolynomial(trimmed, right);
    if (nearZero(leftValue, trimmed, left)) roots.push(left);
    if (nearZero(rightValue, trimmed, right)) roots.push(right);
    if (leftValue * rightValue < 0) roots.push(bisect((x) => evaluatePolynomial(trimmed, x), left, right));
  }
  return uniqueSorted(roots.map((root) => clamp(root, min, max)));
}

function bracketedRoots(fn: (x: number) => number, min: number, max: number): number[] {
  const segments = 4096;
  const roots: number[] = [];
  let previousX = min;
  let previousValue = fn(previousX);
  for (let index = 1; index <= segments; index += 1) {
    const x = min + (max - min) * index / segments;
    const value = fn(x);
    if (Math.abs(previousValue) <= ROOT_TOLERANCE) roots.push(previousX);
    if (previousValue * value < 0) roots.push(bisect(fn, previousX, x));
    previousX = x;
    previousValue = value;
  }
  if (Math.abs(previousValue) <= ROOT_TOLERANCE) roots.push(max);
  return uniqueSorted(roots);
}

function bisect(fn: (x: number) => number, start: number, end: number): number {
  let left = start;
  let right = end;
  let leftValue = fn(left);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (left + right) / 2;
    const value = fn(middle);
    if (Math.abs(value) <= ROOT_TOLERANCE || right - left <= ROOT_TOLERANCE) return middle;
    if (leftValue * value <= 0) right = middle;
    else {
      left = middle;
      leftValue = value;
    }
  }
  return (left + right) / 2;
}

function compositeSimpson(fn: (x: number) => number, lower: number, upper: number, intervals: number): number {
  const width = (upper - lower) / intervals;
  let sum = fn(lower) + fn(upper);
  for (let index = 1; index < intervals; index += 1) sum += (index % 2 === 0 ? 2 : 4) * fn(lower + index * width);
  const result = sum * width / 3;
  if (!Number.isFinite(result)) throw new Error("numeric integration produced a non-finite result");
  return result;
}

function requiredExpression(expressions: Map<string, ProblemExpression>, id: string): ProblemExpression {
  const expression = expressions.get(id);
  if (!expression) throw new Error(`unknown expression ${id}`);
  return expression;
}

function exactValue(value: Fraction): ExactSolverValue {
  return { kind: value.denominator === 1n ? "integer" : "rational", value: fractionText(value) };
}

function exactNumber(value: ExactSolverValue): number | null {
  if (value.kind !== "integer" && value.kind !== "rational") return null;
  const [numerator, denominator = "1"] = value.value.split("/");
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) ? result : null;
}

function fractionText(value: Fraction): string {
  return value.denominator === 1n ? String(value.numerator) : `${value.numerator}/${value.denominator}`;
}

function addFraction(left: Fraction, right: Fraction): Fraction { return fraction(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator); }
function subtractFraction(left: Fraction, right: Fraction): Fraction { return fraction(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator); }
function multiplyFraction(left: Fraction, right: Fraction): Fraction { return fraction(left.numerator * right.numerator, left.denominator * right.denominator); }
function divideFraction(left: Fraction, right: Fraction): Fraction { return fraction(left.numerator * right.denominator, left.denominator * right.numerator); }
function powerFraction(value: Fraction, exponent: number): Fraction { return fraction(value.numerator ** BigInt(exponent), value.denominator ** BigInt(exponent)); }
function fractionNumber(value: Fraction): number { return Number(value.numerator) / Number(value.denominator); }

function sqrtFraction(value: Fraction): Fraction | null {
  const numerator = integerSqrt(value.numerator);
  const denominator = integerSqrt(value.denominator);
  return numerator * numerator === value.numerator && denominator * denominator === value.denominator ? fraction(numerator, denominator) : null;
}

function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error("square root of negative integer");
  if (value < 2n) return value;
  let current = 1n << BigInt(Math.ceil(bitLength(value) / 2));
  while (true) {
    const next = (current + value / current) / 2n;
    if (next >= current) return current;
    current = next;
  }
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a === 0n ? 1n : a;
}

function abs(value: bigint): bigint { return value < 0n ? -value : value; }
function bitLength(value: bigint): number { return abs(value).toString(2).length; }
function trimPolynomial(value: Fraction[]): Fraction[] { while (value.length > 1 && value[value.length - 1]!.numerator === 0n) value.pop(); return value; }
function trimNumericPolynomial(value: number[]): number[] { const result = [...value]; while (result.length > 1 && Math.abs(result[result.length - 1]!) <= 1e-14) result.pop(); return result; }
function evaluatePolynomial(coefficients: number[], x: number): number { return coefficients.reduceRight((sum, coefficient) => sum * x + coefficient, 0); }
function maximumResidual(values: number[], fn: (x: number) => number): number { return values.reduce((maximum, value) => Math.max(maximum, Math.abs(fn(value))), 0); }
function uniqueSorted(values: number[]): number[] { return [...values].sort((a, b) => a - b).filter((value, index, sorted) => index === 0 || Math.abs(value - sorted[index - 1]!) > ROOT_TOLERANCE * 8); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function nearZero(value: number, coefficients: number[], x: number): boolean { return Math.abs(value) <= ROOT_TOLERANCE * Math.max(1, coefficients.reduce((sum, coefficient, degree) => sum + Math.abs(coefficient) * Math.abs(x) ** degree, 0)); }

function validateExact(raw: unknown, set: boolean, path: string, issues: SolverIssue[]): void {
  const values = set ? raw : [raw];
  if (!Array.isArray(values) || values.some((value) => !validExactValue(value))) {
    add(issues, "invalid_exact_value", path, "exact value does not match the declared valueType");
  }
}

function validExactValue(value: unknown): boolean {
  if (!isRecord(value) || !["integer", "rational", "radical", "symbolic"].includes(String(value.kind)) || typeof value.value !== "string" || value.value.length === 0 || value.value.length > 256) return false;
  if (value.kind === "integer") return /^-?\d+$/.test(value.value);
  if (value.kind === "rational") return /^-?\d+\/[1-9]\d*$/.test(value.value);
  return /^[A-Za-z0-9_+*/^(). -]+$/.test(value.value);
}

function validateExactAgreement(rawExact: unknown, rawApproximate: unknown, set: boolean, errorBound: number, path: string, issues: SolverIssue[]): void {
  const exactValues = set && Array.isArray(rawExact) ? rawExact : [rawExact];
  const approximateValues = set && Array.isArray(rawApproximate) ? rawApproximate : [rawApproximate];
  if (exactValues.length !== approximateValues.length) {
    add(issues, "exact_approximate_mismatch", path, "exact and approximate sets must have the same cardinality");
    return;
  }
  exactValues.forEach((exact, index) => {
    if (!isRecord(exact) || typeof exact.kind !== "string" || typeof exact.value !== "string") return;
    const numeric = exactNumber(exact as unknown as ExactSolverValue);
    const approximate = approximateValues[index];
    if (numeric !== null && typeof approximate === "number" && Math.abs(numeric - approximate) > Math.max(errorBound, 1e-10)) {
      add(issues, "exact_approximate_mismatch", `${path}.exact`, "exact value disagrees with its numerical approximation");
    }
  });
}

function requestExpressionIds(request: SolveRequest | undefined): string[] {
  if (!request) return [];
  if (request.kind === "intersections") return [request.leftExpressionId, request.rightExpressionId];
  return [request.expressionId];
}

function validApproximate(raw: unknown, set: boolean): boolean {
  return set ? Array.isArray(raw) && raw.every((value) => typeof value === "number" && Number.isFinite(value)) : typeof raw === "number" && Number.isFinite(raw);
}

function validateRequestId(raw: unknown, requestIds: Set<string>, path: string, issues: SolverIssue[], requireKnown: boolean): void {
  if (typeof raw !== "string" || raw === "" || (requireKnown && !requestIds.has(raw))) add(issues, "unknown_request", path, `unknown request ${String(raw)}`);
}

function validateResultId(raw: unknown, path: string, issues: SolverIssue[]): void {
  if (typeof raw !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(raw)) add(issues, "invalid_id", path, "invalid result id");
}

function failedProblem(problemIssues: ProblemIRIssue[], raw: unknown, providerId: string): SolverResult {
  return {
    schemaVersion: SOLVER_RESULT_VERSION,
    problemId: isRecord(raw) && typeof raw.id === "string" ? raw.id : "invalid_problem",
    providerId,
    status: "failed",
    values: [],
    proofs: [],
    issues: problemIssues.map((issue) => ({ ...issue })),
  };
}

function failedExecution(raw: unknown, providerId: string, code: string, message: string): SolverResult {
  return {
    schemaVersion: SOLVER_RESULT_VERSION,
    problemId: isRecord(raw) && typeof raw.id === "string" ? raw.id : "invalid_problem",
    providerId,
    status: "failed",
    values: [],
    proofs: [],
    issues: [{ code, path: "$", message }],
  };
}

function add(issues: SolverIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
