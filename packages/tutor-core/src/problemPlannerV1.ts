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
import { tutorDebug } from "./tutorDebug";

const PROBLEM_PLANNER_MODEL = "accounts/fireworks/routers/kimi-k2p6-turbo";

export interface ProblemPlannerV1Options {
  proxyUrl: string;
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  provider?: SolverProvider;
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

export async function planAndSolveProblemV1(
  question: string,
  turnPlan: TurnPlanV3,
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
      headers: {
        "content-type": "application/json",
        "x-planner": "1",
        "x-problem-ir-version": "1",
        "x-planner-deadline-ms": String(options.timeoutMs),
        ...(options.sessionId ? { "x-session-id": options.sessionId } : {}),
      },
      signal,
      body: JSON.stringify({
        model: PROBLEM_PLANNER_MODEL,
        max_tokens: 3600,
        temperature: 0,
        stream: false,
        messages: [
          { role: "system", content: PROBLEM_IR_V1_PROMPT },
          {
            role: "user",
            content: `SUBMITTED QUESTION\n${question}\n\nVALIDATED TURN PLAN V3\n${JSON.stringify(turnPlan)}`,
          },
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
    const audit = verifyTurnPlanAgainstSolver(
      problemValidation.problem,
      solverValidation.result,
      turnPlan,
      question,
    );
    return {
      problemIR: problemValidation.problem,
      solverResult: solverValidation.result,
      audit,
      projection: audit.status === "verified"
        ? buildSolverAuthorityProjection(problemValidation.problem, solverValidation.result, audit)
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
  raw: unknown,
  question: string,
  turnPlan: TurnPlanV3,
): unknown {
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
  turnPlan: TurnPlanV3,
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
  turnPlan: TurnPlanV3,
): Record<string, unknown> | null {
  if (!isRecord(raw) || typeof raw.turnPlanQuantityId !== "string" || typeof raw.symbol !== "string") {
    return null;
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

const PROBLEM_IR_V1_PROMPT = `You are the topic-neutral formulation planner for a verified teaching engine.
Return exactly one JSON object matching problem-ir/v1. Never return prose or markdown.

Use only facts grounded by exact character spans from SUBMITTED QUESTION. Copy the submitted question exactly into question.
Represent mathematics as the typed AST; never emit code, executable strings, pixels, or drawing commands.
Allowed AST nodes: number, constant(pi|e), variable, unary(+|-), binary(+|-|*|/|^), call(sin|cos|tan|asin|acos|atan|sqrt|abs|exp|log|ln).
Allowed solve requests: evaluate, roots, intersections, definite_integral.
Use evaluate for any requested scalar that can be written as a closed numeric AST after substituting the givens.
Do not invent a solve request for a law or assumption not justified by the submitted question and validated TurnPlan.

Every solve request that computes a numeric TurnPlan unknown MUST include resultBinding:
{ "turnPlanQuantityId": exact unknown id, "symbol": exact unknown symbol, "unit": exact unknown unit when present, "evidenceFactIds": [requested fact ids] }.
Do not infer or rename TurnPlan ids. Intermediary roots/intersections used only for a representation may omit resultBinding.
All fact/entity/expression/constraint/intent/request ids are short alphanumeric identifiers beginning with a letter or underscore-free camelCase.

Required root fields:
{
  "schemaVersion":"problem-ir/v1",
  "id":"shortId",
  "question":"exact submitted question",
  "facts":[{"id":"...","kind":"given|requested|assumption","statement":"...","evidence":{"source":"question","start":0,"end":1,"quote":"exact substring"}}],
  "entities":[{"id":"...","kind":"point|line|curve|region|body|solid|component|field|state|other","label":"optional","evidenceFactIds":["..."]}],
  "expressions":[{"id":"...","valueType":"scalar|function","root":{"kind":"number","value":1},"evidenceFactIds":["..."]}],
  "constraints":[],
  "representationIntents":[{"id":"...","kind":"graph|bounded_region|section|solid|network|apparatus|free_body|field|conceptual","entityIds":["..."],"evidenceFactIds":["..."]}],
  "solveRequests":[]
}`;
