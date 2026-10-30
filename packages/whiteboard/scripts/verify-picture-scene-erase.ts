/**
 * A doubt figure swaps a reference picture out of the zone (DIAGRAM_DOUBT_FIGURES,
 * lane 3): `clearFigureZone` calls `eraseSceneInk` and `erasePinnedInk`, and
 * the whole picture must go while the work column stays.
 *
 * What has to hold, at a swap (0 ms) and at a watched erase:
 *   - after `drawPicture`, `eraseSceneInk` leaves no `htReferencePicture`
 *     group and no `htReferencePicturePart` node anywhere on the stage: card,
 *     line work, picture and a numbered picture's key all go;
 *   - the picture group is figure ink (`htInk` "scene"), never work ink;
 *   - every work row survives, and a figure line drawn beside it goes too;
 *   - a picture drawn back at once after the erase (the resume's return) is
 *     whole again.
 *
 * Run: pnpm exec tsx scripts/verify-picture-scene-erase.ts
 */
import assert from "node:assert/strict";
import Konva from "konva";
import {
  REFERENCE_PICTURE_ZONE,
  fitPicture,
  referencePictureCredit,
  referencePictureLayout,
  type ReferencePictureLegendEntry,
  type ReferencePictureRecord,
} from "@heytutor/drawing";
import type { BoardPicture, WhiteboardHandle } from "../src/Whiteboard";
import { BOARD_INK_ATTR } from "../src/inkKind";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

const PICTURE_ID = "rp_0123456789abcdef01234567";
const PLAN_WIDTH = 400;
const PLAN_HEIGHT = 300;
const OUTLINE_STROKES = [[20, 20, 120, 20, 120, 80], [200, 40, 260, 40]];
const FILL_STROKES = [[36, 0, 36, PLAN_HEIGHT], [102, PLAN_HEIGHT, 102, 0]];
const RECORD: ReferencePictureRecord = {
  id: PICTURE_ID,
  source: "wikimedia",
  title: "File:Synthetic diagram.svg",
  pageUrl: "https://commons.wikimedia.org/wiki/File:Synthetic_diagram.svg",
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  artist: "Test Artist",
  imageUrl: `/api/reference-picture/${PICTURE_ID}/image`,
  planUrl: `/api/reference-picture/${PICTURE_ID}/plan`,
  width: 800,
  height: 600,
  shows: "a synthetic diagram",
  labels: [],
  plan: { width: PLAN_WIDTH, height: PLAN_HEIGHT, outlineLengthPx: 260, fillLengthPx: 600 },
};
const KEY: ReferencePictureLegendEntry[] = ["Right atrium", "Left atrium", "Aorta"].map((label, i) => ({ mark: String(i + 1), label }));
const PLACEMENT = fitPicture(PLAN_WIDTH, PLAN_HEIGHT, REFERENCE_PICTURE_ZONE);
const KEYED_PLACEMENT = referencePictureLayout({ plan: { width: PLAN_WIDTH, height: PLAN_HEIGHT }, legend: KEY })!.picture;

function makePicture(legend?: ReferencePictureLegendEntry[]): BoardPicture {
  return {
    ...(legend ? { legend } : {}),
    id: PICTURE_ID,
    image: Konva.Util.createCanvasElement(),
    inkMask: Konva.Util.createCanvasElement(),
    credit: referencePictureCredit(RECORD),
    plan: {
      width: PLAN_WIDTH,
      height: PLAN_HEIGHT,
      paper: "#fdfcf7",
      outline: { brushPx: 6, strokes: OUTLINE_STROKES, lengthPx: RECORD.plan.outlineLengthPx },
      fill: { brushPx: 72, strokes: FILL_STROKES, lengthPx: RECORD.plan.fillLengthPx },
    },
  };
}

function drive() {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const run = async (job: Promise<void>): Promise<void> => {
    let done = false;
    void job.then(() => { done = true; });
    for (let elapsed = 0; !done && elapsed < 30_000; elapsed += 16) {
      clock.advance(16);
      clock.pump();
      for (let turn = 0; turn < 30; turn++) await Promise.resolve();
    }
    assert.ok(done, "a board job must finish under the virtual clock");
    await job;
  };
  return { board, run };
}

const pictureNodes = (board: WhiteboardHandle) => board.getDrawLayer()!.getStage()!.find(
  (node: Konva.Node) => Boolean(node.getAttr("htReferencePicture") || node.getAttr("htReferencePicturePart")),
);
const pictureGroups = (board: WhiteboardHandle) => board.getDrawLayer()!.getStage()!.find(
  (node: Konva.Node) => Boolean(node.getAttr("htReferencePicture")),
);
function inkCount(board: WhiteboardHandle, kind: string): number {
  let count = 0;
  for (const layer of [board.getDrawLayer(), board.getAnimLayer?.()]) {
    layer?.find((node: Konva.Node) => node.getAttr(BOARD_INK_ATTR) === kind).forEach(() => { count += 1; });
  }
  return count;
}

async function main(): Promise<void> {
  for (const keyed of [false, true]) {
    for (const duration of [0, 600]) {
      const label = `${keyed ? "numbered" : "labelled"} picture, erase over ${duration} ms`;
      const { board, run } = drive();
      const picture = makePicture(keyed ? KEY : undefined);
      const placement = keyed ? KEYED_PLACEMENT : PLACEMENT;
      await run(board.writeText("v = u + at", 90, 200, 0));
      await run(board.writeText("so the cell divides", 90, 260, 0));
      for (const pass of keyed ? ["outline", "fill", "legend"] as const : ["outline", "fill"] as const) {
        await run(board.drawPicture(picture, placement, pass, 0));
      }
      const groups = pictureGroups(board);
      assert.equal(groups.length, 1, `${label}: the picture lays one group`);
      const partCount = pictureNodes(board).length - 1;
      assert.ok(partCount >= (keyed ? 4 : 3), `${label}: card, line work, picture${keyed ? " and key" : ""} are on the board (${partCount})`);
      const work = inkCount(board, "work");
      assert.ok(work > 0, `${label}: the work rows are on the board`);

      await run(board.eraseSceneInk(duration));
      assert.equal(pictureGroups(board).length, 0, `${label}: eraseSceneInk leaves no picture group`);
      assert.equal(pictureNodes(board).length, 0, `${label}: eraseSceneInk leaves no part of the picture`);
      assert.equal(inkCount(board, "scene"), 0, `${label}: no figure ink is left`);
      assert.equal(inkCount(board, "work"), work, `${label}: every work row survives`);
      assert.equal(groups[0]!.getAttr(BOARD_INK_ATTR), "scene", `${label}: the picture group is figure ink, never work ink`);

      // The resume stamps the stored passes back at once: the picture is whole again.
      for (const pass of keyed ? ["outline", "fill", "legend"] as const : ["outline", "fill"] as const) {
        await run(board.drawPicture(picture, placement, pass, 0));
      }
      assert.equal(pictureGroups(board).length, 1, `${label}: the returned picture lays one group`);
      assert.equal(pictureNodes(board).length - 1, partCount, `${label}: the returned picture is whole`);
      assert.equal(inkCount(board, "work"), work, `${label}: the return leaves the work alone`);
      unmountTestWhiteboard(board);
    }
  }
  console.log("verify-picture-scene-erase: eraseSceneInk takes the whole picture and keeps the work");
}

runWhiteboardVerifier(main);
