import assert from "node:assert/strict";
import Konva from "konva";
import { textToStrokePaths } from "@heytutor/drawing";
import { mountTestWhiteboard } from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

async function main() {
  for (const kind of ["shape-swap", "highlight-swap", "shape-flight", "shape-hop", "write-cue", "glyph-lookup", "cursor-flight"] as const) {
    if (process.env.TEST_CASE && process.env.TEST_CASE !== kind) continue;
    let reject!: (error: Error) => void;
    const glyphs = new Promise<Awaited<ReturnType<typeof textToStrokePaths>>>((_, no) => { reject = no; });
    const board = mountTestWhiteboard(undefined, kind === "glyph-lookup" ? () => glyphs : textToStrokePaths);
    const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source);
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    const advance = async (ms: number) => { for (let i = 0; i < ms; i += 16) { clock.advance(16); clock.pump(); await flush(); } };
    assert(board.getDrawLayer() instanceof Konva.Layer);
    assert(board.getDrawLayer()!.getStage() instanceof Konva.Stage);
    assert(board.getCursorLayer()!.findOne(".pen-lift"), "mount actual VirtualCursor, not a string placeholder");
    if (kind === "shape-flight" || kind === "shape-hop") {
      const equip = board.setInstrument("pencil"); await advance(600); await equip;
    }
    board.setCursorPos(kind === "shape-hop" ? 480 : 900, kind === "shape-hop" ? 200 : 600);
    const root = board.beginDrawTransaction(); const sp = board.createDrawSavepoint(root);
    let cancelled = false; let settled = false;
    const job = kind === "highlight-swap"
      ? board.drawAnnotation("highlight", "M 500 200 L 600 200 L 600 220 L 500 220 Z", 1000, { shouldCancel: () => cancelled })
      : kind === "write-cue" || kind === "glyph-lookup"
      ? board.writeText("N", 500, 200, 1000, kind === "write-cue" ? { charStartOffsetsMs: [10000], getAudioPositionMs: () => 0 } : undefined, 32, () => cancelled)
      : kind === "cursor-flight"
      ? board.flyCursorTo(500, 200, 1000, undefined, () => cancelled)
      : board.drawShape("M 500 200 L 600 200", 1000, { cued: true, shouldCancel: () => cancelled });
    void job.then(() => { settled = true; });
    await advance(kind === "write-cue" ? 600 : 32);
    board.setPaused(true); cancelled = true;
    await advance(64);
    assert(settled, `${kind}: owned cancellation must settle before Resume or global cancellation`);
    await job;
    board.rollbackDrawSavepoint(root, sp);
    if (kind === "glyph-lookup") { reject(new Error("late lookup rejection after cancellation")); await flush(); }
    const ink = [...board.getDrawLayer()!.getChildren(), ...board.getAnimLayer()!.getChildren()] as Konva.Node[];
    assert.equal(ink.filter((node) => node.getAttr("htInk")).length, 0, `${kind}: cancelled attempt leaves no stale ink`);
    board.abortDrawTransaction(root); board.cancelAnimations(); board.getDrawLayer()!.getStage()!.destroy();
    console.log(`${kind}: paused scoped cancellation passed`);
  }
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", onUnhandled);
  for (const kind of ["swap", "tween", "cue", "glyph-resolve", "glyph-reject", "erase-flight", "erase-work-flight", "clear-flight"] as const) {
    if (process.env.TEST_CASE && process.env.TEST_CASE !== `global-${kind}`) continue;
    for (const owned of [false, true]) {
      let resolve!: (value: Awaited<ReturnType<typeof textToStrokePaths>>) => void;
      let reject!: (error: Error) => void;
      const glyphs = new Promise<Awaited<ReturnType<typeof textToStrokePaths>>>((yes, no) => { resolve = yes; reject = no; });
      const board = mountTestWhiteboard(undefined, kind.startsWith("glyph-") ? () => glyphs : textToStrokePaths);
      const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source);
      const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
      const advance = async (ms: number) => { for (let i = 0; i < ms; i += 16) { clock.advance(16); clock.pump(); await flush(); } };
      const ink = () => board.getDrawLayer()!.getStage()!.getLayers().filter((layer) => layer !== board.getCursorLayer())
        .flatMap((layer) => layer.getChildren()).filter((node: Konva.Node) => node.getAttr("htInk"));
      if (kind === "tween") { const equip = board.setInstrument("pencil"); await advance(600); await equip; board.setCursorPos(500, 200); }
      if (kind.includes("flight")) { await board.drawShape("M 500 200 L 600 200", 0); board.setCursorPos(900, 600); }
      const root = owned ? board.beginDrawTransaction() : null;
      if (root) board.createDrawSavepoint(root);
      let settled = false;
      // Deliberately no outer shouldCancel: cancelAnimations is itself sufficient.
      const job = kind === "cue" ? board.writeText("N", 500, 200, 1000, { charStartOffsetsMs: [10000], getAudioPositionMs: () => 0 }, 32)
        : kind.startsWith("glyph-") ? board.writeText("N", 500, 200, 0)
        : kind === "erase-flight" ? board.eraseRegion(500, 190, 100, 30, 1000)
        : kind === "erase-work-flight" ? board.eraseWorkInk(1000)
        : kind === "clear-flight" ? board.clearBoard(1000)
        : board.drawShape("M 500 200 L 600 200", 1000, { cued: true });
      void job.then(() => { settled = true; });
      await advance(kind === "cue" ? 600 : 32);
      const before = ink().map((node: Konva.Node) => ({ node, dash: node.getAttr("dashOffset") }));
      if (kind === "tween") assert(before.some(({ dash }) => typeof dash === "number" && dash > 0 && dash < 100), "cancel during a real partial stroke");
      board.setPaused(true); board.cancelAnimations(); await flush(); await advance(64);
      assert(settled, `${kind}/${owned ? "owned" : "unowned"}: global cancellation must join without Resume`);
      await job;
      assert.equal(clock.pendingCount(), 0, `${kind}: a cancelled continuation must not create another frame`);
      assert(ink().every((node: Konva.Node) => before.some((entry) => entry.node === node)), `${kind}: no post-cancel ink`);
      for (const entry of before) assert.equal(entry.node.getAttr("dashOffset"), entry.dash, `${kind}: no forced completion`);
      if (kind === "glyph-reject") reject(new Error("late globally cancelled glyph failure"));
      else if (kind === "glyph-resolve") resolve(await textToStrokePaths("N", 500, 200, 32));
      await flush(); await new Promise<void>((done) => setImmediate(done));
      assert(ink().every((node: Konva.Node) => before.some((entry) => entry.node === node)), `${kind}: late glyph result cannot create fallback ink`);
      if (root && !kind.startsWith("clear-")) { board.abortDrawTransaction(root); board.finishAbortedDrawTransaction(root); }
      board.cancelAnimations(); board.getDrawLayer()!.getStage()!.destroy();
    }
    console.log(`global-${kind}: owned/unowned no-predicate cancellation joined with no new ink, frames or forced completion`);
  }
  await new Promise<void>((done) => setImmediate(done));
  assert.deepEqual(unhandled, [], "late global cancellation rejections are observed");
  process.off("unhandledRejection", onUnhandled);
  if (!process.env.TEST_CASE || process.env.TEST_CASE === "scoped-sibling") {
    const board = mountTestWhiteboard();
    const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source);
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    const advance = async (ms: number) => { for (let i = 0; i < ms; i += 16) { clock.advance(16); clock.pump(); await flush(); } };
    const equip = board.setInstrument("pencil"); await advance(600); await equip;
    board.setCursorPos(500, 200);
    let siblingSettled = false;
    const sibling = board.drawShape("M 500 200 L 600 200", 4000, { cued: true });
    void sibling.then(() => { siblingSettled = true; }); await advance(64);
    const siblingNode = board.getAnimLayer()!.getChildren().find((node) => node.getAttr("htInk"))!;
    const root = board.beginDrawTransaction(); const sp = board.createDrawSavepoint(root);
    let ownerSettled = false;
    const owner = board.drawShape("M 800 500 L 900 500", 1000, { cued: true });
    void owner.then(() => { ownerSettled = true; }); await advance(32);
    board.setPaused(true); const dash = siblingNode.getAttr("dashOffset");
    board.cancelDrawSavepoint(root, sp); await advance(64);
    assert(ownerSettled, "explicit savepoint cancellation joins its initial flight with no caller predicate");
    assert(!siblingSettled, "scoped cancellation never resolves an unrelated paused sibling");
    assert.equal(siblingNode.getAttr("dashOffset"), dash, "scoped cancellation must not force sibling ink complete");
    await owner; board.rollbackDrawSavepoint(root, sp); board.abortDrawTransaction(root);
    board.setPaused(false); await advance(5000); await sibling;
    assert.equal(siblingNode.getParent(), board.getDrawLayer());
    assert.equal(siblingNode.getAttr("htDrawTransactionId"), undefined, "late unowned sibling completion stays unowned");
    board.cancelAnimations(); board.getDrawLayer()!.getStage()!.destroy();
    console.log("scoped-sibling: only the owned attempt joins; unrelated ink resumes normally");
  }
}
runWhiteboardVerifier(main);
