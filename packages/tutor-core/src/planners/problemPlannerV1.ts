import {
  LocalDeterministicSolverProvider,
  buildSolverAuthorityProjection,
  evaluateMathExpression,
  expressionToSafeSource,
  solveWithDeadline,
  validateProblemIR,
  validateSolverResult,
  verifyTurnPlanAgainstSolver,
  type ProblemIR,
  type SolverAuthorityAudit,
  type SolverProvider,
  type SolverResult,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import { withFastModeHeader } from "../llm/fastMode";
import { withTurnTraceHeaders } from "../llm/traceHeaders";
import { tutorDebug } from "../tutorDebug";

const PROBLEM_PLANNER_MODEL = "server";

export interface ProblemPlannerV1Options {
  proxyUrl: string;
  sessionId?: string;
  /** Client-generated Langfuse turn id shared with teaching and TTS. */
  traceId?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  provider?: SolverProvider;
  fastMode?: boolean;
}

export interface ProblemAuthorityV1Response {
  problemIR: ProblemIR;
  solverResult: SolverResult;
  audit: SolverAuthorityAudit;
  projection: Record<string, unknown> | null;
  rawContent: string;
  elapsedMs: number;
  traceId?: string;
}

/**
 * Formulate the question as ProblemIR and solve it deterministically.
 *
 * The model sees the question and the validated plan. A bound solver value
 * that disagrees with the plan beyond rounding loses its binding (see
 * `withdrawDisagreeingBindings`), so the caller's reconcile step can only
 * sharpen a rounded plan value, never swap in a different answer.
 *
 * Without a turn plan (`null`), the call can run alongside the turn planner.
 * The model then names each requested quantity itself, and the caller must
 * join the result to the plan with `bindProblemIRToTurnPlan` before auditing.
 */
export async function planAndSolveProblemV1(
  question: string,
  turnPlan: TurnPlanV3 | null,
  options: ProblemPlannerV1Options,
): Promise<ProblemAuthorityV1Response | null> {
  const startedAt = Date.now();
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(new DOMException("ProblemIR planner deadline exceeded", "TimeoutError")),
    Math.max(1, options.timeoutMs),
  );
  const signal = options.signal
    ? mergeAbortSignals(options.signal, timeoutController.signal)
    : timeoutController.signal;
  try {
    const response = await (options.fetchImpl ?? fetch)(options.proxyUrl, {
      method: "POST",
      headers: withFastModeHeader(
        withTurnTraceHeaders(
          {
            "content-type": "application/json",
            "x-planner": "1",
            "x-problem-ir-version": "1",
            "x-planner-deadline-ms": String(options.timeoutMs),
          },
          { sessionId: options.sessionId, traceId: options.traceId, question },
        ),
        options.fastMode,
      ),
      signal,
      body: JSON.stringify({
        model: PROBLEM_PLANNER_MODEL,
        max_tokens: 3600,
        temperature: 0,
        stream: false,
        messages: [
          { role: "system", content: PROBLEM_IR_V1_PROMPT },
          { role: "user", content: problemIRUserMessage(question, turnPlan) },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = parseJsonObject(content);
    const normalized = normalizeProblemIRModelOutput(parsed, question, turnPlan);
    const problemValidation = validateProblemIR(normalized, question);
    if (problemValidation.problem && problemValidation.problem.facts.length === 0) {
      // `{}` is a refusal, not a formulation; filled-in defaults must not
      // turn it into an empty "solved" authority.
      tutorDebug("planner", "ProblemIR v1 returned no grounded facts");
      return null;
    }
    if (!problemValidation.problem) {
      tutorDebug("planner", "ProblemIR v1 rejected", {
        issue_codes: problemValidation.issues.map((issue) => issue.code),
      });
      return null;
    }
    const elapsedBeforeSolve = Date.now() - startedAt;
    const remainingMs = Math.max(1, options.timeoutMs - elapsedBeforeSolve);
    const solverResult = await solveWithDeadline(
      options.provider ?? new LocalDeterministicSolverProvider(),
      problemValidation.problem,
      remainingMs,
      signal,
    );
    const solverValidation = validateSolverResult(solverResult, problemValidation.problem);
    if (!solverValidation.result || solverValidation.result.status !== "solved") return null;
    const problem = turnPlan
      ? withdrawDisagreeingBindings(problemValidation.problem, solverValidation.result, turnPlan)
      : problemValidation.problem;
    // Without a plan there is nothing to audit yet. The binding join and the
    // audit happen once the plan exists; until then no value is authoritative.
    const audit: SolverAuthorityAudit = turnPlan
      ? verifyTurnPlanAgainstSolver(problem, solverValidation.result, turnPlan, question)
      : { status: "incomplete", issues: [{ code: "turn_plan_pending", message: "no turn plan to audit against yet" }], bindings: [] };
    return {
      problemIR: problem,
      solverResult: solverValidation.result,
      audit,
      projection: audit.status === "verified"
        ? buildSolverAuthorityProjection(problem, solverValidation.result, audit)
        : null,
      rawContent: content,
      elapsedMs: Date.now() - startedAt,
      traceId: response.headers.get("x-heytutor-trace-id") ?? undefined,
    };
  } catch (error) {
    tutorDebug("planner", "ProblemIR v1 planning failed", {
      reason: error instanceof Error ? error.message : String(error),
      elapsed_ms: Date.now() - startedAt,
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * The caller reconciles the plan with the solver before auditing, and
 * reconcile replaces a plan value with any bound solver value whose id,
 * symbol and unit agree. That is right for a rounded plan value (34.64 for
 * 34.641...) and wrong for a different answer: a formulation with the wrong
 * law (R = u^2/g) would overwrite the plan's 34.64 with 40 and then audit as
 * verified. So a binding survives only when the plan value is the solver
 * value rounded to the plan's own displayed precision, within 5%. Anything
 * else loses its binding and audits as `incomplete`: an absent second
 * opinion, never a silently changed answer and never a stopped lesson.
 */
export function withdrawDisagreeingBindings(
  problem: ProblemIR,
  result: SolverResult,
  turnPlan: TurnPlanV3,
): ProblemIR {
  const values = new Map(result.values.map((value) => [value.requestId, value]));
  let changed = false;
  const solveRequests = problem.solveRequests.map((request) => {
    const binding = request.resultBinding;
    if (!binding) return request;
    const derived = turnPlan.derived.find((quantity) => quantity.id === binding.turnPlanQuantityId);
    const value = values.get(request.id);
    if (!derived || !value || typeof value.approximate !== "number") return request;
    if (planValueRoundsSolverValue(derived.value, value.approximate)) return request;
    tutorDebug("planner", "ProblemIR binding withdrawn: solver and plan disagree", {
      quantity_id: binding.turnPlanQuantityId,
      plan_value: derived.value,
      solver_value: value.approximate,
    });
    changed = true;
    const withdrawn: Record<string, unknown> = { ...request };
    delete withdrawn.resultBinding;
    return withdrawn as unknown as typeof request;
  });
  return changed ? { ...problem, solveRequests } : problem;
}

/** True when `plan` is `solver` rounded to the decimals `plan` is written with. */
export function planValueRoundsSolverValue(plan: number, solver: number): boolean {
  if (!Number.isFinite(plan) || !Number.isFinite(solver)) return false;
  const difference = Math.abs(plan - solver);
  if (difference <= 1e-9 * Math.max(1, Math.abs(solver))) return true;
  const written = String(plan);
  if (/e/i.test(written)) return false;
  const decimals = written.includes(".") ? written.split(".")[1]!.length : 0;
  const halfUnit = 0.5 * 10 ** -decimals;
  return difference <= halfUnit * (1 + 1e-9) && difference <= 0.05 * Math.abs(solver);
}

/**
 * Normalize only model-boundary drift that can be proved from existing typed
 * inputs. This is deliberately not a mathematical repair layer: it may fix an
 * exact question span, canonical field aliases, or a closed numeric bound, but
 * it drops any request whose missing semantics would require inference.
 */
export function normalizeProblemIRModelOutput(
  raw: unknown,
  question: string,
  turnPlan: TurnPlanV3 | null | undefined,
): unknown {
  if (!isRecord(raw)) return raw;
  const facts = arrayRecords(raw.facts).flatMap((fact) => {
    // The compact wire format carries the quote alone; the span is rebuilt
    // from the question, never trusted from the model.
    const evidence = exactQuestionEvidence(
      fact.evidence ?? (typeof fact.quote === "string" ? { quote: fact.quote } : undefined),
      question,
    );
    if (!evidence) return [];
    const lifted: Record<string, unknown> = { ...fact, evidence };
    delete lifted.quote;
    return [lifted];
  });
  const factIds = recordIds(facts);
  const withEvidence = (record: Record<string, unknown>): Record<string, unknown> | null => {
    const evidenceFactIds = filterIds(record.evidenceFactIds, factIds);
    return evidenceFactIds.length > 0 ? { ...record, evidenceFactIds } : null;
  };

  const entities = arrayRecords(raw.entities).flatMap((entity) => {
    const normalized = withEvidence(entity);
    return normalized ? [normalized] : [];
  });
  const entityIds = recordIds(entities);

  const expressions = arrayRecords(raw.expressions).flatMap((expression) => {
    const grounded = withEvidence(expression);
    if (!grounded) return [];
    // `expr` is the compact infix form. It is parsed here into the same typed
    // AST the validator and solver accept; nothing is evaluated from text.
    const root = typeof grounded.expr === "string"
      ? parseInfixExpression(grounded.expr)
      : normalizeExpressionNode(grounded.root);
    if (!root || !isStructurallySafeExpression(root) || trigTakesDegreeLiteral(root)) return [];
    const lifted: Record<string, unknown> = { ...grounded, root };
    delete lifted.expr;
    return [lifted];
  });
  const expressionIds = recordIds(expressions);

  const constraints = arrayRecords(raw.constraints).flatMap((constraint) => {
    const grounded = withEvidence(constraint);
    if (!grounded) return [];
    if (grounded.kind === "equation" || grounded.kind === "inequality") {
      return typeof grounded.leftExpressionId === "string" && expressionIds.has(grounded.leftExpressionId) &&
        typeof grounded.rightExpressionId === "string" && expressionIds.has(grounded.rightExpressionId)
        ? [grounded]
        : [];
    }
    const entityRefs = filterIds(grounded.entityIds, entityIds);
    return entityRefs.length >= 2 ? [{ ...grounded, entityIds: entityRefs }] : [];
  });

  const representationIntents = arrayRecords(raw.representationIntents).flatMap((intent) => {
    const grounded = withEvidence(intent);
    if (!grounded) return [];
    const entityIdsForIntent = filterIds(grounded.entityIds, entityIds);
    return entityIdsForIntent.length > 0
      ? [{ ...grounded, entityIds: entityIdsForIntent }]
      : [];
  });

  const solveRequests = arrayRecords(raw.solveRequests).flatMap((request) => {
    const normalized = normalizeSolveRequest(request, expressionIds, factIds, turnPlan);
    return normalized ? [normalized] : [];
  });

  return {
    ...raw,
    // Constant or echoed fields the model need not spend tokens on. A question
    // that is present must still match; an absent one is the submitted one.
    schemaVersion: raw.schemaVersion ?? "problem-ir/v1",
    id: typeof raw.id === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(raw.id) ? raw.id : "problem",
    question: raw.question === undefined || normalizedQuestionMatches(raw.question, question)
      ? question
      : raw.question,
    facts,
    entities,
    expressions,
    constraints,
    representationIntents,
    solveRequests,
  };
}

function normalizeSolveRequest(
  request: Record<string, unknown>,
  expressionIds: Set<string>,
  factIds: Set<string>,
  turnPlan: TurnPlanV3 | null | undefined,
): Record<string, unknown> | null {
  if (typeof request.id !== "string") return null;
  const resultBinding = normalizeResultBinding(request.resultBinding, factIds, turnPlan);
  const binding = resultBinding ? { resultBinding } : {};
  if (request.kind === "evaluate") {
    return typeof request.expressionId === "string" && expressionIds.has(request.expressionId)
      ? { id: request.id, kind: request.kind, expressionId: request.expressionId, ...binding }
      : null;
  }
  if (request.kind === "roots") {
    return typeof request.expressionId === "string" && expressionIds.has(request.expressionId) &&
      validVariable(request.variable) && validDomain(request.domain)
      ? {
          id: request.id,
          kind: request.kind,
          expressionId: request.expressionId,
          variable: request.variable,
          domain: request.domain,
          ...binding,
        }
      : null;
  }
  if (request.kind === "intersections") {
    return typeof request.leftExpressionId === "string" && expressionIds.has(request.leftExpressionId) &&
      typeof request.rightExpressionId === "string" && expressionIds.has(request.rightExpressionId) &&
      validVariable(request.variable) && validDomain(request.domain)
      ? {
          id: request.id,
          kind: request.kind,
          leftExpressionId: request.leftExpressionId,
          rightExpressionId: request.rightExpressionId,
          variable: request.variable,
          domain: request.domain,
          ...binding,
        }
      : null;
  }
  if (request.kind !== "definite_integral" || !validVariable(request.variable)) return null;
  const integrandId = typeof request.expressionId === "string"
    ? request.expressionId
    : isRecord(request.integrand) && typeof request.integrand.id === "string"
      ? request.integrand.id
      : null;
  const lower = closedNumericValue(request.lower ?? request.lowerBound);
  const upper = closedNumericValue(request.upper ?? request.upperBound);
  return integrandId && expressionIds.has(integrandId) && lower !== null && upper !== null && lower !== upper
    ? {
        id: request.id,
        kind: request.kind,
        expressionId: integrandId,
        variable: request.variable,
        lower,
        upper,
        ...binding,
      }
    : null;
}

function normalizeResultBinding(
  raw: unknown,
  factIds: Set<string>,
  turnPlan: TurnPlanV3 | null | undefined,
): Record<string, unknown> | null {
  if (!isRecord(raw) || typeof raw.turnPlanQuantityId !== "string" || typeof raw.symbol !== "string") {
    return null;
  }
  if (!turnPlan) {
    // Question-alone formulation: the id is the model's own name for the
    // quantity. `bindProblemIRToTurnPlan` must rename it before any audit.
    const evidenceFactIds = filterIds(raw.evidenceFactIds, factIds);
    if (evidenceFactIds.length === 0 || !validVariable(raw.turnPlanQuantityId)) return null;
    return {
      turnPlanQuantityId: raw.turnPlanQuantityId,
      symbol: raw.symbol,
      ...(typeof raw.unit === "string" && raw.unit.trim() ? { unit: raw.unit } : {}),
      evidenceFactIds,
    };
  }
  const unknown = turnPlan.unknowns.find((candidate) => candidate.id === raw.turnPlanQuantityId);
  const derived = turnPlan.derived.find((candidate) => candidate.id === raw.turnPlanQuantityId);
  const evidenceFactIds = filterIds(raw.evidenceFactIds, factIds);
  if (!unknown || !derived || evidenceFactIds.length === 0) return null;
  if (
    normalizeToken(raw.symbol) !== normalizeToken(unknown.symbol) ||
    normalizeToken(derived.symbol) !== normalizeToken(unknown.symbol) ||
    normalizeUnitToken(typeof raw.unit === "string" ? raw.unit : undefined) !== normalizeUnitToken(unknown.unit) ||
    normalizeUnitToken(derived.unit) !== normalizeUnitToken(unknown.unit)
  ) return null;
  return {
    turnPlanQuantityId: unknown.id,
    symbol: unknown.symbol,
    ...(unknown.unit ? { unit: unknown.unit } : {}),
    evidenceFactIds,
  };
}

function exactQuestionEvidence(raw: unknown, question: string): Record<string, unknown> | null {
  if (typeof raw === "string") raw = { quote: raw };
  if (
    !isRecord(raw) || (raw.source !== undefined && raw.source !== "question") ||
    typeof raw.quote !== "string" || raw.quote === ""
  ) {
    return null;
  }
  const quote = raw.quote;
  if (
    Number.isInteger(raw.start) && Number.isInteger(raw.end) &&
    question.slice(raw.start as number, raw.end as number) === quote
  ) return { source: "question", start: raw.start, end: raw.end, quote };
  const occurrences: number[] = [];
  let from = 0;
  while (from <= question.length - quote.length) {
    const index = question.indexOf(quote, from);
    if (index < 0) break;
    occurrences.push(index);
    from = index + Math.max(1, quote.length);
  }
  // The validator grounds a fact by its quote; the span is advisory. A quote
  // that repeats ("m/s") is still the question's own text, so it takes the
  // first occurrence instead of dropping the fact and everything citing it.
  if (occurrences.length === 0) return null;
  return { source: "question", start: occurrences[0], end: occurrences[0]! + quote.length, quote };
}

function normalizeExpressionNode(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw) || typeof raw.kind !== "string") return null;
  const normalized = { ...raw };
  if ((raw.kind === "binary" || raw.kind === "unary") && normalized.operator === undefined && typeof raw.op === "string") {
    normalized.operator = raw.op;
    delete normalized.op;
  }
  if (raw.kind === "binary") {
    const left = normalizeExpressionNode(raw.left);
    const right = normalizeExpressionNode(raw.right);
    if (!left || !right) return null;
    normalized.left = left;
    normalized.right = right;
  } else if (raw.kind === "unary") {
    const operand = normalizeExpressionNode(raw.operand);
    if (!operand) return null;
    normalized.operand = operand;
  } else if (raw.kind === "call") {
    const functionName = typeof raw.function === "string"
      ? raw.function
      : typeof raw.name === "string" ? raw.name : null;
    // Models write a one-argument call as `args: [x]` about as often as
    // `argument: x`. Any other arity is not a supported call and is dropped.
    const listed = Array.isArray(raw.args) && raw.args.length === 1 ? raw.args[0] : undefined;
    const argument = normalizeExpressionNode(raw.argument ?? raw.arg ?? listed);
    if (!functionName) return null;
    if (!argument) return null;
    normalized.function = functionName;
    normalized.argument = argument;
    delete normalized.name;
    delete normalized.arg;
    delete normalized.args;
  }
  return normalized;
}

function isStructurallySafeExpression(root: Record<string, unknown>): boolean {
  try {
    const variables = new Set<string>();
    collectVariables(root, variables);
    if (variables.size > 1) return false;
    expressionToSafeSource(root as never, variables.values().next().value);
    return true;
  } catch {
    return false;
  }
}

/**
 * `sin(30)` is almost always 30 degrees evaluated as radians (-0.988). A trig
 * argument that is a closed number without pi and larger than one turn is
 * refused; degrees must be written as `30*pi/180`.
 */
function trigTakesDegreeLiteral(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (raw.kind === "binary") return trigTakesDegreeLiteral(raw.left) || trigTakesDegreeLiteral(raw.right);
  if (raw.kind === "unary") return trigTakesDegreeLiteral(raw.operand);
  if (raw.kind !== "call") return false;
  if (trigTakesDegreeLiteral(raw.argument)) return true;
  if (raw.function !== "sin" && raw.function !== "cos" && raw.function !== "tan") return false;
  const variables = new Set<string>();
  collectVariables(raw.argument, variables);
  if (variables.size > 0 || mentionsPi(raw.argument)) return false;
  const value = closedNumericValue(raw.argument);
  return value !== null && Math.abs(value) > 2 * Math.PI;
}

function mentionsPi(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (raw.kind === "constant") return raw.name === "pi";
  if (raw.kind === "binary") return mentionsPi(raw.left) || mentionsPi(raw.right);
  if (raw.kind === "unary") return mentionsPi(raw.operand);
  if (raw.kind === "call") return mentionsPi(raw.argument);
  return false;
}

function collectVariables(raw: unknown, variables: Set<string>): void {
  if (!isRecord(raw)) return;
  if (raw.kind === "variable" && typeof raw.name === "string") variables.add(raw.name);
  if (raw.kind === "binary") {
    collectVariables(raw.left, variables);
    collectVariables(raw.right, variables);
  } else if (raw.kind === "unary") collectVariables(raw.operand, variables);
  else if (raw.kind === "call") collectVariables(raw.argument, variables);
}

function closedNumericValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const normalized = typeof raw === "string" ? parseInfixExpression(raw) : normalizeExpressionNode(raw);
  if (!normalized) return null;
  try {
    const source = expressionToSafeSource(normalized as never);
    const value = evaluateMathExpression(source, 0);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function arrayRecords(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

function recordIds(records: Record<string, unknown>[]): Set<string> {
  return new Set(records.flatMap((record) => typeof record.id === "string" ? [record.id] : []));
}

function filterIds(raw: unknown, ids: Set<string>): string[] {
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && ids.has(id))
    : [];
}

function validVariable(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(raw);
}

function validDomain(raw: unknown): raw is { min: number; max: number } {
  return isRecord(raw) && typeof raw.min === "number" && typeof raw.max === "number" &&
    Number.isFinite(raw.min) && Number.isFinite(raw.max) && raw.min < raw.max && raw.max - raw.min <= 1e6;
}

function normalizedQuestionMatches(raw: unknown, question: string): boolean {
  return typeof raw === "string" && raw.trim().replace(/\s+/g, " ").toLowerCase() ===
    question.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/\\(?:mathrm|text|operatorname)/g, "").replace(/[^a-z0-9]+/g, "");
}

function normalizeUnitToken(raw: string | undefined): string {
  const value = String(raw ?? "1").toLowerCase().replace(/µ|μ/g, "u").replace(/\s+/g, "");
  return value === "none" ? "1" : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function mergeAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  if (first.aborted) abort(first);
  else first.addEventListener("abort", () => abort(first), { once: true });
  if (second.aborted) abort(second);
  else second.addEventListener("abort", () => abort(second), { once: true });
  return controller.signal;
}

/**
 * The submitted question and the validated plan, as origin/main sent them.
 * Without a plan the model names each requested quantity itself.
 */
export function problemIRUserMessage(question: string, turnPlan: TurnPlanV3 | null): string {
  return turnPlan
    ? `SUBMITTED QUESTION\n${question}\n\nVALIDATED TURN PLAN V3\n${JSON.stringify(turnPlan)}`
    : `SUBMITTED QUESTION\n${question}\n\nVALIDATED TURN PLAN V3\nnone: name each requested numeric quantity yourself`;
}

/**
 * Join a question-alone ProblemIR to a turn plan that finished afterwards.
 *
 * A binding is renamed to a plan unknown only when its normalized symbol and
 * unit match exactly one unknown and no other binding claims that unknown.
 * Anything ambiguous loses its binding, which audits as `incomplete` (an
 * absent second opinion), never as a contradiction. Run
 * `withdrawDisagreeingBindings` on the result before reconcile and audit.
 */
export function bindProblemIRToTurnPlan(problem: ProblemIR, turnPlan: TurnPlanV3): ProblemIR {
  const matches = new Map<string, string[]>();
  for (const request of problem.solveRequests) {
    const binding = request.resultBinding;
    if (!binding) continue;
    const unknownIds = turnPlan.unknowns
      .filter((unknown) =>
        bindingSymbolKey(unknown.symbol) === bindingSymbolKey(binding.symbol) &&
        bindingUnitKey(unknown.unit) === bindingUnitKey(binding.unit))
      .map((unknown) => unknown.id);
    matches.set(request.id, unknownIds);
  }
  const claims = new Map<string, number>();
  for (const unknownIds of matches.values()) {
    if (unknownIds.length === 1) claims.set(unknownIds[0]!, (claims.get(unknownIds[0]!) ?? 0) + 1);
  }
  return {
    ...problem,
    solveRequests: problem.solveRequests.map((request) => {
      if (!request.resultBinding) return request;
      const unknownIds = matches.get(request.id) ?? [];
      const { resultBinding, ...rest } = request;
      if (unknownIds.length !== 1 || claims.get(unknownIds[0]!) !== 1) return rest as typeof request;
      const unknown = turnPlan.unknowns.find((candidate) => candidate.id === unknownIds[0])!;
      return {
        ...request,
        resultBinding: {
          ...resultBinding,
          turnPlanQuantityId: unknown.id,
          symbol: unknown.symbol,
          ...(unknown.unit ? { unit: unknown.unit } : {}),
        },
      };
    }),
  };
}

/**
 * Join keys for a question-alone binding. Case and script are meaning here:
 * T is not t, and Δv is not v. Only markup and separators are dropped.
 */
function bindingSymbolKey(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\\(?:mathrm|text|operatorname)\s*/g, "")
    .replace(/\\Delta\s*/g, "Δ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function bindingUnitKey(raw: string | undefined): string {
  const value = String(raw ?? "1").normalize("NFKC").replace(/µ|μ/g, "u").replace(/\s+/g, "");
  return value === "" || value.toLowerCase() === "none" ? "1" : value;
}

const INFIX_FUNCTIONS = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "abs", "exp", "log", "ln"]);
const MAX_INFIX_LENGTH = 256;
/** Matches ProblemIR's own 24 level expression depth ceiling. */
const MAX_INFIX_NESTING = 24;

type InfixToken =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "^" | "(" | ")" };

/**
 * Parse the compact infix form into ProblemIR's typed AST. The grammar is the
 * AST's own: numbers, pi, identifiers, + - * / ^, parentheses and the
 * whitelisted one-argument functions. Multiplication must be explicit. Any
 * other character, or anything left over, rejects the whole expression.
 *
 * `e` is an ordinary identifier, never Euler's number: models write `e*1000`
 * for the elementary charge, and a constant there would be a confident wrong
 * number. Euler's number is `exp(1)`. A free `e` fails as an unsolvable
 * variable in a closed scalar, which is the refusal we want.
 */
export function parseInfixExpression(source: string): Record<string, unknown> | null {
  if (typeof source !== "string" || source.trim() === "" || source.length > MAX_INFIX_LENGTH) return null;
  const text = source
    .replace(/π/g, "pi")
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-");
  const tokens: InfixToken[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z][A-Za-z0-9_]*)|([-+*/^()]))/y;
  let index = 0;
  while (index < text.length) {
    if (/^\s*$/.test(text.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) return null;
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: "number", value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: "name", value: match[2] });
    else tokens.push({ kind: "op", value: match[3] as "+" });
  }
  let position = 0;
  const peekOp = (value: string) => {
    const token = tokens[position];
    return token?.kind === "op" && token.value === value;
  };
  // `nesting` counts parentheses, calls, signs and exponents: the constructs
  // that deepen the tree without a left-to-right operator chain.
  const enter = (nesting: number) => {
    if (nesting >= MAX_INFIX_NESTING) throw new Error("too deep");
    return nesting + 1;
  };
  const expression = (nesting: number): Record<string, unknown> => {
    let left = term(nesting);
    while (peekOp("+") || peekOp("-")) {
      const operator = (tokens[position++] as { value: string }).value;
      left = { kind: "binary", operator, left, right: term(nesting) };
    }
    return left;
  };
  const term = (nesting: number): Record<string, unknown> => {
    let left = unary(nesting);
    while (peekOp("*") || peekOp("/")) {
      const operator = (tokens[position++] as { value: string }).value;
      left = { kind: "binary", operator, left, right: unary(nesting) };
    }
    return left;
  };
  const unary = (nesting: number): Record<string, unknown> => {
    if (peekOp("+") || peekOp("-")) {
      const operator = (tokens[position++] as { value: string }).value;
      return { kind: "unary", operator, operand: unary(enter(nesting)) };
    }
    return power(nesting);
  };
  const power = (nesting: number): Record<string, unknown> => {
    const base = primary(nesting);
    if (!peekOp("^")) return base;
    position += 1;
    return { kind: "binary", operator: "^", left: base, right: unary(enter(nesting)) };
  };
  const primary = (nesting: number): Record<string, unknown> => {
    const token = tokens[position++];
    if (!token) throw new Error("unexpected end");
    if (token.kind === "number") {
      if (!Number.isFinite(token.value)) throw new Error("invalid number");
      return { kind: "number", value: token.value };
    }
    if (token.kind === "name") {
      if (peekOp("(")) {
        if (!INFIX_FUNCTIONS.has(token.value)) throw new Error("unsupported function");
        position += 1;
        const argument = expression(enter(nesting));
        if (!peekOp(")")) throw new Error("missing )");
        position += 1;
        return { kind: "call", function: token.value, argument };
      }
      if (INFIX_FUNCTIONS.has(token.value)) throw new Error("function without argument");
      if (token.value === "pi") return { kind: "constant", name: "pi" };
      return { kind: "variable", name: token.value };
    }
    if (token.value === "(") {
      const inner = expression(enter(nesting));
      if (!peekOp(")")) throw new Error("missing )");
      position += 1;
      return inner;
    }
    throw new Error("unexpected operator");
  };
  try {
    const root = expression(0);
    return position === tokens.length ? root : null;
  } catch {
    return null;
  }
}

const PROBLEM_IR_V1_PROMPT = `You are the topic-neutral formulation planner for a verified teaching engine.
Return one minified JSON object on a single line. No prose, markdown, indentation or line breaks.

Shape (every array required, may be empty):
{"facts":[{"id":"fSpeed","kind":"given|requested|assumption","statement":"at most 10 words","quote":"exact substring of the question"}],"entities":[{"id":"ball","kind":"point|line|curve|region|body|solid|component|field|state|other","label":"optional","evidenceFactIds":["fSpeed"]}],"expressions":[{"id":"eTime","valueType":"scalar|function","expr":"2*20*sin(30*pi/180)/10","evidenceFactIds":["fSpeed"]}],"constraints":[],"representationIntents":[{"id":"iPath","kind":"graph|bounded_region|section|solid|network|apparatus|free_body|field|conceptual","entityIds":["ball"],"evidenceFactIds":["fSpeed"]}],"solveRequests":[{"id":"sTime","kind":"evaluate","expressionId":"eTime","resultBinding":{"turnPlanQuantityId":"T","symbol":"T","unit":"s","evidenceFactIds":["fTime"]}}]}

Use only facts grounded by a quote copied character for character from SUBMITTED QUESTION; one fact per stated value, condition, or requested result. Never emit pixels, drawing commands or code.
Entity kind is exactly one of point line curve region body solid component field state other (a circuit part is component). network and apparatus are representation intent kinds, not entity kinds.
expr: numbers, pi, at most one variable, + - * / ^, parentheses, and sin cos tan asin acos atan sqrt abs exp ln. Always write * explicitly. e is not a constant; write exp(1). Trig takes radians, so 30 degrees is 30*pi/180. log and ln both mean natural log.
Constraints: {"id","kind":"equation|inequality","leftExpressionId","rightExpressionId","relation":"< <= > >= (inequality only)","evidenceFactIds"} or {"id","kind":"incident|parallel|perpendicular|tangent|inside|connected|symmetric","entityIds":[two or more],"evidenceFactIds"}.
Solve requests: evaluate {expressionId}; roots {expressionId,variable,domain:{"min","max"}}; intersections {leftExpressionId,rightExpressionId,variable,domain}; definite_integral {expressionId,variable,lower,upper}.

Use evaluate for any requested scalar that can be written as a closed numeric expr after substituting the givens, with the complete formula (every factor, angle term and sign). Emit expressions only when a solve request or constraint uses them; never one per given value.
Do not invent a solve request for a law or assumption not justified by the submitted question and validated TurnPlan. If the givens are symbols rather than numbers, emit no solve requests; still return facts, entities and representation intents.
For mensuration, represent each source shape and part as solid (3D) or region (2D), and include solid/section or bounded_region representation intent. Ground the join or cavity in source facts; a scalar answer still needs its spatial setup.

Every solve request that computes a numeric TurnPlan unknown MUST include resultBinding with the exact unknown id, exact symbol, exact unit when present, and evidenceFactIds naming the requested fact. Do not infer or rename TurnPlan ids. When the TurnPlan says none, choose a short id, the conventional symbol and the SI unit yourself.
All ids are short alphanumeric camelCase identifiers beginning with a letter.`;
