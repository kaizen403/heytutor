/**
 * The board's writing style is a contract, not a preference.
 *
 * The failure this guards against is specific and was measured live: seven
 * consecutive rows of one derivation came out at 23, 28, 32, 32, 28, 17 and
 * 26 px, because every layer chose a row's size by shrinking it until it fit.
 * These checks fail if any of that behaviour comes back.
 */
import assert from "node:assert/strict";
import {
  BOARD_TYPE_SCALE,
  BOARD_TYPE_STEPS,
  MAX_BOARD_FONT_SIZE,
  MIN_BOARD_FONT_SIZE,
  WORK_CONTINUATION_INDENT,
  boardFontSize,
  fitBoardText,
  nextSmallerBoardFontSize,
  snapToBoardTypeScale,
  workRowFontSize,
  wrapBoardText,
} from "../src/layout/boardTypography";
import { fitWorkTextCommand } from "../src/layout/lessonPlanner";
import { WORK_ZONE } from "../src/layout/boardZones";
import { measureTextWidth } from "../src/handwriting/handwriting";
import type { DrawCommand } from "../src/protocol/drawingProtocol";

const NARROW_COLUMN = WORK_ZONE.maxTextWidth;
const FULL_COLUMN = WORK_ZONE.fullWidthTextWidth;

/** The seven rows that came out at seven different sizes. */
const DERIVATION = [
  "Given: u = -20 cm, f = -15 cm",
  "want v = image distance",
  "1/f = 1/u + 1/v",
  "1/v = 1/f - 1/u",
  "1/v = 1/(-15) - 1/(-20)",
  "v > 0 -> real image, same side as object",
  "check: 1/15 - 1/20 = 1/60",
];

function verifyScaleIsOrderedAndClosed(): void {
  for (let index = 1; index < BOARD_TYPE_STEPS.length; index += 1) {
    assert.ok(
      BOARD_TYPE_STEPS[index]! < BOARD_TYPE_STEPS[index - 1]!,
      "the scale must be strictly descending",
    );
  }
  assert.equal(BOARD_TYPE_STEPS[0], MAX_BOARD_FONT_SIZE);
  assert.equal(BOARD_TYPE_STEPS.at(-1), MIN_BOARD_FONT_SIZE);

  // A heading must be visibly bigger than the working, the working visibly
  // bigger than the names on the figure, and those bigger than a measurement.
  // Steps closer than 1.1x would read as a mistake rather than as a hierarchy.
  for (let index = 1; index < BOARD_TYPE_STEPS.length; index += 1) {
    const ratio = BOARD_TYPE_STEPS[index - 1]! / BOARD_TYPE_STEPS[index]!;
    assert.ok(
      ratio >= 1.1,
      `steps ${BOARD_TYPE_STEPS[index - 1]} and ${BOARD_TYPE_STEPS[index]} are too close to tell apart`,
    );
  }

  assert.ok(BOARD_TYPE_SCALE.heading > BOARD_TYPE_SCALE.work);
  assert.ok(BOARD_TYPE_SCALE.work > BOARD_TYPE_SCALE.label);
  assert.ok(BOARD_TYPE_SCALE.label > BOARD_TYPE_SCALE.annotation);

  // Anything handed in from outside lands on a real step, never between two.
  for (const candidate of [0, 5, 11, 12, 17, 19, 23, 26, 31, 32, 37, 45, 48, 96, Number.NaN]) {
    const snapped = snapToBoardTypeScale(candidate);
    assert.ok(
      (BOARD_TYPE_STEPS as readonly number[]).includes(snapped),
      `snapping ${candidate} produced the off-scale size ${snapped}`,
    );
  }
  assert.equal(snapToBoardTypeScale(1000), MAX_BOARD_FONT_SIZE);
  assert.equal(snapToBoardTypeScale(1), MIN_BOARD_FONT_SIZE);
  assert.equal(nextSmallerBoardFontSize(MIN_BOARD_FONT_SIZE), null, "the floor has no step below it");
}

function verifyRoleDecidesSizeNotLength(): void {
  assert.equal(boardFontSize("work", FULL_COLUMN), BOARD_TYPE_SCALE.work);
  assert.equal(boardFontSize("work", NARROW_COLUMN), BOARD_TYPE_SCALE.workNarrow);
  assert.equal(workRowFontSize(NARROW_COLUMN), BOARD_TYPE_SCALE.workNarrow);
  assert.ok(
    workRowFontSize(NARROW_COLUMN) < workRowFontSize(FULL_COLUMN),
    "the column beside a figure writes smaller than the whole board",
  );

  // The point of the whole module: length must not move the size.
  for (const column of [FULL_COLUMN, NARROW_COLUMN]) {
    const expected = workRowFontSize(column);
    const sizes = DERIVATION.map((line) => fitBoardText(line, { role: "work", maxWidth: column }).fontSize);
    assert.deepEqual(
      sizes,
      DERIVATION.map(() => expected),
      `one derivation must come out one size in a ${column}px column, got ${sizes.join(", ")}`,
    );
  }
}

function verifyLongLinesWrapRatherThanShrink(): void {
  const long = "v > 0 -> real image, same side as object";
  const narrow = fitBoardText(long, { role: "work", maxWidth: NARROW_COLUMN });

  assert.equal(
    narrow.fontSize,
    BOARD_TYPE_SCALE.workNarrow,
    "a long sentence must keep the column's size and wrap, not shrink to fit",
  );
  assert.ok(narrow.lines.length > 1, "a line too wide for the column must be broken up");
  for (const line of narrow.lines) {
    assert.ok(
      measureTextWidth(line, narrow.fontSize) <= NARROW_COLUMN,
      `wrapped row still overhangs the column: ${line}`,
    );
  }
  assert.equal(
    narrow.lines.join(" ").replace(/\s+/g, " "),
    long,
    "wrapping must not drop or duplicate anything the student is meant to read",
  );

  // The same sentence on an empty board is one row at the full size.
  const full = fitBoardText(long, { role: "work", maxWidth: FULL_COLUMN });
  assert.deepEqual(full.lines, [long]);
  assert.equal(full.fontSize, BOARD_TYPE_SCALE.work);
}

function verifyOnlyUnbreakableTokensDropTheSize(): void {
  const chain = "CH3CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2OH";
  const fitted = fitBoardText(chain, { role: "work", maxWidth: NARROW_COLUMN });

  assert.ok(
    fitted.fontSize < BOARD_TYPE_SCALE.workNarrow,
    "a single token wider than the column at every step above the floor must step down",
  );
  assert.ok(
    (BOARD_TYPE_STEPS as readonly number[]).includes(fitted.fontSize),
    "even the last resort lands on the scale",
  );
  assert.ok(fitted.fontSize >= MIN_BOARD_FONT_SIZE, "and never below the floor");

  // An ordinary line in the same column is untouched by that neighbour.
  assert.equal(
    fitBoardText("v = 60 cm", { role: "work", maxWidth: NARROW_COLUMN }).fontSize,
    BOARD_TYPE_SCALE.workNarrow,
  );
}

function verifyWrapPrefersReadableBreaks(): void {
  // A break at a word boundary keeps whole words together.
  const words = wrapBoardText("the image is real and inverted and on the same side", 28, 260);
  assert.ok(words.length > 1);
  for (const line of words) {
    assert.ok(!/^\s|\s$/.test(line), "wrapped rows must not carry stray spaces");
  }
  assert.ok(
    words.every((line) => !line.includes("  ")),
    "wrapping must not double up spaces",
  );

  // An equation with no spaces still breaks at an operator, and the operator
  // leads the continuation the way a teacher writes a spilled line.
  const equation = wrapBoardText("1/v=1/15-1/20+1/60-1/30+1/90", 36, 200);
  assert.ok(equation.length > 1, "a long equation must break");
  for (const line of equation.slice(1)) {
    assert.ok(
      /^[+\-−×÷=→≈≤≥]/u.test(line),
      `a continuation should open with the operator it carries over, got "${line}"`,
    );
  }
  assert.equal(equation.join(""), "1/v=1/15-1/20+1/60-1/30+1/90");
}

function verifyWorkCommandsCarryOneSizeAndIndentContinuations(): void {
  const write = (text: string): DrawCommand => ({
    type: "WRITE",
    params: [900, 625, 18],
    text,
    charPosition: 0,
    narrationBefore: "",
  });

  for (const line of DERIVATION) {
    const rows = fitWorkTextCommand(write(line));
    assert.ok(rows.length >= 1);
    const sizes = new Set(rows.map((row) => row.params[2]));
    assert.equal(sizes.size, 1, `"${line}" was drawn at ${[...sizes].join(", ")}`);
    assert.equal(
      rows[0]!.params[2],
      BOARD_TYPE_SCALE.work,
      "the model's requested size must be ignored — it says what to write, not how large",
    );
    assert.equal(rows[0]!.params[0], WORK_ZONE.marginX, "a row starts at the column margin");
    for (const row of rows.slice(1)) {
      assert.equal(
        row.params[0],
        WORK_ZONE.marginX + WORK_CONTINUATION_INDENT,
        "a wrapped continuation is set in, so it does not read as a new step",
      );
    }
  }

  // Every row of one lesson, one size.
  const lesson = DERIVATION.flatMap((line) => fitWorkTextCommand(write(line)));
  const lessonSizes = new Set(lesson.map((row) => row.params[2]));
  assert.equal(
    lessonSizes.size,
    1,
    `a lesson must be written at one size, got ${[...lessonSizes].sort().join(", ")}`,
  );

  assert.deepEqual(fitWorkTextCommand(write("   ")), [], "an empty row draws nothing");
}

verifyScaleIsOrderedAndClosed();
verifyRoleDecidesSizeNotLength();
verifyLongLinesWrapRatherThanShrink();
verifyOnlyUnbreakableTokensDropTheSize();
verifyWrapPrefersReadableBreaks();
verifyWorkCommandsCarryOneSizeAndIndentContinuations();

console.log("board typography verification passed");
