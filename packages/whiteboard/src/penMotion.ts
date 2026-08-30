/**
 * Handwriting motion helpers. Keep the nib on a continuous timeline:
 * cubic ease-in-out on a 12ms Tegaki stroke looks like a freeze.
 */

export const SHORT_STROKE_EASE_MS = 120;
export const AUDIO_WAIT_SLACK_MS = 24;

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Natural pen motion for long scene strokes. */
export function easePen(progress: number): number {
  const t = clamp01(progress);
  return t < 0.5 ? 2 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/**
 * Short handwriting uses linear time so the nib does not stall at every
 * ease-in and ease-out. Longer scene strokes keep the gentle cubic.
 */
export function handwritingProgress(linear: number, durationMs: number): number {
  if (!(durationMs > SHORT_STROKE_EASE_MS)) return clamp01(linear);
  return easePen(linear);
}

export function audioWaitAlreadyDue(
  positionMs: number,
  targetMs: number,
  slackMs = AUDIO_WAIT_SLACK_MS,
): boolean {
  return positionMs >= targetMs - slackMs;
}

export function sampleCountForLength(totalLength: number): number {
  return Math.max(12, Math.min(64, Math.ceil(Math.max(totalLength, 1) / 3)));
}

export function samplePolyline(
  totalLength: number,
  pointAt: (distance: number) => { x: number; y: number },
): { x: number; y: number }[] {
  const length = Math.max(totalLength, 1);
  const count = sampleCountForLength(length);
  const samples: { x: number; y: number }[] = [];
  for (let index = 0; index <= count; index++) {
    samples.push(pointAt((index / count) * length));
  }
  return samples;
}

export function pointAlongSamples(
  samples: readonly { x: number; y: number }[],
  totalLength: number,
  distance: number,
): { x: number; y: number } {
  if (samples.length === 0) return { x: 0, y: 0 };
  const last = samples[samples.length - 1]!;
  if (samples.length === 1) return last;
  const t = clamp01(distance / Math.max(totalLength, 1)) * (samples.length - 1);
  const index = Math.min(Math.floor(t), samples.length - 2);
  const frac = t - index;
  const start = samples[index]!;
  const end = samples[index + 1]!;
  return {
    x: start.x + (end.x - start.x) * frac,
    y: start.y + (end.y - start.y) * frac,
  };
}

export function splitDrawnLength(
  lengths: readonly number[],
  drawn: number,
): { index: number; inStroke: number } {
  if (lengths.length === 0) return { index: 0, inStroke: 0 };
  let remaining = Math.max(drawn, 0);
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!;
    if (remaining <= length) return { index, inStroke: remaining };
    remaining -= length;
  }
  const last = lengths.length - 1;
  return { index: last, inStroke: lengths[last]! };
}

/**
 * Compiler-owned labels under this budget skip stroke-by-stroke pen motion
 * and appear as a batch. Teaching WRITE must stay above it, or the live
 * lesson draws the line without the nib.
 */
export const INSTANT_LABEL_MS_PER_CHAR = 18;

/** True when writeText will walk the nib along each glyph instead of dumping ink. */
export function writeUsesStrokePenMotion(input: {
  hasSchedule: boolean;
  durationMs: number;
  visibleCharacterCount: number;
}): boolean {
  if (input.hasSchedule) return true;
  return input.durationMs > input.visibleCharacterCount * INSTANT_LABEL_MS_PER_CHAR;
}
