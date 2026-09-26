/**
 * Which instrument the hand reaches for, what it leaves behind, and what a
 * change of hand costs.
 *
 * The rule splits on what the mark *is*: words are the pen, the figure and the
 * scaffolding it hangs off are the pencil, emphasis is the highlighter, erasing
 * is the duster. Two things have to hold at once, and each has been broken
 * before. The swap has to stay cheap — an early version swapped per command and
 * a lesson spent its time twirling — and the swap has to be *visible in the
 * ink*, because a hand that picks up a pencil and then lays down the pen's own
 * ink has not swapped anything the student can see.
 */
import assert from "node:assert/strict";
import {
  instrumentForActivity,
  instrumentInkStyle,
  instrumentPalette,
  instrumentMetrics,
  instrumentShapes,
  instrumentSilhouette,
  type InstrumentKind,
  type PenActivity,
} from "../src/instruments";
import { LEAN_GAIN, RESTING_TILT } from "../src/penChoreography";

const BOARD_INK = "#1B2A4A";

function verifyMapping(): void {
  const expected: Record<PenActivity, InstrumentKind> = {
    write: "pen",
    draw: "pencil",
    sketch: "pencil",
    annotate: "pen",
    highlight: "highlighter",
    erase: "duster",
    idle: "pen",
  };
  for (const [activity, kind] of Object.entries(expected) as [PenActivity, InstrumentKind][]) {
    assert.equal(
      instrumentForActivity(activity),
      kind,
      `${activity} must be done with the ${kind}`,
    );
  }

  // A figure and the scaffolding around it are one piece of work, so the hand
  // does not change mid-figure to add a tick or drop a line.
  assert.equal(
    instrumentForActivity("draw"),
    instrumentForActivity("sketch"),
    "a figure and its construction must be drawn with the same instrument",
  );
  // Words are not drawn.
  assert.notEqual(
    instrumentForActivity("write"),
    instrumentForActivity("draw"),
    "writing and drawing must be visibly different instruments",
  );

  // Every activity has a tilt and a lean, or the barrel snaps to zero.
  for (const activity of Object.keys(expected) as PenActivity[]) {
    assert.equal(typeof RESTING_TILT[activity], "number", `${activity} has no resting tilt`);
    assert.equal(typeof LEAN_GAIN[activity], "number", `${activity} has no lean gain`);
  }
  // A pencil laying in a line stands more upright than a pen writing a word.
  assert.ok(
    RESTING_TILT.sketch > RESTING_TILT.write,
    "the pencil must stand more upright than the pen",
  );
  assert.ok(
    RESTING_TILT.draw > RESTING_TILT.write,
    "a drawn line comes from the wrist and stands more upright than a written one",
  );
}

function verifyPencilIsDrawable(): void {
  const palette = instrumentPalette("pencil", BOARD_INK);
  assert.ok(palette.nib && palette.barrel && palette.outline);
  assert.notEqual(
    instrumentPalette("pencil", BOARD_INK).barrel,
    instrumentPalette("pen", BOARD_INK).barrel,
    "the pencil must not look like the pen, or the swap says nothing",
  );
  assert.ok(instrumentShapes("pencil").length > 0, "the pencil has no art");
  assert.ok(instrumentSilhouette("pencil").length >= 8, "the pencil has no silhouette to smear");
  assert.ok(instrumentMetrics("pencil").height > 0);
}

/**
 * The half that went missing. For a while the pencil was picked up correctly
 * and then laid down ink identical to the pen's — same colour, same width, same
 * opacity — so on the board there was no pencil at all.
 */
function verifyTheMarkChangesToo(): void {
  const pen = instrumentInkStyle("pen", BOARD_INK);
  const pencil = instrumentInkStyle("pencil", BOARD_INK);

  assert.equal(pen.color, BOARD_INK, "the pen lays down the board's own ink");
  assert.equal(pen.widthScale, 1, "the pen writes at the width the caller asked for");
  assert.equal(pen.opacity, 1, "ink is opaque");

  assert.notEqual(pencil.color, pen.color, "lead must not be the same colour as ink");
  assert.ok(pencil.widthScale < pen.widthScale, "lead must lay a thinner line than ink");
  assert.ok(pencil.opacity < pen.opacity, "lead must let the board show through");
  // ...but still be a mark, not a ghost.
  assert.ok(pencil.opacity > 0.6, `lead must still read as a mark, got ${pencil.opacity}`);
  assert.ok(pencil.widthScale > 0.6, `lead must not thin out to a hairline, got ${pencil.widthScale}`);

  // A red board sketches in red lead rather than in a fixed grey: the pencil
  // keeps a trace of whatever the board writes in.
  const redLead = instrumentInkStyle("pencil", "#B3261E");
  assert.notEqual(redLead.color, pencil.color, "lead must follow the board's ink colour");

  const customPen = instrumentInkStyle("pen", BOARD_INK, {
    pencilColor: "#D64545",
    markerThickness: 1.4,
    pencilThickness: 0.8,
  });
  const customPencil = instrumentInkStyle("pencil", BOARD_INK, {
    pencilColor: "#D64545",
    markerThickness: 1.4,
    pencilThickness: 0.8,
  });
  assert.equal(customPen.color, BOARD_INK, "pencil color does not recolor marker writing");
  assert.equal(customPen.widthScale, 1.4, "marker thickness changes writing width");
  assert.equal(customPencil.widthScale, pencil.widthScale * 0.8, "pencil thickness changes figure width");
  assert.equal(customPencil.color, instrumentInkStyle("pencil", "#D64545").color, "pencil color changes lead independently");
  assert.equal(instrumentInkStyle("pen", BOARD_INK, { markerThickness: 100 }).widthScale, 1.6, "an invalidly thick mark is bounded");
}

/**
 * A reveal group draws its structure first and its construction detail after,
 * so a figure picks the pencil up once. Replaying that order here is what stops
 * a future change to the reveal phases from turning one swap into forty.
 */
function verifySwapsStayCheap(): void {
  const lesson: PenActivity[] = [
    // Opening: the given list and the meaning line.
    "write", "write",
    // The figure: structure, then its construction scaffolding.
    "draw", "draw", "draw", "draw", "draw",
    "sketch", "sketch", "sketch",
    // Then the derivation, with a marker gesture in the middle of it.
    "write", "write", "annotate", "write", "write",
    "highlight",
    "write",
  ];

  let swaps = 0;
  let held = instrumentForActivity(lesson[0]!);
  for (const activity of lesson.slice(1)) {
    const next = instrumentForActivity(activity);
    if (next !== held) swaps += 1;
    held = next;
  }
  assert.equal(
    swaps,
    4,
    `this lesson has four instrument boundaries (into the figure, out of it, into and out of the highlighter), got ${swaps}`,
  );

  // The eight-beat figure block itself must cost exactly one swap: pick the
  // pencil up, draw the figure and its scaffolding, put it down.
  const figure = lesson.slice(2, 10);
  const figureKinds = new Set(figure.map(instrumentForActivity));
  assert.equal(figureKinds.size, 1, "a figure must be drawn without changing hands");

  // A gesture over existing ink is made with whatever is already in hand.
  assert.equal(
    instrumentForActivity("annotate"),
    instrumentForActivity("write"),
    "annotating must not interrupt writing to fetch another tool",
  );
}

verifyMapping();
verifyPencilIsDrawable();
verifyTheMarkChangesToo();
verifySwapsStayCheap();

console.log(
  "verify-instrument-rule: pen writes words in full-weight ink, pencil draws the figure and its " +
    "scaffolding in thinner, softer lead, highlighter marks up finished work, duster erases — " +
    "and a whole lesson changes hands four times",
);
