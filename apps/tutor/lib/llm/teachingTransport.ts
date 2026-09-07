import {
  resolveReasoningEffort,
  type ReasoningEffort,
  type ReasoningMode,
} from "@heytutor/tutor-core";
import {
  DEFAULT_TEACHING_FAST_MODEL,
  DEFAULT_TEACHING_MODEL,
  resolveTeachingFireworksModel,
} from "./fireworksModels";

export { DEFAULT_TEACHING_FAST_MODEL, DEFAULT_TEACHING_MODEL };
export const DEFAULT_TEACHING_CONNECT_TIMEOUT_MS = 25_000;
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
}): ReasoningEffort {
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
