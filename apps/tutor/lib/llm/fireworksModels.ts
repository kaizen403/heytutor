/** Planner and generic Fireworks calls. Change models in ENV, not in call sites. */
export const DEFAULT_FIREWORKS_MODEL =
  "accounts/fireworks/models/kimi-k3";

/** Fireworks Fast serving path for planners. Same Kimi K3 weights, higher tok/s. */
export const DEFAULT_FIREWORKS_FAST_MODEL =
  "accounts/fireworks/routers/kimi-k3-fast";

/**
 * Spoken teaching and notes-chat. Kimi K3, the same weights the planners use.
 *
 * The lane stays split so teaching can move to a cheaper model on its own, but
 * the replacement must accept `thinking: { type: "disabled" }`: a planned turn
 * always asks for no reasoning (see `resolveTeachingReasoningEffort`). The GLM
 * 5.3 family is thinking-only and answers that request with a 400, which kills
 * the lesson before the tutor speaks.
 */
export const DEFAULT_TEACHING_MODEL =
  "accounts/fireworks/models/kimi-k3";

/** Fireworks Fast serving path for teaching. Same Kimi K3 weights. */
export const DEFAULT_TEACHING_FAST_MODEL =
  "accounts/fireworks/routers/kimi-k3-fast";

/**
 * Problem IR only. Independent of Fast mode, FIREWORKS_MODEL, and teaching.
 * Compact JSON formulation, not spoken teaching.
 *
 * Kimi K3 Fast in both modes. Measured 4 Oct 2026 on the compact wire format:
 * p50 3.9s and max 4.8s over 15 calls against DeepSeek V4.1 Flash's p50 6.9s
 * with a 13 tok/s episode that ran 35 to 40s, and the two-loop Kirchhoff
 * formula right 3 of 3 times against DeepSeek's 0 of 5.
 */
export const DEFAULT_PROBLEM_IR_MODEL =
  "accounts/fireworks/routers/kimi-k3-fast";

/**
 * The cheap lane: notes chat when the cheap cohort or Jev picks it. This was
 * the Problem IR default until Problem IR moved to Kimi K3 Fast.
 */
export const DEFAULT_CHEAP_FIREWORKS_MODEL =
  "accounts/fireworks/models/deepseek-v4p1-flash";

/**
 * Cheapest Fireworks model that accepts images. Teaching stays on
 * `FIREWORKS_TEACHING_MODEL`; OCR has its own lane.
 */
export const DEFAULT_FIREWORKS_VISION_MODEL =
  "accounts/fireworks/models/qwen3p7-plus";

function trimModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Fast serving is a per-lane router ID. A configured override wins whenever
 * Fast mode is not explicitly off. The built-in Fast SKU is used only when
 * Fast mode is on and no override is set, so board-name / unlabeled calls
 * stay on the standard model.
 */
function resolveLaneFastModel(
  configured: string | undefined,
  fallback: string,
  fastMode?: boolean,
): string | undefined {
  if (fastMode === false) {
    return undefined;
  }
  const override = trimModel(configured);
  if (override) {
    return override;
  }
  if (fastMode === true) {
    return fallback;
  }
  return undefined;
}

/**
 * Resolve the Fireworks model for planners and generic calls.
 *
 * - `FIREWORKS_MODEL` is the only model when Fast mode is off.
 * - Fast mode uses `FIREWORKS_FAST_MODEL`, then Kimi K3 Fast.
 * - `FIREWORKS_TEACHING_MODEL` never leaks into planners.
 */
export function resolveFireworksModel(options: {
  fastMode?: boolean;
  env?: Record<string, string | undefined>;
} = {}): string {
  const env = options.env ?? process.env;
  return (
    resolveLaneFastModel(
      env.FIREWORKS_FAST_MODEL,
      DEFAULT_FIREWORKS_FAST_MODEL,
      options.fastMode,
    ) ||
    trimModel(env.FIREWORKS_MODEL) ||
    DEFAULT_FIREWORKS_MODEL
  );
}

/**
 * Spoken teaching only.
 *
 * - `FIREWORKS_TEACHING_MODEL` wins when Fast mode is off.
 * - Fast mode uses `FIREWORKS_TEACHING_FAST_MODEL`, then GLM 5.3 Fast.
 * - `FIREWORKS_MODEL` / `FIREWORKS_FAST_MODEL` stay on planners.
 */
export function resolveTeachingFireworksModel(options: {
  fastMode?: boolean;
  env?: Record<string, string | undefined>;
} = {}): string {
  const env = options.env ?? process.env;
  return (
    resolveLaneFastModel(
      env.FIREWORKS_TEACHING_FAST_MODEL,
      DEFAULT_TEACHING_FAST_MODEL,
      options.fastMode,
    ) ||
    trimModel(env.FIREWORKS_TEACHING_MODEL) ||
    DEFAULT_TEACHING_MODEL
  );
}

/**
 * The teaching deployment a stalled Fast router falls back to: the standard
 * serverless Kimi K3. Same weights, a separate serving path. Measured 6 Oct
 * 2026: the Kimi K3 Fast router stalled for about a minute, and the startup
 * retry went back to the same router and failed the lesson.
 */
export const DEFAULT_TEACHING_RETRY_MODEL = DEFAULT_TEACHING_MODEL;

/**
 * The alternate teaching deployment, or null when there is none.
 *
 * Only a Fast lane teaching call has one: it falls back to
 * `FIREWORKS_TEACHING_RETRY_MODEL`, then standard Kimi K3. With Fast mode off
 * the call already runs on the standard path the student chose, and the
 * router costs more, so it keeps today's single deployment.
 */
export function resolveTeachingAlternateFireworksModel(options: {
  fastMode?: boolean;
  env?: Record<string, string | undefined>;
} = {}): string | null {
  const env = options.env ?? process.env;
  const fastLane = resolveLaneFastModel(
    env.FIREWORKS_TEACHING_FAST_MODEL,
    DEFAULT_TEACHING_FAST_MODEL,
    options.fastMode,
  );
  if (!fastLane) return null;
  const alternate = trimModel(env.FIREWORKS_TEACHING_RETRY_MODEL) || DEFAULT_TEACHING_RETRY_MODEL;
  return alternate === fastLane ? null : alternate;
}

export function resolveFireworksModels(options: {
  fastMode?: boolean;
  env?: Record<string, string | undefined>;
} = {}): string[] {
  return [resolveFireworksModel(options)];
}

/** Image-question OCR only. Never used for teaching or planners. */
export function resolveFireworksVisionModel(
  env: Record<string, string | undefined> = process.env,
): string {
  return trimModel(env.FIREWORKS_VISION_MODEL) || DEFAULT_FIREWORKS_VISION_MODEL;
}

/**
 * Problem IR (`x-problem-ir-version: 1`) only.
 *
 * - `FIREWORKS_PROBLEM_IR_MODEL` or Kimi K3 Fast.
 * - Ignores Fast mode, `FIREWORKS_MODEL`, `FIREWORKS_FAST_MODEL`, and teaching env.
 */
export function resolveProblemIRFireworksModel(options: {
  env?: Record<string, string | undefined>;
} = {}): string {
  const env = options.env ?? process.env;
  return trimModel(env.FIREWORKS_PROBLEM_IR_MODEL) || DEFAULT_PROBLEM_IR_MODEL;
}

/**
 * The cheap notes model, resolved exactly as it was while it shared Problem
 * IR's resolver: `FIREWORKS_PROBLEM_IR_MODEL` still overrides it, so a
 * deployment that set that variable sees no change in notes chat.
 */
export function resolveCheapFireworksModel(options: {
  env?: Record<string, string | undefined>;
} = {}): string {
  const env = options.env ?? process.env;
  return trimModel(env.FIREWORKS_PROBLEM_IR_MODEL) || DEFAULT_CHEAP_FIREWORKS_MODEL;
}
