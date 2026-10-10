import assert from "node:assert/strict";
import {
  measureTextInkBounds,
  measureTextWidth,
  measureWrittenTextInkBounds,
  normalizeStrokeText,
  textToStrokePaths,
  type StrokePath,
} from "../src/handwriting/handwriting";

/** Read the same absolute coordinates and nib radius the board paints. */
function inkOf(strokes: StrokePath[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    const numbers = stroke.pathData.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      const x = Number(numbers[index]);
      const y = Number(numbers[index + 1]);
      assert(Number.isFinite(x) && Number.isFinite(y), "accent ink must be finite");
      minX = Math.min(minX, x - stroke.width / 2);
      maxX = Math.max(maxX, x + stroke.width / 2);
      minY = Math.min(minY, y - stroke.width / 2);
      maxY = Math.max(maxY, y + stroke.width / 2);
    }
  }
  return { minX, maxX, minY, maxY };
}

const accents = [
  ["v̄", "v", 1], ["x̄", "x", 1], ["v̅", "v", 1],
  ["â", "a", 2], ["ẋ", "x", 1], ["ẍ", "x", 2], ["v⃗", "v", 3],
] as const;

for (const size of [19, 32, 46]) {
  for (const [text, base, added] of accents) {
    const plain = await textToStrokePaths(base, 70, 230, size);
    const paths = await textToStrokePaths(text, 70, 230, size);
    assert.equal(paths.length, 1, `${text}: accent must share its base CharacterPath`);
    const path = paths[0]!;
    assert.equal(path.strokes.length, plain[0]!.strokes.length + added, `${text}: missing accent strokes`);
    assert.equal(measureTextWidth(text, size), measureTextWidth(base, size), `${text}: accent advanced the cursor`);
    assert.equal(path.width, plain[0]!.width, `${text}: accent changed its base box`);

    // Compare accent to its own base in the same rendered glyph: both must
    // receive the same hand transform, without depending on font fallback.
    const count = plain[0]!.strokes.length;
    const body = inkOf(path.strokes.slice(0, count));
    const mark = inkOf(path.strokes.slice(count));
    assert(mark.maxY < body.minY, `${text}: accent must sit above the letter`);
    assert(body.minY - mark.maxY < size * 0.2, `${text}: accent detached vertically`);
    const bodyCentre = (body.minX + body.maxX) / 2;
    const markCentre = (mark.minX + mark.maxX) / 2;
    assert(Math.abs(bodyCentre - markCentre) < size * 0.06, `${text}: accent detached horizontally`);
    assert(mark.minX >= body.minX - size * 0.08 && mark.maxX <= body.maxX + size * 0.08,
      `${text}: accent must be sized to the base ink`);
  }

  // Base layout, including spacing across words and scripts, stays identical.
  for (const [text, base] of [
    ["v̄_1", "v_1"], ["Δx̄", "Δx"], ["v̄ x⃗", "v x"],
    ["x_(v̄1)", "x_(v1)"], ["x^ẋ", "x^x"], ["x_ẍ", "x_x"],
    ["v̄_1 + Δx⃗", "v_1 + Δx"], ["âḃc̈", "abc"],
  ]) {
    const paths = await textToStrokePaths(text, 70, 230, size);
    const plain = await textToStrokePaths(base, 70, 230, size);
    assert.deepEqual(paths.map(p => [p.x, p.y, p.width, p.fontSize]),
      plain.map(p => [p.x, p.y, p.width, p.fontSize]), `${text}: base placements changed`);
    assert.equal(measureTextWidth(text, size), measureTextWidth(base, size), `${text}: measured width changed`);
    assert(paths.every(p => p.strokes.length > 0), `${text}: the board would create a fallback Text node`);
  }

  for (const text of [
    ...accents.map(([text]) => text), "v̄_1 + Δx̄", "x_(v⃗1)", "v̄⃗", "x^ẋ",
  ]) {
    assert.deepEqual(measureTextInkBounds(text, 70, 230, size),
      measureWrittenTextInkBounds(text, 70, 230, size), `${text}: measured and rendered ink disagree`);
    const paths = await textToStrokePaths(text, 70, 230, size);
    const actual = inkOf(paths.flatMap(p => p.strokes));
    const bounds = measureTextInkBounds(text, 70, 230, size)!;
    assert.equal(bounds.x, actual.minX);
    assert.equal(bounds.y, actual.minY);
    assert.equal(bounds.width, actual.maxX - actual.minX);
    assert.equal(bounds.height, actual.maxY - actual.minY);
  }
}

// Unsupported and orphan marks cannot escape into a detached fallback node,
// including marks outside the BMP. Their bases and advances survive.
for (const [text, base] of [
  ["v́", "v"], ["v\u{1D185} x", "v x"], ["̄v", "v"], ["v ̄x", "v x"],
]) {
  const paths = await textToStrokePaths(text, 70, 230, 32);
  const plain = await textToStrokePaths(base, 70, 230, 32);
  assert.equal(paths.length, plain.length, `${text}: detached mark path`);
  assert.deepEqual(paths.map(p => [p.x, p.y, p.width]), plain.map(p => [p.x, p.y, p.width]));
  assert.equal(measureTextWidth(text), measureTextWidth(base));
  assert(paths.every(p => p.strokes.length > 0), `${text}: detached fallback node`);
}
assert.deepEqual(await textToStrokePaths("̄⃗", 70, 230, 32), [], "orphan marks must not draw");
assert.equal(measureTextWidth("̄⃗"), 0);
assert.equal(measureTextInkBounds("̄⃗", 70, 230, 32), null);

for (const [composed, decomposed] of [["â", "â"], ["ẋ", "ẋ"], ["ẍ", "ẍ"]]) {
  assert.deepEqual(await textToStrokePaths(composed, 70, 230, 32),
    await textToStrokePaths(decomposed, 70, 230, 32), "canonical accents must replay as the same ink");
}
assert.equal(normalizeStrokeText("가"), "가", "unrelated canonical decompositions must stay unchanged");
for (const sign of ["≠", "∉", "≮", "≯"]) {
  assert.equal(normalizeStrokeText(sign), sign, "accent normalization must preserve mathematical negation");
}
assert.equal(normalizeStrokeText("\\neq"), "≠", "LaTeX negation must retain its sign");
for (const sign of ["≠", "∉"]) {
  const paths = await textToStrokePaths(sign, 70, 230, 32);
  assert.equal(paths[0]!.char, sign);
  const slash = inkOf([paths[0]!.strokes.at(-1)!]);
  assert(slash.maxX - slash.minX > 4 && slash.maxY - slash.minY > 8, "negated sign must keep its diagonal slash");
}
const overlay = await textToStrokePaths("≠", 70, 230, 32);
const equality = await textToStrokePaths("=", 70, 230, 32);
assert.equal(overlay.length, 1);
assert.equal(overlay[0]!.strokes.length, equality[0]!.strokes.length + 1, "explicit negation overlay retains its slash");
const unknownBase = await textToStrokePaths("🦕̄", 70, 230, 32);
assert.equal(unknownBase.length, 1);
assert.equal(unknownBase[0]!.char, "🦕", "even an unsupported base must never pass a combining mark to Text");

console.log("handwriting accents: bars, hats, dots and vectors attach as strokes; base widths and rendered ink bounds agree");
