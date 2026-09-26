/**
 * Marker stunts — the tricks the hand does with the pen when it has nothing
 * to write.
 *
 * `penIdle` is the quiet half of a pause: rolls, taps, a bob, a drift out and
 * back. Deliberately small, because those run constantly and anything larger
 * would read as the pen being taken somewhere. This module is the loud half,
 * and the student picks it: four tricks a person actually does with a pen,
 * each big enough to be worth watching once, each rare enough that seeing one
 * is a small event rather than wallpaper.
 *
 * The selection is a *list*, not a switch. Whichever tricks the student has
 * chosen are the only ones drawn; an empty list is the hand with no tricks at
 * all. That is the shape the setting is stored in and the shape the board is
 * handed, so "the ones I picked" and "the ones it plays" cannot drift apart.
 *
 *   thumbAround  the barrel swung a full turn around the thumb, the hand
 *                orbiting a small circle under it
 *   knuckleRoll  the pen walked out across the knuckles and back, four beats,
 *                rolling most of a turn out and all of it back
 *   helicopter   two fast flat turns with the hand dipping toward the board
 *   tossCatch    flicked up off the board, one turn in the air, caught
 *
 * The rules are the ones the idle repertoire already holds to, because a stunt
 * that breaks them is worse than no stunt at all:
 *
 *  - Every stunt starts and ends at exactly rest, with zero slope at both
 *    ends. Nothing pops into or out of one.
 *  - A turn is a *whole* turn. A stunt that ends the barrel at 290° would snap
 *    the last 70° on the frame it finishes.
 *  - Nothing touches opacity. The marker is never less visible during a stunt
 *    than it is standing still; a trick that blinks the pen out is the exact
 *    complaint this whole area exists to answer.
 *  - Travel and lift are bounded. A stunt is performed where the pen stands,
 *    so it can never be mistaken for the pen being carried somewhere.
 *
 * Everything is a pure function of (t, seed inputs), so `verify-pen-stunts`
 * measures the motion without a canvas.
 */

import { bell, holdEnvelope, pulseTrain, smootherstep } from "./penChoreography";
import { clamp01 } from "./penMotion";

export type StuntKind = "thumbAround" | "knuckleRoll" | "helicopter" | "tossCatch";

export const STUNT_KINDS: readonly StuntKind[] = [
  "thumbAround",
  "knuckleRoll",
  "helicopter",
  "tossCatch",
];

/**
 * Display copy for the four tricks.
 *
 * It lives beside the motion rather than in the settings screen so a stunt
 * cannot exist in the engine without a name a student would recognise, and so
 * the same words appear in the drawer, the account page and the preview page.
 * `verify-pen-stunts` holds every kind to having both.
 */
export interface StuntCopy {
  /** Two or three words, as a student would say it. */
  label: string;
  /** One sentence describing what the hand does. No trailing full stop. */
  caption: string;
}

export const STUNT_COPY: Record<StuntKind, StuntCopy> = {
  thumbAround: {
    label: "Thumb spin",
    caption: "A full turn around the thumb, the hand circling under it",
  },
  knuckleRoll: {
    label: "Knuckle roll",
    caption: "Walked out across the knuckles and back, four beats",
  },
  helicopter: {
    label: "Helicopter",
    caption: "Two fast flat turns, dipping toward the board",
  },
  tossCatch: {
    label: "Toss and catch",
    caption: "Flicked up off the board, one turn in the air, caught",
  },
};

/** Narrow an unknown value to a stunt the engine actually has. */
export function parseStuntKinds(value: unknown): StuntKind[] {
  const raw =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value
        : [];
  const picked: StuntKind[] = [];
  for (const entry of raw) {
    const trimmed = typeof entry === "string" ? entry.trim() : "";
    // Order follows STUNT_KINDS rather than the input, and duplicates collapse,
    // so two stored orderings of the same selection are the same selection.
    if (isStuntKind(trimmed) && !picked.includes(trimmed)) picked.push(trimmed);
  }
  return STUNT_KINDS.filter((kind) => picked.includes(kind));
}

/** The stored form: a stable, comma-separated list. */
export function serializeStuntKinds(kinds: readonly StuntKind[]): string {
  return parseStuntKinds(kinds).join(",");
}

const STUNT_KIND_SET = new Set<string>(STUNT_KINDS);

export function isStuntKind(kind: string): kind is StuntKind {
  return STUNT_KIND_SET.has(kind);
}

/**
 * A trick is slower than a fidget. A thumb-around done in 600ms is a twitch;
 * done in a second and a half it is a hand playing with a pen.
 */
export const STUNT_MS: Record<StuntKind, number> = {
  thumbAround: 1500,
  knuckleRoll: 1750,
  helicopter: 1300,
  tossCatch: 1900,
};

/**
 * Weights inside the stunt pool. The toss is the biggest read on the board and
 * the one that would tire first, so it comes up least.
 */
export const STUNT_WEIGHT: Record<StuntKind, number> = {
  thumbAround: 1.2,
  knuckleRoll: 1.1,
  helicopter: 1,
  tossCatch: 0.7,
};

/**
 * How much of the idle repertoire a stunt is allowed to be, as weight against
 * the ten plain gestures. The gesture weights sum to about 11.4, so this is
 * roughly one slot in eight — a trick every few pauses, not every pause.
 */
export const STUNT_POOL_WEIGHT = 1.45;

/**
 * A stunt is never the first thing that happens in a pause. The hand has to
 * look like it settled into having nothing to do before it starts performing,
 * and a trick on the opening beat of every pause is a tic.
 */
export const STUNT_EARLIEST_INDEX = 1;

/**
 * Nor two close together: this many plain gestures must pass between tricks.
 * `pickKind` already bars the last two kinds, which would only stop the *same*
 * trick twice running; this stops a thumb-around followed by a toss.
 */
export const STUNT_SEPARATION = 2;

/** A stunt travels further than a fidget, but still nowhere. */
export const STUNT_TRAVEL_MAX_PX = 34;
/** And further off the board, because a toss leaves it. */
export const STUNT_LIFT_MAX_PX = 30;
/** Peak lift of the toss, before mood and the soft cap. */
const TOSS_LIFT_PX = 26;
/** How wide the hand orbits under a thumb-around. */
const THUMB_ORBIT_PX = 9;
/** How far out the pen walks across the knuckles. */
const KNUCKLE_REACH_PX = 17;

/**
 * One stunt's departure from rest at `t` in [0, 1], before mood and the caps.
 *
 * Shaped exactly like the idle repertoire's own frame so `penIdle` can apply
 * one stunt and one gesture through the same path, and nothing can end up with
 * two sets of end conditions.
 */
export interface StuntFrame {
  dx: number;
  dy: number;
  tiltOffset: number;
  spin: number;
  lift: number;
  scaleUp: number;
  /**
   * True when the spin term is a whole number of turns. Mood may not scale it:
   * 0.8 of a turn does not end where it began, so a low-energy pause would
   * leave the barrel short and snap it back the frame the stunt ends.
   */
  fullTurn?: boolean;
}

const REST: StuntFrame = { dx: 0, dy: 0, tiltOffset: 0, spin: 0, lift: 0, scaleUp: 0 };

/**
 * Where a stunt has the instrument at `t`.
 *
 * `swing` is ±1 so a trick reads left- or right-handed, `hover` is how far off
 * the board the resting hand is already holding the nib — a stunt that has to
 * touch down cancels it.
 */
export function stuntFrame(
  kind: StuntKind,
  t: number,
  swing: number,
  hover: number,
  roll1: number,
  roll2: number,
): StuntFrame {
  const u = clamp01(t);

  if (kind === "thumbAround") {
    // The barrel goes all the way round the thumb while the hand itself
    // orbits a small circle under it. `bell` on both axes is what keeps the
    // orbit from opening or closing with a velocity: the circle is traced and
    // then quietly stops existing.
    const env = bell(u);
    const phase = 2 * Math.PI * u;
    const radius = THUMB_ORBIT_PX * (0.78 + 0.34 * roll1);
    return {
      dx: swing * radius * Math.sin(phase) * env,
      dy: -radius * 0.55 * (1 - Math.cos(phase)) * env,
      // The wrist rolls back under the turn and comes level again.
      tiltOffset: swing * 5.5 * Math.sin(phase) * env,
      spin: swing * 360 * smootherstep(u),
      lift: 8.5 * env,
      scaleUp: 0.055 * env,
      fullTurn: true,
    };
  }

  if (kind === "knuckleRoll") {
    // The pen walks out across the knuckles and comes back. Four beats in the
    // ripple, a big roll of the barrel that returns to where it started, and
    // the hand drifting outward under it.
    const env = holdEnvelope(u, 0.2, 0.24);
    const walk = bell(u);
    const beats = pulseTrain(u, 4);
    return {
      dx: swing * KNUCKLE_REACH_PX * walk,
      // Each knuckle the pen crosses is a small step up and a settle.
      dy: -2.6 * beats * env - 1.4 * walk,
      tiltOffset: swing * (4 + 3 * roll2) * beats * env,
      // Out most of a turn and all the way back: net zero, so mood may scale
      // it without leaving the barrel short.
      spin: swing * 168 * Math.sin(2 * Math.PI * u) * env,
      lift: 6.2 * walk + 1.6 * beats * env,
      scaleUp: 0.02 * walk,
    };
  }

  if (kind === "helicopter") {
    // Two flat turns close to the board, the hand dipping toward it as the
    // barrel picks up speed. 720° is still a whole number of turns.
    const env = bell(u);
    return {
      dx: swing * 2.4 * env,
      dy: 3.1 * env,
      tiltOffset: 0,
      spin: swing * 720 * smootherstep(u),
      // Stays near the surface: most of the resting hover is given back, so
      // the barrel turns flat against the board rather than reading as the pen
      // being lifted away and spun.
      lift: (3.4 - hover * 0.75) * env,
      scaleUp: 0.03 * env,
      fullTurn: true,
    };
  }

  if (kind === "tossCatch") {
    // Flicked up off the board, one turn in the air, caught. `bell` is the
    // ballistic arc: it leaves the hand and returns to it with no velocity at
    // either end, which is the only way a catch can be silent.
    const flight = bell(u);
    const lean = Math.sin(Math.PI * u);
    return {
      dx: swing * (4.5 + 3 * roll1) * lean * lean,
      dy: -6.5 * flight,
      // The barrel is thrown a little away from the hand and squares up again.
      tiltOffset: swing * 4 * flight,
      spin: swing * 360 * smootherstep(u),
      lift: TOSS_LIFT_PX * (0.85 + 0.3 * roll2) * flight,
      // It comes toward the viewer as it rises, which is what sells the height.
      scaleUp: 0.115 * flight,
      fullTurn: true,
    };
  }

  return REST;
}
