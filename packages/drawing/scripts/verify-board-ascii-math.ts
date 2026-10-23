/**
 * The board writes mathematics the way a student writes it, not the way it
 * was typed.
 *
 * In the relative velocity lessons recorded on 20 Oct 2026 the work column
 * showed `v_rel = sqrt(36 + 64)`, `d = 2 * 60` and `theta = atan(8/6)`:
 * `sqrt(` in 22 rows across 6 lessons, a product star in 14 rows across 5, and
 * `atan` or `arcsin` in 3. Two of the `sqrt(` rows were `normalizeBoardText`'s
 * own spelling of "square root of", and its "times" became a star.
 *
 * Every recorded row in the fixture is pushed through both WRITE parsers and
 * must come out with `√(`, `×` and `tan⁻¹(`, and every character must be
 * inked by the handwriting engine (a character without a glyph is drawn as a
 * blank gap). A code row keeps its `*` and `sqrt(`, because there they are the
 * program.
 *
 * A star becomes `×` only after a number (PR #249 review). Between two
 * symbols or two brackets it stays a star: between vectors `×` is a cross
 * product, so `W = F * d` must never be written `W = F × d`, and the spoken
 * "times" is still written `*` for the same reason.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isCodeBoardRow, normalizeBoardText, parseDrawingCommands } from "../src/protocol/drawingProtocol";
import { unwrapMathMarkup } from "../src/protocol/mathMarkup";
import { normalizeStrokeText, textToStrokePaths } from "../src/handwriting/handwriting";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(here, "fixtures/recorded-write-rows-2026-10-20.json"), "utf8"),
) as { rows: { id: string; row: string }[] };

const ASCII_MATH = /(?<![A-Za-z0-9_.])sqrt\s*\(|\b(?:a|arc)(?:sin|cos|tan)\s*\(|square root of|\btimes\b/;
/** A product star after a number: a standalone number before it, or a bracket with a number after it. */
const PRODUCT_STAR = /(?<![\p{L}\p{N}_.])\d+(?:\.\d+)?\s*\*\s*[\p{L}\p{N}(√]|[)\]]\s*\*\s*\p{N}/u;

async function assertInked(text: string, context: string): Promise<void> {
  const paths = await textToStrokePaths(text, 0, 100, 32);
  for (const path of paths) {
    if (/\s/.test(path.char)) continue;
    assert.ok(path.strokes.length > 0, `${context}: "${path.char}" has no ink in "${text}"`);
  }
}

assert.ok(fixture.rows.length >= 40, `the recorded row fixture did not load (${fixture.rows.length} rows)`);

let mapped = 0;
for (const { id, row } of fixture.rows) {
  assert.equal(isCodeBoardRow(row), false, `${id}: a physics row was read as code: ${row}`);
  // The live stream parser and the stored replay parser both reach the board.
  const parsed = parseDrawingCommands(`say it [WRITE:${row},90,277]`).commands[0]?.text ?? "";
  const direct = normalizeBoardText(unwrapMathMarkup(row));
  assert.equal(parsed, direct, `${id}: the two WRITE parsers disagree on ${row}`);
  assert.doesNotMatch(direct, ASCII_MATH, `${id}: ASCII math reached the board: ${row} -> ${direct}`);
  assert.doesNotMatch(direct, PRODUCT_STAR, `${id}: a product star reached the board: ${row} -> ${direct}`);
  // A second pass changes nothing: the lesson planner normalises again.
  assert.equal(normalizeBoardText(direct), direct, `${id}: normalising twice changed ${direct}`);
  await assertInked(direct, id);
  mapped++;
}

const EXACT: [string, string][] = [
  ["v_rel = sqrt(36 + 64)", "v_rel = √(36 + 64)"],
  ["d = 2 * 60", "d = 2 × 60"],
  ["check: 2*60 = 120, 4*60 = 240", "check: 2×60 = 120, 4×60 = 240"],
  ["v_y = 5*sqrt(3) = 8.66 km/h", "v_y = 5×√(3) = 8.66 km/h"],
  ["theta = atan(8/6) = 53.13°", "θ = tan^(-1)(8/6) = 53.13°"],
  ["θ = arcsin(1/2) = 30°", "θ = sin^(-1)(1/2) = 30°"],
  ["θ = arccos((A·B)/(|A||B|))", "θ = cos^(-1)((A·B)/(|A||B|))"],
  ["\\arctan(3/4)", "tan^(-1)(3/4)"],
  ["v = square root of 2gh", "v = √(2gh)"],
  // "times" between symbols keeps main's star: never a cross product.
  ["F = m times a", "F = m * a"],
  ["3 times 4", "3 × 4"],
  // A two argument arctangent is its own function and keeps its name.
  ["φ = atan2(R_y,R_x) = 90°", "φ = atan2(R_y,R_x) = 90°"],
  // A star with no operand after it, or on an antibonding orbital, is a mark.
  ["σ*2s", "σ*2s"],
  ["z* = 3", "z* = 3"],
  // A conjugate star sits on its symbol: it is never a product after a letter
  // or a closing bracket that a letter follows, nor before a minus.
  ["ψ*ψ", "ψ*ψ"],
  ["ψ*(x)", "ψ*(x)"],
  ["z*z", "z*z"],
  ["z* − z", "z* - z"],
  ["ψ_1*ψ_2", "ψ_1*ψ_2"],
  ["ψ(x)*ψ(x)", "ψ(x)*ψ(x)"],
  ["2 * -3", "2 * -3"],
  // A product after a number: a number before an operand, or a bracket
  // before a number.
  ["3*4", "3×4"],
  ["2 * 5", "2 × 5"],
  ["(a+b)*2", "(a+b)×2"],
  ["10*sin(30)", "10×sin(30)"],
  ["d_A = 20 * 30", "d_A = 20 × 30"],
  // Between two symbols or two brackets the star stays (PR #249 review):
  // `×` there reads as a cross product.
  ["W = F * d", "W = F * d"],
  ["F = q * v * B", "F = q * v * B"],
  ["d_A = v_A * t_b", "d_A = v_A * t_b"],
  ["(a+b)*(c+d)", "(a+b)*(c+d)"],
  ["(A+B)*(A-B)", "(A+B)*(A-B)"],
];
for (const [row, expected] of EXACT) {
  assert.equal(normalizeBoardText(unwrapMathMarkup(row)), expected, `board text for ${row}`);
}

// Code keeps its own spelling: here `*` and `sqrt(` are the program.
const CODE: string[] = [
  "x = math.sqrt(n)",
  "nums[i] * 2",
  "total += a * b",
  "a ** 2",
  "if n == 0: return 1",
  "int n = a * b;",
  "def area(r): return 3.14 * r * r",
];
for (const row of CODE) {
  assert.ok(isCodeBoardRow(row), `a code row was read as maths: ${row}`);
  const written = normalizeBoardText(row);
  assert.doesNotMatch(written, /[×√]|⁻¹|\^\(-1\)/, `code was rewritten as maths: ${row} -> ${written}`);
}

// The glyphs the mapping writes are all inked.
await assertInked(normalizeStrokeText("√(2) × 3 tan⁻¹(1) sin⁻¹(1) cos⁻¹(1)"), "glyph set");

console.log(`board ascii math: ${mapped} recorded rows write √, × and inverse trig with ink; code rows keep * and sqrt(`);
