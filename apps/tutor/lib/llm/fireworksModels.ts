/** The only default model ID. Change models in ENV, not in call sites. */
export const DEFAULT_FIREWORKS_MODEL =
  "accounts/fireworks/models/deepseek-v4-flash-0731";

/**
 * Cheapest Fireworks model that accepts images. Teaching stays on
 * `FIREWORKS_MODEL` (DeepSeek Flash is text-only).
 */
export const DEFAULT_FIREWORKS_VISION_MODEL =
  "accounts/fireworks/models/qwen3p7-plus";

/**
 * Resolve the single Fireworks model for teaching and planners.
 *
 * - `FIREWORKS_MODEL` is the only model when set.
 * - `FIREWORKS_FAST_MODEL` replaces it only while Fast mode is on.
 * - Otherwise the default above is used.
 */
export function resolveFireworksModel(options: {
  fastMode?: boolean;
  env?: Record<string, string | undefined>;
} = {}): string {
  const env = options.env ?? process.env;
  if (options.fastMode !== false) {
    const fast = env.FIREWORKS_FAST_MODEL?.trim();
    if (fast) {
      return fast;
    }
  }

  const configured =
    env.FIREWORKS_MODEL?.trim() ||
    env.FIREWORKS_TEACHING_MODEL?.trim();
  return configured || DEFAULT_FIREWORKS_MODEL;
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
  return env.FIREWORKS_VISION_MODEL?.trim() || DEFAULT_FIREWORKS_VISION_MODEL;
}
