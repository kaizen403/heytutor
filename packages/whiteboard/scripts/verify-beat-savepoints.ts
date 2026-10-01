import assert from "node:assert/strict";
import Konva from "konva";
import { textToStrokePaths } from "@heytutor/drawing";
import { mountTestWhiteboard } from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";
import { runScheduledFocus } from "../../../apps/tutor/features/tutor-session/lib/board/scheduledFocus";

async function main() {
  // Canvas paint/font measurement are not under test; node ownership/tweens are.
  const makeCanvas = Konva.Util.createCanvasElement;
  Konva.Util.createCanvasElement = () => ({ getContext: () => ({
    measureText: (text: string) => ({ width: text.length * 16 }),
  }) }) as unknown as HTMLCanvasElement;
  const board = mountTestWhiteboard(undefined, async (...args) => {
    if (args[0] === "fallback-label") throw new Error("offline glyph lookup failure");
    return textToStrokePaths(...args);
  });
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const advance = async (ms: number) => {
    for (let i = 0; i < ms; i += 16) { clock.advance(16); clock.pump(); await flush(); }
  };
  const staticAnimNodes = [...board.getAnimLayer()!.getChildren()];
  const paths = () => board.getDrawLayer()!.getStage()!.getLayers()
    .filter((layer) => layer !== board.getCursorLayer())
    .flatMap((layer) => layer.getChildren())
    .filter((node) => node.getAttr("htInk"));
  const finish = async (job: Promise<void>) => { await advance(2_000); await job; };
  await finish(board.drawShape("M 500 200 L 580 200", 0));
  const work = paths()[0]!;
  const transaction = board.beginDrawTransaction();
  await finish(board.drawShape("M 500 210 L 580 210", 100));
  const prior = paths().find((node) => node !== work)!;
  const origin = board.createDrawSavepoint(transaction);
  await finish(board.drawShape("M 500 220 L 580 220", 100));
  const partial = paths().find((node) => node !== work && node !== prior)!;
  board.rollbackDrawSavepoint(transaction, origin);
  assert.deepEqual(paths(), [work, prior], "real adapter removes only nodes after the beat savepoint");
  assert.equal(partial.getParent(), null);
  board.abortDrawTransaction(transaction);
  board.finishAbortedDrawTransaction(transaction);
  assert.deepEqual(paths(), [work], "whole-intro abort still removes earlier intro beats");

  for (const kind of ["solid", "dashed", "annotation", "highlight", "label", "fallback-label"] as const) {
    // These are after-tween controls; separate tests cancel during the swap/flight.
    await finish(board.setInstrument(kind === "label" || kind === "fallback-label" ? "pen" : kind === "highlight" ? "highlighter" : "pencil"));
    const id = board.beginDrawTransaction();
    const checkpoint = board.createDrawSavepoint(id);
    board.setCursorPos(500, 230);
    let cancelled = false;
    let settled = false;
    const job = kind === "label" || kind === "fallback-label"
      ? board.writeText(kind === "label" ? "N" : "fallback-label", 500, 230, 1_000, undefined, 32, () => cancelled)
      : kind === "annotation" || kind === "highlight"
      ? board.drawAnnotation(kind === "highlight" ? "highlight" : "underline", kind === "highlight" ? "M 500 230 L 580 230 L 580 250 L 500 250 Z" : "M 500 230 L 580 230", 1_000, { shouldCancel: () => cancelled })
      : board.drawShape("M 500 230 L 580 230", 1_000, { pace: "scene", cued: true,
        dashed: kind === "dashed", shouldCancel: () => cancelled });
    void job.then(() => { settled = true; });
    await advance(160);
    const active = paths().find((node) => node !== work)!;
    assert(active, `${kind}: real animation must have created an owned node before Pause`);
    const dash = active.getAttr("dashOffset");
    const opacity = active.getAttr("opacity");
    board.setPaused(true); cancelled = true;
    await advance(64);
    assert(settled, `${kind}: cancelled animation must join while paused, not keep painting or wait for Resume`);
    await job;
    board.rollbackDrawSavepoint(id, checkpoint);
    await advance(160);
    assert.deepEqual(paths(), [work], `${kind}: no stale completion can add nodes after rollback`);
    assert.equal(active.getAttr("dashOffset"), dash, `${kind}: no stale stroke advance`);
    assert.equal(active.getAttr("opacity"), opacity, `${kind}: no stale fade advance`);
    board.abortDrawTransaction(id); board.finishAbortedDrawTransaction(id); board.setPaused(false);
  }
  // FOCUS uses the real annotation adapter with its own asynchronous loop.
  const focusId = board.beginDrawTransaction();
  const focusOrigin = board.createDrawSavepoint(focusId);
  let focusCancelled = false;
  let focusSettled = false;
  board.setCursorPos(500, 230);
  const focus = runScheduledFocus({
    setSpotlight: board.setSpotlight, flyCursorTo: board.flyCursorTo,
    drawAnnotation: (kind, path, duration, options) => board.drawAnnotation(kind, path, duration,
      { ...options, shouldCancel: () => focusCancelled }),
  }, [{ id: "verified-path", startMs: 0, endMs: 1_000,
    rects: [{ x: 500, y: 230, width: 80, height: 1 }],
    paths: [{ path: "M 500 230 L 580 230", x: 500, y: 230 }], pulse: null,
    letter: async () => ({ cancelled: false, penAt: null }),
  }], { emphasis: "trace", veil: null, getAudioPositionMs: () => clock.now(),
    waitUntilAudioMs: async () => {}, isCancelled: () => focusCancelled, floorMs: 1_000 });
  void focus.then(() => { focusSettled = true; });
  await advance(160);
  assert(paths().length > 1, "the scheduled FOCUS must create actual trace ink");
  board.setPaused(true); focusCancelled = true;
  await advance(64);
  assert(focusSettled, "the owned FOCUS must join its cancelled paused trace before rollback");
  await focus;
  board.rollbackDrawSavepoint(focusId, focusOrigin);
  await advance(160);
  assert.deepEqual(paths(), [work], "FOCUS cannot add stale nodes after its savepoint rollback");
  board.abortDrawTransaction(focusId); board.finishAbortedDrawTransaction(focusId);
  assert.deepEqual(board.getAnimLayer()!.getChildren(), staticAnimNodes, "permanent hidden-path scaffold retains its identity");
  board.cancelAnimations();
  board.getDrawLayer()!.getStage()!.destroy();
  Konva.Util.createCanvasElement = makeCanvas;
  console.log("whiteboard beat savepoints: real node tracking, rollback, paused cancellation and stale completion verified");
}
runWhiteboardVerifier(main);
