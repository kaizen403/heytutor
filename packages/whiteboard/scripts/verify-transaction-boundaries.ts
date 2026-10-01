import assert from "node:assert/strict";
import Konva from "konva";
import { textToStrokePaths } from "@heytutor/drawing";
import type { WhiteboardHandle } from "../src/Whiteboard";
import { getTestWhiteboardRefs, mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

async function main() {
  const board = mountTestWhiteboard(process.env.WHITEBOARD_TEST_SOURCE);
  const clock = createVirtualWhiteboardClock(); board.setTimeSource(clock.source);
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const advance = async (ms: number) => { for (let i = 0; i < ms; i += 16) { clock.advance(16); clock.pump(); await flush(); } };
  const finish = async (job: Promise<void>) => { await advance(3000); await job; };
  const stage = board.getDrawLayer()!.getStage()!;
  const ink = () => stage.getLayers().filter((layer) => layer !== board.getCursorLayer()).flatMap((layer) => layer.getChildren()).filter((node) => node.getAttr("htInk"));
  const dims = () => stage.getLayers().flatMap((layer) => layer.getChildren()).filter((node) => node instanceof Konva.Rect && node.fill() === "#1A1A1A");
  const spotlight = { veil: { x: 400, y: 100, width: 600, height: 500 }, hole: { x: 500, y: 200, width: 100, height: 100 } };
  const which = process.env.TEST_CASE;
  if (!which || which === "gaps") {
    await finish(board.drawShape("M 450 200 L 650 200", 0)); const pre = ink()[0]!;
    const root = board.beginDrawTransaction(); await finish(board.drawShape("M 450 220 L 650 220", 0)); const prior = ink()[1]!;
    const sp = board.createDrawSavepoint(root);
    assert.throws(() => board.punchDiagramLineGapsInRect({ x: 520, y: 190, width: 30, height: 40 }, 0), /savepoint/, "creation-only savepoints must reject destructive line splitting before mutation");
    assert.deepEqual(ink(), [pre, prior]); board.rollbackDrawSavepoint(root, sp); assert.deepEqual(ink(), [pre, prior]);
    board.commitDrawTransaction(root);
    board.punchDiagramLineGapsInRect({ x: 520, y: 190, width: 30, height: 40 }, 0);
    assert.equal(ink().length, 4, "legacy line splitting remains supported outside savepoints");
    await board.clearBoard(); console.log("gaps: rejected before mutation; legacy split preserved");
  }
  if (!which || which === "spotlight") {
    const root = board.beginDrawTransaction(); const sp = board.createDrawSavepoint(root);
    const oldCleanup = board.setSpotlight(spotlight); assert.equal(dims().length, 4);
    board.rollbackDrawSavepoint(root, sp); assert.equal(dims().length, 0, "rollback owns every spotlight band");
    const newCleanup = board.setSpotlight(spotlight); assert.equal(dims().length, 4);
    oldCleanup(); assert.equal(dims().length, 4, "stale FOCUS cleanup cannot clear its successor spotlight");
    newCleanup(); assert.equal(dims().length, 0);
    board.setSpotlight(spotlight); board.abortDrawTransaction(root); assert.equal(dims().length, 0);
    console.log("spotlight: rollback/abort and identity-scoped cleanup passed");
  }
  if (!which || which === "cross-board") {
    const other = mountTestWhiteboard(process.env.WHITEBOARD_TEST_SOURCE);
    const a = board.beginDrawTransaction(), z = other.beginDrawTransaction();
    const sa = board.createDrawSavepoint(a), sz = other.createDrawSavepoint(z);
    assert.notEqual(a, z); assert.notEqual(sa, sz);
    await finish(board.drawShape("M 450 200 L 650 200", 0));
    assert.throws(() => board.rollbackDrawSavepoint(z, sz), /inactive/);
    assert.throws(() => board.rollbackDrawSavepoint(a, sz), /inactive/);
    assert.equal(ink().length, 1);
    board.abortDrawTransaction(a); other.abortDrawTransaction(z); other.cancelAnimations(); other.getDrawLayer()!.getStage()!.destroy();
    console.log("cross-board: foreign roots and foreign savepoints rejected");
  }
  if (!which || which === "keep-visible") {
    for (const kind of ["solid", "dashed", "annotation", "highlight", "glyph", "fallback"] as const) {
      const b = mountTestWhiteboard(process.env.WHITEBOARD_TEST_SOURCE, kind === "fallback" ? async () => { throw new Error("offline glyph failure"); } : textToStrokePaths);
      b.setTimeSource(clock.source);
      await finish(b.setInstrument(kind === "highlight" ? "highlighter" : kind === "glyph" || kind === "fallback" ? "pen" : "pencil"));
      b.setCursorPos(500, 200);
      const root = b.beginDrawTransaction(); b.createDrawSavepoint(root);
      const job = kind === "highlight" || kind === "annotation" ? b.drawAnnotation(kind === "highlight" ? "highlight" : "underline", "M 500 200 L 600 200 L 600 220 L 500 220 Z", 1000)
        : kind === "glyph" || kind === "fallback" ? b.writeText("N", 500, 200, 1000, undefined, 32)
        : b.drawShape("M 500 200 L 600 200", 1000, { cued: true, dashed: kind === "dashed" });
      await advance(160);
      const visible = b.getDrawLayer()!.getStage()!.getLayers().filter((layer) => layer !== b.getCursorLayer()).flatMap((layer) => layer.getChildren()).filter((node) => node.getAttr("htInk"));
      assert(visible.length > 0, `${kind}: partial ink must exist before release`);
      const partial = visible.map((node: Konva.Node) => ({ node, attrs: structuredClone(node.getAttrs()) }));
      b.cancelAnimations(); b.commitDrawTransaction(root); await advance(64); await job;
      assert(visible.every((node) => node.getParent()), `${kind}: late cancelled cleanup must preserve released partial ink`);
      for (const { node, attrs } of partial) {
        delete attrs.htDrawTransactionId; delete attrs.htDrawTransactionGeneration;
        assert.deepEqual(node.getAttrs(), attrs, `${kind}: global cancel plus commit preserves the exact partial stroke/fade/clip, not a forced completion`);
      }
      assert.equal(clock.pendingCount(), 0, `${kind}: released command must not schedule another frame`);
      const dimsCleanup = b.setSpotlight(spotlight); const next = b.beginDrawTransaction(); b.abortDrawTransaction(next); dimsCleanup();
      b.cancelAnimations(); b.getDrawLayer()!.getStage()!.destroy();
    }
    console.log("keep-visible: six partial-ink cleanup paths preserved");
  }
  if (!which || which === "retention") {
    type RetainedTransaction = { nodes: Set<Konva.Node>; savepoint: { nodes: Set<Konva.Node> } | null };
    const registryOf = (host: WhiteboardHandle) => {
      const registry = getTestWhiteboardRefs(host).map((ref) => ref.current).find((value) => {
        if (!value || typeof value !== "object") return false;
        const candidate = value as { transactions?: unknown; capture?: unknown };
        return candidate.transactions instanceof Map && typeof candidate.capture === "function";
      }) as { transactions: Map<string, RetainedTransaction>; capture: () => unknown } | undefined;
      assert(registry, "draw transaction registry is reachable only through the harness ref seam");
      return registry;
    };
    const veil = { x: 400, y: 100, width: 600, height: 500 };
    const hole = { x: 500, y: 200, width: 100, height: 100 };
    const light = { veil, hole };
    const b = mountTestWhiteboard(process.env.WHITEBOARD_TEST_SOURCE);
    b.setTimeSource(clock.source);
    await finish(b.setInstrument("pencil"));
    b.setCursorPos(500, 200);
    const root = b.beginDrawTransaction();
    const job = b.drawShape("M 500 170 L 600 170", 240, { cued: true });
    await advance(80);
    const moving = b.getAnimLayer()!.getChildren().find((node) => node.getAttr("htInk"));
    assert(moving, "animated stroke exists before it completes");
    const generation = moving.getAttr("htDrawTransactionGeneration");
    await finish(job);
    assert.equal(moving.getParent(), b.getDrawLayer(), "completing a stroke keeps the same node");
    assert.equal(moving.getAttr("htDrawTransactionGeneration"), generation, "moving anim ink onto the draw layer must keep its generation");
    const registry = registryOf(b);
    const retainedOwnership = registry.capture();
    const tx = registry.transactions.get(root);
    assert(tx?.nodes.has(moving), "the completed stroke stays in the live transaction");
    const parked = b.setSpotlight(light);
    b.createDrawSavepoint(root);
    const parkedBands = [...(tx.savepoint?.nodes ?? [])].filter((node) => node instanceof Konva.Rect && node.fill() === "#1A1A1A");
    assert.equal(parkedBands.length, 4, "spotlight bands are checkpointed with the beat");
    parked();
    assert(parkedBands.every((node) => !tx.nodes.has(node) && !tx.savepoint!.nodes.has(node)), "disposing a checkpointed spotlight removes it from both node sets");
    for (let i = 0; i < 20; i++) {
      const release = b.setSpotlight(light);
      release();
      await finish(b.drawAnnotation("underline", "M 500 200 L 600 200", 10, { transient: true }));
    }
    assert.equal([...tx.nodes].filter((node) => node.getParent() === null).length, 0, "destroyed nodes do not stay in the transaction");
    assert.equal(tx.nodes.size, 1, "twenty spotlight and transient cycles retain only the completed stroke");
    assert.equal(moving.getParent(), b.getDrawLayer());
    b.createDrawSavepoint(root);
    assert.equal(tx.savepoint?.nodes.size, 1, "the next checkpoint snapshots only live completed ink");
    assert(tx.savepoint?.nodes.has(moving));
    b.commitDrawTransaction(root);
    assert.equal(tx.nodes.size, 0, "commit clears nodes still reachable from a live ownership reference");
    assert.equal(tx.savepoint?.nodes.size, 0, "commit clears the checkpoint still reachable from a live ownership reference");
    assert.equal(moving.getParent(), b.getDrawLayer(), "commit keeps the completed stroke");
    void retainedOwnership;
    unmountTestWhiteboard(b);

    for (const terminal of ["abort", "clear"] as const) {
      const host = mountTestWhiteboard(process.env.WHITEBOARD_TEST_SOURCE);
      host.setTimeSource(clock.source);
      await finish(host.drawShape("M 450 240 L 650 240", 0));
      const terminalRoot = host.beginDrawTransaction();
      await finish(host.drawShape("M 450 260 L 650 260", 0));
      host.createDrawSavepoint(terminalRoot);
      const terminalRegistry = registryOf(host);
      const terminalOwnership = terminalRegistry.capture();
      const terminalTx = terminalRegistry.transactions.get(terminalRoot);
      assert(terminalTx && terminalTx.nodes.size > 0 && (terminalTx.savepoint?.nodes.size ?? 0) > 0, `${terminal}: checkpoint retains completed ink before teardown`);
      if (terminal === "abort") {
        host.abortDrawTransaction(terminalRoot);
        host.finishAbortedDrawTransaction(terminalRoot);
      } else {
        await host.clearBoard();
      }
      assert.equal(terminalTx.nodes.size, 0, `${terminal} clears nodes still reachable from a live ownership reference`);
      assert.equal(terminalTx.savepoint?.nodes.size, 0, `${terminal} clears the checkpoint still reachable from a live ownership reference`);
      void terminalOwnership;
      unmountTestWhiteboard(host);
    }
    console.log("retention: disposed nodes leave both sets; completed ink stays; terminal snapshots are cleared");
  }
  board.cancelAnimations(); stage.destroy();
}
runWhiteboardVerifier(main);
