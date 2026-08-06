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
import { withBoardEpochSegment, type RecordedSegmentPayload } from "../lib/boardsClient";
import {
  estimateBoardTextWidthAtSize,
  findWorkTextSlot,
  registerBoardAnchor,
  textRectsOverlap,
} from "../features/tutor-session/lib/boardLayout";
import { TEXT_LAYOUT } from "../features/tutor-session/constants";
import type { BoardLayoutState } from "../features/tutor-session/types";

const WORK_MAX_WIDTH = 400 - 28 - TEXT_LAYOUT.marginX;

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
  for (const write of writes) {
    assert.equal(write.type, "WRITE");
    assert.equal(write.params[0], TEXT_LAYOUT.marginX);
    const fontSize = write.params[2] ?? 32;
    assert.ok(fontSize >= 12 && fontSize <= 32);
    assert.ok(
      measureTextWidth(write.text ?? "", fontSize) <= WORK_MAX_WIDTH,
      `work text crossed the diagram boundary: ${write.text}`,
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

  for (let index = 0; index < 9; index += 1) {
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
    Array.from({ length: 9 }, (_, index) => TEXT_LAYOUT.workTopY + index * TEXT_LAYOUT.lineHeight),
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
  assert.ok(fitted.every((item) => item.params[0] === TEXT_LAYOUT.marginX));
  assert.ok(fitted.every((item) => measureTextWidth(item.text ?? "", item.params[2] ?? 32) <= WORK_MAX_WIDTH));

  const compact = fitWorkTextCommand(command(
    "WRITE",
    [900, 625, 32],
    "CH3CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2OH",
  ));
  assert.ok(compact.length > 1, "an unbroken long token must wrap instead of crossing the diagram");
  assert.ok(compact.every((item) => measureTextWidth(item.text ?? "", item.params[2] ?? 32) <= WORK_MAX_WIDTH));
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

verifyLiveWriteRepair();
verifySequentialRows();
verifyFontAwareMeasurement();
verifyReplayEpochAndResolvedCoordinates();
console.log("board layout verification passed");
