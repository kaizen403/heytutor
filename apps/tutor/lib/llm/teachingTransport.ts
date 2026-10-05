import {
  resolveReasoningEffort,
  type ReasoningEffort,
  type ReasoningMode,
} from "@heytutor/tutor-core";
import {
  DEFAULT_TEACHING_FAST_MODEL,
  DEFAULT_TEACHING_MODEL,
  DEFAULT_TEACHING_RETRY_MODEL,
  resolveTeachingAlternateFireworksModel,
  resolveTeachingFireworksModel,
} from "./fireworksModels";

export { DEFAULT_TEACHING_FAST_MODEL, DEFAULT_TEACHING_MODEL, DEFAULT_TEACHING_RETRY_MODEL };
const DEFAULT_TEACHING_CONNECT_TIMEOUT_MS = 25_000;
export const DEFAULT_TEACHING_MAX_TOKENS = 3600;
export const TEACHING_TOKEN_CEILING = 6_000;
/**
 * A 6–10 minute code lesson is ~16–24 spoken steps plus a [TYPE] per block.
 * The ordinary 3600 ceiling cuts that mid-walk and forces a "continue" gap.
 */
export const CODE_LESSON_TEACHING_MAX_TOKENS = 12_000;

/**
 * Token budget for the spoken teaching stream. A global FIREWORKS_MAX_TOKENS
 * of 3600 must not cap a DSA lesson — that is what made balloon / subsequence
 * turns stop at exactly 3600 completion tokens and go quiet until "continue".
 */
export function resolveTeachingContentBudget(options: {
  codeLesson?: boolean;
  env?: Record<string, string | undefined>;
} = {}): number {
  if (options.codeLesson) {
    return CODE_LESSON_TEACHING_MAX_TOKENS;
  }
  const configured = Number.parseInt(options.env?.FIREWORKS_MAX_TOKENS ?? "", 10);
  if (Number.isFinite(configured)) {
    return Math.min(Math.max(configured, 1200), TEACHING_TOKEN_CEILING);
  }
  return DEFAULT_TEACHING_MAX_TOKENS;
}

export async function fetchTeachingCompletion(options: {
  fetchImpl?: typeof fetch;
  init: RequestInit;
  signal?: AbortSignal;
  timeoutMs?: number;
  url: string;
}): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(new DOMException("Teaching connection timed out", "TimeoutError")),
    Math.max(1, options.timeoutMs ?? DEFAULT_TEACHING_CONNECT_TIMEOUT_MS),
  );
  const signal = options.signal
    ? mergeAbortSignals(options.signal, timeoutController.signal)
    : timeoutController.signal;
  try {
    return await (options.fetchImpl ?? fetch)(options.url, {
      ...options.init,
      signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function resolveTeachingModel(
  env: Record<string, string | undefined> = process.env,
  options: { fastMode?: boolean } = {},
): string {
  return resolveTeachingFireworksModel({
    fastMode: options.fastMode,
    env,
  });
}

/**
 * Sent only by the client's startup retry: the turn's first teaching request
 * timed out before a usable step, or spoke nothing but reasoning. The value is
 * that reason. `x-heytutor-reasoning-retry` keeps its own meaning (reasoning
 * off) and is also sent by the hedge, so it cannot mark a stall on its own.
 */
export const TEACHING_STARTUP_RETRY_HEADER = "x-heytutor-startup-retry";

export type TeachingStartupRetryReason = "first_content_timeout" | "reasoning_only";

export function readTeachingStartupRetry(headers: Headers): TeachingStartupRetryReason | null {
  const value = headers.get(TEACHING_STARTUP_RETRY_HEADER);
  return value === "first_content_timeout" || value === "reasoning_only" ? value : null;
}

export type TeachingModelFallbackReason =
  | `startup_retry_${TeachingStartupRetryReason}`
  | "upstream_connect_failure";

export interface TeachingModelRoute {
  /** The deployment the first upstream attempt calls. */
  model: string;
  /** Called on the last network retry when every earlier attempt failed to connect. */
  alternate: string | null;
  /** Set when `model` is already the alternate deployment. */
  fallbackReason: TeachingModelFallbackReason | null;
}

/**
 * Which teaching deployment each upstream attempt calls.
 *
 * A Fast mode startup retry skips the router that just stalled and runs on
 * the standard deployment, whatever the stall reason: a reasoning-only retry
 * runs with thinking off either way, so the deployment change costs nothing.
 * It gets no alternate of its own; the router is what it is escaping.
 */
export function resolveTeachingModelRoute(
  env: Record<string, string | undefined> = process.env,
  options: { fastMode?: boolean; startupRetry?: TeachingStartupRetryReason | null } = {},
): TeachingModelRoute {
  const model = resolveTeachingModel(env, { fastMode: options.fastMode });
  const alternate = resolveTeachingAlternateFireworksModel({ fastMode: options.fastMode, env });
  if (!alternate || alternate === model) return { model, alternate: null, fallbackReason: null };
  if (options.startupRetry) {
    return { model: alternate, alternate: null, fallbackReason: `startup_retry_${options.startupRetry}` };
  }
  return { model, alternate, fallbackReason: null };
}

/**
 * Whether a failed upstream attempt may be retried before any content: a
 * connection failure (no response) or a provider 5xx. A 4xx is the request's
 * own fault and would fail the same way anywhere.
 */
export function isRetryableTeachingFailure(response: Response | null): boolean {
  return response === null || response.status >= 500;
}

/**
 * The deployment for upstream attempt `attempt` (0 based) of `attempts`. The
 * last attempt moves to the alternate only when every earlier one failed to
 * connect; a stream that started is never retried at all.
 */
export function teachingAttemptModel(
  route: TeachingModelRoute,
  attempt: number,
  attempts: number,
): string {
  return route.alternate && attempt === attempts - 1 && attempt > 0 ? route.alternate : route.model;
}

/**
 * TurnPlanV3 already did the mathematical work. Repeating hidden reasoning in
 * the narration pass adds tens of seconds of silence and can contradict the
 * audited plan. Unplanned fallback turns retain the ordinary classifier.
 */
export function resolveTeachingReasoningEffort(options: {
  question: string;
  hasAuthoritativePlan: boolean;
  mode: ReasoningMode;
  /** A DSA turn: the program is committed and the lesson shape is given. */
  codeLesson?: boolean;
  /**
   * The previous attempt spent its whole allowance reasoning and spoke
   * nothing. The retry must speak: 2 of 33 chemistry lessons came back
   * empty because the retry reasoned again, while the student watched a
   * blank board for 70 to 110 seconds.
   */
  afterReasoningOnly?: boolean;
}): ReasoningEffort {
  if (options.afterReasoningOnly) return "none";
  // Measured 5 Sep 2026: a thinking budget on the teaching pass moved the
  // first spoken word from 1.1s to 9.0s, and the student watches a thinking
  // overlay for all of it. The lesson's structure now comes from the beat
  // plan rather than from the model working it out, so the budget buys
  // latency and little else.
  if (options.codeLesson) return "none";
  if (options.hasAuthoritativePlan) return "none";
  return resolveReasoningEffort(options.question, options.mode);
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
