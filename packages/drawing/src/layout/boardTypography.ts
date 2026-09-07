/**
 * The board's writing style, in one place.
 *
 * A teacher at a whiteboard writes at a handful of sizes and every one of them
 * means something: the topic across the top, the working underneath it at one
 * steady size, the names on the figure smaller than the working, and the
 * measurements smaller again. What a teacher never does is write each line at
 * whatever size happens to make it reach the edge of the board.
 *
 * That is exactly what this board used to do. Three layers each picked a size
 * for the same row by shrinking it one pixel at a time until it fit:
 * `fitWorkTextCommand` from 32 down to 12 against a fixed 282px column,
 * `fitWorkRowFontSize` from 36 down to 24 against the real column, and a bare
 * `32` fallback in the executor. Shrinking was tried before wrapping, so a long
 * line became a tiny line rather than two ordinary ones. Measured down one
 * board: 23, 28, 32, 32, 28, 17, 26. Every row a different size, and the 17px
 * row was a sentence the student was meant to copy.
 *
 * So the rules here are:
 *
 *   1. Size is chosen by ROLE, not by length. Every role has exactly one size.
 *   2. Text that does not fit is WRAPPED, at that same size.
 *   3. Only a single unbreakable token — a chemical formula, a long symbol —
 *      may drop the size, and then it drops to the next step on the scale for
 *      the whole block, never to a bespoke per-row number.
 *
 * The steps are far enough apart to read as deliberate (about a 1.28 ratio)
 * and few enough that one board never shows more than three of them.
 */
import { measureTextWidth } from "../handwriting/handwriting";

/**
 * What a piece of board text *is*. The role decides the size; nothing else may.
 */
export type BoardTextRole =
  /** The topic across the top of a page. At most one per page. */
  | "heading"
  /** A row of the solution column: a name, a relation, a substitution, a result. */
  | "work"
  /** A name on the figure: `O`, `F`, `principal axis`. Reads under the working. */
  | "label"
  /** A measurement, a unit, an aside pinned to the figure. The quietest ink. */
  | "annotation";

/**
 * The scale. Five steps, each about 1.28x the one below it.
 *
 * `work` and `workNarrow` are the same role at two column widths: beside a
 * figure the solution column is roughly a quarter of the board, and one
 * smaller size for the whole turn is steadier than trimming each row to its
 * own. The turn's figure is committed before narration starts, so which of the
 * two applies is fixed for the lesson and never changes under the student.
 */
export const BOARD_TYPE_SCALE = {
  heading: 46,
  work: 36,
  workNarrow: 28,
  label: 24,
  annotation: 19,
} as const;

/**
 * The scale in descending order. A block that cannot fit at its role's size
 * steps down this list, so every size on the board is one of these five.
 */
export const BOARD_TYPE_STEPS: readonly number[] = [
  BOARD_TYPE_SCALE.heading,
  BOARD_TYPE_SCALE.work,
  BOARD_TYPE_SCALE.workNarrow,
  BOARD_TYPE_SCALE.label,
  BOARD_TYPE_SCALE.annotation,
];

/** Nothing is ever drawn smaller than the bottom of the scale. */
export const MIN_BOARD_FONT_SIZE = BOARD_TYPE_SCALE.annotation;

/** Nothing is ever drawn larger than the top of it. */
export const MAX_BOARD_FONT_SIZE = BOARD_TYPE_SCALE.heading;

/**
 * A column at or under this width is the one beside a figure, not the whole
 * board. Set above the 282px worst case so a figure that sits a little further
 * right does not flip the whole turn up to the full-width size.
 */
export const NARROW_COLUMN_MAX_WIDTH = 460;

/**
 * How far a wrapped continuation is set in from the column margin.
 *
 * A wrapped row is not a new step, and at the same left edge it would read as
 * one. The indent is what says "this is still the line above".
 */
export const WORK_CONTINUATION_INDENT = 28;

/** The steady size for a solution row in a column of this width. */
export function workRowFontSize(columnWidth: number): number {
  return Number.isFinite(columnWidth) && columnWidth <= NARROW_COLUMN_MAX_WIDTH
    ? BOARD_TYPE_SCALE.workNarrow
    : BOARD_TYPE_SCALE.work;
}

/** The size for a role, before any column is taken into account. */
export function boardFontSize(role: BoardTextRole, columnWidth?: number): number {
  if (role === "work") return workRowFontSize(columnWidth ?? Number.POSITIVE_INFINITY);
  return BOARD_TYPE_SCALE[role];
}

/** Snap any incoming number onto the scale, rounding down to a real step. */
export function snapToBoardTypeScale(fontSize: number): number {
  if (!Number.isFinite(fontSize)) return BOARD_TYPE_SCALE.work;
  if (fontSize >= MAX_BOARD_FONT_SIZE) return MAX_BOARD_FONT_SIZE;
  for (const step of BOARD_TYPE_STEPS) {
    if (fontSize >= step) return step;
  }
  return MIN_BOARD_FONT_SIZE;
}

/** The next step down the scale, or null at the floor. */
export function nextSmallerBoardFontSize(fontSize: number): number | null {
  const snapped = snapToBoardTypeScale(fontSize);
  const index = BOARD_TYPE_STEPS.indexOf(snapped);
  const next = index >= 0 ? BOARD_TYPE_STEPS[index + 1] : null;
  return next ?? null;
}

/** Characters a line may break before, so the operator leads the next row. */
const LEADING_BREAK = /[+\-−×÷=→≈≤≥]/u;
/**
 * The best place to break: a clause boundary the reader already stops at. A
 * given list broken at its comma reads as a list carrying on; the same list
 * broken at the space inside `f = -15 cm` reads as two half-facts.
 */
const CLAUSE_BREAK = /[,;]/u;
/** Next best: any space between words. */
const TRAILING_BREAK = /\s/u;
/**
 * A row may not end here. `Given: u = -20 cm, f =` reads as a broken equation
 * rather than as a line that carried on, so a break that leaves a relation or a
 * binary operator hanging off the end is rejected and the search keeps going.
 */
const DANGLING_TAIL = /[=+\-−×÷→≈≤≥([{^_/*]$/u;

/** Is this a place a row could honestly stop? */
function isCleanBreak(head: string): boolean {
  const trimmed = head.trim();
  return trimmed.length > 0 && !DANGLING_TAIL.test(trimmed);
}

/**
 * The longest prefix of `text` that fits `maxWidth` at `fontSize`, in characters.
 * At least one character, so the caller always makes progress.
 */
function fittingPrefixLength(text: string, fontSize: number, maxWidth: number): number {
  let fit = 1;
  for (let index = 2; index <= text.length; index += 1) {
    if (measureTextWidth(text.slice(0, index), fontSize) > maxWidth) break;
    fit = index;
  }
  return fit;
}

export interface WrapBoardTextOptions {
  /**
   * Allow a cut inside a token when no boundary is reachable. Off by default:
   * `CH3CH2` broken across two rows says something the formula does not, so a
   * caller tries a smaller size first and only turns this on at the floor.
   */
  allowHardSplit?: boolean;
  /**
   * Width available to rows after the first. Continuations are set in from the
   * margin, so they have that much less room than the row they carry on from.
   */
  continuationWidth?: number;
}

/**
 * Break one line into rows that fit the column, all at the same size.
 *
 * Where it breaks, in order of preference: a word or separator boundary, then
 * *before* a binary operator so the continuation opens with it the way a
 * teacher writes a spilled equation. Returns null when neither is reachable
 * and hard splitting was not allowed — that is the caller's cue to step down
 * the scale rather than cut a token in half.
 */
export function wrapBoardText(
  text: string,
  fontSize: number,
  maxWidth: number,
  options: WrapBoardTextOptions = {},
): string[] | null {
  const source = text.trim();
  if (!source) return [];
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return [source];
  if (measureTextWidth(source, fontSize) <= maxWidth) return [source];

  const continuationWidth =
    Number.isFinite(options.continuationWidth) && (options.continuationWidth ?? 0) > 0
      ? Math.min(options.continuationWidth!, maxWidth)
      : maxWidth;

  const lines: string[] = [];
  let remaining = source;
  let width = maxWidth;

  while (remaining && measureTextWidth(remaining, fontSize) > width) {
    const fit = fittingPrefixLength(remaining, fontSize, width);
    // Never search back past the middle of what fits: a break that early
    // wastes more of the row than the tidier boundary is worth.
    const floor = Math.max(1, Math.floor(fit * 0.5));

    let splitAt = -1;
    for (const boundary of [CLAUSE_BREAK, TRAILING_BREAK]) {
      for (let index = fit; index >= floor; index -= 1) {
        if (
          boundary.test(remaining[index - 1] ?? "") &&
          isCleanBreak(remaining.slice(0, index))
        ) {
          splitAt = index;
          break;
        }
      }
      if (splitAt >= 0) break;
    }
    if (splitAt < 0) {
      for (let index = fit; index >= floor; index -= 1) {
        // Break *before* the operator, and only when it is a separator between
        // two terms — a leading sign on the first term is not a break point.
        if (
          LEADING_BREAK.test(remaining[index - 1] ?? "") &&
          index - 1 >= floor &&
          isCleanBreak(remaining.slice(0, index - 1))
        ) {
          splitAt = index - 1;
          break;
        }
      }
    }
    if (splitAt < 1) {
      if (!options.allowHardSplit) return null;
      splitAt = fit;
    }

    const head = remaining.slice(0, splitAt).trim();
    if (!head) break;
    lines.push(head);
    remaining = remaining.slice(splitAt).trim();
    width = continuationWidth;
  }

  if (remaining) lines.push(remaining);
  return lines;
}

export interface BoardTextBlock {
  /** One size for every row of this block. Always a step on the scale. */
  fontSize: number;
  /** The rows, in order. The first is the row itself; the rest are continuations. */
  lines: string[];
}

export interface FitBoardTextOptions {
  role: BoardTextRole;
  /** Width the block has to live in. */
  maxWidth: number;
  /** Force a size instead of deriving one from the role. Snapped to the scale. */
  fontSize?: number;
}

/**
 * Lay out one piece of board text: pick its size once, then wrap to it.
 *
 * The size only drops below the role's own when wrapping cannot help — a
 * single token wider than the column — and then it drops a whole step for the
 * whole block, so the block stays internally uniform and the board still shows
 * only sizes from the scale.
 */
export function fitBoardText(text: string, options: FitBoardTextOptions): BoardTextBlock {
  const source = text.trim();
  const base = options.fontSize !== undefined
    ? snapToBoardTypeScale(options.fontSize)
    : boardFontSize(options.role, options.maxWidth);

  if (!source) return { fontSize: base, lines: [] };
  const maxWidth = Number.isFinite(options.maxWidth) && options.maxWidth > 0
    ? options.maxWidth
    : Number.POSITIVE_INFINITY;

  // Work rows set their continuations in from the margin, so those rows have
  // the indent less room. Measuring them against the full column is how a
  // wrapped row ends up overhanging the figure it was wrapped to avoid.
  const wrapOptions: WrapBoardTextOptions = options.role === "work" && Number.isFinite(maxWidth)
    ? { continuationWidth: maxWidth - WORK_CONTINUATION_INDENT }
    : {};

  let fontSize = base;
  for (;;) {
    const lines = wrapBoardText(source, fontSize, maxWidth, wrapOptions);
    if (lines !== null) return { fontSize, lines };

    const smaller = nextSmallerBoardFontSize(fontSize);
    if (smaller === null) break;
    fontSize = smaller;
  }

  // A token that will not fit at any step on the scale. Cutting it is the last
  // thing left, and it happens at the floor so the cut is as late as possible.
  return {
    fontSize,
    lines: wrapBoardText(source, fontSize, maxWidth, { ...wrapOptions, allowHardSplit: true })
      ?? [source],
  };
}
