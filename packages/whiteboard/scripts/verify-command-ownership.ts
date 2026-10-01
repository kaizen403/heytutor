import assert from "node:assert/strict";
import Konva from "konva";
import { textToStrokePaths } from "@heytutor/drawing";
import { mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function main() {
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", onUnhandled);
  const chars = await textToStrokePaths("N", 500, 200, 32);
  for (const transition of ["abort-successor", "abort", "commit-successor", "clear-successor", "rollback", "preintro-root", "preintro-abort", "preintro-commit"] as const) {
    if (process.env.TEST_CASE && process.env.TEST_CASE !== transition) continue;
    for (const outcome of ["resolve", "reject"] as const) {
      const gate = deferred<Awaited<ReturnType<typeof textToStrokePaths>>>();
      const board = mountTestWhiteboard(undefined, () => gate.promise);
      const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source);
      const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
      const advance = async (ms: number) => { for (let i = 0; i < ms; i += 16) { clock.advance(16); clock.pump(); await flush(); } };
      const ink = () => ([...board.getDrawLayer()!.getChildren(), ...board.getAnimLayer()!.getChildren()] as Konva.Node[]).filter((node) => node.getAttr("htInk"));
      const unowned = transition.startsWith("preintro-");
      let root = unowned ? null : board.beginDrawTransaction();
      let sp = root ? board.createDrawSavepoint(root) : null;
      let settled = false;
      // No caller predicate: board ownership alone retires old work.
      const job = board.writeText("N", 500, 200, 0); void job.then(() => { settled = true; }); await flush();
      if (transition === "abort-successor" || transition === "abort") {
        board.abortDrawTransaction(root!); board.finishAbortedDrawTransaction(root!);
        root = transition === "abort-successor" ? board.beginDrawTransaction() : null;
      } else if (transition === "commit-successor") { board.commitDrawTransaction(root!); root = board.beginDrawTransaction(); }
      else if (transition === "clear-successor") { await board.clearBoard(); root = board.beginDrawTransaction(); }
      else if (transition === "rollback") {
        board.cancelDrawSavepoint(root!, sp!); await advance(64); assert(settled, "scoped cancel joins unresolved lookup while paused or running"); await job;
        board.rollbackDrawSavepoint(root!, sp!);
      } else {
        root = board.beginDrawTransaction(); sp = board.createDrawSavepoint(root);
        if (transition === "preintro-abort") { board.abortDrawTransaction(root); root = null; }
        if (transition === "preintro-commit") { board.commitDrawTransaction(root); root = null; }
      }
      board.setPaused(true); await advance(64);
      if (!unowned) assert(settled, `${transition}: root retirement must join an unresolved lookup without shouldCancel`);
      else assert(!settled, `${transition}: unrelated deferred preintro work remains live`);
      if (outcome === "resolve") gate.resolve(chars); else gate.reject(new Error("late glyph lookup failure"));
      board.setPaused(false); await advance(3000); await job;
      if (unowned) {
        assert(ink().length > 0, `${transition}/${outcome}: preintro deferred ink survives`);
        assert(ink().every((node) => node.getAttr("htDrawTransactionId") === undefined), "preintro deferred ink must never be adopted");
        const retained = ink(); if (root) board.abortDrawTransaction(root);
        assert.deepEqual(ink(), retained, "later intro abort cannot delete unrelated work");
      } else {
        assert.equal(ink().length, 0, `${transition}/${outcome}: a deferred label must retain its original root, not create successor ink after retirement`);
        if (root) board.abortDrawTransaction(root);
      }
      unmountTestWhiteboard(board);
    }
    console.log(`${transition}: deferred success/failure ownership passed`);
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(unhandled, [], "late glyph rejection must be consumed after the owned join");
  process.off("unhandledRejection", onUnhandled);
}
runWhiteboardVerifier(main);
