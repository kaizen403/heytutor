/**
 * Kept FOCUS rings (`[FOCUS:id|keep]`) on the real board.
 *
 * What has to hold:
 *   - a pinned ring is not transient: it outlives the fade that takes an
 *     ordinary review trace away, at a watched speed and at a seek (0 ms);
 *   - it is tagged `"pin"`, never `"scene"`, so it belongs to the page;
 *   - `eraseWorkInk` (a work column page turn) takes it away and leaves the
 *     figure;
 *   - `erasePinnedInk` takes only the rings;
 *   - `eraseSceneInk` takes the figure and the rings and leaves the work.
 */
import assert from "node:assert/strict";
import Konva from "konva";
import { mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";
import { BOARD_INK_ATTR } from "../src/inkKind";
import type { WhiteboardHandle } from "../src/Whiteboard";

const RING = "M 640 300 A 40 40 0 1 1 639.9 300 Z";
const FIGURE_LINE = "M 450 400 L 900 400";

async function settle(clock: ReturnType<typeof createVirtualWhiteboardClock>, job: Promise<void>): Promise<void> {
  let done = false;
  void job.then(() => { done = true; });
  for (let elapsed = 0; !done && elapsed < 6000; elapsed += 16) {
    clock.advance(16);
    clock.pump();
    for (let turn = 0; turn < 40; turn++) await Promise.resolve();
  }
  assert(done, "board job must finish under the virtual clock");
  await job;
}

function inkKinds(board: WhiteboardHandle): string[] {
  const kinds: string[] = [];
  for (const layer of [board.getDrawLayer(), board.getAnimLayer?.()]) {
    if (!layer) continue;
    layer.find((node: Konva.Node) => node.getAttr(BOARD_INK_ATTR) !== undefined)
      .forEach((node) => kinds.push(String(node.getAttr(BOARD_INK_ATTR))));
  }
  return kinds.sort();
}

function count(board: WhiteboardHandle, kind: string): number {
  return inkKinds(board).filter((entry) => entry === kind).length;
}

async function boardWithFigureWorkAndPin(duration: number) {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  await settle(clock, board.drawShape(FIGURE_LINE, 0));
  await settle(clock, board.writeText("v = u + at", 90, 200, 0));
  // A transient review trace and a pinned ring round the same part.
  await settle(clock, board.drawAnnotation("circle", RING, duration, { transient: true }));
  await settle(clock, board.drawAnnotation("circle", RING, duration, { pinned: true }));
  return { board, clock };
}

async function main() {
  for (const duration of [0, 400]) {
    const { board, clock } = await boardWithFigureWorkAndPin(duration);
    assert(count(board, "work") > 0, "the work row must be on the board");
    assert(count(board, "scene") > 0, "the figure line must be on the board");
    assert.equal(count(board, "pin"), 1, `a pinned ring outlives the transient fade (duration ${duration})`);
    // Pump well past any fade: the pin must still stand.
    for (let i = 0; i < 40; i++) { clock.advance(16); clock.pump(); await Promise.resolve(); }
    assert.equal(count(board, "pin"), 1, "a pinned ring is never faded away");
    const pin = board.getDrawLayer()!.find((node: Konva.Node) => node.getAttr(BOARD_INK_ATTR) === "pin")[0];
    assert(pin, "a finished pinned ring is committed to the draw layer");
    assert.equal(pin.opacity(), 1, "a pinned ring is drawn at full opacity");

    const scene = count(board, "scene");
    await settle(clock, board.eraseWorkInk(0));
    assert.equal(count(board, "pin"), 0, "a page turn (eraseWorkInk) takes the pinned ring away");
    assert.equal(count(board, "work"), 0, "a page turn takes the work away");
    assert.equal(count(board, "scene"), scene, "a page turn leaves the figure");
    unmountTestWhiteboard(board);
  }

  {
    const { board } = await boardWithFigureWorkAndPin(0);
    const work = count(board, "work");
    const scene = count(board, "scene");
    board.erasePinnedInk();
    assert.equal(count(board, "pin"), 0, "erasePinnedInk takes the rings");
    assert.equal(count(board, "work"), work, "erasePinnedInk leaves the work");
    assert.equal(count(board, "scene"), scene, "erasePinnedInk leaves the figure");
    unmountTestWhiteboard(board);
  }

  for (const duration of [0, 600]) {
    const { board, clock } = await boardWithFigureWorkAndPin(0);
    const work = count(board, "work");
    await settle(clock, board.eraseSceneInk(duration));
    assert.equal(count(board, "scene"), 0, "eraseSceneInk takes the figure");
    assert.equal(count(board, "pin"), 0, "eraseSceneInk takes the pinned rings");
    assert.equal(count(board, "work"), work, "eraseSceneInk leaves the work");
    unmountTestWhiteboard(board);
  }

  console.log("verify-pinned-ink: pinned rings outlive fades, go on a page turn, and eraseSceneInk keeps the work");
}

runWhiteboardVerifier(main);
