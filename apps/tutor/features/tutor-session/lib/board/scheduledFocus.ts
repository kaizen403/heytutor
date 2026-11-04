/**
 * Scheduled focus: the pen follows the voice through a FOCUS.
 *
 * A FOCUS naming several parts used to be one gesture at the start of its
 * sentence: every withheld label lettered at once, every path traced inside
 * one budget of about 900 ms, then the pen parked for the rest of the
 * sentence. The names it was illustrating arrived later, a median 3.3 s
 * (p75 6.1 s, max 14.4 s) after the step began on the lecture-lab set, and
 * 28 of 31 more than a second after the ring had faded.
 *
 * The runner now hands the executor a schedule: one window per target, in
 * spoken order, in media milliseconds from the segment's audio start. This
 * loop runs those windows one at a time. For each target the pen leaves for
 * the part a beat before its name and letters the part's withheld label in
 * that beat, so the label is on the board as the name is said, then traces
 * the part's own ink from the name to the end of the clause. A spotlight
 * follows the target being spoken; a pulse rings each target after its trace.
 *
 * Everything here is in media milliseconds. The whiteboard scales the
 * durations it is handed by its animation speed, and the audio clock the
 * waits are measured against is media time, so nothing needs the playback
 * rate except the waits and deadline-bound flights, which the caller wires.
 */
import type { FocusEmphasis } from "@heytutor/drawing";
import { withSpotlight, type SpotlightHost, type SpotlightRect } from "./spotlight";

/** One target's spoken window. Same shape as tutor-core's FocusTargetWindow. */
export interface FocusTargetWindow {
  /** Diagram anchor or group id. */
  id: string;
  /** Media ms from the segment's audio start when the name begins. */
  startMs: number;
  /** Clause end; always at least startMs + 600. */
  endMs: number;
  anchor: "label" | "role" | "clause" | "proportional";
}

/** Same shape as tutor-core's FocusTargetSchedule. */
export interface FocusTargetSchedule {
  /** Spoken order, monotonic startMs. */
  targets: FocusTargetWindow[];
  matchedCount: number;
  source: "tts" | "estimated";
}

export interface FocusPenPoint {
  x: number;
  y: number;
}

export interface FocusTracePath extends FocusPenPoint {
  path: string;
}

export interface ScheduledFocusTarget {
  id: string;
  startMs: number;
  endMs: number;
  /** What the spotlight hole covers while this target is spoken. */
  rects: SpotlightRect[];
  /** What the pen traces: the target's own ink, or a ring round its anchor. */
  paths: FocusTracePath[];
  /**
   * The spotlight hole for each path, exactly as given (no padding added),
   * for a target whose paths sit far apart: a numbered picture's mark on the
   * drawing, then its row in the key. The spotlight follows the pen from one
   * to the next instead of one hole spanning both, which would light most of
   * the picture. Absent, the hole is `rects` padded, throughout the target.
   */
  pathHoles?: SpotlightRect[];
  /** The ring drawn after the trace when the emphasis is pulse. */
  pulse: FocusTracePath | null;
  /**
   * Letters the target's withheld labels and dimensions. Reports where it
   * left the pen so the hop back to the trace is sized by the distance.
   */
  letter: () => Promise<{ cancelled: boolean; penAt: FocusPenPoint | null }>;
}

export interface ScheduledFocusHost extends SpotlightHost {
  flyCursorTo: (x: number, y: number, durationMs: number, rotation?: number, shouldCancel?: () => boolean) => Promise<void>;
  drawAnnotation: (
    kind: "underline" | "circle_around",
    path: string,
    durationMs: number,
    options: { strokeWidth: number; transient: true; shouldCancel?: () => boolean; shouldStop?: () => boolean },
  ) => Promise<void>;
}

export interface ScheduledFocusOptions {
  emphasis: FocusEmphasis;
  /** The zone a spotlight dims. Null means no veil for this focus. */
  veil: SpotlightRect | null;
  /** The segment's audio clock, in media ms. */
  getAudioPositionMs: () => number;
  /** Resolves when the audio clock reaches targetMs, or on cancel. */
  waitUntilAudioMs: (targetMs: number, getTargetMs?: () => number) => Promise<void>;
  /** Converts a remaining media-time window to a safe whiteboard flight budget. */
  flightBudgetMs?: (audioMs: number) => number;
  /** The next written word releases the pen; only transient gestures shrink. */
  deadlineMs?: number;
  /** Runtime alignment refresh; target ids still refer to committed geometry. */
  getTiming?: () => { targets: readonly FocusTargetWindow[]; deadlineMs: number };
  isPaused?: () => boolean;
  isCancelled: () => boolean;
  /** Least a target is traced for when its window has already passed. */
  floorMs: number;
}

/**
 * Leave early enough for a calm cross-board reach and a short label, so the
 * extra travel time comes before the spoken name rather than delaying it. The
 * trace starts on it rather than a flight and a glyph later.
 */
export const FOCUS_FLIGHT_LEAD_MS = 620;
/** Longest hop between two points of a focus. */
export const FOCUS_HOP_MAX_MS = 400;
/** A hop across a label's width still reads as a movement. */
const FOCUS_HOP_MIN_MS = 80;
/** Longer reaches spend more frames in the existing eased flight. */
const FOCUS_HOP_PX_PER_MS = 1.2;
/** A traced path shorter than this is a flicker, not a gesture. */
const FOCUS_PATH_MIN_MS = 180;
export const FOCUS_PULSE_MS = 260;
const FOCUS_SPOTLIGHT_OPACITY = 0.36;
const SPOTLIGHT_PAD_PX = 10;
/** Under this distance the whiteboard settles the nib without a flight. */
const NIB_SETTLE_PX = 6;

/**
 * How long a hop from `from` to `to` takes, capped at `capMs`. Unknown start
 * (the pen just traced a path and stands at its far end) costs the cap; a
 * known start is sized by the distance, and no distance at all is no hop.
 */
export function focusHopMs(from: FocusPenPoint | null, to: FocusPenPoint, capMs: number): number {
  const cap = Math.min(Math.max(capMs, 0), FOCUS_HOP_MAX_MS);
  if (!from) return cap;
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < NIB_SETTLE_PX) return 0;
  return Math.min(Math.max(distance / FOCUS_HOP_PX_PER_MS, FOCUS_HOP_MIN_MS), cap);
}

function unionRect(rects: readonly SpotlightRect[]): SpotlightRect {
  const first = rects[0] ?? { x: 0, y: 0, width: 0, height: 0 };
  return rects.reduce((union, rect) => {
    const x = Math.min(union.x, rect.x);
    const y = Math.min(union.y, rect.y);
    const right = Math.max(union.x + union.width, rect.x + rect.width);
    const bottom = Math.max(union.y + union.height, rect.y + rect.height);
    return { x, y, width: right - x, height: bottom - y };
  }, first);
}

function paddedHole(rects: readonly SpotlightRect[]): SpotlightRect {
  const union = unionRect(rects);
  return {
    x: union.x - SPOTLIGHT_PAD_PX,
    y: union.y - SPOTLIGHT_PAD_PX,
    width: union.width + SPOTLIGHT_PAD_PX * 2,
    height: union.height + SPOTLIGHT_PAD_PX * 2,
  };
}

/**
 * Run the targets in order, each inside its own spoken window.
 * Returns true when it stopped for a cancellation.
 */
export async function runScheduledFocus(
  host: ScheduledFocusHost,
  targets: readonly ScheduledFocusTarget[],
  options: ScheduledFocusOptions,
): Promise<boolean> {
  if (targets.length === 0) return options.isCancelled();
  const deadlineMs = () => options.getTiming?.().deadlineMs ?? options.deadlineMs;
  const windowFor = (target: ScheduledFocusTarget) => options.getTiming?.().targets.find(window => window.id === target.id) ?? target;
  const boundDuration = (durationMs: number, remainingParts = 1): number => {
    const deadline = deadlineMs();
    if (deadline === undefined || !Number.isFinite(deadline)) return durationMs;
    const remainingMs = Math.max(0, deadline - options.getAudioPositionMs());
    const budgetMs = options.flightBudgetMs?.(remainingMs) ?? remainingMs;
    return Math.min(durationMs, Math.max(0, budgetMs) / remainingParts);
  };
  const deadlineExpired = (): boolean => {
    const deadline = deadlineMs();
    return !options.isPaused?.() && deadline !== undefined && Number.isFinite(deadline)
      && options.getAudioPositionMs() >= deadline;
  };
  const motionCancelled = () => options.isCancelled() || deadlineExpired();
  const flyTo = async (point: FocusPenPoint, durationMs: number): Promise<void> => {
    if (durationMs > 0 || !deadlineExpired()) {
      await host.flyCursorTo(point.x, point.y, durationMs, undefined, motionCancelled);
    }
  };
  const trace = async (kind: "underline" | "circle_around", path: string,
    durationMs: number, strokeWidth: number): Promise<void> => {
    if (deadlineExpired() || durationMs <= 0) return;
    await host.drawAnnotation(kind, path, durationMs, {
      strokeWidth, transient: true,
      shouldCancel: options.isCancelled,
      shouldStop: deadlineExpired,
    });
  };
  // Parts that sit far apart open on the first rather than on a hole
  // spanning them all.
  const firstHole = targets[0]?.pathHoles?.[0];
  const spotlight = options.emphasis === "spotlight" && options.veil
    ? {
        veil: options.veil,
        hole: firstHole && targets.every((target) => target.pathHoles && target.pathHoles.length > 0)
          ? { ...firstHole }
          : paddedHole(targets.flatMap((target) => target.rects)),
        opacity: FOCUS_SPOTLIGHT_OPACITY,
      }
    : null;
  const holeFor = (target: ScheduledFocusTarget, pathIndex: number): SpotlightRect | null => {
    const hole = target.pathHoles?.[pathIndex];
    return hole ? { ...hole } : null;
  };
  // Every re-aim replaces the lease owned by this focus. The helper releases
  // the latest target's nodes, not just the initial union or a successor veil.
  return withSpotlight(host, spotlight, async (scope) => {
    let penAt: FocusPenPoint | null = null;
    for (const target of targets) {
      if (options.isCancelled()) return true;
      const first = target.paths[0];
      if (!first) continue;

      // Leave for the part a beat before its name so the pen stands on it,
      // label written, when the word lands rather than arriving a flight
      // and a glyph later.
      const startMs = () => Math.min(windowFor(target).startMs, deadlineMs() ?? Number.POSITIVE_INFINITY);
      await options.waitUntilAudioMs(startMs() - FOCUS_FLIGHT_LEAD_MS,
        options.getTiming ? () => startMs() - FOCUS_FLIGHT_LEAD_MS : undefined);
      if (options.isCancelled()) return true;
      if (spotlight) scope.setSpotlight?.({ ...spotlight, hole: holeFor(target, 0) ?? paddedHole(target.rects) });
      const pulseParts = options.emphasis === "pulse" && target.pulse ? 2 : 0;
      const traceParts = target.paths.length * 2 + pulseParts;
      const approachMs = boundDuration(focusHopMs(penAt, first, FOCUS_HOP_MAX_MS), traceParts + 1);
      if (approachMs > 0) await flyTo(first, approachMs);
      if (options.isCancelled()) return true;
      penAt = first;

      // The label's ink belongs to this target, so it is released here and
      // nowhere earlier: not by a WRITE row that contains its letter, and
      // not with the other targets' labels at the start of the sentence.
      const lettered = await target.letter();
      if (lettered.cancelled) return true;
      if (lettered.penAt) penAt = lettered.penAt;

      // Labels remain committed geometry. Once their cue yields to writing,
      // leave the nib at its actual position rather than completing gestures.
      if (deadlineExpired()) continue;

      // Writing a label leaves the pen beyond its trace start. Spend the
      // remaining lead on that return, so the calmer hop does not steal the
      // first word of the explanation from the trace itself.
      const remainingMs = Math.max(0, startMs() - options.getAudioPositionMs());
      const returnMs = boundDuration(focusHopMs(penAt, first, options.flightBudgetMs?.(remainingMs) ?? remainingMs), traceParts + 1);
      if (Math.hypot(penAt.x - first.x, penAt.y - first.y) >= NIB_SETTLE_PX) {
        // An exhausted lead settles the nib immediately while this cue still
        // owns the pen; an expired deadline must never catch up its endpoint.
        // A minimum hop after the word would delay the explanation again.
        await flyTo(first, returnMs);
        if (options.isCancelled()) return true;
        penAt = first;
      }

      await options.waitUntilAudioMs(startMs(), options.getTiming ? startMs : undefined);
      if (options.isCancelled()) return true;

      // The trace gets what is left of the clause, hops included, so the
      // ring fades as the clause ends rather than a second in.
      const now = options.getAudioPositionMs();
      const pulseMs = options.emphasis === "pulse" && target.pulse ? FOCUS_PULSE_MS : 0;
      // The pulse and the hop to it are reserved out of the clause too.
      const pulseReserveMs = pulseMs > 0 ? pulseMs + FOCUS_HOP_MAX_MS : 0;
      const endMs = Math.min(windowFor(target).endMs, deadlineMs() ?? Number.POSITIVE_INFINITY);
      const budgetMs = Math.max(endMs - now - pulseReserveMs, options.floorMs);
      const perPathMs = budgetMs / target.paths.length;
      for (const [pathIndex, candidate] of target.paths.entries()) {
        if (options.isCancelled()) return true;
        if (deadlineExpired()) break;
        const remainingParts = (target.paths.length - pathIndex) * 2 + pulseParts;
        const pathHole = pathIndex > 0 ? holeFor(target, pathIndex) : null;
        if (spotlight && pathHole) scope.setSpotlight?.({ ...spotlight, hole: pathHole });
        const hopMs = boundDuration(focusHopMs(penAt, candidate, perPathMs / 3), remainingParts);
        if (hopMs > 0) await flyTo(candidate, hopMs);
        if (options.isCancelled()) return true;
        await trace(
          "underline",
          candidate.path,
          boundDuration(Math.max(Math.round(perPathMs - hopMs), FOCUS_PATH_MIN_MS), remainingParts - 1),
          1.25,
        );
        // A traced path leaves the pen at its far end, which only the
        // whiteboard knows.
        penAt = null;
      }

      if (pulseMs > 0 && target.pulse) {
        if (options.isCancelled()) return true;
        const leftMs = Math.min(windowFor(target).endMs, deadlineMs() ?? Number.POSITIVE_INFINITY) - options.getAudioPositionMs() - pulseMs;
        const hopMs = boundDuration(focusHopMs(penAt, target.pulse, Math.max(leftMs, FOCUS_HOP_MIN_MS)), 2);
        if (hopMs > 0) await flyTo(target.pulse, hopMs);
        if (options.isCancelled()) return true;
        await trace("circle_around", target.pulse.path, boundDuration(pulseMs), 1.1);
        penAt = null;
      }
    }
    return false;
  });
}
