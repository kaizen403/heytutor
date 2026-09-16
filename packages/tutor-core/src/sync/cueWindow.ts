import type { DrawCommand } from "@heytutor/drawing";
import { mathToSpeech, type AudioTimings } from "../tts/elevenLabsClient";
import { getCommandDrawDurationMs, getFlightDuration } from "./audioSync";

/**
 * The pen follows the voice through a figure intro.
 *
 * A verified figure is spoken one reveal group at a time, and every command in
 * the group carries a `spokenCue`: the word in that sentence which names the
 * part it draws. This module turns the word into a slice of the segment's
 * audio clock and into an ink budget for the part, so the mirror is drawn
 * while "mirror" is said and the pole is marked while "pole" is said.
 *
 * Measured before this existed (10 Sep 2026, concave mirror lesson): the whole
 * intro was one 10.26 s sentence, the fourteen strokes were capped to 1.3 s in
 * total by the scene batch cap and drawn in 3.5 s, and the pen then parked for
 * 3.3 s. No stroke waited for its word because intro commands had no word.
 */

export interface SpokenCue {
  token: string;
  entityId: string;
}

export interface CueSpeechWindow {
  /** Media ms from segment audio start when the cue word begins. */
  startMs: number;
  /**
   * Media ms when the window closes: the start of the next part's word when
   * the caller names one, otherwise the end of the sentence. Never earlier
   * than the end of the cue word itself.
   */
  endMs: number;
  /** Media ms the whole sentence lasts. */
  totalMs: number;
  /** False when the word is not in the sentence; the window then runs on from the cursor. */
  matched: boolean;
  /**
   * Character index (into the spoken sentence) of the matched word. Pass it
   * back as `cursor` for the next command so matching walks forward through
   * the sentence and never doubles back, while a run of commands sharing one
   * word still lands on the same occurrence.
   */
  cursor: number;
}

/** The voice's measured rate when the session has not yet calibrated one. */
export const CUE_DEFAULT_MS_PER_CHAR = 86;

/** The nib's speed on figure ink, mirrored from the whiteboard's INK_SPEED_PX_PER_MS. */
export const CUE_INK_SPEED_PX_PER_MS = 2;
/** Shortest stroke the whiteboard will animate, mirrored from SCENE_SHAPE_MIN_MS. */
export const CUE_STROKE_MIN_MS = 70;
/**
 * What one command costs the hand beyond its ink: the frames a hop, a tween
 * start and a settle each take. Measured live on 10 Sep 2026 as 150 to 250 ms
 * wall per command (a 12 px point took 164 to 247 ms against a 72 ms budget),
 * which is 225 to 375 media ms at the default 1.5x. Left out of the floor, a
 * 26 stroke circuit was budgeted at 5 s and took 11.
 */
export const CUE_COMMAND_OVERHEAD_MS = 180;
/**
 * How far a stroke may be drawn out over hand speed to sit under its word.
 * A part is drawn at a teacher's unhurried pace and the pen then holds on it;
 * stretching a 40 px tick over a two second clause reads as a stalled board.
 */
export const CUED_STRETCH_MAX = 4;
/**
 * How far past its follow natural a big figure shape may be drawn out. The
 * follow naturals were set for work-area strokes; a 1400 px area rectangle
 * under a four second sentence is drawn over two, not one and a half.
 */
export const CUED_FOLLOW_STRETCH = 1.5;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word search. Short names ("P", "mg", "F'") are matched case
 * sensitively because "a" and "A" are different labels; longer words are
 * matched regardless of case so "Mirror" at a sentence start still counts.
 */
export function findSpokenToken(spoken: string, token: string, from = 0): number {
  const needle = token.trim();
  if (!needle) return -1;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
    needle.length <= 3 ? "gu" : "giu",
  );
  pattern.lastIndex = Math.max(0, Math.min(from, spoken.length));
  const match = pattern.exec(spoken);
  return match ? match.index : -1;
}

function usableTimings(timings: AudioTimings | null | undefined): AudioTimings | null {
  if (!timings || timings.charStartTimes.length === 0 || !(timings.totalDuration > 0)) {
    return null;
  }
  return timings;
}

function charStartMs(
  index: number,
  timings: AudioTimings | null,
  msPerChar: number,
): number {
  if (!timings) return Math.round(Math.max(index, 0) * msPerChar);
  const clamped = Math.max(0, Math.min(index, timings.charStartTimes.length - 1));
  return Math.max(Math.round((timings.charStartTimes[clamped] ?? 0) * 1000), 0);
}

function charEndMs(
  index: number,
  timings: AudioTimings | null,
  msPerChar: number,
): number {
  if (!timings) return Math.round(Math.max(index + 1, 0) * msPerChar);
  const clamped = Math.max(0, Math.min(index, timings.charStartTimes.length - 1));
  const start = timings.charStartTimes[clamped] ?? 0;
  const duration = timings.charDurations[clamped] ?? 0.06;
  return Math.max(Math.round((start + duration) * 1000), 0);
}

/**
 * Where in the sentence's audio the cue word is spoken.
 *
 * Exact when the segment's alignment is known (every prefetched sentence has
 * one before it starts), estimated at `msPerChar` otherwise. `nextToken` is
 * the first later command's word that differs from this one; the window runs
 * up to it, which is how long a teacher keeps drawing the mirror before
 * moving on to "its pole".
 */
export function getCueSpeechWindow(
  narration: string,
  spokenCue: SpokenCue,
  timings: AudioTimings | null | undefined,
  msPerChar: number = CUE_DEFAULT_MS_PER_CHAR,
  cursor = 0,
  nextToken: string | null = null,
): CueSpeechWindow {
  const spoken = mathToSpeech(narration.trim());
  const aligned = usableTimings(timings);
  const rate = Number.isFinite(msPerChar) && msPerChar > 0 ? msPerChar : CUE_DEFAULT_MS_PER_CHAR;
  const totalMs = aligned
    ? Math.round(aligned.totalDuration * 1000)
    : Math.round(spoken.length * rate);
  const from = Math.max(0, Math.min(cursor, spoken.length));
  const token = mathToSpeech(spokenCue.token).trim();
  // The cursor sits at the end of the previous command's word. A run of parts
  // under one word shares it, so a token that ends exactly there is that same
  // word; a different token searches on from there, and cannot land on the
  // head of the phrase just matched ("pulley" inside "pulley support" used to
  // put the pulley under the support's word, 950 ms before its own).
  const sharedIndex = from - token.length;
  const index =
    sharedIndex >= 0 && findSpokenToken(spoken, token, sharedIndex) === sharedIndex
      ? sharedIndex
      : findSpokenToken(spoken, token, from);
  if (index < 0) {
    return {
      startMs: Math.min(charStartMs(from, aligned, rate), totalMs),
      endMs: totalMs,
      totalMs,
      matched: false,
      cursor: from,
    };
  }
  const tokenEnd = index + token.length;
  const startMs = charStartMs(index, aligned, rate);
  const wordEndMs = Math.min(charEndMs(tokenEnd - 1, aligned, rate), totalMs);
  let closeMs = totalMs;
  if (nextToken) {
    const next = mathToSpeech(nextToken).trim();
    const nextIndex = next ? findSpokenToken(spoken, next, tokenEnd) : -1;
    if (nextIndex >= 0) closeMs = charStartMs(nextIndex, aligned, rate);
  }
  return {
    startMs,
    endMs: Math.max(closeMs, wordEndMs, startMs),
    totalMs,
    matched: true,
    cursor: tokenEnd,
  };
}

/** Ink the pen has to lay for this command, from its geometry. */
export function estimateCommandInkLengthPx(command: DrawCommand): number {
  const p = command.params;
  const n = (index: number) => (Number.isFinite(p[index]) ? (p[index] as number) : 0);
  switch (command.type) {
    case "DRAW_LINE": {
      let length = 0;
      for (let i = 2; i + 1 < p.length; i += 2) {
        length += Math.hypot(n(i) - n(i - 2), n(i + 1) - n(i - 1));
      }
      return length;
    }
    case "ARROW":
      return Math.hypot(n(2) - n(0), n(3) - n(1)) + 24;
    case "DRAW_ARC":
      return (Math.abs(n(4) - n(3)) * Math.PI / 180) * Math.abs(n(2));
    case "DRAW_CIRCLE":
      return 2 * Math.PI * Math.abs(n(2));
    case "DRAW_POINT":
      return 2 * Math.PI * (Number.isFinite(p[2]) ? Math.abs(n(2)) : 2);
    case "DRAW_RECT":
      return 2 * (Math.abs(n(2)) + Math.abs(n(3)));
    case "DRAW_CUBE":
      return 9 * Math.abs(n(2));
    case "DRAW_CUBOID":
      return 4 * (Math.abs(n(2)) + Math.abs(n(3)) + Math.abs(n(4)));
    case "DIMENSION":
      return Math.hypot(n(2) - n(0), n(3) - n(1)) + 40;
    case "CIRCLE_AROUND":
      return Math.PI * (Math.abs(n(2)) + Math.abs(n(3)));
    case "UNDERLINE":
    case "HIGHLIGHT":
      return Math.abs(n(2));
    default:
      return 60;
  }
}

const TEXT_TYPES = new Set<DrawCommand["type"]>(["WRITE", "LABEL", "DIMENSION"]);

/**
 * The least time a cued command can honestly take: the nib at hand speed over
 * its ink, after the approach, and never under the whiteboard's own stroke
 * floor. Text keeps its handwriting natural, because a letter is read and
 * the execution path already refuses to letter it faster.
 */
export function cuedInkFloorMs(command: DrawCommand): number {
  // A compiled dimension is a bare bar; its value is a LABEL of its own.
  const isText = TEXT_TYPES.has(command.type)
    && (command.type !== "DIMENSION" || Boolean(command.text?.trim()));
  if (isText) {
    return getCommandDrawDurationMs(command, "follow");
  }
  if (
    command.type === "PAUSE" ||
    command.type === "CLEAR" ||
    command.type === "ERASE" ||
    command.type === "FRAME" ||
    command.type === "TYPE" ||
    command.type === "POINT"
  ) {
    return getCommandDrawDurationMs(command, "scene");
  }
  const strokeMs = Math.max(
    Math.round(estimateCommandInkLengthPx(command) / CUE_INK_SPEED_PX_PER_MS),
    CUE_STROKE_MIN_MS,
  );
  return getFlightDuration(command, "scene") + strokeMs + CUE_COMMAND_OVERHEAD_MS;
}

/**
 * The most a cued command should take: the teacher's unhurried pace for that
 * kind of mark, and never more than a few times its hand-speed time, so a
 * tick is not drawn out over a clause. Text has no stretch: a label takes the
 * time the hand takes to letter it, whatever the voice is doing.
 */
export function cuedInkCapMs(command: DrawCommand, floorMs = cuedInkFloorMs(command)): number {
  const isText = TEXT_TYPES.has(command.type)
    && (command.type !== "DIMENSION" || Boolean(command.text?.trim()));
  if (isText) return floorMs;
  const natural = Math.round(getCommandDrawDurationMs(command, "follow") * CUED_FOLLOW_STRETCH);
  return Math.max(Math.min(natural, Math.round(floorMs * CUED_STRETCH_MAX)), floorMs);
}

export interface CueWindowSharers {
  /** Sum of the floors of the later commands drawn under this same word. */
  floorMs: number;
  /** Sum of (cap minus floor) of those commands: how far they can be drawn out. */
  capacityMs: number;
}

/**
 * The commands after `index` that share its cue word, contiguous. Four rays
 * under "rays" split the window between them rather than the first taking
 * it all and the rest sprinting after the word has passed.
 */
export function cueWindowSharers(
  commands: ReadonlyArray<{ spokenCue?: SpokenCue }>,
  index: number,
  floorsMs: ReadonlyArray<number>,
  capsMs: ReadonlyArray<number>,
): CueWindowSharers {
  const token = commands[index]?.spokenCue?.token;
  let floorMs = 0;
  let capacityMs = 0;
  if (!token) return { floorMs, capacityMs };
  for (let next = index + 1; next < commands.length; next++) {
    if (commands[next]?.spokenCue?.token !== token) break;
    const floor = floorsMs[next] ?? 0;
    floorMs += floor;
    capacityMs += Math.max((capsMs[next] ?? floor) - floor, 0);
  }
  return { floorMs, capacityMs };
}

/**
 * Hand time the parts after this word still need. A window may stretch its
 * parts only as far as leaves that much of the sentence: "weight" filled to
 * its last millisecond left "acceleration" a window shorter than its two
 * arrows and two letters, and the beat ran past the voice.
 */
export function cueWindowReserveMs(
  commands: ReadonlyArray<{ spokenCue?: SpokenCue }>,
  index: number,
  floorsMs: ReadonlyArray<number>,
): number {
  const token = commands[index]?.spokenCue?.token;
  let next = index + 1;
  while (next < commands.length && commands[next]?.spokenCue?.token === token) next++;
  let reserve = 0;
  for (; next < commands.length; next++) reserve += floorsMs[next] ?? 0;
  return reserve;
}

/**
 * What is left of the word's window for this command once the pen has
 * waited for the word, less what the later words' parts still need.
 */
export function cueWindowRemainingMs(
  window: Pick<CueSpeechWindow, "endMs" | "totalMs">,
  startMs: number,
  reserveMs: number,
): number {
  return Math.min(window.endMs, window.totalMs - reserveMs) - startMs;
}

/** The first later command's word that differs from this one's, if any. */
export function nextDistinctCueToken(
  commands: ReadonlyArray<{ spokenCue?: SpokenCue }>,
  index: number,
): string | null {
  const token = commands[index]?.spokenCue?.token;
  for (let next = index + 1; next < commands.length; next++) {
    const candidate = commands[next]?.spokenCue?.token;
    if (candidate && candidate !== token) return candidate;
  }
  return null;
}

/**
 * Ink budget for one cued command.
 *
 * The part is drawn inside what is left of its word's window once the pen
 * has waited for the word. Commands sharing the window each keep their floor
 * and split the slack in proportion to how far each can be drawn out, so a
 * mirror arc takes the room a label beside it cannot use. Never under the
 * floor (a hand cannot go faster) and never over the cap (a hold on the
 * finished part is better than a crawl).
 */
export function cuedInkBudgetMs(input: {
  remainingMs: number;
  floorMs: number;
  capMs: number;
  sharers?: CueWindowSharers;
}): number {
  const floor = Math.max(Math.round(input.floorMs), 0);
  const cap = Math.max(Math.round(input.capMs), floor);
  const sharedFloor = Math.max(input.sharers?.floorMs ?? 0, 0);
  const sharedCapacity = Math.max(input.sharers?.capacityMs ?? 0, 0);
  const capacity = cap - floor;
  const slack = Math.max(input.remainingMs - floor - sharedFloor, 0);
  const totalCapacity = capacity + sharedCapacity;
  const share = totalCapacity > 0 ? (slack * capacity) / totalCapacity : 0;
  return Math.min(Math.max(Math.round(floor + share), floor), cap);
}
