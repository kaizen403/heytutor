import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { BOARD_TYPE_STEPS, textToStrokePaths, unwrapMathMarkup } from "@heytutor/drawing";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

async function main(): Promise<void> {
  let checks = 0;
  const failures: string[] = [];
  const check = (value: unknown, message: string) => { checks++; if (!value) failures.push(message); };
  check(unwrapMathMarkup("B_\\parallel") === "B_∥", "parallel command retains its relation glyph");
  const board = mountTestWhiteboard();
  const settings = { markerColor: "#222222", pencilColor: "#222222", markerThickness: 1.6, pencilThickness: 1.6 };
  const snapshots: string[] = [];
  try {
    for (const fontSize of BOARD_TYPE_STEPS) {
      for (const text of ["∥", "B_∥"]) {
        await board.clearBoard(0);
        await board.writeText(text, 70, 230, 0, undefined, fontSize, undefined, settings);
        const paths = await textToStrokePaths(text, 70, 230, fontSize);
        const glyph = paths.find((path) => path.char === "∥");
        check(glyph?.strokes.length === 2, `${fontSize}/${text}: parallel has two strokes`);
        const nodes = board.getDrawLayer()!.getChildren().filter((node) => node.getAttr("htInk"));
        check(nodes.every((node) => node.getClassName() === "Path"), `${fontSize}/${text}: actual Whiteboard uses stroke paths`);
        const stems = nodes.filter((node) => glyph?.strokes.some((stroke) => stroke.pathData === node.getAttr("data")));
        check(stems.length === 2, `${fontSize}/${text}: actual Whiteboard retains both stems`);
        const rectangles = stems.map((node) => node.getClientRect()).sort((a, b) => a.x - b.x);
        const gap = rectangles.length === 2 ? rectangles[1]!.x - rectangles[0]!.x - rectangles[0]!.width : -Infinity;
        check(gap >= 1, `${fontSize}/${text}: painted stems need >=1px air at maximum nib, got ${gap.toFixed(3)}px`);
        const row = snapshots.length;
        snapshots.push(`<g transform="translate(0,${row * 55 - 210})">${nodes.map((node) => `<path d="${node.getAttr("data")}" fill="none" stroke="#222222" stroke-width="${node.getAttr("strokeWidth")}" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}</g><text x="145" y="${row * 55 + 27}" font-family="sans-serif" font-size="14">${fontSize}px ${text}; painted gap ${gap.toFixed(2)}px</text>`);
      }
    }
    // Scheduled writing must commit the second stem too; immediate layout alone
    // cannot establish what the pen writes under an audio clock.
    await board.clearBoard(0);
    const clock = createVirtualWhiteboardClock();
    board.setTimeSource(clock.source); board.setCursorPos(70, 230);
    let complete = false;
    const pending = board.writeText("B_∥", 70, 230, 200, {
      charStartOffsetsMs: [0, 100], charDurationsMs: [100, 100], getAudioPositionMs: clock.now,
    }, 32, undefined, settings).then(() => { complete = true; });
    for (let step = 0; step < 1000 && !complete; step++) {
      clock.advance(16); clock.pump();
      for (let microtask = 0; microtask < 20; microtask++) await Promise.resolve();
    }
    check(complete, "scheduled relation finishes on the virtual audio clock");
    if (complete) await pending;
    const glyph = (await textToStrokePaths("B_∥", 70, 230, 32)).find((path) => path.char === "∥")!;
    const stems = board.getDrawLayer()!.getChildren().filter((node) => glyph.strokes.some((stroke) => stroke.pathData === node.getAttr("data")));
    check(stems.length === 2, "scheduled writing commits both parallel strokes");
    const snapshot = process.argv.find((argument) => argument.startsWith("--snapshot="))?.slice("--snapshot=".length);
    if (snapshot) writeFileSync(snapshot, `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="570" viewBox="0 0 520 570"><rect width="520" height="570" fill="white"/>${snapshots.join("")}</svg>`);
  } finally { unmountTestWhiteboard(board); }
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(`H4 parallel glyph: ${checks} checks passed on actual Whiteboard immediate/scheduled paths`);
}
runWhiteboardVerifier(main);
