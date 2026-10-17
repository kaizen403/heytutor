/** Phone font floor through actual shell/viewport consumers and native handwriting paths. */
import assert from "node:assert/strict";
import { BOARD_TYPE_SCALE, fitBoardText, textToStrokePaths } from "@heytutor/drawing";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
async function main(): Promise<void> {
  process.env.PHONE_BOARD_READABILITY_ONLY = "1";
  const { phoneViewportScales } = await import("./verify-mobile-caption-dock");
  assert.equal(phoneViewportScales.length, 4);
  const board = mountTestWhiteboard();
  try {
    for (const [index, fontSize] of Object.values(BOARD_TYPE_SCALE).entries()) {
      const text = index === 2 ? "check: 10 = -(-10)" : "v = 10 m/s";
      const paths = await textToStrokePaths(text, 90, 80 + index * 90, fontSize);
      assert.ok(paths.some(char => char.strokes.length > 0), "real handwriting ink exists");
      const expected = paths.flatMap(char => char.strokes.map(stroke => stroke.pathData));
      const beforeCount = board.getDrawLayer()!.getChildren().length;
      await board.writeText(text, 90, 80 + index * 90, 0, undefined, fontSize);
      for (const scale of phoneViewportScales) assert.ok(fontSize * scale >= 16 - 1e-8, "every role meets16CSSpx in the actual viewport");
      const actual = board.getDrawLayer()!.getChildren().slice(beforeCount)
        .filter(node => node.getClassName() === "Path").map(node => node.getAttrs().data);
      assert.deepEqual(actual, expected, "actual Whiteboard preserves canonical native stroke paths and font size");
    }
    assert.ok(board.getDrawLayer()!.getChildren().length > 0, "actual Whiteboard commits native ink");
    const short = fitBoardText("v = 10 m/s", { role: "work", maxWidth: 282 });
    const wrapped = fitBoardText("The image is real and inverted and on the same side as the object", { role: "work", maxWidth: 282 });
    assert.equal(short.fontSize, 27); assert.equal(wrapped.fontSize, 27); assert.ok(wrapped.lines.length > 1);
    const token = fitBoardText("CH3CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2CH2OH", { role: "work", maxWidth: 282 });
    assert.equal(token.fontSize, 19, "unbreakable-token fallback is covered by the phone floor");
  } finally { unmountTestWhiteboard(board); }
  console.log("Phone board readability: actual role floor, pan, keyboard/deck, capture and native ink GREEN");

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
