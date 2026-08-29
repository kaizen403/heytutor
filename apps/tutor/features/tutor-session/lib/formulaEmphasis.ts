import { measureTextWidth } from "@heytutor/drawing";
import type { BoardTextRect } from "../types";

/**
 * Runtime-owned emphasis geometry for work-area formulas.
 *
 * The teaching stream may only say *which* row to emphasise (`[EMPHASIZE:last]`)
 * — never where it sits. Everything here is derived from the row the runtime
 * wrote itself, so emphasis stays deterministic and replayable.
 */

export interface EmphasisSpan {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

/** Relations that separate a statement from its result. */
const RESULT_SEPARATORS = ["=", "≈", "≅"];

/**
 * The part of a worked line worth highlighting: everything to the right of the
 * last relation sign. `v = u + at` highlights `u + at`; `x = 4.5 m` highlights
 * `4.5 m`. A row with no relation, or nothing either side of one, has no
 * result span and is only boxed.
 */
export function resultCharRange(rawText: string): { start: number; end: number } | null {
  const text = rawText ?? "";
  let separator = -1;
  for (const candidate of RESULT_SEPARATORS) {
    separator = Math.max(separator, text.lastIndexOf(candidate));
  }
  if (separator < 0) return null;

  // A relation with nothing in front of it is not a result, it is a fragment.
  if (text.slice(0, separator).trim().length === 0) return null;

  let start = separator + 1;
  while (start < text.length && /\s/.test(text[start]!)) start += 1;
  let end = text.length;
  while (end > start && /\s/.test(text[end - 1]!)) end -= 1;

  if (end <= start) return null;
  // If the "result" is the whole line there is nothing to single out.
  if (start === 0 && end === text.length) return null;
  return { start, end };
}

/**
 * Turn a character range into board geometry.
 *
 * `measureTextWidth` is the same metric the handwriting renderer uses, so a
 * prefix measurement lands on the glyph boundary rather than near it. It is
 * linear in `fontSize`, and the measured full width is rescaled onto the width
 * the row was actually laid out at — so the row's real font size cancels out
 * and never has to be threaded through the layout state.
 */
export function spanRectInRow(
  row: BoardTextRect,
  start: number,
  end: number,
): EmphasisSpan | null {
  const text = row.text ?? "";
  if (text.length === 0) return null;
  if (start < 0 || end > text.length || end <= start) return null;
  if (!(row.width > 0)) return null;

  const fullWidth = measureTextWidth(text);
  if (!(fullWidth > 0)) return null;

  const scale = row.width / fullWidth;
  const prefix = measureTextWidth(text.slice(0, start)) * scale;
  const width = measureTextWidth(text.slice(start, end)) * scale;
  if (!(width > 0)) return null;

  // Never let a measurement slip past the row it belongs to.
  const x = row.x + Math.max(0, Math.min(prefix, row.width));
  return {
    x,
    y: row.y,
    width: Math.max(1, Math.min(width, row.x + row.width - x)),
    height: row.height,
    text: text.slice(start, end),
  };
}

/** The highlightable result of a work row, or null when there is not one. */
export function resultSpanOfRow(row: BoardTextRect): EmphasisSpan | null {
  const range = resultCharRange(row.text ?? "");
  if (!range) return null;
  return spanRectInRow(row, range.start, range.end);
}
