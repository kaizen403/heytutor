/**
 * A doubt's fresh page (DIAGRAM_DOUBT_FIGURES, lane 9): the lesson's page is
 * lifted off the board whole and put back whole when the lesson resumes.
 *
 * What has to hold:
 *   - `holdPage` leaves the board blank and holds every stroke: work rows, a
 *     figure line, a highlight and a kept ring;
 *   - the doubt page drawn meanwhile is erased by `returnHeldPage`, and the
 *     lesson page comes back node for node, in the order it stood, with its
 *     meta;
 *   - a second hold while a page is held blanks the board and keeps the
 *     first page (one level: the lesson's page);
 *   - `clearBoard` drops a held page, so a new question never gets it back;
 *   - held ink leaves its draw transaction: a rollback or an abort after the
 *     hold (a doubt beat cut short) destroys none of it, and it comes back
 *     whole;
 *   - returned ink is tracked again: a page turn erase takes the work rows;
 *   - `captureHeldPageSnapshot` (lane 10, Download notes on the doubt page)
 *     snapshots the held page exactly as `returnHeldPage` puts it back, and
 *     leaves the doubt page and the hold untouched.
 *
 * Mutations (lane 10): the capture snapshots the shown page; the capture
 * leaves the held page on the board; the capture drops the shown page.
 * Mutation: `holdPage` keeps held ink in its transaction (no `detach`).
 *
 * Run: pnpm exec tsx scripts/verify-held-page.ts
 */
import assert from "node:assert/strict";
import type Konva from "konva";
import type { WhiteboardHandle } from "../src/Whiteboard";
import { BOARD_INK_ATTR } from "../src/inkKind";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

const FIGURE_LINE = "M 600 200 L 900 200";
const RING = "M 700 300 m -30 0 a 30 30 0 1 0 60 0 a 30 30 0 1 0 -60 0";
const BOX = "M 80 180 L 380 180 L 380 230 L 80 230 Z";

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

/** Every ink node on the board's layers, in stage order, as JSON. */
function pageShape(board: WhiteboardHandle): string[] {
  const stage = board.getDrawLayer()!.getStage()!;
  const cursor = board.getCursorLayer();
  const shape: string[] = [];
  for (const layer of stage.getLayers()) {
    if (layer === cursor) continue;
    for (const node of layer.getChildren()) {
      if (node.getAttr(BOARD_INK_ATTR) === undefined && node.className === "Rect") continue;
      shape.push(`${layer.index}:${node.toJSON()}`);
    }
  }
  return shape;
}

function inkCount(board: WhiteboardHandle): number {
  let count = 0;
  for (const layer of [board.getDrawLayer(), board.getAnimLayer()]) {
    layer?.find((node: Konva.Node) => node.getAttr(BOARD_INK_ATTR) !== undefined).forEach(() => { count += 1; });
  }
  return count;
}

let checks = 0;
function check(condition: boolean, message: string): void {
  assert.ok(condition, message);
  checks += 1;
}

async function drawLessonPage(board: WhiteboardHandle, run: (job: Promise<void>) => Promise<void>): Promise<void> {
  await run(board.writeText("v = u + at", 90, 140, 0));
  await run(board.writeText("so the body speeds up and the line runs on past the zone edge", 90, 200, 0));
  await run(board.drawShape(FIGURE_LINE, 0));
  await run(board.drawAnnotation("highlight", BOX, 0));
  await run(board.drawAnnotation("circle", RING, 0, { pinned: true }));
}

async function main(): Promise<void> {
  {
    const { board, run } = drive();
    await drawLessonPage(board, run);
    const lesson = pageShape(board);
    const lessonInk = inkCount(board);
    check(lessonInk >= 5, `the lesson page has its ink (${lessonInk} nodes)`);
    check(!board.hasHeldPage(), "no page is held before a hold");

    board.holdPage({ layout: "lesson" });
    check(board.hasHeldPage(), "hold: a page is held");
    check(inkCount(board) === 0, "hold: the board is blank");
    check(board.pinnedInkCount() === 0, "hold: no kept ring stays on the fresh page");

    // The doubt page.
    await run(board.writeText("why does it speed up?", 90, 140, 0));
    await run(board.drawShape("M 650 400 L 950 400", 0));
    check(inkCount(board) > 0, "the doubt page draws on the blank board");

    // The harness canvas encodes nothing: the snapshot is the stage's node list at the moment of capture.
    const stage = board.getDrawLayer()!.getStage()!;
    stage.toDataURL = (() => JSON.stringify(pageShape(board))) as typeof stage.toDataURL;
    const doubtShape = JSON.stringify(pageShape(board));
    const doubtInk = inkCount(board);
    const shot = board.captureHeldPageSnapshot();
    check(shot !== null && shot.snapshotDataUrl === JSON.stringify(lesson),
      "capture held: the snapshot is the lesson page as it will come back, not the doubt page");
    check(shot !== null && (shot.meta as { layout: string }).layout === "lesson", "capture held: the held page's meta rides with it");
    check(JSON.stringify(pageShape(board)) === doubtShape && inkCount(board) === doubtInk && board.hasHeldPage(),
      "capture held: the doubt page stays on the board and the lesson page stays held");

    const back = board.returnHeldPage();
    check(back !== null && (back.meta as { layout: string }).layout === "lesson", "return: the held page's meta comes back");
    check(!board.hasHeldPage(), "return: nothing is held after");
    const returned = pageShape(board);
    check(JSON.stringify(returned) === JSON.stringify(lesson), "return: the lesson page is back node for node, in order, and the doubt page is gone");
    check(inkCount(board) === lessonInk, "return: the same ink count as before the hold");
    check(board.pinnedInkCount() === 1, "return: the lesson's kept ring is back");
    check(board.returnHeldPage() === null, "a second return has nothing to return");
    check(board.captureHeldPageSnapshot() === null, "capture held: nothing held, no snapshot");

    // Returned ink is tracked again: a work page turn takes the rows.
    await run(board.eraseWorkInk(0));
    const work = board.getDrawLayer()!.find((node: Konva.Node) => node.getAttr(BOARD_INK_ATTR) === "work").length +
      board.getAnimLayer()!.find((node: Konva.Node) => node.getAttr(BOARD_INK_ATTR) === "work").length;
    check(work === 0, "returned work rows are tracked: eraseWorkInk takes them");
    unmountTestWhiteboard(board);
  }

  {
    const { board, run } = drive();
    await drawLessonPage(board, run);
    const lesson = pageShape(board);
    board.holdPage({ layout: "lesson" });
    await run(board.writeText("first doubt page", 90, 140, 0));
    board.holdPage({ layout: "doubt" });
    check(inkCount(board) === 0, "second hold: the board is blank again");
    await run(board.writeText("second doubt page", 90, 140, 0));
    const back = board.returnHeldPage();
    check(back !== null && (back.meta as { layout: string }).layout === "lesson", "second hold: the first page's meta is kept");
    check(JSON.stringify(pageShape(board)) === JSON.stringify(lesson), "second hold: the lesson page comes back, not the first doubt page");
    unmountTestWhiteboard(board);
  }

  {
    const { board, run } = drive();
    await drawLessonPage(board, run);
    board.holdPage({ layout: "lesson" });
    await run(board.clearBoard());
    check(!board.hasHeldPage(), "clearBoard drops the held page");
    check(board.returnHeldPage() === null && inkCount(board) === 0, "after clearBoard nothing comes back");
    unmountTestWhiteboard(board);
  }

  {
    // The lesson page is drawn inside an open transaction, then held. A
    // rollback and an abort of that transaction after the hold must reach
    // only what was drawn after it.
    const { board, run } = drive();
    const transaction = board.beginDrawTransaction();
    const origin = board.createDrawSavepoint(transaction);
    await drawLessonPage(board, run);
    const lesson = pageShape(board);
    const lessonInk = inkCount(board);
    const lessonNodes: Konva.Node[] = [];
    for (const layer of [board.getDrawLayer(), board.getAnimLayer()]) {
      layer?.find((node: Konva.Node) => node.getAttr(BOARD_INK_ATTR) !== undefined).forEach((node) => { lessonNodes.push(node); });
    }
    const destroyed = new Set<Konva.Node>();
    for (const node of lessonNodes) {
      const destroy = node.destroy.bind(node);
      node.destroy = (() => { destroyed.add(node); return destroy(); }) as typeof node.destroy;
    }
    check(lessonNodes.length >= 5, `transaction: the lesson page has its ink (${lessonNodes.length} nodes)`);

    board.holdPage({ layout: "lesson" });
    board.rollbackDrawSavepoint(transaction, origin);
    check(destroyed.size === 0, `rollback after hold: no held stroke is destroyed (${destroyed.size})`);

    const doubtPoint = board.createDrawSavepoint(transaction);
    await run(board.writeText("why does it speed up?", 90, 140, 0));
    board.rollbackDrawSavepoint(transaction, doubtPoint);
    check(inkCount(board) === 0, "rollback after hold: the doubt beat's own ink goes");
    await run(board.writeText("why does it speed up?", 90, 140, 0));
    board.abortDrawTransaction(transaction);
    board.finishAbortedDrawTransaction(transaction);
    check(destroyed.size === 0, `abort after hold: no held stroke is destroyed (${destroyed.size})`);
    check(inkCount(board) === 0, "abort after hold: the doubt page's ink goes");

    const back = board.returnHeldPage();
    check(back !== null, "transaction: the held page comes back");
    check(JSON.stringify(pageShape(board)) === JSON.stringify(lesson) && inkCount(board) === lessonInk,
      "transaction: the lesson page is back node for node after the rollback and the abort");
    unmountTestWhiteboard(board);
  }

  console.log(`verify-held-page: ${checks} checks passed`);
}

runWhiteboardVerifier(main);
