import assert from "node:assert/strict";
import {
  fitWorkTextCommand,
  getSegmentCommands,
  measureTextWidth,
  prepareVerifiedLessonSegments,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { withBoardEpochSegment, type RecordedSegmentPayload } from "../../lib/boards/boardsClient";
import {
  estimateBoardTextWidthAtSize,
  findWorkTextSlot,
  registerBoardAnchor,
  withWorkRowIdentity,
  textRectsOverlap,
} from "../../features/tutor-session/lib/board/boardLayout";
import { BOARD_ROWS_PER_PAGE } from "@heytutor/tutor-core";
import {
  BOARD_WORK_ROWS_PER_PAGE,
  TEXT_LAYOUT,
  WORK_ROW_FONT_SIZE,
} from "../../features/tutor-session/constants";
import {
  fitWorkRowFontSize,
  workRowBaseFontSize,
  wrapWorkRow,
  MIN_WORK_ROW_FONT_SIZE,
} from "../../features/tutor-session/hooks/useBoardLayout";
import {
  BOARD_TYPE_SCALE,
  BOARD_TYPE_STEPS,
  WORK_CONTINUATION_INDENT,
  WORK_ZONE,
} from "@heytutor/drawing";
import type { BoardLayoutState } from "../../features/tutor-session/types";

const WORK_MAX_WIDTH = 400 - 28 - TEXT_LAYOUT.marginX;
/**
 * The parse layer runs before anything knows whether this turn has a figure,
 * so it fits against the whole board and only breaks lines no column could
 * hold. The app re-fits every row against the column it lands in.
 */
const PARSE_MAX_WIDTH = WORK_ZONE.fullWidthTextWidth;

function command(
  type: DrawCommand["type"],
  params: number[],
  text?: string,
): DrawCommand {
  return { type, params, text, charPosition: 0, narrationBefore: "" };
}

const diagram: VerifiedDiagram = {
  id: "verified_scene",
  name: "test",
  commands: [],
  anchors: [{ id: "diagram", labels: ["diagram"], x: 500, y: 160, width: 300, height: 260 }],
  reveals: [],
  promptAddon: "",
};

function verifyLiveWriteRepair(): void {
  const source = command(
    "WRITE",
    [820, 145, 32],
    "B = μ_0 I /(2 π r) and F = q v B sin θ",
  );
  const segment: TutorSegment = { narration: "write the field and force laws", command: source };
  const result = prepareVerifiedLessonSegments([segment], diagram);
  const writes = result.segments.flatMap(getSegmentCommands);

  assert.ok(writes.length >= 1, "misplaced work must be repaired, not discarded");
  const repairedSizes = new Set(writes.map((write) => write.params[2]));
  assert.equal(repairedSizes.size, 1, "one repaired line must come back at one size");
  for (const [index, write] of writes.entries()) {
    assert.equal(write.type, "WRITE");
    assert.equal(
      write.params[0],
      TEXT_LAYOUT.marginX + (index === 0 ? 0 : WORK_CONTINUATION_INDENT),
      "rows start at the margin; wrapped continuations are set in under them",
    );
    const fontSize = write.params[2]!;
    assert.ok(
      (BOARD_TYPE_STEPS as readonly number[]).includes(fontSize),
      `repaired work must use a size from the board scale, got ${fontSize}`,
    );
    assert.ok(
      measureTextWidth(write.text ?? "", fontSize) <= PARSE_MAX_WIDTH,
      `work text overran the board: ${write.text}`,
    );
  }
  assert.equal(result.blockedCommandCount, 0);
}

function verifySequentialRows(): void {
  const layout: BoardLayoutState = {
    rects: [{ x: 500, y: 160, width: 300, height: 260, text: "diagram" }],
    nextY: TEXT_LAYOUT.topY,
  };
  const placed: Array<{ x: number; y: number; width: number; height: number }> = [];

  for (let index = 0; index < BOARD_WORK_ROWS_PER_PAGE; index += 1) {
    const slot = findWorkTextSlot({
      layout,
      requestedX: index % 2 === 0 ? 90 : 780,
      requestedY: 145,
      width: 210,
      height: TEXT_LAYOUT.textHeight,
      diagramActive: true,
      sequential: true,
      runtimeOwnsX: true,
    });
    assert.ok(slot, `row ${index + 1} should fit`);
    const rect = {
      x: slot.x,
      y: slot.y,
      width: 210,
      height: TEXT_LAYOUT.textHeight,
    };
    assert.equal(rect.x, TEXT_LAYOUT.marginX);
    assert.ok(placed.every((prior) => !textRectsOverlap(prior, rect)));
    placed.push(rect);
    registerBoardAnchor(layout, rect);
    layout.nextY = rect.y + TEXT_LAYOUT.lineHeight;
  }

  assert.deepEqual(
    placed.map((rect) => rect.y),
    Array.from(
      { length: BOARD_WORK_ROWS_PER_PAGE },
      (_, index) => TEXT_LAYOUT.workTopY + index * TEXT_LAYOUT.lineHeight,
    ),
  );
  assert.equal(
    findWorkTextSlot({
      layout,
      requestedX: 90,
      requestedY: 145,
      width: 210,
      height: TEXT_LAYOUT.textHeight,
      diagramActive: true,
      sequential: true,
      runtimeOwnsX: true,
    }),
    null,
    "the tenth row must request a page rollover instead of overwriting",
  );

  // The teaching prompt tells the model how many rows a page holds so it knows
  // a long lesson spans several pages. That number must be this number.
  assert.equal(
    placed.length,
    BOARD_ROWS_PER_PAGE,
    "BOARD_ROWS_PER_PAGE has drifted from the real work-column capacity",
  );
}

function verifyFontAwareMeasurement(): void {
  const text = "∫_(-2)^(2)(4 - x^2) dx";
  const widths = [12, 24, 32, 40].map((fontSize) =>
    estimateBoardTextWidthAtSize(text, fontSize),
  );
  assert.ok(widths.every(Number.isFinite));
  assert.ok(widths[0]! < widths[1]! && widths[1]! < widths[2]! && widths[2]! < widths[3]!);

  const fitted = fitWorkTextCommand(command("WRITE", [900, 625, 40], text));
  assert.ok(fitted.length >= 1);
  assert.equal(fitted[0]!.params[0], TEXT_LAYOUT.marginX);
  assert.ok(
    fitted.every((item) => measureTextWidth(item.text ?? "", item.params[2] ?? 32) <= PARSE_MAX_WIDTH),
  );

  // The narrow column beside a figure is where a long token actually has to be
  // dealt with, and that is the app's job because only it knows the column.
  const compact = wrapWorkRow("CH3CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2OH", WORK_MAX_WIDTH);
  assert.ok(compact.lines.length > 1, "an unbroken long token must wrap instead of crossing the diagram");
  assert.ok(
    compact.lines.every((line) => measureTextWidth(line, compact.fontSize) <= WORK_MAX_WIDTH),
  );
}

function verifyReplayEpochAndResolvedCoordinates(): void {
  const resolved = command("WRITE", [90, 250, 24], "v = 60 cm");
  const recorded: RecordedSegmentPayload[] = [{
    orderIndex: 7,
    narration: "v equals sixty centimeters",
    spokenText: "v equals sixty centimeters",
    command: resolved,
    audioBytes: null,
    durationMs: 900,
    timings: null,
  }];
  const persisted = withBoardEpochSegment(recorded);
  assert.deepEqual(persisted.map((segment) => segment.orderIndex), [0, 1]);
  assert.equal((persisted[0]!.command as DrawCommand).type, "CLEAR");
  assert.deepEqual((persisted[1]!.command as DrawCommand).params, [90, 250, 24]);
}

function verifyWorkRowIdentity(): void {
  const layout: BoardLayoutState = { rects: [], nextY: TEXT_LAYOUT.topY };
  const first = withWorkRowIdentity(layout, {
    x: 90,
    y: 145,
    width: 120,
    height: 42,
    text: "v = 60 cm",
  });
  registerBoardAnchor(layout, first);
  const second = withWorkRowIdentity(layout, {
    x: 90,
    y: 199,
    width: 120,
    height: 42,
    text: "1/v = 1/15 - 1/20",
  });
  assert.equal(first.workId, "w1");
  assert.equal(first.workIndex, 1);
  assert.equal(second.workId, "w2");
  assert.equal(second.workIndex, 2);
}

verifyLiveWriteRepair();
verifySequentialRows();
verifyFontAwareMeasurement();
verifyReplayEpochAndResolvedCoordinates();
verifyWorkRowIdentity();
// --- no work row may reach the diagram --------------------------------------
//
// The layout clamps the RECT it registers to the column, but `writeText` draws
// the whole string at whatever size it is handed, so a row composed wider than
// the column is drawn straight through the figure. Observed live on 4 Sep 2026:
// a "Given: ..." line 861px wide crossed a ray diagram. Runtime lines arrive
// pre-wrapped; this clamp is the backstop for a teaching line that is too long.
function verifyWorkRowFits(): void {
  const column = 282;

  // Beside a figure the column has its own steady base, so a lesson's rows come
  // out one size instead of each being trimmed differently.
  const narrowBase = workRowBaseFontSize(column);
  assert.ok(
    narrowBase < WORK_ROW_FONT_SIZE,
    "the column beside a figure must use a smaller base than the full board",
  );
  assert.equal(
    workRowBaseFontSize(WORK_ZONE.fullWidthTextWidth),
    WORK_ROW_FONT_SIZE,
    "with no figure the full work-row size is used",
  );
  assert.equal(
    fitWorkRowFontSize("v = 60 cm", column),
    narrowBase,
    "a row that already fits must keep its base size — no silent shrinking",
  );

  // The lines a real derivation is made of must all come out the same size.
  // Measured on 4 Sep 2026, before the board had a type scale, these seven rows
  // were drawn at 23, 28, 32, 32, 28, 17 and 26px: every layer picked a size by
  // shrinking the row until it fit, so length decided size and the column read
  // as a fault rather than as writing.
  const derivation = [
    "Given: u = -20 cm, f = -15 cm",
    "want v = image distance",
    "1/f = 1/u + 1/v",
    "1/v = 1/f - 1/u",
    "1/v = 1/(-15) - 1/(-20)",
    "v > 0 -> real image, same side as object",
    "check: 1/15 - 1/20 = 1/60",
  ];
  for (const line of derivation) {
    assert.equal(
      fitWorkRowFontSize(line, column),
      narrowBase,
      `every row of one lesson shares one size; "${line}" was trimmed`,
    );
  }

  // A row too wide for the column is WRAPPED at that size, not shrunk to fit,
  // and every row it becomes really does stay inside the column — including the
  // continuations, which are indented and so have less room than the first.
  const overLong = "v > 0 -> real image, same side as object";
  const wrapped = wrapWorkRow(overLong, column);
  assert.equal(wrapped.fontSize, narrowBase, "wrapping must not cost the row its size");
  assert.ok(wrapped.lines.length > 1, "a row too wide for the column must be broken up");
  wrapped.lines.forEach((line, index) => {
    const room = column - (index === 0 ? 0 : WORK_CONTINUATION_INDENT);
    assert.ok(
      estimateBoardTextWidthAtSize(line, wrapped.fontSize) <= room + 1,
      `wrapped row ${index + 1} overhangs the column: "${line}"`,
    );
  });
  assert.equal(
    wrapped.lines.join(" ").replace(/\s+/g, " "),
    overLong,
    "wrapping must not lose or duplicate anything",
  );

  // Only a token that cannot be broken may cost a row its size, and then it
  // lands on a step of the scale rather than on a bespoke number.
  const unbreakable = wrapWorkRow("CH3CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2OH", column);
  assert.ok(
    unbreakable.fontSize < narrowBase,
    "a token wider than the column at the base size must step the block down",
  );
  assert.ok(
    (BOARD_TYPE_STEPS as readonly number[]).includes(unbreakable.fontSize),
    `the last resort must still land on the scale, got ${unbreakable.fontSize}`,
  );
  assert.ok(
    unbreakable.fontSize >= MIN_WORK_ROW_FONT_SIZE,
    "and never below the floor",
  );

  assert.equal(
    fitWorkRowFontSize("", column),
    narrowBase,
    "empty text must not divide by zero; it takes its column's base",
  );

  // A figure label reads under the working, and a measurement under the label.
  assert.ok(
    BOARD_TYPE_SCALE.label < BOARD_TYPE_SCALE.workNarrow,
    "names on the figure must not compete with the working",
  );
  assert.ok(BOARD_TYPE_SCALE.annotation < BOARD_TYPE_SCALE.label);
}

verifyWorkRowFits();

console.log("board layout verification passed");
