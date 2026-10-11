import assert from "node:assert/strict";
import Konva from "konva";
import {
  mountTestWhiteboard,
  unmountTestWhiteboard,
} from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

async function main() {
  for (const duration of [0, 300]) {
    const board = mountTestWhiteboard();
    const clock = createVirtualWhiteboardClock();
    board.setTimeSource(clock.source);
    await board.drawShape("M450 300 L700 300", 0);
    let completed = false;
    const job = board.drawShape(
      "M574 300 A4 4 0 1 0 566 300 A4 4 0 1 0 574 300 Z",
      duration,
      { pointStyle: "open" },
    );
    void job.then(() => {
      completed = true;
    });
    for (let elapsed = 0; !completed && elapsed < 5000; elapsed += 16) {
      clock.advance(16);
      clock.pump();
      for (let turn = 0; turn < 40; turn++) await Promise.resolve();
    }
    assert(
      completed,
      "open point must finish in both live reveal and seek catch-up",
    );
    await job;
    const paths = board
      .getDrawLayer()!
      .getChildren()
      .filter((node) => node instanceof Konva.Path) as Konva.Path[];
    assert.equal(paths.length, 2);
    const mark = paths.at(-1)!;
    assert.equal(
      mark.fill(),
      "#F6E4C4",
      "excluded center must mask the underlying line with the actual board color",
    );
    assert.equal(
      mark.opacity(),
      1,
      "an excluded center cannot be a translucent fill over a solid axis",
    );
    assert(mark.strokeWidth() > 0, "excluded point still needs a visible ring");
    assert.notEqual(
      paths[0]!.fill(),
      mark.fill(),
      "ordinary figure lines must retain their original rendering",
    );
    unmountTestWhiteboard(board);
  }
  console.log("open endpoint live/catch-up masking passed");
}
runWhiteboardVerifier(main);
