/**
 * Where the marker stands, and how it moves, while the tutor is talking.
 *
 * A DSA lesson spends most of its minutes on speech rather than ink: the
 * figure is up, the code is typed, and the tutor explains. Three separate
 * paths used to leave the pen dead during exactly those minutes.
 *
 *   - A spoken step with no tag issued no command at all, so the pen stayed
 *     wherever the last stroke had ended, for the whole step.
 *   - Both spotlight paths flew the pen to the lit entity and then set the
 *     cursor to `idle`, which is opacity 0. The pen did not stand at the
 *     figure; it disappeared from the board.
 *   - A single fly-and-stop parks the pen on one cell for a sixty-word beat,
 *     which reads as a stalled lesson even while the audio runs.
 *
 * This module is the shared answer: a route across the parts of the figure
 * under discussion, walked at a human pace for as long as the words last.
 * It draws no ink.
 */

/**
 * States the tour is allowed to hold. `idle` is deliberately absent: it is
 * opacity 0, and a pen at opacity 0 is not standing at the figure.
 */
export type MarkerTourCursorState = "speaking" | "thinking";

export interface MarkerTourHost {
  flyCursorTo: (x: number, y: number, durationMs: number) => Promise<void> | void;
  setCursorState?: (state: MarkerTourCursorState) => void;
}

export interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TourStop {
  x: number;
  y: number;
}

/** One hop between stops. Slow enough to read as a hand, not a teleport. */
export const MARKER_HOP_MS = 620;
/** How long the pen rests on a stop before moving on. */
export const MARKER_DWELL_MS = 820;
/** Left unspent at the end so the next command is not late. */
const TAIL_MS = 140;
/**
 * What the segment runner assumes a character of narration costs. A tour is
 * sized against the same estimate the runner uses to budget the segment's ink,
 * so the pen keeps moving for as long as the words do.
 */
const MS_PER_NARRATION_CHAR = 85;
/**
 * The estimate above runs a little long against real speech. A tour that
 * outlasts its words holds the next segment up, so spend most of it, not all.
 */
const TOUR_SHARE_OF_ESTIMATE = 0.85;
/** No single step's tour runs longer than this, whatever the estimate says. */
const MAX_TOUR_MS = 45_000;

/** Below this a target is one point, not something to trace along. */
const TRACEABLE_WIDTH_PX = 56;

function stopFor(target: TourRect, fraction: number): TourStop {
  return {
    x: target.x + target.width * fraction,
    // The top edge, not the centre: the pen graphic hangs down and to the
    // right of its tip, so a stop in the middle of a cell covers the value
    // the tutor is naming.
    y: target.y,
  };
}

/**
 * The route for one spoken step.
 *
 * Several targets means one stop each, in the order the caller gave them,
 * which is the order the figure was built in. A single wide target is worth
 * tracing across instead: the pen walks its span rather than pinning its
 * left edge.
 *
 * `rotation` starts the route at a different stop each time, so consecutive
 * steps about the same frame do not replay the same two moves.
 */
export function markerTourStops(targets: readonly TourRect[], rotation = 0): TourStop[] {
  // Width and height are checked too: a stop is derived from them, and one
  // NaN would fly the pen to an undrawable point rather than fail loudly.
  const usable = targets.filter(
    (target) =>
      Number.isFinite(target.x) &&
      Number.isFinite(target.y) &&
      Number.isFinite(target.width) &&
      Number.isFinite(target.height),
  );
  if (usable.length === 0) return [];
  const stops: TourStop[] =
    usable.length === 1
      ? usable[0]!.width >= TRACEABLE_WIDTH_PX
        ? [stopFor(usable[0]!, 0.15), stopFor(usable[0]!, 0.5), stopFor(usable[0]!, 0.85)]
        : [stopFor(usable[0]!, 0.5)]
      : usable.slice(0, 6).map((target) => stopFor(target, 0.5));
  if (stops.length < 2) return stops;
  const offset = ((rotation % stops.length) + stops.length) % stops.length;
  return [...stops.slice(offset), ...stops.slice(0, offset)];
}

/**
 * Walk the route for `totalMs`, looping if the words outlast the stops.
 *
 * Returns true if the turn was cancelled part-way, matching the convention
 * the command executor uses to bail out of the rest of a segment.
 */
export async function tourMarker(
  host: MarkerTourHost,
  stops: readonly TourStop[],
  options: {
    totalMs: number;
    isCancelled: () => boolean;
    delay: (ms: number) => Promise<void>;
    now?: () => number;
    /** Cursor state to hold while touring. Never `idle`: that is invisible. */
    cursorState?: MarkerTourCursorState;
  },
): Promise<boolean> {
  if (stops.length === 0) return options.isCancelled();
  const now = options.now ?? (() => Date.now());
  host.setCursorState?.(options.cursorState ?? "speaking");
  const deadline = now() + Math.max(options.totalMs, 0);
  let index = 0;
  // A first hop always runs, even inside a short window: the point of the
  // command is to put the pen at the thing being talked about.
  while (index === 0 || now() < deadline - TAIL_MS) {
    if (options.isCancelled()) return true;
    const stop = stops[index % stops.length]!;
    index += 1;
    const left = deadline - now();
    const hop = index === 1 ? Math.min(MARKER_HOP_MS, Math.max(left, 200)) : Math.min(MARKER_HOP_MS, Math.max(left - TAIL_MS, 160));
    await host.flyCursorTo(stop.x, stop.y, hop);
    if (options.isCancelled()) return true;
    const rest = deadline - now() - TAIL_MS;
    if (rest <= 0) break;
    await options.delay(Math.min(MARKER_DWELL_MS, rest));
  }
  return options.isCancelled();
}

/**
 * How long the marker should walk for one spoken step.
 *
 * A shape budget is the wrong clock here: a focus is sized as one shape, about
 * a second and a half, while the step it belongs to can run a minute. The pen
 * used to land, go invisible, and wait out the rest of the words.
 */
export function narrationTourMs(
  narration: string | undefined,
  budgetMs: number,
  shareMs?: number,
): number {
  const estimateMs = (narration ?? "").trim().length * MS_PER_NARRATION_CHAR;
  const wanted = Math.min(
    Math.max(budgetMs, Math.round(estimateMs * TOUR_SHARE_OF_ESTIMATE)),
    MAX_TOUR_MS,
  );
  // `shareMs` is this command's slice of the segment, and it is a ceiling.
  //
  // Without it the walk was sized from the *whole* segment's narration even
  // when the segment held two commands, so a frame swap followed by a focus
  // asked for the beat's time twice over. The draw chain then ran tens of
  // seconds behind its own audio, and the commands after it — the ones that
  // type the code — arrived long after the words, or never. A pen that walks
  // is worth nothing if it walks instead of writing.
  if (shareMs === undefined || !Number.isFinite(shareMs) || shareMs <= 0) return wanted;
  return Math.min(wanted, Math.max(Math.round(shareMs), budgetMs));
}
