import { resolveFireworksModels } from "./fireworksModels";

const TRANSIENT_PLANNER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
/** Retired or undeployed model IDs. Skip to the next model; do not retry the same one. */
const MODEL_UNAVAILABLE_STATUSES = new Set([404, 410]);
const unavailableModels = new Set<string>();

const DEFAULT_TURN_PLAN_MAX_TOKENS = 2800;
const DEFAULT_PROBLEM_IR_MAX_TOKENS = 3600;
const DEFAULT_SCENE_PLANNER_MAX_TOKENS = 4800;
const DEFAULT_ALTERNATE_SCENE_MAX_TOKENS = 5200;

type PlannerPhase = "plan" | "repair";
type PlannerLane = "primary" | "alternate";

export interface PlannerModelOptions {
  semanticSceneV2: boolean;
  turnPlanV3: boolean;
  problemIRV1?: boolean;
  plannerPhase: PlannerPhase;
  plannerLane?: PlannerLane;
  fastMode?: boolean;
  env?: Record<string, string | undefined>;
}

export interface PlannerRetryEvent {
  attempt: number;
  delayMs: number;
  message?: string;
  model: string;
  modelAttempt: number;
  status?: number;
}

export interface PlannerTransportOptions {
  apiKey: string;
  /** Maximum time for one upstream model attempt to return response headers. */
  attemptTimeoutMs?: number;
  body: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  maxAttemptsPerModel?: number;
  maxRetryDelayMs?: number;
  models: readonly string[];
  onRetry?: (event: PlannerRetryEvent) => void;
  signal?: AbortSignal;
  sleep?: (delayMs: number) => Promise<void>;
  url: string;
}

export interface PlannerTransportResult {
  attemptCount: number;
  model: string;
  response: Response;
}

export function resolvePlannerMaxTokens(options: PlannerModelOptions): number {
  const env = options.env ?? process.env;
  if (options.problemIRV1) {
    const parsed = Number.parseInt(
      env.FIREWORKS_PROBLEM_IR_MAX_TOKENS ?? `${DEFAULT_PROBLEM_IR_MAX_TOKENS}`,
      10,
    );
    return Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 2400), 5000)
      : DEFAULT_PROBLEM_IR_MAX_TOKENS;
  }
  if (options.turnPlanV3) {
    const configured = options.plannerLane === "alternate"
      ? env.FIREWORKS_TURN_PLANNER_ALTERNATE_MAX_TOKENS
      : env.FIREWORKS_TURN_PLANNER_MAX_TOKENS;
    const parsed = Number.parseInt(configured ?? `${DEFAULT_TURN_PLAN_MAX_TOKENS}`, 10);
    return Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1800), 4000)
      : DEFAULT_TURN_PLAN_MAX_TOKENS;
  }
  const configured = options.semanticSceneV2 && options.plannerLane === "alternate"
    ? env.FIREWORKS_SCENE_ALTERNATE_MAX_TOKENS
    : env.FIREWORKS_SCENE_PLANNER_MAX_TOKENS;
  const fallback = options.semanticSceneV2 && options.plannerLane === "alternate"
    ? DEFAULT_ALTERNATE_SCENE_MAX_TOKENS
    : DEFAULT_SCENE_PLANNER_MAX_TOKENS;
  const parsed = Number.parseInt(configured ?? `${fallback}`, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1800), 6000) : fallback;
}

function uniqueModels(models: readonly string[]): string[] {
  return [...new Set(models)];
}

/** One ENV-owned model for every planner lane. */
export function resolvePlannerModels(options: PlannerModelOptions): string[] {
  return resolveFireworksModels({
    fastMode: options.fastMode,
    env: options.env,
  });
}

function retryAfterMs(response: Response, nowMs: number, maxDelayMs: number): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;

  const seconds = Number(value);
  const unboundedDelay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value) - nowMs;

  if (!Number.isFinite(unboundedDelay)) return null;
  return Math.min(Math.max(0, Math.round(unboundedDelay)), maxDelayMs);
}

function defaultRetryDelayMs(attempt: number, maxDelayMs: number): number {
  return Math.min(250 * attempt, maxDelayMs);
}

async function retainResponse(response: Response): Promise<Response> {
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Fetch a planner completion, retrying only transport failures and transient
 * upstream statuses. The final upstream response is returned untouched so the
 * route can preserve its status, body, and trace behavior.
 */
export async function fetchPlannerCompletion(
  options: PlannerTransportOptions,
): Promise<PlannerTransportResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const attemptsPerModel = Math.max(1, Math.floor(options.maxAttemptsPerModel ?? 2));
  const attemptTimeoutMs = Math.max(1, Math.floor(options.attemptTimeoutMs ?? 25_000));
  const maxRetryDelayMs = Math.max(0, Math.floor(options.maxRetryDelayMs ?? 2000));
  const models = uniqueModels(options.models.map((model) => model.trim()).filter(Boolean))
    .filter((model) => !unavailableModels.has(model));
  if (models.length === 0) throw new Error("planner transport requires at least one model");

  const totalAttempts = models.length * attemptsPerModel;
  let attempt = 0;
  let lastError: unknown = null;
  let lastResponse: { model: string; response: Response } | null = null;

  for (const model of models) {
    for (let modelAttempt = 1; modelAttempt <= attemptsPerModel; modelAttempt += 1) {
      if (options.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException("Planner request aborted", "AbortError");
      }
      attempt += 1;
      const attemptController = new AbortController();
      const timeoutId = setTimeout(
        () => attemptController.abort(new DOMException("Planner attempt timed out", "TimeoutError")),
        attemptTimeoutMs,
      );
      const signal = options.signal
        ? mergeAbortSignals(options.signal, attemptController.signal)
        : attemptController.signal;
      try {
        const response = await fetchImpl(options.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...options.body, model }),
          signal,
        });
        clearTimeout(timeoutId);

        if (MODEL_UNAVAILABLE_STATUSES.has(response.status)) {
          unavailableModels.add(model);
          lastResponse = { response: await retainResponse(response), model };
          break;
        }

        if (!TRANSIENT_PLANNER_STATUSES.has(response.status)) {
          return { response, model, attemptCount: attempt };
        }

        if (attempt === totalAttempts) {
          return { response, model, attemptCount: attempt };
        }

        // Retain a readable copy in case every later fallback fails at the
        // network layer and this is the best upstream error we can return.
        lastResponse = { response: await retainResponse(response), model };
        const delayMs =
          retryAfterMs(response, Date.now(), maxRetryDelayMs) ??
          defaultRetryDelayMs(attempt, maxRetryDelayMs);
        options.onRetry?.({ attempt, delayMs, model, modelAttempt, status: response.status });
        await sleep(delayMs);
      } catch (error: unknown) {
        clearTimeout(timeoutId);
        lastError = error;
        if (options.signal?.aborted) {
          throw options.signal.reason instanceof Error
            ? options.signal.reason
            : new DOMException("Planner request aborted", "AbortError");
        }
        if (attempt === totalAttempts) break;

        const delayMs = defaultRetryDelayMs(attempt, maxRetryDelayMs);
        options.onRetry?.({
          attempt,
          delayMs,
          model,
          modelAttempt,
          message: error instanceof Error ? error.message : String(error),
        });
        await sleep(delayMs);
      }
    }
  }

  if (lastResponse) {
    return {
      response: lastResponse.response,
      model: lastResponse.model,
      attemptCount: attempt,
    };
  }

  throw lastError instanceof Error ? lastError : new Error("planner fetch failed");
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
