import assert from "node:assert/strict";
import type { WhiteboardHandle } from "../src/Whiteboard";
import { getTestWhiteboardRefs, mountTestWhiteboard, unmountTestWhiteboard } from "./whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../src/whiteboardClock";
import { runWhiteboardVerifier } from "./runWhiteboardVerifier";

const SPOTLIGHT = {
  veil: { x: 400, y: 100, width: 700, height: 500 },
  hole: { x: 600, y: 200, width: 100, height: 100 },
};
const SUCCESSOR_PACE = 0.42;

function veils(board: WhiteboardHandle) {
  return board.getDrawLayer()!.getStage()!.getLayers().flatMap((layer) => layer.getChildren())
    .filter((node) => node.getAttr("fill") === "#1A1A1A");
}

function ink(board: WhiteboardHandle) {
  return board.getDrawLayer()!.getStage()!.getLayers()
    .filter((layer) => layer !== board.getCursorLayer())
    .flatMap((layer) => layer.getChildren())
    .filter((node) => node.getAttr("htInk"));
}

/** The damper ref sits between animation speed and the cursor view. */
function paceRef(board: WhiteboardHandle): { current: number | null } {
  const refs = getTestWhiteboardRefs(board);
  const speedIndex = refs.findIndex((ref, index) => {
    const view = refs[index + 2]?.current;
    return ref.current === 1
      && refs[index + 1]?.current === null
      && !!view && typeof view === "object"
      && "spinVelocity" in view;
  });
  assert(speedIndex >= 0, "pace ref is reachable through the harness ref seam");
  return refs[speedIndex + 1] as { current: number | null };
}

function cursorRef(board: WhiteboardHandle, state: string): { current: unknown } {
  const refs = getTestWhiteboardRefs(board).filter((ref) => ref.current === state);
  assert.equal(refs.length, 1, `test seam identifies the actual activeCursorStateRef (${state})`);
  return refs[0]!;
}

function mount() {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  const advance = async (ms: number) => {
    for (let i = 0; i < ms; i += 16) { clock.advance(16); clock.pump(); await flush(); }
  };
  return { board, clock, flush, advance };
}

async function successorCase(kind: string): Promise<void> {
  const { board, clock, flush, advance } = mount();
  try {
    board.setCursorPos(900, 600);
    board.setCursorState("drawing");
    let settled = false;
    const oldJob = kind.startsWith("erase-region")
      ? board.eraseRegion(500, 200, 100, 100, 1000)
      : kind.startsWith("erase-work")
        ? board.eraseWorkInk(1000)
        : board.clearBoard(1000);
    void oldJob.then(() => { settled = true; });
    await advance(kind.endsWith("sweep") ? 420 : 32);
    const stateRef = cursorRef(board, "erasing");
    const pace = paceRef(board);
    // Cancel, then install the successor before the old continuation runs.
    board.setPaused(true);
    board.cancelAnimations();
    const releaseSuccessor = board.setSpotlight(SPOTLIGHT);
    board.setCursorState("speaking");
    pace.current = SUCCESSOR_PACE;
    const successorNodes = veils(board);
    assert.equal(successorNodes.length, 4, `${kind}: successor focus installs four veil bands`);
    await flush();
    await advance(64);
    await oldJob;
    assert(settled, `${kind}: cancelled old command joins while paused`);
    assert.deepEqual(veils(board), successorNodes, `${kind}: cancelled destructive command must not delete successor veil`);
    assert.equal(stateRef.current, "speaking", `${kind}: cancelled destructive command must not restore stale cursor state over successor`);
    assert.equal(pace.current, SUCCESSOR_PACE, `${kind}: cancelled destructive command must not reset successor pace`);
    assert.equal(clock.pendingCount(), 0, `${kind}: cancelled continuation must not leave an orphan frame`);
    await advance(48);
    assert.equal(clock.pendingCount(), 0, `${kind}: a paused successor must not keep a rescheduled frame`);
    releaseSuccessor();
    board.setPaused(false);
    board.setSpotlight(SPOTLIGHT);
    await board.clearBoard();
    assert.equal(veils(board).length, 0, `${kind}: explicit instantaneous clear still clears`);
    assert.equal(clock.pendingCount(), 0, `${kind}: explicit clear does not schedule a frame`);
  } finally {
    unmountTestWhiteboard(board);
  }
}

async function completedClear(): Promise<void> {
  const { board, clock, advance } = mount();
  try {
    board.setCursorState("speaking");
    await board.drawShape("M 500 200 L 600 200", 0);
    assert(ink(board).length > 0, "completed clear starts with ink");
    board.setSpotlight(SPOTLIGHT);
    assert.equal(veils(board).length, 4);
    const stateRef = cursorRef(board, "speaking");
    const pace = paceRef(board);
    pace.current = SUCCESSOR_PACE;
    const job = board.clearBoard(1000);
    await advance(1200);
    await job;
    assert.equal(veils(board).length, 0, "completed animated clear removes the spotlight");
    assert.equal(ink(board).length, 0, "completed animated clear removes ink");
    assert.equal(stateRef.current, "speaking", "completed animated clear restores the cursor it captured");
    assert.equal(pace.current, null, "completed animated clear resets pace");
    assert.equal(clock.pendingCount(), 0, "completed animated clear leaves no frame");
  } finally {
    unmountTestWhiteboard(board);
  }
}

async function completedEraseRegion(): Promise<void> {
  const { board, clock, advance } = mount();
  try {
    board.setCursorState("speaking");
    await board.drawShape("M 520 230 L 580 230", 0);
    await board.drawShape("M 800 400 L 900 400", 0);
    const outside = ink(board).find((node) => node.getClientRect().x >= 700);
    assert(outside, "erase-region control keeps a stroke outside the region");
    const release = board.setSpotlight(SPOTLIGHT);
    const successorNodes = veils(board);
    assert.equal(successorNodes.length, 4);
    const stateRef = cursorRef(board, "speaking");
    const pace = paceRef(board);
    pace.current = SUCCESSOR_PACE;
    const job = board.eraseRegion(500, 200, 100, 100, 1000);
    await advance(1200);
    await job;
    assert.equal(ink(board).filter((node) => {
      const box = node.getClientRect();
      return box.x < 600 && box.x + box.width > 500 && box.y < 300 && box.y + box.height > 200;
    }).length, 0, "completed erase region removes ink inside the rect");
    assert.equal(outside.getParent(), board.getDrawLayer(), "completed erase region keeps ink outside the rect");
    assert.deepEqual(veils(board), successorNodes, "completed erase region leaves the spotlight in place");
    assert.equal(stateRef.current, "speaking", "completed erase region restores the cursor it captured");
    assert.equal(pace.current, SUCCESSOR_PACE, "completed erase region does not reset pace");
    assert.equal(clock.pendingCount(), 0, "completed erase region leaves no frame");
    release();
  } finally {
    unmountTestWhiteboard(board);
  }
}

async function completedEraseWork(): Promise<void> {
  const { board, clock, advance } = mount();
  try {
    board.setCursorState("speaking");
    await board.drawAnnotation("underline", "M 80 200 L 180 200", 0);
    await board.drawAnnotation("underline", "M 500 200 L 600 200", 0);
    const scene = ink(board).filter((node) => node.getAttr("htInk") === "scene");
    const work = ink(board).filter((node) => node.getAttr("htInk") === "work");
    assert(work.length > 0 && scene.length > 0, "erase-work control has both work and scene ink");
    const release = board.setSpotlight(SPOTLIGHT);
    const successorNodes = veils(board);
    const stateRef = cursorRef(board, "speaking");
    const pace = paceRef(board);
    pace.current = SUCCESSOR_PACE;
    const job = board.eraseWorkInk(1000);
    await advance(1200);
    await job;
    assert.equal(ink(board).filter((node) => node.getAttr("htInk") === "work").length, 0, "completed erase work removes work ink");
    assert(scene.every((node) => node.getParent() === board.getDrawLayer()), "completed erase work keeps scene ink");
    assert.deepEqual(veils(board), successorNodes, "completed erase work leaves the spotlight in place");
    assert.equal(stateRef.current, "speaking", "completed erase work restores the cursor it captured");
    assert.equal(pace.current, SUCCESSOR_PACE, "completed erase work does not reset pace");
    assert.equal(clock.pendingCount(), 0, "completed erase work leaves no frame");
    release();
  } finally {
    unmountTestWhiteboard(board);
  }
}

async function explicitClear(): Promise<void> {
  const { board, clock } = mount();
  try {
    board.setCursorState("speaking");
    await board.drawShape("M 500 200 L 600 200", 0);
    board.setSpotlight(SPOTLIGHT);
    assert.equal(veils(board).length, 4);
    const stateRef = cursorRef(board, "speaking");
    const pace = paceRef(board);
    pace.current = SUCCESSOR_PACE;
    await board.clearBoard();
    assert.equal(veils(board).length, 0, "explicit instantaneous clear removes the spotlight");
    assert.equal(ink(board).length, 0, "explicit instantaneous clear removes ink");
    assert.equal(stateRef.current, "speaking", "explicit instantaneous clear does not rewrite the cursor");
    assert.equal(pace.current, null, "explicit instantaneous clear resets pace");
    assert.equal(clock.pendingCount(), 0, "explicit instantaneous clear leaves no frame");
  } finally {
    unmountTestWhiteboard(board);
  }
}

async function main(): Promise<void> {
  const which = process.env.TEST_CASE;
  const successors = [
    "clear-flight",
    "clear-sweep",
    "erase-region-flight",
    "erase-region-sweep",
    "erase-work-flight",
    "erase-work-sweep",
  ];
  for (const kind of successors) {
    if (which && which !== kind) continue;
    await successorCase(kind);
    console.log(`${kind}: cancelled destructive successor preserved focus, cursor, and pace`);
  }
  if (!which || which === "completed-clear") {
    await completedClear();
    console.log("completed-clear: animated clear still restores cursor, pace, ink, and spotlight");
  }
  if (!which || which === "completed-erase-region") {
    await completedEraseRegion();
    console.log("completed-erase-region: animated erase still restores cursor and removes only the region");
  }
  if (!which || which === "completed-erase-work") {
    await completedEraseWork();
    console.log("completed-erase-work: animated erase still restores cursor and removes only work ink");
  }
  if (!which || which === "explicit-clear") {
    await explicitClear();
    console.log("explicit-clear: instantaneous clear still clears deliberately");
  }
}

runWhiteboardVerifier(main);
