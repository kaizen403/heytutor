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
 * rate except the wait itself, which the caller wires.
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
  /** The ring drawn after the trace when the emphasis is pulse. */
  pulse: FocusTracePath | null;
  /**
   * Letters the target's withheld labels and dimensions. Reports where it
   * left the pen so the hop back to the trace is sized by the distance.
   */
  letter: () => Promise<{ cancelled: boolean; penAt: FocusPenPoint | null }>;
}

export interface ScheduledFocusHost extends SpotlightHost {
  flyCursorTo: (x: number, y: number, durationMs: number) => Promise<void>;
  drawAnnotation: (
    kind: "underline" | "circle_around",
    path: string,
    durationMs: number,
    options: { strokeWidth: number; transient: true },
  ) => Promise<void>;
}

export interface ScheduledFocusOptions {
  emphasis: FocusEmphasis;
  /** The zone a spotlight dims. Null means no veil for this focus. */
  veil: SpotlightRect | null;
  /** The segment's audio clock, in media ms. */
  getAudioPositionMs: () => number;
  /** Resolves when the audio clock reaches targetMs, or on cancel. */
  waitUntilAudioMs: (targetMs: number) => Promise<void>;
  isCancelled: () => boolean;
  /** Least a target is traced for when its window has already passed. */
  floorMs: number;
}

/**
 * The pen leaves for a part this long before its name: a hop of up to 160 ms
 * and a one-glyph label fit inside it, so the label lands on the word and the
 * trace starts on it rather than a flight and a glyph later.
 */
export const FOCUS_FLIGHT_LEAD_MS = 320;
/** Longest hop between two points of a focus. */
const FOCUS_HOP_MAX_MS = 160;
/** A hop across a label's width still reads as a movement. */
const FOCUS_HOP_MIN_MS = 24;
/** Hand speed for a hop: 160 ms covers a quarter of the diagram zone. */
const FOCUS_HOP_PX_PER_MS = 1.6;
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
  const spotlight = options.emphasis === "spotlight" && options.veil
    ? {
        veil: options.veil,
        hole: paddedHole(targets.flatMap((target) => target.rects)),
        opacity: FOCUS_SPOTLIGHT_OPACITY,
      }
    : null;
  // The veil goes up once for the whole focus and comes down in
  // withSpotlight's finally, whatever happens in between. The hole moves
  // from target to target inside the body; that is a re-aim of a veil the
  // helper already owns, not a second raise.
  return withSpotlight(host, spotlight, async () => {
    let penAt: FocusPenPoint | null = null;
    for (const target of targets) {
      if (options.isCancelled()) return true;
      const first = target.paths[0];
      if (!first) continue;

      // Leave for the part a beat before its name so the pen stands on it,
      // label written, when the word lands rather than arriving a flight
      // and a glyph later.
      await options.waitUntilAudioMs(target.startMs - FOCUS_FLIGHT_LEAD_MS);
      if (options.isCancelled()) return true;
      if (spotlight) host.setSpotlight?.({ ...spotlight, hole: paddedHole(target.rects) });
      const approachMs = focusHopMs(penAt, first, FOCUS_HOP_MAX_MS);
      if (approachMs > 0) await host.flyCursorTo(first.x, first.y, approachMs);
      penAt = first;

      // The label's ink belongs to this target, so it is released here and
      // nowhere earlier: not by a WRITE row that contains its letter, and
      // not with the other targets' labels at the start of the sentence.
      const lettered = await target.letter();
      if (lettered.cancelled) return true;
      if (lettered.penAt) penAt = lettered.penAt;

      await options.waitUntilAudioMs(target.startMs);
      if (options.isCancelled()) return true;

      // The trace gets what is left of the clause, hops included, so the
      // ring fades as the clause ends rather than a second in.
      const now = options.getAudioPositionMs();
      const pulseMs = options.emphasis === "pulse" && target.pulse ? FOCUS_PULSE_MS : 0;
      // The pulse and the hop to it are reserved out of the clause too.
      const pulseReserveMs = pulseMs > 0 ? pulseMs + FOCUS_HOP_MAX_MS : 0;
      const budgetMs = Math.max(target.endMs - now - pulseReserveMs, options.floorMs);
      const perPathMs = budgetMs / target.paths.length;
      for (const candidate of target.paths) {
        if (options.isCancelled()) return true;
        const hopMs = focusHopMs(penAt, candidate, perPathMs / 3);
        if (hopMs > 0) await host.flyCursorTo(candidate.x, candidate.y, hopMs);
        await host.drawAnnotation(
          "underline",
          candidate.path,
          Math.max(Math.round(perPathMs - hopMs), FOCUS_PATH_MIN_MS),
          { strokeWidth: 1.25, transient: true },
        );
        // A traced path leaves the pen at its far end, which only the
        // whiteboard knows.
        penAt = null;
      }

      if (pulseMs > 0 && target.pulse) {
        if (options.isCancelled()) return true;
        const leftMs = target.endMs - options.getAudioPositionMs() - pulseMs;
        const hopMs = focusHopMs(penAt, target.pulse, Math.max(leftMs, FOCUS_HOP_MIN_MS));
        if (hopMs > 0) await host.flyCursorTo(target.pulse.x, target.pulse.y, hopMs);
        await host.drawAnnotation("circle_around", target.pulse.path, pulseMs, {
          strokeWidth: 1.1,
          transient: true,
        });
        penAt = null;
      }
    }
    return false;
  });
}
