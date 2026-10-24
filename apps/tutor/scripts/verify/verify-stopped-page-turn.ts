/**
 * A stopped page turn leaves the board and its layout in agreement, and an
 * older turn's page hold never touches a newer turn's board.
 *
 * PR #249 review (Greptile P1): stopping during the page hold skipped the
 * wipe but still reset the layout, so the old page's ink stayed on the board
 * while its row records vanished; Continue or a doubt then wrote its first
 * row on top of that ink. And `cancelRef` is shared: a quick replacement turn
 * clears it while the stopped turn is still holding, so the stopped turn
 * woke up and wiped the replacement's board.
 *
 * This mounts the real `useBoardLayout` hook against a whiteboard that keeps
 * the ink it writes, and checks after each scenario that every row of ink on
 * the board is recorded in the layout, and no recorded row is drawn over:
 *   1. Stop during the hold, then Continue.
 *   2. Stop during the hold, a replacement turn starts at once and writes,
 *      then the stopped turn's hold wakes up.
 * It also checks that the live runner hands its own turn check to the
 * reservation and reserves nothing once the turn has stopped.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DrawCommand } from "@heytutor/drawing";
import { findWorkTextSlot, textRectsOverlap } from "../../features/tutor-session/lib/board/boardLayout";
import { DIAGRAM_ZONE, TEXT_LAYOUT } from "../../features/tutor-session/constants";
import { mountBoardLayout, type MountedBoardLayout } from "./boardLayoutHarness";

const app = fileURLToPath(new URL("../../", import.meta.url));
const runnerPath = path.join(app, "features/tutor-session/hooks/turn/useSegmentRunner.ts");
const HOLD_MS = 1_500;

const write = (text: string): DrawCommand => ({ type: "WRITE", text, params: [TEXT_LAYOUT.marginX, 200], charPosition: 0, narrationBefore: "" });

/** The executor writing reserved rows: ink on the board, then committed. */
function ink(h: MountedBoardLayout, rows: readonly DrawCommand[]) {
  for (const row of rows) h.ink.push({ text: row.text!, x: row.params[0]!, y: row.params[1]! });
  for (const rect of h.board.boardLayoutRef.current.rects) rect.pendingInk = false;
}

/** Every row of ink is recorded, and no recorded row overlaps ink it does not own. */
function assertConsistent(h: MountedBoardLayout, label: string) {
  const rects = h.board.boardLayoutRef.current.rects.filter(rect => rect.x < DIAGRAM_ZONE.x);
  for (const row of h.ink) {
    assert(rects.some(rect => rect.text === row.text && rect.x === row.x && rect.y === row.y),
      `${label}: "${row.text}" is on the board, so the layout still records it`);
  }
  for (const rect of rects) {
    for (const row of h.ink) {
      if (rect.text === row.text && rect.x === row.x && rect.y === row.y) continue;
      const inkRect = { x: row.x, y: row.y, width: rect.width, height: rect.height };
      assert(!textRectsOverlap(rect, inkRect), `${label}: "${rect.text}" is never placed over "${row.text}"`);
    }
  }
}

/** Fill one page; the next reservation must turn it. */
async function fillPage(h: MountedBoardLayout, prefix: string, isCancelled?: () => boolean) {
  const roomLeft = () => findWorkTextSlot({
    layout: h.board.boardLayoutRef.current, requestedX: TEXT_LAYOUT.marginX, requestedY: 0, width: 300,
    height: TEXT_LAYOUT.textHeight, diagramActive: false, sequential: true, runtimeOwnsX: true,
  }) !== null;
  let rows = 0;
  while (roomLeft()) {
    const placed = await h.settle(h.board.reserveTextCommandPlacements(write(`${prefix} ${++rows}: v = ${rows} m/s`), { isCancelled }));
    ink(h, placed);
    assert(rows < 20, "the page fills");
  }
  assert.equal(h.calls.filter(call => call.kind === "erase").length, 0, "filling never turns the page");
  assert(rows >= 5, `a page holds several rows (${rows})`);
}

/** 1. Stop during the hold, then Continue. */
async function stopThenContinue() {
  const h = mountBoardLayout();
  try {
    await fillPage(h, "row");
    const pageInk = h.ink.length;
    const turn = h.board.reserveTextCommandPlacements(write("next page row"));
    await h.advance(HOLD_MS / 3);
    h.cancelRef.current = true; // Stop.
    await h.settle(turn);
    assert.equal(h.calls.filter(call => call.kind === "erase").length, 0, "stopped during the hold: the page is not wiped");
    assert.equal(h.ink.length, pageInk, "the finished page is still on the board");
    assertConsistent(h, "after a stop during the hold");

    h.cancelRef.current = false; // Continue.
    const placed = await h.settle(h.board.reserveTextCommandPlacements(write("continued row")));
    ink(h, placed);
    assertConsistent(h, "Continue after a stopped page turn");
    console.log("stopped page turn: the page and its records stay together, Continue writes on a fresh page");
  } finally { h.close(); }
}

/** 2. Stop during the hold, a replacement turn starts at once, then the old hold wakes. */
async function replacedDuringHold() {
  const h = mountBoardLayout();
  try {
    let generation = 1;
    const turnA = 1;
    const aCancelled = () => h.cancelRef.current || generation !== turnA;
    await fillPage(h, "turn A", aCancelled);
    const held = h.board.reserveTextCommandPlacements(write("turn A next page"), { isCancelled: aCancelled });
    await h.advance(HOLD_MS / 3);

    // Stop, and a new question at once: the shared flag is cleared again.
    h.cancelRef.current = true;
    generation = 2;
    h.cancelRef.current = false;
    const turnB = 2;
    const bCancelled = () => h.cancelRef.current || generation !== turnB;
    await h.settle(h.board.beginBoardEpoch());
    const replacementStart = h.now();
    for (const text of ["turn B: u = 4 m/s", "turn B: v = 9 m/s"]) {
      const placed = await h.settle(h.board.reserveTextCommandPlacements(write(text), { isCancelled: bCancelled }));
      ink(h, placed);
    }
    const replacementRows = h.board.boardLayoutRef.current.rects.map(rect => rect.text);

    await h.settle(held); // The stopped turn's hold wakes up.
    await h.advance(HOLD_MS * 2);
    assert.equal(h.calls.filter(call => call.kind === "erase" && call.at >= replacementStart).length, 0,
      "the stopped turn never wipes the replacement turn's board");
    assert.deepEqual(h.board.boardLayoutRef.current.rects.map(rect => rect.text), replacementRows,
      "the stopped turn never resets or adds to the replacement turn's layout");
    assert.deepEqual(h.ink.map(row => row.text), ["turn B: u = 4 m/s", "turn B: v = 9 m/s"], "the replacement turn's ink is intact");
    assertConsistent(h, "after the stopped turn's hold wakes");
    console.log("stopped page turn: an older turn's hold never touches the replacement turn");
  } finally { h.close(); }
}

/** The live runner passes its own turn check and stops reserving once stopped. */
function runnerPassesTurnCheck() {
  const source = readFileSync(runnerPath, "utf8");
  const start = source.indexOf("const prepared: DrawCommand[] = [];");
  const end = source.indexOf("segmentCommands = prepared;", start);
  assert(start >= 0 && end > start, "found the runner's reservation loop");
  const loop = source.slice(start, end);
  const checkAt = loop.indexOf("if (isCancelled()) return;");
  const reserveAt = loop.indexOf("await reserveTextCommandPlacements(command, { isCancelled })");
  assert(reserveAt >= 0, "the runner hands its own turn check to the reservation");
  assert(checkAt >= 0 && checkAt < reserveAt, "and reserves nothing once its turn has stopped or been replaced");
  const turnCheck = source.indexOf("const isCancelled = () => cancelRef.current || isStale();");
  assert(turnCheck >= 0 && turnCheck < start, "the turn check covers a replaced turn, not only the shared stop flag");
  console.log("stopped page turn: the runner reserves under its own turn");
}

async function main() {
  runnerPassesTurnCheck();
  await stopThenContinue();
  await replacedDuringHold();
  console.log("verify-stopped-page-turn: passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
