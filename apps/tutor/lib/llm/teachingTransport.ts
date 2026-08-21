import {
  resolveReasoningEffort,
  type ReasoningEffort,
  type ReasoningMode,
} from "@heytutor/tutor-core";

export const DEFAULT_TEACHING_MODEL = "accounts/fireworks/routers/kimi-k2p6-turbo";
export const DEFAULT_TEACHING_CONNECT_TIMEOUT_MS = 25_000;

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
): string {
  return env.FIREWORKS_TEACHING_MODEL ??
    env.FIREWORKS_MODEL ??
    DEFAULT_TEACHING_MODEL;
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
}): ReasoningEffort {
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
