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

/**
 * Advance a tween by wall delta × live speed so a mid-stroke rate change
 * retimes only the remaining ink instead of jumping or rewinding.
 */
export function advanceSpeedAwareProgress(input: {
  elapsedMediaMs: number;
  durationMs: number;
  wallDeltaMs: number;
  speed: number;
}): { elapsedMediaMs: number; progress: number } {
  const speed = Number.isFinite(input.speed) && input.speed > 0 ? input.speed : 1;
  const elapsedMediaMs = Math.max(input.elapsedMediaMs, 0) + Math.max(input.wallDeltaMs, 0) * speed;
  if (input.durationMs <= 0) {
    return { elapsedMediaMs, progress: 1 };
  }
  return {
    elapsedMediaMs,
    progress: clamp01(elapsedMediaMs / input.durationMs),
  };
}

/** Natural pen motion for long scene strokes. */
export function easePen(progress: number): number {
  const t = clamp01(progress);
  return t < 0.5 ? 2 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/**
 * Stable -1..1 wobble from a seed so consecutive strokes do not share a pulse.
 */
export function handwritingVariation(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Handwriting cadence: mix linear travel with a gentle ease.
 *
 * A full cubic ease-in-out on a 12ms Tegaki stroke used to look like a freeze,
 * so short glyphs were forced onto a metronome. Mixing keeps a floor on
 * velocity (the nib never parks) while the middle of the stroke still runs
 * faster than the start and finish — and `variation` slides that peak so
 * every letter is not the same motion.
 */
export function handwritingProgress(
  linear: number,
  durationMs: number,
  variation = 0,
): number {
  const t = clamp01(linear);
  const easeWeight = durationMs > 280 ? 0.52 : durationMs > 90 ? 0.4 : 0.3;
  const skew = Math.min(1, Math.max(-1, variation)) * 0.18;
  const u = clamp01(t + skew * 4 * t * (1 - t) * (0.5 - t));
  const ease = u * u * (3 - 2 * u);
  return (1 - easeWeight) * u + easeWeight * ease;
}

/**
 * Map linear time to distance along a sampled stroke, lingering on corners
 * the way a hand does and running faster through straight segments.
 */
export function pacedStrokeDistance(
  samples: readonly { x: number; y: number }[],
  totalLength: number,
  linear: number,
  durationMs: number,
  variation = 0,
): number {
  const eased = handwritingProgress(linear, durationMs, variation);
  const length = Math.max(totalLength, 1);
  if (samples.length < 3) {
    return eased * length;
  }

  const weights: number[] = [];
  let weightedTotal = 0;
  for (let index = 0; index < samples.length - 1; index++) {
    const start = samples[index]!;
    const end = samples[index + 1]!;
    const segment = Math.hypot(end.x - start.x, end.y - start.y);
    let turn = 0;
    if (index > 0) {
      const prev = samples[index - 1]!;
      const next = end;
      const d1x = start.x - prev.x;
      const d1y = start.y - prev.y;
      const d2x = next.x - start.x;
      const d2y = next.y - start.y;
      const mag1 = Math.hypot(d1x, d1y);
      const mag2 = Math.hypot(d2x, d2y);
      if (mag1 > 0.2 && mag2 > 0.2) {
        const dot = Math.min(1, Math.max(-1, (d1x * d2x + d1y * d2y) / (mag1 * mag2)));
        turn = Math.acos(dot);
      }
    }
    const weight = segment * (1 + 1.15 * turn);
    weights.push(weight);
    weightedTotal += weight;
  }

  if (!(weightedTotal > 0)) {
    return eased * length;
  }

  let remaining = eased * weightedTotal;
  let actual = 0;
  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index]!;
    const start = samples[index]!;
    const end = samples[index + 1]!;
    const segment = Math.hypot(end.x - start.x, end.y - start.y);
    if (remaining <= weight) {
      const frac = weight > 0 ? remaining / weight : 1;
      return actual + segment * frac;
    }
    remaining -= weight;
    actual += segment;
  }
  return length;
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
 * Time to credit a tween on its very first frame.
 *
 * Writing is a chain of tweens: a carry to the next letter, the letter, a wait
 * on the voice, the next carry. Each one is created inside the previous one's
 * last frame, so its own first frame is a whole display refresh later. Timing
 * that frame from when it runs makes it worth nothing, and at a 50 ms glyph
 * budget two such frames per character are most of the letter — the pen visibly
 * stalled at every letter and the hand read as stop-start.
 *
 * Crediting the gap since the tween was created fixes that, capped so a stalled
 * main thread or a hidden tab cannot swallow a whole glyph in one step.
 */
export function tweenStartDeltaMs(
  createdAtMs: number,
  frameNowMs: number,
  capMs: number,
): number {
  if (!(frameNowMs > createdAtMs)) return 0;
  return Math.min(frameNowMs - createdAtMs, Math.max(capMs, 0));
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

/**
 * How much a corner slows the nib. Human drawing obeys a speed/curvature law:
 * the tighter the turn, the slower the hand goes through it. Weighting each
 * sampled step by its turn angle spends more of the glyph's time on the bends
 * and less on the straights, which is what separates a written letter from a
 * path traced at one constant rate.
 */
export const CORNER_LINGER = 0.9;
/** A cusp must not stall the pen outright, so the turn term is capped. */
export const MAX_CORNER_TURN = 1.6;
/**
 * The pen presses in and lifts off rather than starting and stopping at full
 * speed, so the ends of every stroke get a little extra time.
 */
export const STROKE_EDGE_LINGER = 0.3;
export const STROKE_EDGE_FRACTION = 0.16;
/**
 * Air between two strokes of the same glyph costs far less time than ink:
 * the hand carries over quickly and settles on the next start.
 */
export const AIR_PACE_WEIGHT = 0.4;

export interface PaceSegment {
  kind: "ink" | "air";
  samples: readonly { x: number; y: number }[];
}

export interface PaceStep {
  /** Index into the segment list this step belongs to. */
  segment: number;
  /** Distance from the start of that segment at the end of this step. */
  distance: number;
  /** Share of the glyph's time this step is worth. */
  weight: number;
}

export interface GlyphPacePlan {
  steps: PaceStep[];
  totalWeight: number;
  totalLength: number;
  /**
   * Chord length of each segment as this plan measured it. Konva's own curve
   * length is a little longer than the sampled polyline, so a caller mapping a
   * paced distance back onto a dash offset has to rescale by this or the last
   * sliver of every stroke is left undrawn.
   */
  segmentLengths: number[];
}

function turnAt(
  samples: readonly { x: number; y: number }[],
  index: number,
): number {
  if (index <= 0 || index + 1 >= samples.length) return 0;
  const prev = samples[index - 1]!;
  const here = samples[index]!;
  const next = samples[index + 1]!;
  const d1x = here.x - prev.x;
  const d1y = here.y - prev.y;
  const d2x = next.x - here.x;
  const d2y = next.y - here.y;
  const mag1 = Math.hypot(d1x, d1y);
  const mag2 = Math.hypot(d2x, d2y);
  if (!(mag1 > 0.2) || !(mag2 > 0.2)) return 0;
  const dot = Math.min(1, Math.max(-1, (d1x * d2x + d1y * d2y) / (mag1 * mag2)));
  return Math.acos(dot);
}

/**
 * Build the time map for one glyph: every sampled step of every stroke, plus
 * the air between them, weighted by how long a hand would actually spend on it.
 *
 * The result is consumed by `pacedGlyphPosition`, so a glyph animated on a
 * single tween still slows into its corners, eases off each stroke end, and
 * whips across the gaps — instead of unrolling at a constant rate the way an
 * arc-length reveal does.
 */
export function planGlyphPacing(segments: readonly PaceSegment[]): GlyphPacePlan {
  const steps: PaceStep[] = [];
  const segmentLengths: number[] = [];
  let totalWeight = 0;
  let totalLength = 0;

  segments.forEach((segment, segmentIndex) => {
    const samples = segment.samples;
    if (samples.length < 2) {
      segmentLengths.push(0);
      steps.push({ segment: segmentIndex, distance: 0, weight: 0 });
      return;
    }

    let travelled = 0;
    const spans: number[] = [];
    for (let index = 0; index < samples.length - 1; index++) {
      const start = samples[index]!;
      const end = samples[index + 1]!;
      spans.push(Math.hypot(end.x - start.x, end.y - start.y));
    }
    const segmentLength = spans.reduce((sum, span) => sum + span, 0);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;

    for (let index = 0; index < spans.length; index++) {
      const span = spans[index]!;
      travelled += span;
      let weight: number;
      if (segment.kind === "air") {
        weight = span * AIR_PACE_WEIGHT;
      } else {
        const turn = Math.min(turnAt(samples, index + 1), MAX_CORNER_TURN);
        // Distance from whichever end of the stroke is nearer, as a fraction.
        const along = segmentLength > 0 ? travelled / segmentLength : 0.5;
        const edge = Math.max(
          0,
          1 - Math.min(along, 1 - along) / Math.max(STROKE_EDGE_FRACTION, 1e-6),
        );
        weight = span * (1 + CORNER_LINGER * turn) * (1 + STROKE_EDGE_LINGER * edge);
      }
      totalWeight += weight;
      steps.push({ segment: segmentIndex, distance: travelled, weight });
    }
  });

  return { steps, totalWeight, totalLength, segmentLengths };
}

/**
 * Where the nib is at `eased` progress through a glyph's own time map.
 * Returns the segment being drawn and how far into it the ink has reached.
 */
export function pacedGlyphPosition(
  plan: GlyphPacePlan,
  eased: number,
): { segment: number; distance: number } {
  const steps = plan.steps;
  if (steps.length === 0) return { segment: 0, distance: 0 };
  const target = clamp01(eased) * plan.totalWeight;
  if (!(plan.totalWeight > 0)) {
    const last = steps[steps.length - 1]!;
    return { segment: last.segment, distance: last.distance };
  }

  let consumed = 0;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]!;
    if (target <= consumed + step.weight) {
      const previous = steps[index - 1];
      const from = previous && previous.segment === step.segment ? previous.distance : 0;
      const frac = step.weight > 0 ? (target - consumed) / step.weight : 1;
      return { segment: step.segment, distance: from + (step.distance - from) * frac };
    }
    consumed += step.weight;
  }
  const last = steps[steps.length - 1]!;
  return { segment: last.segment, distance: last.distance };
}
