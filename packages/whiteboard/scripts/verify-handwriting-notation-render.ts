import assert from "node:assert/strict";
import {
  countWrittenGlyphs,
  measureTextInkBounds,
  textToStrokePaths,
} from "@heytutor/drawing";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

async function main() {
  const board = mountTestWhiteboard();
  try {
    for (const text of ["[0, 1]", "[H_3O^+]", "[Fe(CN)_6]^(3−)", "v̄ + [x⃗] = 20 − 8"]) {
      await board.clearBoard(0);
      await board.writeText(text, 70, 230, 0, undefined, 32);
      const nodes = board.getDrawLayer()!.getChildren().filter(node => node.getAttr("htInk"));
      assert.equal(nodes.filter(node => node.getClassName() === "Text").length, 0,
        `${text}: actual Whiteboard must never create a fallback Text node`);
      const paths = await textToStrokePaths(text, 70, 230, 32);
      assert.equal(nodes.length, paths.reduce((sum, path) => sum + path.strokes.length, 0));
      const bounds = measureTextInkBounds(text, 70, 230, 32)!;
      for (const node of nodes) {
        const actual = node.getClientRect();
        assert(actual.x >= bounds.x - 1 && actual.y >= bounds.y - 1 &&
          actual.x + actual.width <= bounds.x + bounds.width + 1 &&
          actual.y + actual.height <= bounds.y + bounds.height + 1,
        `${text}: actual ink must fit the measured reservation`);
      }
    }
    // Unknown text still uses the existing fallback; supported notation must
    // not be obtained by hiding all Text nodes or dropping unknown characters.
    await board.clearBoard(0);
    await board.writeText("🦕", 70, 230, 0, undefined, 32);
    assert.equal(board.getDrawLayer()!.getChildren().filter(node => node.getClassName() === "Text").length, 1);

    await board.clearBoard(0);
    const clock = createVirtualWhiteboardClock();
    board.setTimeSource(clock.source);
    board.setCursorPos(70, 230);
    const text = "[v̄] − x_1";
    const count = countWrittenGlyphs(text);
    let complete = false;
    const pending = board.writeText(text, 70, 230, 1000, {
      charStartOffsetsMs: Array.from({ length: count }, (_, index) => index * 90),
      charDurationsMs: Array.from({ length: count }, () => 90),
      getAudioPositionMs: clock.now,
    }, 32).then(() => { complete = true; });
    for (let step = 0; step < 1000 && !complete; step++) {
      clock.advance(16); clock.pump();
      for (let microtask = 0; microtask < 20; microtask++) await Promise.resolve();
    }
    assert(complete, "scheduled notation must finish within its finite clock budget");
    await pending;
    const nodes = board.getDrawLayer()!.getChildren().filter(node => node.getAttr("htInk"));
    assert.equal(nodes.filter(node => node.getClassName() === "Text").length, 0);
    assert.equal(nodes.length, (await textToStrokePaths(text, 70, 230, 32))
      .reduce((sum, path) => sum + path.strokes.length, 0), "every scheduled glyph must commit every stroke");
  } finally { unmountTestWhiteboard(board); }
  console.log("handwriting notation render: actual immediate and scheduled Whiteboard paths retain brackets/minus/attached marks with measured bounds");
}
runWhiteboardVerifier(main);
