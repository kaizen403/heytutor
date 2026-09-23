import { calculateLlmCostDetails } from "@/lib/obs/usageCost";
import { evaluationInputHash } from "./lessonReviewState";
import {
  flagsFromLessonAnswers,
  notesDecisionFromAnswers,
  questionsForJob,
  rubricVersionForJob,
} from "./rubrics";
import {
  EVALUATION_POLICY_VERSION,
  JEV_EVALUATE_URL,
  JEV_GATEWAY_MODEL,
  type AssessOptions,
  type EvaluationProvenance,
  type EvaluationQuestion,
  type NormalizedAnswer,
  type TutorAssessment,
  type TutorEvaluationRequest,
} from "./types";

const CIRCUIT_FAILURES = 3;
const CIRCUIT_OPEN_MS = 60_000;
const DEFAULT_DEADLINE_MS = 300;

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export function resetEvaluationCircuitForTests(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function noteFailure(now: number): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAILURES) {
    circuitOpenUntil = now + CIRCUIT_OPEN_MS;
    consecutiveFailures = 0;
  }
}

function noteSuccess(): void {
  consecutiveFailures = 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unitInterval(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

function readDistribution(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const distribution: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    const probability = unitInterval(entry);
    if (probability === null) return null;
    distribution[key] = probability;
  }
  return distribution;
}

function normalizeAnswer(question: EvaluationQuestion, value: unknown): NormalizedAnswer | null {
  if (!isRecord(value) || value.type !== question.type) return null;
  if (question.type === "boolean") {
    const probability = unitInterval(value.probability);
    return probability === null ? null : { type: "boolean", probability };
  }
  if (question.type === "choice") {
    if (typeof value.choice !== "string" || !(value.choice in question.criteria)) return null;
    const probabilities = value.probabilities == null ? null : readDistribution(value.probabilities);
    if (value.probabilities != null && probabilities === null) return null;
    return { type: "choice", choice: value.choice, probabilities };
  }
  const score = typeof value.score === "number" && Number.isFinite(value.score) ? value.score : null;
  if (score === null || score < 0 || score > question.criteria.length - 1) return null;
  const probabilities = value.probabilities == null ? null : readDistribution(value.probabilities);
  if (value.probabilities != null && probabilities === null) return null;
  return { type: "score", score, probabilities };
}

function normalizeAnswers(
  questions: Record<string, EvaluationQuestion>,
  value: unknown,
): Record<string, NormalizedAnswer> | null {
  if (!isRecord(value)) return null;
  const answers: Record<string, NormalizedAnswer> = {};
  for (const [key, question] of Object.entries(questions)) {
    const answer = normalizeAnswer(question, value[key]);
    if (!answer) return null;
    answers[key] = answer;
  }
  return answers;
}

function readReportedCost(metadata: unknown): { cost: number | null; generationId: string | null; model: string | null } {
  if (!isRecord(metadata)) return { cost: null, generationId: null, model: null };
  const gateway = isRecord(metadata.gateway) ? metadata.gateway : null;
  const rawCost = gateway?.cost;
  const parsed = typeof rawCost === "string" || typeof rawCost === "number" ? Number(rawCost) : Number.NaN;
  return {
    cost: Number.isFinite(parsed) ? parsed : null,
    generationId: typeof gateway?.generationId === "string" ? gateway.generationId : null,
    model: null,
  };
}

function resolveApiKey(explicit: string | null | undefined): string | null {
  if (explicit === null) return null;
  const value = (explicit ?? process.env.AI_GATEWAY_API_KEY)?.trim();
  return value ? value : null;
}

function unavailable(job: TutorEvaluationRequest["job"], reason: string): TutorAssessment {
  return { status: "unavailable", job, reason };
}

function mergeSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
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
 * One evaluation call. Invalid answers, timeouts, and a missing key become
 * `unavailable`. Callers keep the existing model path in that case.
 */
export async function assessTutorState(
  request: TutorEvaluationRequest,
  options: AssessOptions = {},
): Promise<TutorAssessment> {
  const now = Date.now();
  if (options.circuit && now < circuitOpenUntil) {
    return unavailable(request.job, "circuit_open");
  }
  if (options.signal?.aborted) {
    return unavailable(request.job, "aborted");
  }

  const apiKey = resolveApiKey(options.apiKey);
  if (!apiKey) {
    return unavailable(request.job, "missing_key");
  }

  const questions = questionsForJob(request.job);
  const model = options.model?.trim() || JEV_GATEWAY_MODEL;
  const body = {
    model,
    state: request.state,
    questions,
    providerOptions: {
      gateway: {
        zeroDataRetention: options.zeroDataRetention !== false,
        disallowPromptTraining: true,
        only: ["typesafe-ai"],
      },
    },
  };
  const inputHash = evaluationInputHash({
    model,
    rubric: rubricVersionForJob(request.job),
    policy: EVALUATION_POLICY_VERSION,
    state: request.state,
    questions,
  });

  const deadline = new AbortController();
  const deadlineMs = Math.max(1, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const deadlineId = setTimeout(() => {
    deadline.abort(new DOMException("Evaluation deadline exceeded", "TimeoutError"));
  }, deadlineMs);
  const signal = options.signal ? mergeSignals(options.signal, deadline.signal) : deadline.signal;
  const started = Date.now();

  try {
    const response = await (options.fetchImpl ?? fetch)(options.endpoint ?? JEV_EVALUATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      if (options.circuit) noteFailure(Date.now());
      const reason = response.status === 401 ? "auth" : response.status === 429 ? "rate_limited" : `http_${response.status}`;
      return unavailable(request.job, reason);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      if (options.circuit) noteFailure(Date.now());
      return unavailable(request.job, "schema");
    }
    const answers = normalizeAnswers(questions, payload.answers);
    if (!answers) {
      if (options.circuit) noteFailure(Date.now());
      return unavailable(request.job, "schema");
    }
    if (options.circuit) noteSuccess();

    const usageRecord = isRecord(payload.usage) ? payload.usage : {};
    const inputTokens = typeof usageRecord.inputTokens === "number" ? usageRecord.inputTokens : 0;
    const outputTokens = typeof usageRecord.outputTokens === "number" ? usageRecord.outputTokens : 0;
    const reported = readReportedCost(payload.providerMetadata);
    const estimatedUsd = calculateLlmCostDetails(
      { input: inputTokens, output: outputTokens },
      { model },
    ).total ?? 0;
    const provenance: EvaluationProvenance = {
      model,
      rubricVersion: rubricVersionForJob(request.job),
      policyVersion: EVALUATION_POLICY_VERSION,
      inputHash,
      latencyMs: Date.now() - started,
      gatewayModel: typeof payload.model === "string" ? payload.model : null,
      generationId: reported.generationId,
    };
    const decision = request.job === "notes_routing" ? notesDecisionFromAnswers(answers) : null;
    return {
      status: "assessed",
      job: request.job,
      answers,
      flags: request.job === "lesson_review" ? flagsFromLessonAnswers(answers) : [],
      decision,
      useCheapGenerator: decision === "cheap_explanation",
      provenance,
      usage: {
        inputTokens,
        outputTokens,
        reportedCostUsd: reported.cost,
        estimatedUsd,
      },
    };
  } catch {
    const callerAborted = options.signal?.aborted === true;
    const timedOut = deadline.signal.aborted && !callerAborted;
    if (options.circuit && !callerAborted) noteFailure(Date.now());
    return unavailable(request.job, callerAborted ? "aborted" : timedOut ? "deadline" : "transport");
  } finally {
    clearTimeout(deadlineId);
  }
}
