/**
 * Synthesised glyphs must look like the character they claim to be.
 *
 * Greek and maths characters have no entry in the Caveat handwriting font, so
 * they are built from a Latin base plus extra strokes. That construction is
 * unverified by anything else in the repo, and it is easy to get subtly and
 * silently wrong: theta was drawn as an `o` with a bar pinned at y = -470,
 * while the `o` glyph's own ink only reaches -341. The bar therefore floated
 * clear above the oval and every theta on the board rendered as "ō". A student
 * reading "ō_i = 45 deg" cannot tell they are looking at an angle.
 *
 * These are geometric assertions, not pixel comparisons: the crossbar has to
 * pass through the oval it crosses.
 */
import { measureTextWidth, textToStrokePaths } from "../src/handwriting/handwriting";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const FONT_SIZE = 36;

interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const POINT = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;

/** Ink extent of one rendered character, read off its SVG path data. */
async function extentOf(char: string): Promise<{ extent: Extent; strokeCount: number }> {
  const paths = await textToStrokePaths(char, 0, 100, FONT_SIZE);
  assert(paths.length > 0, `no character path produced for "${char}"`);
  const strokes = paths.flatMap((path) => path.strokes);
  assert(strokes.length > 0, `"${char}" produced no strokes`);

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const stroke of strokes) {
    for (const match of stroke.pathData.matchAll(POINT)) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { extent: { minX, maxX, minY, maxY }, strokeCount: strokes.length };
}

// --- theta -----------------------------------------------------------------

const theta = await extentOf("θ");
const o = await extentOf("o");

assert(
  theta.strokeCount > o.strokeCount,
  "theta must add a crossbar to the base oval",
);

// The bar is the stroke the oval does not have. Its own extent must sit inside
// the oval's vertical span — that is the whole difference between a theta and
// an o wearing a macron.
const thetaPaths = await textToStrokePaths("θ", 0, 100, FONT_SIZE);
const thetaStrokes = thetaPaths.flatMap((path) => path.strokes);
const bar = thetaStrokes[thetaStrokes.length - 1];
assert(bar, "theta produced no crossbar stroke");

const barYs = [...bar.pathData.matchAll(POINT)].map((m) => Number(m[2]));
const barY = barYs.reduce((a, b) => a + b, 0) / Math.max(barYs.length, 1);

assert(
  barY > o.extent.minY && barY < o.extent.maxY,
  `theta's crossbar must pass through the oval (oval spans y ${o.extent.minY.toFixed(1)}..${o.extent.maxY.toFixed(1)}), but sits at y ${barY.toFixed(1)} — a bar outside that range renders as "ō", not a theta`,
);

// Through the middle, not clipping the top or bottom edge.
const oMidY = (o.extent.minY + o.extent.maxY) / 2;
const oHeight = o.extent.maxY - o.extent.minY;
assert(
  Math.abs(barY - oMidY) < oHeight * 0.2,
  `theta's crossbar should cross near the oval's middle (y ${oMidY.toFixed(1)}), got ${barY.toFixed(1)}`,
);

// And it must actually span the oval rather than sit off to one side.
const barXs = [...bar.pathData.matchAll(POINT)].map((m) => Number(m[1]));
const barMinX = Math.min(...barXs);
const barMaxX = Math.max(...barXs);
assert(
  barMinX <= o.extent.minX + 1 && barMaxX >= o.extent.maxX - 1,
  `theta's crossbar must span the oval (oval x ${o.extent.minX.toFixed(1)}..${o.extent.maxX.toFixed(1)}), got ${barMinX.toFixed(1)}..${barMaxX.toFixed(1)}`,
);

// The whole glyph must not tower over its base: an overshooting bar was exactly
// the old bug, and it also pushed the row's apparent height.
assert(
  theta.extent.minY >= o.extent.minY - oHeight * 0.15,
  `theta must not reach far above the oval it is built from: theta top ${theta.extent.minY.toFixed(1)} vs oval top ${o.extent.minY.toFixed(1)}`,
);

// --- the other synthesised Greek letters still render ------------------------

for (const char of ["μ", "λ", "ρ", "Δ", "π", "α", "β"]) {
  const paths = await textToStrokePaths(char, 0, 100, FONT_SIZE);
  const strokes = paths.flatMap((path) => path.strokes);
  assert(strokes.length > 0, `"${char}" renders as nothing on the board`);
}

// --- letter spacing: Caveat's own advance, padded only where ink would overlap -----

const helloWidth = measureTextWidth("hello", FONT_SIZE);
// Font advances alone are ~55px and `ll` overlaps. A hairline pad on colliding
// pairs lands near 62px; 0.11em of even air was ~72px and read as tracked.
assert(
  helloWidth < 68,
  `"hello" is tracked out like print: ${helloWidth.toFixed(1)}px`,
);
assert(
  helloWidth > 56,
  `"hello" collapsed into itself: ${helloWidth.toFixed(1)}px`,
);

const hello = await textToStrokePaths("hello", 0, 100, FONT_SIZE);
assert(hello.length === 5, `expected five glyphs in "hello", got ${hello.length}`);

function inkExtent(path: { strokes: { pathData: string }[] }): Extent {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const stroke of path.strokes) {
    for (const match of stroke.pathData.matchAll(POINT)) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY };
}

for (let index = 1; index < hello.length; index++) {
  const previous = inkExtent(hello[index - 1]!);
  const current = inkExtent(hello[index]!);
  const gap = current.minX - previous.maxX;
  assert(
    gap > 1.2,
    `"hello"[${index}] sits too close to the previous letter (${gap.toFixed(1)}px of air)`,
  );
  assert(
    gap < 7,
    `"hello"[${index}] leaves ${gap.toFixed(1)}px of air — tracked print`,
  );
}

// --- the hand, not the font ------------------------------------------------
//
// One glyph table means one shape per letter, and a row of identical letters
// is the loudest tell that a board is typeset rather than written. Each glyph
// carries a small seeded wobble; these assertions pin it to "a person wrote
// this" and keep it well clear of "the text is falling apart".

{
  const repeated = await textToStrokePaths("llll", 0, 100, FONT_SIZE);
  assert(repeated.length === 4, "expected four glyphs");
  const inks = repeated.map((path) => path.strokes.map((stroke) => stroke.pathData).join(" "));
  assert(new Set(inks).size === 4, "the same letter must never be written twice identically");

  const extents = repeated.map((path) => inkExtent(path));
  const tops = extents.map((extent) => extent.minY);
  const spread = Math.max(...tops) - Math.min(...tops);
  assert(spread > 0.15, `the letters must actually vary, spread ${spread.toFixed(2)}px`);
  assert(
    spread < FONT_SIZE * 0.12,
    `handwriting wobble, not a ransom note: spread ${spread.toFixed(2)}px at ${FONT_SIZE}px type`,
  );
}

{
  // Layout is the typography layer's business: the wobble moves ink, never the
  // boxes a label or a highlight is measured against.
  const before = measureTextWidth("the hand", FONT_SIZE);
  const paths = await textToStrokePaths("the hand", 0, 100, FONT_SIZE);
  assert(
    Math.abs(measureTextWidth("the hand", FONT_SIZE) - before) < 1e-9,
    "measured width must not depend on the wobble",
  );
  for (const path of paths) {
    if (path.strokes.length === 0) continue;
    const extent = inkExtent(path);
    const margin = FONT_SIZE * 0.14;
    assert(
      extent.minX > path.x - margin && extent.maxX < path.x + path.width + margin,
      `"${path.char}" ink escaped its own box: ${extent.minX.toFixed(1)}..${extent.maxX.toFixed(1)} against ${path.x.toFixed(1)}..${(path.x + path.width).toFixed(1)}`,
    );
  }
}

{
  // A lesson replays, and an exported MP4 has to match the live board frame for
  // frame, so the same text in the same place is the same ink every time.
  const once = await textToStrokePaths("steady", 40, 220, FONT_SIZE);
  const twice = await textToStrokePaths("steady", 40, 220, FONT_SIZE);
  assert(JSON.stringify(once) === JSON.stringify(twice), "handwriting must replay identically");
  const elsewhere = await textToStrokePaths("steady", 41, 220, FONT_SIZE);
  const shifted = elsewhere[0]!.strokes[0]!.pathData;
  assert(shifted !== once[0]!.strokes[0]!.pathData, "the same word elsewhere is written afresh");
}

{
  // The row wanders off the ruled line the way a hand does, without sliding
  // into a different line of writing. Measured on one repeated letter, so this
  // is the baseline moving and not the difference between an "o" and a "d".
  const long = await textToStrokePaths("o o o o o o o o o o o o", 0, 100, FONT_SIZE);
  const feet = long
    .filter((path) => path.char === "o" && path.strokes.length > 0)
    .map((path) => inkExtent(path).maxY);
  assert(feet.length >= 10, `expected a long row of the same letter, got ${feet.length}`);
  const drift = Math.max(...feet) - Math.min(...feet);
  assert(drift > 0.4, `a written row must not sit on a ruled line, drift ${drift.toFixed(2)}px`);
  assert(
    drift < FONT_SIZE * 0.2,
    `the row must still read as one line, drift ${drift.toFixed(2)}px`,
  );
}

console.log(
  `handwriting glyph verification passed — theta's bar crosses the oval at y ${barY.toFixed(1)} (oval ${o.extent.minY.toFixed(1)}..${o.extent.maxY.toFixed(1)}); "hello" is ${helloWidth.toFixed(1)}px`,
);
