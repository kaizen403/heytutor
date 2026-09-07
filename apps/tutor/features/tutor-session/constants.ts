import { DS } from "@heytutor/design-tokens";
import { WORK_ZONE } from "@heytutor/drawing";
import type { CanvasLandingSuggestion } from "@/features/tutor-session/components/CanvasLanding";
import { SOLARIZED_CHROME } from "./lib/code-lesson/solarizedEditor";

export const BOARD_WIDTH = DS.Canvas.width;
export const BOARD_HEIGHT = DS.Canvas.height;
export const WHITEBOARD_COLOR = "#FFFFFF";
export const PAGE_GUTTER_X = 10;
export const PAGE_GUTTER_Y = 6;
export const NOTES_CHAT_RAIL_WIDTH = 380;
// A long lesson (a proof, a multi-part problem) can outrun one response.
// One of these is also spent by the reasoning-only retry, so 1 left a deep
// lesson with no continuation at all.
export const MAX_LLM_CONTINUATIONS = 2;
export const STREAM_SEGMENTS_LIVE = true;

/** Empty-board prompts. Cap is 5: a sixth card forces a scroll, and a second column clips. */
export const LANDING_SUGGESTIONS: CanvasLandingSuggestion[] = [
  {
    topic: "Projectiles",
    question:
      "A ball is thrown at 20 m/s at 30° above the horizontal. Find the maximum height and the range.",
  },
  {
    topic: "Resistors",
    question:
      "A 9 V supply and two 4.7 kΩ resistors in series. Find the voltage at the midpoint.",
  },
  {
    topic: "Ray optics",
    question:
      "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.",
  },
  {
    topic: "Resistors",
    question:
      "Explain why three equal resistors have a larger equivalent resistance in series than in parallel.",
  },
  {
    topic: "Ray optics",
    question:
      "Derive the mirror formula 1/v + 1/u = 1/f and explain what each term means.",
  },
];

/**
 * Work-row handwriting size. Runtime-owned, never the teaching model's — one
 * size for every row of every lesson, because text that changes size partway
 * down a board reads as a fault rather than as emphasis.
 *
 * The board's whole type scale lives in `@heytutor/drawing`'s `boardTypography`:
 * a heading above this, figure labels and measurements below it, and nothing in
 * between. `Whiteboard.writeText` snaps whatever it is handed onto that scale.
 */
export const WORK_ROW_FONT_SIZE = WORK_ZONE.fontSize;

export const TEXT_LAYOUT = {
  marginX: 90,
  topY: 64,
  headingBottomY: 118,
  workTopY: 142,
  bottomY: 645,
  // Row pitch and ink height track WORK_ROW_FONT_SIZE. Seven rows fit a page
  // at this size (nine fitted at 32); the board turns its own page, so a
  // longer lesson simply fills more of them.
  lineHeight: WORK_ZONE.lineHeight,
  textHeight: 47,
  eraseX: 70,
  eraseY: 126,
  eraseWidth: 1060,
  eraseHeight: 520,
};

/**
 * Work rows that fit one board page, derived from the geometry above rather
 * than written down beside it — the two drifted apart the moment the row pitch
 * changed, and the teaching prompt quotes this number to the model.
 */
export const BOARD_WORK_ROWS_PER_PAGE =
  Math.floor(
    (TEXT_LAYOUT.bottomY - TEXT_LAYOUT.textHeight - TEXT_LAYOUT.workTopY) /
      TEXT_LAYOUT.lineHeight,
  ) + 1;

export const DIAGRAM_ZONE = {
  x: 400,
  y: 140,
  width: 760,
  height: 380,
};

/**
 * DSA code-lesson board split. The IDE panel replaces the handwriting work
 * column and is wider than it, so the verified diagram compiles into a
 * narrower right-hand zone than the standard `DIAGRAM_ZONE`.
 */
export const DSA_CODE_PANEL_RECT = {
  x: 24,
  y: 64,
  width: 576,
  height: 584,
};

export const DSA_DIAGRAM_ZONE = {
  x: 620,
  y: 90,
  width: 540,
  height: 460,
};

/**
 * Live CodeMirror, the typing caret, and the canvas export renderer share
 * these numbers so the pen can fly to the same glyph the editor is about to
 * type. Title-bar height is the Solarized Sublime chrome.
 */
export const DSA_EDITOR_METRICS = {
  tabHeight: SOLARIZED_CHROME.titleBarHeight,
  gutterWidth: 40,
  codeLeftPadding: 12,
  codeTopPadding: 6,
  fontSize: 13,
  lineHeight: 20,
  /** Approximate advance of Menlo / Consolas at 13px. */
  charWidth: 7.8,
} as const;

/** Board-space point of the editor caret after `revealedText` has been typed. */
export function codeLessonCaretBoardPoint(revealedText: string): { x: number; y: number } {
  const lines = revealedText.length === 0 ? [""] : revealedText.split("\n");
  const line = lines.length - 1;
  const column = lines[line]!.length;
  return {
    x:
      DSA_CODE_PANEL_RECT.x +
      DSA_EDITOR_METRICS.gutterWidth +
      DSA_EDITOR_METRICS.codeLeftPadding +
      column * DSA_EDITOR_METRICS.charWidth +
      1,
    y:
      DSA_CODE_PANEL_RECT.y +
      DSA_EDITOR_METRICS.tabHeight +
      DSA_EDITOR_METRICS.codeTopPadding +
      line * DSA_EDITOR_METRICS.lineHeight +
      DSA_EDITOR_METRICS.lineHeight * 0.45,
  };
}

/**
 * How often the marker catches up with the code caret while a block types.
 * Short enough that the pen looks like it is writing the line, long enough
 * that it is not re-animating every frame.
 */
export const CODE_CARET_FOLLOW_MS = 160;

export const ANNOTATION_SNAP_DISTANCE = 40;

/**
 * How long a code-lesson focus holds its spotlight.
 *
 * The veil greys the whole diagram zone except the entity under discussion, so
 * it is a glance, not a state: held for a whole spoken step it is exactly the
 * "the figure went grey and nothing happened" the board is meant to avoid. The
 * pen keeps walking after it lifts.
 */
export const CODE_FOCUS_SPOTLIGHT_MS = 1_600;
