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

/**
 * How fast the nib lays ink, in px per ms.
 *
 * A hand draws at roughly one speed and lets the length of the line decide how
 * long the line takes. The board used to do the opposite: every shape in a
 * reveal got the same millisecond budget, so a 30px tick crawled and a 600px
 * box was whipped out, and one figure visibly changed speed several times
 * while being drawn. Budgeting the speed instead is what makes a figure read
 * as one hand drawing it.
 */
export const INK_SPEED_PX_PER_MS = 2;
/** How far a narrated stroke may be stretched to stay under that speed. */
export const INK_STRETCH_MAX = 1.5;

/**
 * How far the hand may lean off its natural speed to track the voice.
 *
 * The adaptation is a *speed*, not a millisecond budget, and it is applied to
 * the whole figure. Damping an absolute budget conflated two things — how long
 * a line is, and how far behind the narration the ink has fallen — so a run of
 * short shapes taught the damper that this figure was a fast one, and the next
 * long shape was whipped out to match.
 */
export const PACE_SCALE_MIN = 0.55;
export const PACE_SCALE_MAX = 1.6;

export function clampPaceScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(Math.max(scale, PACE_SCALE_MIN), PACE_SCALE_MAX);
}

/**
 * Where the hand should be leaning, given how far the voice is ahead of the
 * ink. Positive lag is the voice talking about something not yet drawn.
 */
export function paceScaleForLagMs(lagMs: number): number {
  if (!Number.isFinite(lagMs)) return 1;
  if (lagMs > 220) return PACE_SCALE_MIN;
  if (lagMs > 100) return 0.8;
  if (lagMs < -220) return 1.45;
  return 1.02;
}

/**
 * Ease toward that lean instead of snapping to it, and cap how much one shape
 * may change it, so a figure accelerates and decelerates rather than switching
 * between two speeds.
 */
export const PACE_SCALE_STEP_MAX = 1.22;

export function dampPaceScale(previous: number | null, target: number): number {
  const wanted = clampPaceScale(target);
  if (previous === null) return wanted;
  const prev = clampPaceScale(previous);
  const blended = prev * 0.65 + wanted * 0.35;
  return clampPaceScale(
    Math.min(Math.max(blended, prev / PACE_SCALE_STEP_MAX), prev * PACE_SCALE_STEP_MAX),
  );
}

/**
 * The time this stroke should take.
 *
 * With a ceiling (a reveal, which owns its own envelope) the length decides,
 * inside that envelope — so no shape ever takes longer than it could before,
 * and the short ones stop over-spending. Without one (narrated ink, whose
 * budget is tied to what the voice is saying) the requested time stands unless
 * it would draw faster than a hand can, and even then it is stretched only so
 * far, because ink that lags the sentence describing it is the worse fault.
 */
export function paceShapeDurationMs(input: {
  lengthPx: number;
  requestedMs: number;
  minMs: number;
  maxMs?: number;
  /** >1 lingers, <1 hurries — how hard the hand is leaning to track the voice. */
  paceScale?: number;
}): number {
  const length = Math.max(input.lengthPx, 1);
  const requested = Math.max(input.requestedMs, 0);
  const scale = clampPaceScale(input.paceScale ?? 1);
  const bySpeed = (length / INK_SPEED_PX_PER_MS) * scale;

  if (typeof input.maxMs === "number") {
    return Math.min(Math.max(bySpeed, input.minMs), input.maxMs);
  }
  const stretched = Math.min(Math.max(requested, bySpeed), requested * INK_STRETCH_MAX);
  return Math.max(stretched, input.minMs);
}

/**
 * The time a shape on the board takes, once the caller has said what kind of
 * shape it is.
 *
 * A `scene` shape is one stroke of a reveal and keeps the reveal's ceiling.
 * A `cued` shape is a stroke the voice is describing right now: the intro
 * used to hand the whiteboard a 10 s narration window and the whiteboard
 * clipped every stroke to 320 ms (measured: 14 mirror strokes in 3.5 s under
 * a 10.26 s sentence, then a parked pen for 3.3 s). When the caller says the
 * stroke is cued, the requested time stands, stretched at most
 * `INK_STRETCH_MAX` over the hand-speed floor, and the reveal ceiling is not
 * applied.
 */
export function resolveShapeDurationMs(input: {
  lengthPx: number;
  requestedMs: number;
  minMs: number;
  sceneMaxMs: number;
  pace?: "follow" | "scene";
  cued?: boolean;
  paceScale?: number;
}): number {
  return paceShapeDurationMs({
    lengthPx: input.lengthPx,
    requestedMs: input.requestedMs,
    minMs: input.minMs,
    maxMs: !input.cued && input.pace === "scene" ? input.sceneMaxMs : undefined,
    paceScale: input.paceScale,
  });
}

/**
 * The ink of a character fills its spoken slot.
 *
 * Before this the budget for a scheduled glyph was clamp(slot x 0.78, 42, 128)
 * media ms, run at the board's animation speed (1.5 user x 1.2 adaptive) with
 * the first frame credited, so anything under about 90 media ms was stamped on
 * frame one and a 600 ms word drew a 70 ms glyph and parked for the rest.
 * Measured on the mirror lesson: 27 of 33 rows finished early, median 1.4 s,
 * with per-character wall gaps of one to six frames however long the word was.
 *
 * The slot is the spoken window of the character. The ink takes the slot,
 * floored at `GLYPH_SLOT_MIN_MS` so a fast syllable is still written rather
 * than stamped, and capped at `GLYPH_SLOT_MAX_MS` so a long word does not turn
 * one letter into slow motion; what is left of a long slot is a linger, a slow
 * finishing stroke on the glyph rather than a park. When the pen is behind
 * (the voice has passed the character's start by more than
 * `GLYPH_LAG_TOLERANCE_MS`) the ink shortens toward the floor by the excess
 * and the linger is given up first, so a late row catches its sentence.
 *
 * Smoothing: two consecutive glyphs never differ by more than
 * `GLYPH_BUDGET_STEP_MAX` in ink time when the pen is on time. Catching up is
 * deliberately not smoothed; a hand that is behind does not ease into hurrying.
 */
export const GLYPH_SLOT_MIN_MS = 90;
export const GLYPH_SLOT_MAX_MS = 350;
export const GLYPH_LAG_TOLERANCE_MS = 120;
export const GLYPH_BUDGET_STEP_MAX = 1.5;
/** A slot no schedule can name (the last character of a text with no duration list). */
export const GLYPH_SLOT_FALLBACK_MS = 160;

export interface ScheduledGlyphBudget {
  /** Media ms the glyph's ink takes. */
  inkMs: number;
  /** Media ms the hand stays on the last stroke after the ink, filling the slot. */
  lingerMs: number;
}

export function scheduledGlyphBudgetMs(input: {
  slotMs: number;
  lagMs: number;
  previousMs?: number | null;
}): ScheduledGlyphBudget {
  const slot = Number.isFinite(input.slotMs) ? Math.max(input.slotMs, 0) : GLYPH_SLOT_FALLBACK_MS;
  const lag = Number.isFinite(input.lagMs) ? Math.max(input.lagMs, 0) : 0;
  const clampSlot = (value: number): number =>
    Math.min(Math.max(value, GLYPH_SLOT_MIN_MS), GLYPH_SLOT_MAX_MS);

  const base = clampSlot(slot);
  const previous =
    typeof input.previousMs === "number" && Number.isFinite(input.previousMs) && input.previousMs > 0
      ? clampSlot(input.previousMs)
      : null;
  const smoothed =
    previous === null
      ? base
      : clampSlot(
          Math.min(
            Math.max(base, previous / GLYPH_BUDGET_STEP_MAX),
            previous * GLYPH_BUDGET_STEP_MAX,
          ),
        );

  const behindMs = Math.max(lag - GLYPH_LAG_TOLERANCE_MS, 0);
  const inkMs = clampSlot(smoothed - behindMs);
  const lingerMs = Math.max(slot - lag - inkMs, 0);
  return { inkMs, lingerMs };
}

/**
 * How much of a glyph's time map is left for the finishing stroke when the
 * hand lingers. Half the linger's share of the whole, so a 550 ms linger after
 * a 350 ms glyph draws the last third of the letter at about a third of the
 * speed: a hand slowing to finish the letter while the voice finishes the
 * word. `maxFraction` is the share of the glyph its last stroke actually owns,
 * so the linger never reaches back into an earlier stroke or the air before it.
 */
export const LINGER_TAIL_MAX = 0.35;

export function lingerTailFraction(
  inkMs: number,
  lingerMs: number,
  maxFraction = LINGER_TAIL_MAX,
): number {
  if (!(lingerMs > 0) || !(inkMs > 0)) return 0;
  const share = (lingerMs / (inkMs + lingerMs)) * 0.5;
  return Math.min(Math.max(share, 0), Math.max(Math.min(maxFraction, LINGER_TAIL_MAX), 0));
}

/**
 * Progress through a glyph's time map at `elapsedMs` of an ink phase followed
 * by a linger. The ink phase keeps the handwriting cadence over the body of
 * the letter; the linger eases the tail out over the rest of the slot, ending
 * at 1 so no sliver is left unpainted and never running backwards.
 */
export function lingeringGlyphProgress(
  elapsedMs: number,
  inkMs: number,
  lingerMs: number,
  variation = 0,
  maxTailFraction = LINGER_TAIL_MAX,
): number {
  const tail = lingerTailFraction(inkMs, lingerMs, maxTailFraction);
  if (elapsedMs <= inkMs || tail === 0) {
    const t = inkMs > 0 ? clamp01(elapsedMs / inkMs) : 1;
    return handwritingProgress(t, inkMs, variation) * (1 - tail);
  }
  const u = clamp01((elapsedMs - inkMs) / Math.max(lingerMs, 1e-6));
  return 1 - tail + tail * (1 - (1 - u) * (1 - u));
}

export interface SimulatedGlyph {
  /** Media ms the pen began this glyph (after any wait on the voice). */
  startMs: number;
  /** Media ms the ink was complete. */
  inkEndMs: number;
  /** Media ms the hand left the glyph, linger included. */
  endMs: number;
  /** Media ms the pen stood idle between the previous glyph and this one. */
  pauseMs: number;
  /** How far the voice was past this character's cue when the pen reached it. */
  lagMs: number;
}

export interface SimulatedScheduledLine {
  glyphs: SimulatedGlyph[];
  lastEndMs: number;
  maxPauseMs: number;
}

/**
 * Walk a scheduled row through the slot rule on an ideal media clock: every
 * character waits for its cue, is written for its budget, lingers if the slot
 * is longer than the cap, and hands whatever it overran to the next character
 * as lag. This is the offline model of writeText's scheduled loop, so a budget
 * rule can be judged against a real sentence before it meets the board.
 */
export function simulateScheduledGlyphs(input: {
  offsetsMs: readonly number[];
  slotsMs: readonly number[];
  budget?: (slotMs: number, lagMs: number, previousMs: number | null) => ScheduledGlyphBudget;
}): SimulatedScheduledLine {
  const budget = input.budget ?? ((slotMs, lagMs, previousMs) =>
    scheduledGlyphBudgetMs({ slotMs, lagMs, previousMs }));
  const glyphs: SimulatedGlyph[] = [];
  let previousMs: number | null = null;
  let penFreeMs = 0;
  let maxPauseMs = 0;
  for (let index = 0; index < input.offsetsMs.length; index++) {
    const cueMs = input.offsetsMs[index] ?? 0;
    const slotMs = input.slotsMs[index] ?? GLYPH_SLOT_FALLBACK_MS;
    const startMs = Math.max(cueMs, penFreeMs);
    const lagMs = Math.max(startMs - cueMs, 0);
    const pauseMs = index === 0 ? 0 : Math.max(startMs - penFreeMs, 0);
    const { inkMs, lingerMs } = budget(slotMs, lagMs, previousMs);
    const inkEndMs = startMs + inkMs;
    const endMs = inkEndMs + lingerMs;
    glyphs.push({ startMs, inkEndMs, endMs, pauseMs, lagMs });
    maxPauseMs = Math.max(maxPauseMs, pauseMs);
    penFreeMs = endMs;
    previousMs = inkMs;
  }
  return { glyphs, lastEndMs: penFreeMs, maxPauseMs };
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
