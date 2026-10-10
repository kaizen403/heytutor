import assert from "node:assert/strict";
import Konva from "konva";
import { textToStrokePaths } from "@heytutor/drawing";
import {
  mountTestWhiteboard,
  unmountTestWhiteboard,
} from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

async function main() {
  for (const kind of ["glyph", "no-strokes", "lookup-failure"] as const) {
    const paths: typeof textToStrokePaths =
      kind === "lookup-failure"
        ? async () => {
            throw new Error("offline lookup failure");
          }
        : kind === "no-strokes"
          ? async () => [
              {
                char: "?",
                x: 90,
                y: 145,
                width: 20,
                fontSize: 32,
                strokes: [],
              },
            ]
          : textToStrokePaths;
    const board = mountTestWhiteboard(undefined, paths);
    const clock = createVirtualWhiteboardClock();
    board.setTimeSource(clock.source);
    const flush = async () => {
      for (let i = 0; i < 40; i++) await Promise.resolve();
    };
    const advance = async (ms: number) => {
      for (let i = 0; i < ms; i += 16) {
        clock.advance(16);
        clock.pump();
        await flush();
      }
    };
    let cancelled = false,
      started = 0;
    await advance(16);
    const instrument = board.setInstrument("pen");
    await advance(1000);
    await instrument;
    board.setCursorPos(90, 145);
    const pending = board.writeText(
      "?",
      90,
      145,
      1000,
      undefined,
      32,
      () => cancelled,
      undefined,
      () => {
        started++;
      },
    );
    await flush();
    assert.equal(
      started,
      0,
      `${kind}: preparation and zero-opacity nodes are not shown ink`,
    );
    let visible = false;
    for (let i = 0; i < 40 && !visible; i++) {
      await advance(16);
      visible = board
        .getDrawLayer()!
        .getStage()!
        .getLayers()
        .filter((layer) => layer !== board.getCursorLayer())
        .flatMap((layer) => layer.getChildren())
        .some(
          (node) =>
            node.getAttr("htInk") &&
            (node instanceof Konva.Text
              ? node.opacity() > 0
              : node instanceof Konva.Path &&
                node.dashOffset() < node.getLength()),
        );
    }
    assert(
      visible,
      `${kind}: actual consumer reached positive ink before completion`,
    );
    assert.equal(
      started,
      1,
      `${kind}: first positive reveal notified exactly once before cancellation`,
    );
    cancelled = true;
    board.cancelAnimations();
    await advance(32);
    await pending;
    assert.equal(
      started,
      1,
      `${kind}: cancelled completion never notifies again`,
    );
    unmountTestWhiteboard(board);
  }
  console.log(
    "verify-ink-start-observation: actual stroke and both fallback reveals notify before interrupted completion",
  );
}
runWhiteboardVerifier(main);
