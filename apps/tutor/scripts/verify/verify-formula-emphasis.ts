import { emphasisBoxPath, highlighterSweepPath, measureTextWidth } from "@heytutor/drawing";
import {
  resultCharRange,
  resultSpanOfRow,
  spanRectInRow,
} from "@/features/tutor-session/lib/formulaEmphasis";
import type { BoardTextRect } from "@/features/tutor-session/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function row(text: string, x = 90, y = 200, height = 42): BoardTextRect {
  // Lay the row out at the width the renderer would actually give it.
  return { x, y, width: measureTextWidth(text), height, text };
}

// --- which part of a worked line is the result ----------------------------
assert(resultCharRange("v = u + at") !== null, "an equation has a result span");
assert(resultCharRange("Given: mass and friction") === null, "prose has no result span");
assert(resultCharRange("= 4.5") === null, "a relation with no left side is a fragment, not a result");
assert(resultCharRange("F_net") === null, "a lone symbol has no result span");
{
  const text = "v = u + at";
  const range = resultCharRange(text)!;
  assert(text.slice(range.start, range.end) === "u + at", `got "${text.slice(range.start, range.end)}"`);
}
{
  // The *last* relation wins, so a substitution chain highlights the answer.
  const text = "x = 2 + 3 = 5 m";
  const range = resultCharRange(text)!;
  assert(text.slice(range.start, range.end) === "5 m", `got "${text.slice(range.start, range.end)}"`);
}
{
  const text = "a ≈ 9.8";
  const range = resultCharRange(text)!;
  assert(text.slice(range.start, range.end) === "9.8", `approx signs count too, got "${text.slice(range.start, range.end)}"`);
}

// --- the span lands on the glyphs, and never outside the row --------------
for (const text of ["v = u + at", "x = 2 + 3 = 5 m", "E_k = 1/2 m v^2", "R = 12 Ω", "t = 0.75 s"]) {
  const target = row(text);
  const span = resultSpanOfRow(target)!;
  assert(span, `"${text}" should have a highlightable result`);
  assert(span.x >= target.x - 0.01, `${text}: span starts inside the row`);
  assert(
    span.x + span.width <= target.x + target.width + 0.01,
    `${text}: span ends inside the row (${span.x + span.width} vs ${target.x + target.width})`,
  );
  assert(span.width > 0, `${text}: span has width`);
  assert(span.width < target.width, `${text}: the result is narrower than the whole line`);
  assert(span.y === target.y && span.height === target.height, `${text}: span keeps the row's band`);
  // The measured start must match the width of the text before it.
  const range = resultCharRange(text)!;
  const expected = target.x + measureTextWidth(text.slice(0, range.start));
  assert(
    Math.abs(span.x - expected) < 0.5,
    `${text}: span should start at the glyph boundary (${span.x} vs ${expected})`,
  );
}

// --- a row laid out at a different width still gets a correct span --------
{
  const text = "v = u + at";
  const natural = measureTextWidth(text);
  const squeezed: BoardTextRect = { x: 90, y: 200, width: natural * 0.8, height: 42, text };
  const span = resultSpanOfRow(squeezed)!;
  assert(
    span.x + span.width <= squeezed.x + squeezed.width + 0.01,
    "a rescaled row keeps its span inside the laid-out width",
  );
  const fraction = (span.x - squeezed.x) / squeezed.width;
  const naturalFraction = measureTextWidth(text.slice(0, resultCharRange(text)!.start)) / natural;
  assert(
    Math.abs(fraction - naturalFraction) < 0.01,
    "the span scales with the row instead of drifting off the glyphs",
  );
}

// --- degenerate rows must not throw or produce nonsense -------------------
assert(resultSpanOfRow({ x: 0, y: 0, width: 0, height: 0 }) === null, "an empty rect has no span");
assert(resultSpanOfRow({ x: 0, y: 0, width: 100, height: 40, text: "" }) === null, "empty text has no span");
assert(resultSpanOfRow({ x: 0, y: 0, width: 0, height: 40, text: "v = 2" }) === null, "a zero-width row has no span");
assert(spanRectInRow(row("v = 2"), 3, 2) === null, "a reversed range has no span");
assert(spanRectInRow(row("v = 2"), 0, 99) === null, "a range past the text has no span");

// --- the box is a single closed gesture, sized round the formula ----------
{
  const target = row("v = u + at");
  const path = emphasisBoxPath(target.x, target.y, target.width, target.height);
  assert(path.startsWith("M "), "the box is a path");
  assert((path.match(/M /g) ?? []).length === 1, "the box is one continuous stroke, not four edges");
  const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const xs = numbers.filter((_, index) => index % 2 === 0);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  assert(Math.min(...xs) < target.x, "the box clears the formula on the left");
  assert(Math.max(...xs) > target.x + target.width, "the box clears the formula on the right");
  assert(Math.min(...ys) < target.y, "the box clears the formula above");
  assert(Math.max(...ys) > target.y + target.height, "the box clears the formula below");
  // Deterministic: the same row must replay the same box.
  assert(
    emphasisBoxPath(target.x, target.y, target.width, target.height) === path,
    "a hand-drawn box must not mean a random box",
  );
  assert(
    emphasisBoxPath(target.x + 1, target.y, target.width, target.height) !== path,
    "a different row gets its own wobble",
  );
}

// --- the highlighter sweep is a centre line, not a rectangle --------------
{
  const path = highlighterSweepPath(100, 200, 80, 40);
  assert(path.startsWith("M "), "the sweep is a path");
  assert(!path.includes("Z"), "a marker swipe is an open stroke, not a closed shape");
  const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const ys = numbers.filter((_, index) => index % 2 === 1);
  for (const y of ys) {
    assert(Math.abs(y - 220) < 4, `the sweep tracks the middle of the band, got ${y}`);
  }
}

console.log(
  "verify-formula-emphasis: results are located on the glyphs, boxes are one deterministic stroke, sweeps ride the centre line",
);
