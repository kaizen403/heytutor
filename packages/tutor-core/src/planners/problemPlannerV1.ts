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
 * The model sees the question and the validated plan, as on origin/main.
 *
 * BENCH ONLY: without a turn plan (`null`) the model names each requested
 * quantity itself and the result must be joined with `bindProblemIRToTurnPlan`
 * before any audit. The live hook always passes a plan.
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
    const problem = problemValidation.problem;
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
 * Normalize only model-boundary drift that can be proved from existing typed
 * inputs. This is deliberately not a mathematical repair layer: it may fix an
 * exact question span, canonical field aliases, or a closed numeric bound, but
 * it drops any request whose missing semantics would require inference.
 */
export function normalizeProblemIRModelOutput(
  rawOutput: unknown,
  question: string,
  turnPlan: TurnPlanV3 | null | undefined,
): unknown {
  // Everything below is origin/main's canonical normalizer, byte for byte
  // except the bench-only null plan branch in normalizeResultBinding. The
  // compact wire format is lifted to canonical problem-ir/v1 first, so a
  // canonical output takes exactly origin/main's path.
  const raw = liftCompactProblemIR(rawOutput, question);
  if (!isRecord(raw)) return raw;
  const facts = arrayRecords(raw.facts).flatMap((fact) => {
    const evidence = exactQuestionEvidence(fact.evidence, question);
    if (!evidence) return [];
    return [{ ...fact, evidence }];
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
    const root = normalizeExpressionNode(grounded.root);
    if (!root || !isStructurallySafeExpression(root)) return [];
    return [{ ...grounded, root }];
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
    question: normalizedQuestionMatches(raw.question, question) ? question : raw.question,
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
  if (request.kind === "dc_network") {
    return isRecord(request.network) && isRecord(request.output)
      ? { id: request.id, kind: request.kind, network: request.network, output: request.output, ...binding }
      : null;
  }
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
    // BENCH ONLY (question-alone formulation, never called by the live hook):
    // the id is the model's own name, renamed by bindProblemIRToTurnPlan.
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
  if (!isRecord(raw) || raw.source !== "question" || typeof raw.quote !== "string" || raw.quote === "") {
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
  if (occurrences.length !== 1) return null;
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
    const argument = normalizeExpressionNode(raw.argument ?? raw.arg);
    if (!functionName) return null;
    if (!argument) return null;
    normalized.function = functionName;
    normalized.argument = argument;
    delete normalized.name;
    delete normalized.arg;
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
  const normalized = normalizeExpressionNode(raw);
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
 * Lift the compact wire format to canonical problem-ir/v1. Only the compact
 * fields are touched, so a canonical output passes through unchanged:
 * - a fact `quote` without `evidence` becomes evidence at the quote's first
 *   occurrence (an absent quote stays ungrounded and is dropped later);
 * - an expression `expr` without `root` is parsed into the typed AST (an
 *   unparseable one is left without a root and dropped later);
 * - a string integral bound in a compact output is parsed the same way;
 * - an absent schemaVersion, id or question is filled, only when the output
 *   uses a compact field. A present but invalid value is kept and rejected.
 */
export function liftCompactProblemIR(raw: unknown, question: string): unknown {
  if (!isRecord(raw)) return raw;
  const facts = Array.isArray(raw.facts) ? raw.facts : [];
  const expressions = Array.isArray(raw.expressions) ? raw.expressions : [];
  const compactFact = (fact: unknown) => isRecord(fact) && fact.evidence === undefined && typeof fact.quote === "string";
  const compactExpression = (expression: unknown) =>
    isRecord(expression) && expression.root === undefined && typeof expression.expr === "string";
  if (!facts.some(compactFact) && !expressions.some(compactExpression)) return raw;
  const lifted: Record<string, unknown> = {
    ...raw,
    schemaVersion: raw.schemaVersion === undefined ? PROBLEM_IR_SCHEMA_VERSION : raw.schemaVersion,
    id: raw.id === undefined ? "problem" : raw.id,
    question: raw.question === undefined ? question : raw.question,
  };
  if (Array.isArray(raw.facts)) {
    lifted.facts = raw.facts.map((fact) => {
      if (!compactFact(fact)) return fact;
      const { quote, ...rest } = fact as Record<string, unknown> & { quote: string };
      const start = quote === "" ? -1 : question.indexOf(quote);
      return {
        ...rest,
        evidence: start < 0
          ? { source: "question", quote }
          : { source: "question", start, end: start + quote.length, quote },
      };
    });
  }
  if (Array.isArray(raw.expressions)) {
    lifted.expressions = raw.expressions.map((expression) => {
      if (!compactExpression(expression)) return expression;
      const { expr, ...rest } = expression as Record<string, unknown> & { expr: string };
      const root = parseInfixExpression(expr);
      return root ? { ...rest, root } : rest;
    });
  }
  if (Array.isArray(raw.solveRequests)) {
    lifted.solveRequests = raw.solveRequests.map((request) => {
      if (!isRecord(request) || request.kind !== "definite_integral") return request;
      const next: Record<string, unknown> = { ...request };
      for (const key of ["lower", "upper", "lowerBound", "upperBound"]) {
        if (typeof next[key] === "string") next[key] = parseInfixExpression(next[key] as string) ?? next[key];
      }
      return next;
    });
  }
  return lifted;
}

const PROBLEM_IR_SCHEMA_VERSION = "problem-ir/v1";

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
 * BENCH ONLY. Join a question-alone ProblemIR to a turn plan that finished
 * afterwards; the live hook never calls this.
 *
 * A binding is renamed to a plan unknown only when its normalized symbol and
 * unit match exactly one unknown and no other binding claims that unknown.
 * Anything ambiguous loses its binding, which audits as `incomplete` (an
 * absent second opinion), never as a contradiction.
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
/**
 * A recursion guard for the parser only: it bounds parentheses, calls, signs
 * and exponents. It is not ProblemIR's depth rule. The validator's 24 level
 * AST ceiling also counts operator chains, so a long flat sum parses here and
 * is then dropped by the normalizer, exactly as its canonical AST would be.
 */
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
    .replace(/π/g, " pi ")
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
  // `nesting` counts parentheses, calls, signs and exponents. Operator chains
  // are bounded by the length cap here and by the validator's depth rule.
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

For a source-explicit ideal DC network, dc_network computes node voltages and signed branch currents from Kirchhoff laws, not a closed guessed current expression. Request shape:
{ id, kind:"dc_network", network:{model:"ideal_dc",modelFactId,nodes:[point entity ids],referenceNode,referenceFactId:optional source zero-reference fact,branches:[{id:component entity id,kind:"resistor|voltage_source|current_source|wire|open",from:node id,to:node id,connectionConstraintId,lawFactId,quantityExpressionId,quantityFactId,unit}]}, output:{kind:"node_voltage|branch_current",id:node or component id}, resultBinding }.
DC authority is bounded to a complete supported assertion document, not isolated matching fragments. The original question must consist entirely of: an ideal DC model plus a Nodes declaration (or the combined "An ideal DC circuit has nodes ..." header); named component connects node to node clauses; named resistance equations; oriented V(node)-V(node)=decimal unit or I(node->node)=decimal unit equations immediately after their named connection; optional V(node)=0 V reference; and optional "Find current symbol through component" requests, separated by periods, semicolons or commas. A connection may explicitly append ", not excludedNode" only when the excluded node is declared and differs from both actual endpoints; quote its positive relation. Every declared node, component connection and law must be accounted for exactly once. Unsupported surrounding prose, quoted statements, hypothetical/false-statement contexts, omitted components and conflicting/duplicate declarations leave the request unresolved. Never rewrite the question, remove context or upgrade a given/assumption tag into source authority. This bounded syntax is not general English support or full scene/cohort readiness.
Model fact must quote the explicit ideal DC assumption. Each component/node connection requires a source-grounded connected constraint with exactly [component,from,to] entity IDs. Every connection evidence fact must quote the positive clause "componentLabel connects nodeLabel to nodeLabel" (optional matching Component/Resistor/Wire/Switch/Source prefix), with either endpoint order. Mentioning all three names, excluded endpoints, or an unsupported clause cannot establish connectivity. Extract a positively stated complete relation from the source or leave the request unresolved; never invent it. Do not infer connections from a missing figure, proximity, circuit names or an assumed topology. The declared reference node is a coordinate convention; source polarity is not. A bound node-voltage answer additionally requires referenceFactId quoting V(reference)=0 V from the source; an arbitrary zero may only support unbound intermediate relative coordinates.
Each nontrivial component requires its own given quantity fact quoting only the complete numeric literal and case-sensitive unit. Its scalar number expression is the SI conversion of that supplied literal, not a derived model value. Supported units: ohm/Ω,kohm/kΩ,Mohm/MΩ for resistance; V,mV for voltage; A,mA,µA for current. Resistance must be positive. No default sources or values.
The source lawFactId must quote an explicit equation with source entity labels (or IDs): a resistor's label=given literal/unit; V(from)-V(to)=given voltage; I(from->to)=given current. Wire/open laws respectively require V(from)-V(to)=0 V or I(from->to)=0 A and omit quantityExpressionId/quantityFactId/unit. Never invent those equations when source polarity or connectivity is ambiguous. Branch current is positive from the declared from node to the to node. Bind outputs in SI A or V. Bounds: 2–16 nodes,1–32 branches,at most32 nodal/current unknowns; nonzero SI input/result magnitude1e-12–1e12. Missing assumptions, source laws or unsupported domain/model must remain unresolved rather than fabricated.

Every solve request that computes a numeric TurnPlan unknown MUST include resultBinding with the exact unknown id, exact symbol, exact unit when present, and evidenceFactIds naming the requested fact. Do not infer or rename TurnPlan ids. When the TurnPlan says none, choose a short id, the conventional symbol and the SI unit yourself.
All ids are short alphanumeric camelCase identifiers beginning with a letter.`;
