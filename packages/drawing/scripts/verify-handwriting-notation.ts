import assert from "node:assert/strict";
import {
  countWrittenGlyphs,
  measureTextInkBounds,
  measureTextWidth,
  measureWrittenTextInkBounds,
  normalizeStrokeText,
  textToStrokePaths,
} from "../src/handwriting/handwriting";
import {
  normalizeBoardText,
  parseDrawCommandFromTag,
  parseDrawingCommands,
} from "../src/protocol/drawingProtocol";

// Charge signs must be normalized before a chemical token decides which
// digits are atom counts and which digits are the ion's charge.
const ION_CASES = [
  ["SO42−", "SO42-", "SO_4^(2-)"],
  ["CO32−", "CO32-", "CO_3^(2-)"],
  ["MnO4−", "MnO4-", "MnO_4^(-)"],
  ["Cl−", "Cl-", "Cl^(-)"],
  ["O2−", "O2-", "O^(2-)"],
  ["I3−", "I3-", "I_3^(-)"],
  ["[Fe(CN)6]3−", "[Fe(CN)6]3-", "[Fe(CN)_6]^(3-)"],
  ["e−", "e-", "e^(-)"],
  ["2e−", "2e-", "2e^(-)"],
  ["Cu2+ + 2e− → Cu", "Cu2+ + 2e- → Cu", "Cu^(2+) + 2e^(-) → Cu"],
] as const;

for (const [unicode, ascii, expected] of ION_CASES) {
  assert.equal(normalizeStrokeText(unicode), expected, `${unicode}: keep atom counts separate from charge`);
  assert.equal(normalizeStrokeText(ascii), expected);
  assert.equal(normalizeBoardText(unicode), expected, "protocol must not save a different atom count");
  const fromTag = parseDrawCommandFromTag("WRITE", `${unicode},90,211`, 0, "");
  const fromResponse = parseDrawingCommands(`[WRITE:${unicode},90,211]`).commands[0];
  assert.equal(fromTag.text, expected);
  assert.equal(fromResponse?.text, expected);
  assert.deepEqual(fromTag.params, [90, 211]);
  assert.deepEqual(fromResponse?.params, [90, 211]);
}


for (const size of [19, 32, 46]) {
  for (const [unicode, ascii] of ION_CASES) {
    const paths = await textToStrokePaths(unicode, 70, 230, size);
    assert(paths.every(path => path.strokes.length > 0), `${unicode}: no ion/electron fallback glyph`);
    assert.deepEqual(paths, await textToStrokePaths(ascii, 70, 230, size), `${unicode}: same scripted ink as ASCII charge`);
    assert.equal(measureTextWidth(unicode, size), measureTextWidth(ascii, size));
    assert.deepEqual(measureTextInkBounds(unicode, 70, 230, size), measureTextInkBounds(ascii, 70, 230, size));
    assert.deepEqual(measureTextInkBounds(unicode, 70, 230, size), measureWrittenTextInkBounds(unicode, 70, 230, size));
    assert.equal(countWrittenGlyphs(unicode), paths.length, "one scheduler slot per visible charge/count glyph");
    assert.equal(countWrittenGlyphs(unicode), countWrittenGlyphs(ascii));
  }
  for (const row of ["[x]", "[0, 1]", "[H_3O^+]", "[Fe(CN)_6]^(3−)", "x_[1]", "v̄ + [a⃗]"]) {
    const paths = await textToStrokePaths(row, 70, 230, size);
    assert(paths.every(path => path.strokes.length > 0), `${row}: every bracket must be handwritten`);
    assert.equal(countWrittenGlyphs(row), paths.length, `${row}: schedule must have one slot per visible glyph`);
    assert.deepEqual(measureTextInkBounds(row, 70, 230, size),
      measureWrittenTextInkBounds(row, 70, 230, size), `${row}: layout and written ink must agree`);
    assert(Number.isFinite(measureTextWidth(row, size)), `${row}: advance must remain finite`);
  }
  // A square bracket is one connected top/stem/bottom pen path, with an
  // inward-facing arm at each end. Inspect its actual rendered geometry.
  for (const bracket of ["[", "]"]) {
    const [path] = await textToStrokePaths(bracket, 70, 230, size);
    assert(path && path.strokes.length === 1, `${bracket}: one connected stroke`);
    const coordinates = path.strokes[0]!.pathData.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
    assert.equal(coordinates.length, 8, `${bracket}: top arm, full stem, bottom arm`);
    const [x0, y0, x1, y1, x2, y2, x3, y3] = coordinates;
    assert(Math.abs(y0! - y1!) < size * .08 && Math.abs(y2! - y3!) < size * .08);
    assert(y2! - y1! > size * .5, `${bracket}: full-height stem`);
    assert(Math.abs(x1! - x2!) < size * .08, `${bracket}: stem stays vertical`);
    assert(bracket === "[" ? x0! > x1! && x3! > x2! : x0! < x1! && x3! < x2!,
      `${bracket}: both arms must face inward`);
  }
  for (const [unicode, ascii] of [
    ["20 − 8", "20 - 8"], ["10⁻³", "10^(-3)"],
    ["x^(−2)", "x^(-2)"], ["v₋₁", "v_(-1)"],
  ]) {
    assert.deepEqual(await textToStrokePaths(unicode, 70, 230, size),
      await textToStrokePaths(ascii, 70, 230, size), `${unicode}: minus notation must use the same strokes`);
    assert.equal(measureTextWidth(unicode, size), measureTextWidth(ascii, size));
    assert.equal(countWrittenGlyphs(unicode), countWrittenGlyphs(ascii));
  }
  for (const text of ["q = 2 µC", "µ̄"]) {
    const micro = await textToStrokePaths(text, 70, 230, size);
    const muText = text.replaceAll("µ", "μ");
    const mu = await textToStrokePaths(muText, 70, 230, size);
    assert(micro.every(path => path.strokes.length > 0), "micro sign uses handwriting, including attached marks");
    assert(micro.some(path => path.char.includes("µ")), "path identity retains micro sign for semantic consumers");
    assert.deepEqual(micro.map(path => path.strokes.length), mu.map(path => path.strokes.length),
      "micro and mu share the same pen-stroke structure");
    assert.equal(measureTextWidth(text, size), measureTextWidth(muText, size));
    assert.deepEqual(measureTextInkBounds(text, 70, 230, size), measureWrittenTextInkBounds(text, 70, 230, size));
    assert.equal(countWrittenGlyphs(text), countWrittenGlyphs(muText));
  }
}
// Subscript letters and script brackets around plain letters are lettered as
// handwritten script groups. Before, a subscript letter had no ink and the
// board typed it in a browser font on the baseline ("fₖ" read "fk"), and
// "v₍A₎" closed its group on the wrong character and wrote a stray "_".
const SCRIPT_CASES = [
  ["v₍A₎", "v_(A)"],
  ["−v₍B₎", "-v_(B)"],
  ["v₍A/B₎", "v_(A/B)"],
  ["fₖ", "f_(k)"],
  ["μₖN", "μ_(k)N"],
  ["Fₛ = μₛN", "F_(s) = μ_(s)N"],
  ["vₘₐₓ", "v_(max)"],
  ["θᵢ = θᵣ", "θ_(i) = θ_(r)"],
  ["kᵦ", "k_(β)"],
  ["vₖ₍A₎", "v_(k)_(A)"],
  ["x²⁽A⁾", "x^2^(A)"],
  ["a₍(b)₎", "a_((b))"],
] as const;
// Everything else is written as before: a bracket with no closer or with an
// unbalanced inside, a bracket whose inside already has script forms, digit
// runs, superscript letters and other letters with no script form.
const KEPT_CASES = [
  ["v₍A", "v_(A"],
  ["a₍b)₎", "a_(b)_)"],
  ["x₍₁₎", "x_((1))"],
  ["x⁽ⁿ⁾", "x^((n))"],
  ["x₁₂", "x_(12)"],
  ["x₁y", "x_1y"],
  ["H₂O", "H_2O"],
  ["y = 2ˣ", "y = 2ˣ"],
  ["e⁻ˣ", "e^-ˣ"],
  ["x⁽ᵏ⁾", "x^(ᵏ^)"],
  ["ℓ₁", "ℓ_1"],
] as const;
for (const [unicode, expected] of [...SCRIPT_CASES, ...KEPT_CASES]) {
  assert.equal(normalizeStrokeText(unicode), expected, `${unicode} is written as ${expected}`);
  assert.equal(normalizeStrokeText(expected), expected, `${expected} is already in its written form`);
}
for (const [unicode, expected] of SCRIPT_CASES) {
  assert.equal(parseDrawCommandFromTag("WRITE", `${unicode},90,211`, 0, "").text, expected, `a WRITE of ${unicode} saves its written form`);
  const paths = await textToStrokePaths(unicode, 70, 230, 32);
  assert.deepEqual(paths, await textToStrokePaths(expected, 70, 230, 32), `${unicode} is lettered as ${expected}`);
  assert(paths.every((path) => path.strokes.length > 0 || !path.char.trim()), `${unicode} has no typed glyph`);
  assert(!paths.some((path) => path.char === "_"), `${unicode} writes no stray underscore`);
  assert.equal(measureTextWidth(unicode, 32), measureTextWidth(expected, 32));
}
for (const letter of "ₐₑₒₓₕₖₗₘₙₚₛₜᵢᵣᵤᵥⱼᵦᵧᵨᵩᵪ") {
  const [base, script] = await textToStrokePaths(`v${letter}`, 70, 230, 32);
  assert(base && script && script.strokes.length > 0, `${letter} has handwriting ink`);
  assert(script.fontSize! < base.fontSize!, `${letter} is lettered at script size`);
}
const [, subscriptA] = await textToStrokePaths("v₍A₎", 70, 230, 32);
assert(subscriptA?.char === "A" && subscriptA.fontSize! < 32, "v₍A₎ reads v with subscript A");
assert.equal((await textToStrokePaths("v₍A₎", 70, 230, 32)).length, 2, "v₍A₎ letters v and A only");
const [, typedX] = await textToStrokePaths("2ˣ", 70, 230, 32);
assert(typedX?.char === "ˣ" && typedX.strokes.length === 0, "superscript letters stay out of this change");

assert.equal(normalizeStrokeText("µC"), "µC", "glyph alias preserves micro-unit text");
assert.equal(normalizeStrokeText("−"), "-", "mathematical minus uses the existing minus stroke");
assert.equal(normalizeStrokeText("≠ ∉"), "≠ ∉", "normalization must retain negated operators");
assert.equal(normalizeStrokeText("가"), "가", "unrelated text must remain unchanged");
console.log("handwriting notation: square brackets, mathematical minus and micro signs are stroke-rendered with consistent layout and glyph slots");
