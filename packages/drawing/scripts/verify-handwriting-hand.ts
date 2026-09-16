/**
 * One hand, writing cleanly.
 *
 * Two faults live in the same place and pull against each other. Writing that
 * is too regular reads as a font, and the board is meant to look written; but
 * variation drawn independently per glyph reads as randomness, which is what
 * makes writing look untidy rather than human. The board had the second: every
 * letter rolled its own angle, size and landing spot out of white noise, its
 * ink weight came from whatever the font's outline happened to be at that
 * point, and the air between letters was set by bounding boxes whose bearings
 * vary by a quarter of an em.
 *
 * These gates hold the fix from both sides: the air between letters is even and
 * the ink is one weight (clean), while the hand still drifts, still never
 * writes the same letter twice the same way, and still never sits on a ruled
 * line (written).
 */

import {
  measureTextWidth,
  textToStrokePaths,
  type CharacterPath,
} from "../src/handwriting/handwriting";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SIZE = 36;
const POINT = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;

const CORPUS = [
  "Momentum is conserved in every collision",
  "A ball of mass m = 2 kg moves at v = 3 m/s",
  "the quick brown fox jumps over the lazy dog",
  "Handwriting should read as one hand, not many.",
  "Kinetic energy grows with the square of speed",
  "energy energy energy energy",
];

interface Ink {
  char: string;
  /** Points along the painted stroke, with the nib radius at each. */
  points: [number, number, number][];
  /** The same, restricted to the body of the letter. */
  body: [number, number, number][];
  width: number;
}

/** Baseline of a rendered glyph, from the box the typography layer gave it. */
const ASCENDER_RATIO = 0.96;
/** How far above the baseline the body of a letter reaches. */
const BODY_RISE_RATIO = 0.55;
const BODY_DROP_RATIO = 0.04;

/** The ink a glyph actually lays down, walked finely enough to measure. */
function inkOf(path: CharacterPath, fontSize: number): Ink {
  const baseline = path.y + ASCENDER_RATIO * fontSize;
  const bodyTop = baseline - BODY_RISE_RATIO * fontSize;
  const bodyBottom = baseline + BODY_DROP_RATIO * fontSize;
  const points: [number, number, number][] = [];
  for (const stroke of path.strokes) {
    const raw = [...stroke.pathData.matchAll(POINT)].map(
      (match) => [Number(match[1]), Number(match[2])] as [number, number],
    );
    for (let index = 0; index < raw.length; index++) {
      const point = raw[index]!;
      points.push([point[0], point[1], stroke.width / 2]);
      const next = raw[index + 1];
      if (!next) continue;
      const steps = Math.ceil(Math.hypot(next[0] - point[0], next[1] - point[1]) / 0.8);
      for (let step = 1; step < steps; step++) {
        const t = step / steps;
        points.push([
          point[0] + (next[0] - point[0]) * t,
          point[1] + (next[1] - point[1]) * t,
          stroke.width / 2,
        ]);
      }
    }
  }
  return {
    char: path.char,
    points,
    // Spacing is read off bodies. A `j` sweeps its tail back under the word
    // before it and a hand writes it that way, so counting the tail as the gap
    // would report a word break that the eye does not see.
    body: points.filter((point) => point[1] >= bodyTop && point[1] <= bodyBottom),
    width: path.strokes[0]?.width ?? 0,
  };
}

/** The closest the painted ink of two letters comes, in px. Negative overlaps. */
function closestApproach(
  a: readonly [number, number, number][],
  b: readonly [number, number, number][],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of a) {
    for (const q of b) {
      const distance = Math.hypot(q[0] - p[0], q[1] - p[1]) - p[2] - q[2];
      if (distance < best) best = distance;
    }
  }
  return best;
}

function stats(values: readonly number[]): {
  mean: number;
  sd: number;
  min: number;
  max: number;
} {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const sd = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1),
  );
  return { mean, sd, min: Math.min(...values), max: Math.max(...values) };
}

/** Which gaps in a rendered line fall inside a word and which cross a space. */
async function measureLine(line: string): Promise<{
  letterAir: number[];
  wordAir: number[];
  collisions: number[];
  weights: number[];
  neighbourWeightStep: number[];
}> {
  const paths = (await textToStrokePaths(line, 0, 200, SIZE)).filter(
    (path) => path.strokes.length > 0,
  );
  const inks = paths.map((path) => inkOf(path, SIZE));
  const body = line.replace(/\s+/g, " ");
  const crossesSpace: boolean[] = [];
  let seen = 0;
  for (let index = 0; index < body.length; index++) {
    if (body[index] !== " ") {
      seen += 1;
      continue;
    }
    if (seen > 0) crossesSpace[seen - 1] = true;
  }

  const letterAir: number[] = [];
  const wordAir: number[] = [];
  const collisions: number[] = [];
  const weights: number[] = [];
  const neighbourWeightStep: number[] = [];
  for (let index = 1; index < inks.length; index++) {
    const previousInk = inks[index - 1]!;
    const currentInk = inks[index]!;
    collisions.push(closestApproach(previousInk.points, currentInk.points));
    const air = closestApproach(previousInk.body, currentInk.body);
    if (Number.isFinite(air)) (crossesSpace[index - 1] ? wordAir : letterAir).push(air);
    const previous = inks[index - 1]!.width;
    const current = inks[index]!.width;
    if (previous > 0 && current > 0) {
      neighbourWeightStep.push(Math.abs(current - previous) / ((current + previous) / 2));
    }
  }
  for (const path of paths) for (const stroke of path.strokes) weights.push(stroke.width);
  return { letterAir, wordAir, collisions, weights, neighbourWeightStep };
}

const letterAir: number[] = [];
const wordAir: number[] = [];
const collisions: number[] = [];
const weights: number[] = [];
const weightSteps: number[] = [];
for (const line of CORPUS) {
  const measured = await measureLine(line);
  letterAir.push(...measured.letterAir);
  wordAir.push(...measured.wordAir);
  collisions.push(...measured.collisions);
  weights.push(...measured.weights);
  weightSteps.push(...measured.neighbourWeightStep);
}

// --- the air inside a word is even, and it is air ---------------------------
{
  const air = stats(letterAir);
  assert(
    stats(collisions).min > 0.12,
    `no ink may be written through other ink: closest approach ${stats(collisions).min.toFixed(2)}px`,
  );
  assert(
    air.mean > SIZE * 0.03 && air.mean < SIZE * 0.075,
    `air inside a word is ${(air.mean / SIZE).toFixed(3)}em — a word has to hold together and still breathe`,
  );
  assert(
    air.sd / air.mean < 0.42,
    `air inside a word varies by ${((100 * air.sd) / air.mean).toFixed(0)}% of itself; uneven air is what stops a word reading as a word`,
  );
  assert(
    air.max < air.mean * 2.2,
    `one pair opened a ${air.max.toFixed(1)}px hole against a ${air.mean.toFixed(1)}px norm`,
  );
}

// --- and the break between words is clearly bigger --------------------------
{
  const letters = stats(letterAir);
  const words = stats(wordAir);
  // A quarter of an em, and the same quarter every time. Measured from the ink
  // either side rather than added as a flat advance: Caveat's bearings vary by
  // a quarter of an em themselves, so a flat space put anything from 4px to
  // 10px between two words at one size, and the eye reads a word break by
  // comparing it with the air inside the words either side of it.
  assert(
    words.mean > SIZE * 0.235 && words.mean < SIZE * 0.3,
    `a word break is ${(words.mean / SIZE).toFixed(3)}em of air; it has to read as a break at every size`,
  );
  assert(
    words.sd / words.mean < 0.16,
    `word breaks vary by ${((100 * words.sd) / words.mean).toFixed(0)}% of themselves`,
  );
  assert(
    words.mean > letters.mean * 4.5,
    `a word break is only ${(words.mean / letters.mean).toFixed(1)}x the air inside a word — the eye groups by spacing`,
  );
  assert(
    words.mean < letters.mean * 8,
    `a word break of ${(words.mean / letters.mean).toFixed(1)}x leaves words stranded from each other`,
  );
  assert(
    words.min > letters.max,
    `the tightest word break (${words.min.toFixed(1)}px) is inside the range of gaps within a word (up to ${letters.max.toFixed(1)}px)`,
  );
}

// --- one nib wrote all of it ------------------------------------------------
{
  const weight = stats(weights);
  assert(
    weight.sd / weight.mean < 0.09,
    `ink weight varies by ${((100 * weight.sd) / weight.mean).toFixed(1)}% — one hand holds one pen`,
  );
  const step = stats(weightSteps);
  assert(
    step.mean < 0.07,
    `neighbouring letters differ in weight by ${(100 * step.mean).toFixed(1)}% on average`,
  );
  assert(
    step.max < 0.32,
    `two letters side by side differ in weight by ${(100 * step.max).toFixed(0)}%`,
  );

  // Greek and maths glyphs are synthesised rather than read off the font, and
  // their widths used to be `max(2.4 * scale, 1.5)` — which is 1.5px at every
  // size the board writes at, against 2.2px for the letters around them. Every
  // formula on the board mixed two pens.
  const latin = stats(
    (await textToStrokePaths("abcdefghij", 0, 200, SIZE)).flatMap((path) =>
      path.strokes.map((stroke) => stroke.width),
    ),
  );
  for (const char of ["π", "θ", "Δ", "→", "∫", "≈", "√", "±"]) {
    const drawn = await textToStrokePaths(char, 0, 200, SIZE);
    const widthsFor = drawn.flatMap((path) => path.strokes.map((stroke) => stroke.width));
    assert(widthsFor.length > 0, `"${char}" drew nothing`);
    const mean = stats(widthsFor).mean;
    assert(
      Math.abs(mean - latin.mean) / latin.mean < 0.25,
      `"${char}" is written with a different pen: ${mean.toFixed(2)}px against ${latin.mean.toFixed(2)}px`,
    );
  }

  // And the nib scales with the type, rather than sitting on a floor.
  const small = stats(
    (await textToStrokePaths("handwriting", 0, 200, 19)).flatMap((path) =>
      path.strokes.map((stroke) => stroke.width),
    ),
  );
  const large = stats(
    (await textToStrokePaths("handwriting", 0, 200, 46)).flatMap((path) =>
      path.strokes.map((stroke) => stroke.width),
    ),
  );
  assert(
    large.mean > small.mean * 1.6,
    `the nib must follow the type size: ${small.mean.toFixed(2)}px at 19px against ${large.mean.toFixed(2)}px at 46px`,
  );
}

// --- the variation is one hand's, not a die per letter ----------------------
{
  // A row of the same letter shows the hand alone: any difference between two
  // of these is the writing, not the letterform.
  const row = (await textToStrokePaths("o o o o o o o o o o o o o o", 0, 200, SIZE)).filter(
    (path) => path.char === "o" && path.strokes.length > 0,
  );
  assert(row.length >= 12, `expected a long row of one letter, got ${row.length}`);

  const feet = row.map((path) => {
    const points = [...path.strokes[0]!.pathData.matchAll(POINT)].map((match) => Number(match[2]));
    return Math.max(...points);
  });
  const heights = row.map((path) => {
    const points = [...path.strokes[0]!.pathData.matchAll(POINT)].map((match) => Number(match[2]));
    return Math.max(...points) - Math.min(...points);
  });

  const steps: number[] = [];
  for (let index = 1; index < feet.length; index++) {
    steps.push(Math.abs(feet[index]! - feet[index - 1]!));
  }
  const range = Math.max(...feet) - Math.min(...feet);
  const step = stats(steps);
  assert(range > SIZE * 0.012, `the row must leave the ruled line: it moved ${range.toFixed(2)}px`);
  assert(
    range < SIZE * 0.13,
    `the row must still read as one line: it moved ${range.toFixed(2)}px`,
  );
  assert(
    step.max < range * 0.75,
    `the baseline jumps ${step.max.toFixed(2)}px between neighbours against a ${range.toFixed(2)}px wander — that is noise, not a hand`,
  );

  const size = stats(heights);
  assert(size.sd > 0, "letters must not all be exactly one size");
  assert(
    // The old per-glyph draw of +-2.8% measured 1.6% here; one hand writing one
    // size measures 0.8%. Half a percent of an x-height is a hand; two is a
    // row of letters that do not look related to each other.
    size.sd / size.mean < 0.012,
    `letter size wobbles by ${((100 * size.sd) / size.mean).toFixed(2)}% — one hand writes one size`,
  );
  // Still written, not typeset: no two are the same ink.
  const inks = new Set(row.map((path) => path.strokes.map((s) => s.pathData).join(" ")));
  assert(inks.size === row.length, "the same letter must never be written twice identically");
}

// --- layout still agrees with the ink ---------------------------------------
{
  for (const line of CORPUS) {
    const measured = measureTextWidth(line, SIZE);
    const paths = await textToStrokePaths(line, 0, 200, SIZE);
    const last = paths[paths.length - 1]!;
    const reached = last.x + last.width;
    assert(
      Math.abs(reached - measured) < SIZE * 0.35,
      `"${line.slice(0, 20)}…" measures ${measured.toFixed(1)}px but the pen reached ${reached.toFixed(1)}px — the two layout loops have drifted apart`,
    );
    const ink = paths
      .filter((path) => path.strokes.length > 0)
      .flatMap((path) => [...path.strokes[0]!.pathData.matchAll(POINT)].map((m) => Number(m[1])));
    assert(
      Math.max(...ink) < measured + SIZE * 0.2,
      `ink runs past the measured width of "${line.slice(0, 20)}…"`,
    );
  }

  // A lesson replays and an export has to match it frame for frame.
  const once = await textToStrokePaths("steady", 40, 220, SIZE);
  const twice = await textToStrokePaths("steady", 40, 220, SIZE);
  assert(JSON.stringify(once) === JSON.stringify(twice), "handwriting must replay identically");
}

console.log(
  `verify-handwriting-hand: air inside a word is ${(stats(letterAir).mean / SIZE).toFixed(3)}em and even to ${((100 * stats(letterAir).sd) / stats(letterAir).mean).toFixed(0)}%, word breaks are ${(stats(wordAir).mean / stats(letterAir).mean).toFixed(1)}x that, one nib wrote every letter and every operator to ${((100 * stats(weights).sd) / stats(weights).mean).toFixed(1)}%, and the hand still drifts off the line without ever jumping`,
);
