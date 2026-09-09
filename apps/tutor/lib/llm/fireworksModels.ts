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
