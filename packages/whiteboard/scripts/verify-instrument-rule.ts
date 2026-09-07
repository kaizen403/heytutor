/**
 * Which instrument the hand reaches for, and what it costs to change.
 *
 * The rule is what a mark commits to, not where it lands. Ink is the pen;
 * construction scaffolding is the pencil; emphasis is the highlighter; erasing
 * is the duster. The reason the split is on *construction* and not on
 * *geometry* is the swap count: an earlier version drew all diagram geometry in
 * pencil, so a lesson that alternates a written line and a drawn one spent its
 * time swapping and read as two cursors. These checks pin both halves — the
 * mapping, and that a realistic lesson stays cheap.
 */
import assert from "node:assert/strict";
import {
  instrumentForActivity,
  instrumentPalette,
  instrumentMetrics,
  instrumentShapes,
  instrumentSilhouette,
  type InstrumentKind,
  type PenActivity,
} from "../src/instruments";
import { LEAN_GAIN, RESTING_TILT } from "../src/penChoreography";

function verifyMapping(): void {
  const expected: Record<PenActivity, InstrumentKind> = {
    write: "pen",
    draw: "pen",
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

  // Everything the student is meant to copy down is inked with one instrument,
  // so a lesson that writes a line and then draws one shows one hand, not two.
  const committed: PenActivity[] = ["write", "draw", "annotate", "idle"];
  const kinds = new Set(committed.map(instrumentForActivity));
  assert.equal(kinds.size, 1, "committed ink must not change instrument mid-lesson");

  // Every activity has a tilt and a lean, or the barrel snaps to zero.
  for (const activity of Object.keys(expected) as PenActivity[]) {
    assert.equal(typeof RESTING_TILT[activity], "number", `${activity} has no resting tilt`);
    assert.equal(typeof LEAN_GAIN[activity], "number", `${activity} has no lean gain`);
  }
  // A pencil laying in a construction line stands more upright than a pen
  // writing a word.
  assert.ok(
    RESTING_TILT.sketch > RESTING_TILT.write,
    "the pencil must stand more upright than the pen",
  );
}

function verifyPencilIsDrawable(): void {
  // The pencil was dead code for a while: defined in the kit, never returned by
  // `instrumentForActivity`. Now that construction reaches for it, it has to be
  // a complete object rather than a name.
  const palette = instrumentPalette("pencil", "#1B2A4A");
  assert.ok(palette.nib && palette.barrel && palette.outline);
  assert.notEqual(
    instrumentPalette("pencil", "#1B2A4A").barrel,
    instrumentPalette("pen", "#1B2A4A").barrel,
    "the pencil must not look like the pen, or the swap says nothing",
  );
  assert.ok(instrumentShapes("pencil").length > 0, "the pencil has no art");
  assert.ok(instrumentSilhouette("pencil").length >= 8, "the pencil has no silhouette to smear");
  assert.ok(instrumentMetrics("pencil").height > 0);
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
  assert.ok(
    swaps <= 4,
    `a lesson of ${lesson.length} beats must not swap instrument more than four times, got ${swaps}`,
  );

  // A gesture over existing ink is made with whatever is already in hand.
  assert.equal(
    instrumentForActivity("annotate"),
    instrumentForActivity("write"),
    "annotating must not interrupt writing to fetch another tool",
  );
}

verifyMapping();
verifyPencilIsDrawable();
verifySwapsStayCheap();

console.log(
  "verify-instrument-rule: pen inks what the student copies, pencil sketches construction, " +
    "highlighter marks up finished work, duster erases — and one lesson swaps at most four times",
);
