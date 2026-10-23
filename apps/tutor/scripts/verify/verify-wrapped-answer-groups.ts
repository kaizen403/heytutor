/**
 * A boxed answer that wrapped onto several rows is framed and carried whole.
 *
 * In the v3 lessons 25 of 273 boxed rows belonged to a WRITE that wrapped in
 * the narrow column beside a figure. `[EMPHASIZE:last]` resolved to the last
 * line, boxed that line alone, and every later page turn carried
 * "+ 2|A||B|cos θ" to the top of the new page by itself.
 *
 * This mounts the real `useBoardLayout` hook (figure on the right, so the
 * column is narrow) and checks, live and on both replay paths (stored rows,
 * and rows flowed again as the Replay button, lecture player and export do):
 * the box frames every row of the wrapped WRITE, a page turn carries the
 * whole answer in order inside one box, two separate WRITEs never merge, a
 * group taller than the carry cap is skipped rather than cut, and the
 * EMPHASIZE executor frames and marks the whole group. Persistence keeps no
 * group id, so replay rejoins the rows from the tag position and words every
 * wrapped piece copies.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emphasisBoxPath, type DrawCommand } from "@heytutor/drawing";
import { resolveVisibleEmphasisRow, textRectsOverlap, workColumnMaxWidth, workColumnRoom } from "../../features/tutor-session/lib/board/boardLayout";
import { DIAGRAM_ZONE, TEXT_LAYOUT } from "../../features/tutor-session/constants";
import type { BoardLayoutState, BoardTextRect } from "../../features/tutor-session/types";
import { mountBoardLayout, type MountedBoardLayout } from "./boardLayoutHarness";

const app = fileURLToPath(new URL("../../", import.meta.url));
const executorPath = path.join(app, "features/tutor-session/hooks/useCommandExecution.ts");

const ANSWER = "R² = A² + B² + 2|A||B|cos θ = 9 + 16 + 24 cos 60° = 37";
const ANSWER_TAG = { charPosition: 412, narrationBefore: "So the resultant squared is" };

type Stored = { text: string; x: number; y: number; fontSize: number; charPosition: number; narrationBefore: string; boxAfter: boolean };

const workRows = (layout: BoardLayoutState) =>
  layout.rects.filter(rect => rect.x < DIAGRAM_ZONE.x && (rect.text ?? "").length > 0).sort((a, b) => a.y - b.y);

/** The pen finishing every reserved row, as the executor does. */
function writeInk(h: MountedBoardLayout, rows: readonly DrawCommand[]) {
  for (const row of rows) h.ink.push({ text: row.text!, x: row.params[0]!, y: row.params[1]! });
  for (const rect of h.board.boardLayoutRef.current.rects) rect.pendingInk = false;
}

/**
 * The EMPHASIZE executor: resolve the named row, frame its whole WRITE and
 * mark it boxed. An older hook without groups boxes the named row alone.
 */
function emphasize(h: MountedBoardLayout, selector = "last"): BoardTextRect[] {
  const rects = h.board.boardLayoutRef.current.rects;
  const row = resolveVisibleEmphasisRow(selector, rects);
  assert(row, `${selector} resolves to a written row`);
  const rows = h.hooks.emphasisGroupRows?.(row, rects) ?? [row];
  if (h.hooks.markEmphasisGroupBoxed) h.hooks.markEmphasisGroupBoxed(rows);
  else for (const each of rows) each.boxed = true;
  return rows;
}

const write = (text: string, tag = { charPosition: 0, narrationBefore: "" }): DrawCommand =>
  ({ type: "WRITE", text, params: [TEXT_LAYOUT.marginX, 200], ...tag });

function assertNoOverlap(layout: BoardLayoutState, label: string) {
  const rects = workRows(layout);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    assert(!textRectsOverlap(rects[i]!, rects[j]!), `${label}: no two work rows share a line (${rects[i]!.text} / ${rects[j]!.text})`);
  }
}

/** Live lesson: a wrapped answer is boxed, then the page fills and turns. */
async function live(): Promise<{ stored: Stored[]; answerLines: string[] }> {
  const h = mountBoardLayout({ diagramActive: true });
  try {
    const stored: Stored[] = [];
    const place = async (command: DrawCommand) => {
      const placed = await h.settle(h.board.reserveTextCommandPlacements(command));
      writeInk(h, placed);
      for (const row of placed) stored.push({
        text: row.text!, x: row.params[0]!, y: row.params[1]!, fontSize: row.params[2]!,
        charPosition: row.charPosition, narrationBefore: row.narrationBefore, boxAfter: false,
      });
      return placed;
    };
    await place(write("A = 3, B = 4, θ = 60°", { charPosition: 40, narrationBefore: "The two vectors are" }));
    const answer = await place(write(ANSWER, ANSWER_TAG));
    const answerLines = answer.map(row => row.text!);
    assert(answerLines.length >= 2 && answerLines.length <= 3, `the fixture answer wraps in the figure column onto 2 or 3 rows (${answerLines.length})`);

    const framed = emphasize(h);
    stored.at(-1)!.boxAfter = true;
    assert.deepEqual(framed.map(row => row.text), answerLines, "[EMPHASIZE:last] frames every row of the wrapped answer, not its last line");
    assert.deepEqual(workRows(h.board.boardLayoutRef.current).filter(row => row.boxed).map(row => row.text), answerLines,
      "every row of the wrapped answer is marked boxed");

    // Two separate one-line WRITEs stay separate answers.
    await place(write("cos 60° = 0.5", { charPosition: 470, narrationBefore: "and cos sixty is a half" }));
    await place(write("R = √37", { charPosition: 520, narrationBefore: "so the resultant is" }));
    const single = emphasize(h);
    stored.at(-1)!.boxAfter = true;
    assert.deepEqual(single.map(row => row.text), ["R = √37"], "a separate WRITE is framed alone");

    // Fill the page until it turns.
    let turned = false;
    for (let index = 1; index <= 8 && !turned; index++) {
      const erases = h.calls.filter(call => call.kind === "erase").length;
      await place(write(`filler ${index}`, { charPosition: 600 + index * 20, narrationBefore: `step ${index}` }));
      if (h.calls.filter(call => call.kind === "erase").length === erases) continue;
      turned = true;
      const erase = h.calls.filter(call => call.kind === "erase").at(-1)!;
      const after = workRows(h.board.boardLayoutRef.current);
      const carried = after.filter(row => row.boxed).map(row => row.text);
      assert.deepEqual(carried, [...answerLines, "R = √37"], "the page turn carries the whole wrapped answer, in order, and the separate answer");
      const boxes = h.calls.filter(call => call.kind === "box" && call.at >= erase.at);
      assert.equal(boxes.length, 2, "one box per carried answer, not one per row");
      const carriedAnswer = after.filter(row => answerLines.includes(row.text!));
      const left = Math.min(...carriedAnswer.map(row => row.x)), top = Math.min(...carriedAnswer.map(row => row.y));
      const right = Math.max(...carriedAnswer.map(row => row.x + row.width)), bottom = Math.max(...carriedAnswer.map(row => row.y + row.height));
      assert.equal(boxes[0]!.path, emphasisBoxPath(left, top, right - left, bottom - top), "the carried answer's box frames all of its rows");
      assertNoOverlap(h.board.boardLayoutRef.current, "live");
    }
    assert(turned, "the fixture turns the page");
    console.log(`wrapped answers live: ${answerLines.length} row answer framed whole and carried whole`);
    return { stored, answerLines };
  } finally { h.close(); }
}

/** Replay the stored rows; persistence kept the tag position and words, no group id. */
async function replay(stored: Stored[], answerLines: string[], flow: boolean) {
  const h = mountBoardLayout({ diagramActive: true });
  const label = flow ? "flowed replay" : "replay";
  try {
    let turned = false;
    for (const row of stored) {
      const erases = h.calls.filter(call => call.kind === "erase").length;
      const command: DrawCommand = { type: "WRITE", text: row.text, params: [row.x, row.y, row.fontSize], charPosition: row.charPosition, narrationBefore: row.narrationBefore };
      const at = await h.settle(h.board.resolveTextPlacement(command, row.x, row.y, flow));
      h.ink.push({ text: row.text, x: at.x, y: at.y });
      for (const rect of h.board.boardLayoutRef.current.rects) rect.pendingInk = false;
      if (h.calls.filter(call => call.kind === "erase").length > erases) {
        turned = true;
        const after = workRows(h.board.boardLayoutRef.current).filter(rect => rect.boxed).map(rect => rect.text);
        assert.deepEqual(after, [...answerLines, "R = √37"], `${label}: the page turn carries the whole wrapped answer`);
      }
      if (row.boxAfter) {
        const framed = emphasize(h);
        if (row.text === answerLines.at(-1)) {
          assert.deepEqual(framed.map(rect => rect.text), answerLines, `${label}: [EMPHASIZE:last] frames every row of the stored answer`);
        } else {
          assert.deepEqual(framed.map(rect => rect.text), [row.text], `${label}: a separate stored WRITE is framed alone`);
        }
      }
      assertNoOverlap(h.board.boardLayoutRef.current, label);
    }
    assert(turned, `${label}: the page turns`);
    console.log(`wrapped answers ${label}: rows rejoined from their tag, framed and carried whole`);
  } finally { h.close(); }
}

/** A group taller than the carry cap is skipped, never cut. */
function carryCap(h: MountedBoardLayout) {
  const cap = h.hooks.MAX_CARRIED_ANSWER_ROWS;
  const row = (y: number, text: string, rowGroup: string): BoardTextRect =>
    ({ x: TEXT_LAYOUT.marginX, y, width: 200, height: TEXT_LAYOUT.textHeight, text, boxed: true, rowGroup });
  const rects = [
    row(TEXT_LAYOUT.workTopY, "older answer", "a"),
    ...Array.from({ length: cap + 1 }, (_, index) => row(TEXT_LAYOUT.workTopY + (index + 1) * TEXT_LAYOUT.lineHeight, `tall ${index}`, "b")),
  ];
  const carried = h.hooks.boxedAnswerRowsToCarry(rects) as unknown;
  assert(Array.isArray(carried) && carried.every(Array.isArray), "boxed answers are carried as whole groups");
  const texts = (carried as BoardTextRect[][]).map(group => group.map(entry => entry.text));
  assert.deepEqual(texts, [["older answer"]], `a ${cap + 1} row answer over the ${cap} row cap is left behind whole, not cut to its last rows`);
  console.log("wrapped answers: a group over the carry cap is skipped, never cut");
}

/** The EMPHASIZE executor frames and marks the whole group. */
function executorFramesGroups() {
  const source = readFileSync(executorPath, "utf8");
  const start = source.indexOf('case "EMPHASIZE": {');
  const end = source.indexOf('case "SUPERSEDE":', start);
  assert(start >= 0 && end > start, "found the EMPHASIZE executor");
  const body = source.slice(start, end);
  const groupAt = body.indexOf("emphasisGroupRows(row, boardLayoutRef.current.rects)");
  const boundsAt = body.indexOf("rowGroupBounds(answerRows)");
  const boxAt = body.indexOf("emphasisBoxPath(frame.x, frame.y, frame.width, frame.height)");
  const markAt = body.indexOf("markEmphasisGroupBoxed(answerRows)");
  assert(groupAt >= 0 && boundsAt > groupAt, "the executor frames every row of the named row's WRITE");
  assert(boxAt > boundsAt && markAt > boxAt, "and marks the whole group boxed once its box is drawn");
  console.log("wrapped answers: EMPHASIZE frames and marks the whole group");
}

/**
 * Main reserves one wrapped equation whole: when it does not fit the rest of
 * the page but fits a fresh one, the page turns before its first row. Carried
 * answers take rows on that fresh page, so they ride along only when the
 * equation still fits whole below them. Otherwise the page turns without
 * them, never splitting the equation across two pages to make room.
 */
async function equationStaysWholeBesideCarriedAnswers(spare: number) {
  const h = mountBoardLayout({ diagramActive: true });
  try {
    const place = async (command: DrawCommand) => {
      const placed = await h.settle(h.board.reserveTextCommandPlacements(command));
      writeInk(h, placed);
      return placed;
    };
    const answer = await place(write(ANSWER, ANSWER_TAG));
    emphasize(h);
    await place(write("R = √37", { charPosition: 520, narrationBefore: "so the resultant is" }));
    emphasize(h);
    const carriedRows = answer.length + 1;
    const fresh = workColumnRoom({ rects: [], nextY: TEXT_LAYOUT.topY }, true).rowsLeft;
    // An equation that fits a fresh page, and below the carried answers only
    // when `spare` (rows over what is left below them) is not positive.
    const wanted = fresh - carriedRows + spare;
    assert(wanted >= 2 && wanted <= fresh, `the fixture equation wraps onto 2 to ${fresh} rows (${wanted})`);
    const width = workColumnMaxWidth(h.board.boardLayoutRef.current, true);
    let text = "s = a";
    for (let term = 1; h.hooks.wrapWorkRow(text, width).lines.length < wanted && term < 400; term++) text += ` + b_${term}`;
    assert.equal(h.hooks.wrapWorkRow(text, width).lines.length, wanted, "the fixture equation wraps onto the wanted rows");
    for (let index = 1; workColumnRoom(h.board.boardLayoutRef.current, true).rowsLeft >= wanted; index++) {
      await place(write(`filler ${index}`, { charPosition: 600 + index * 20, narrationBefore: `step ${index}` }));
    }
    const erases = h.calls.filter(call => call.kind === "erase").length;
    assert.equal(erases, 0, "the fixture fills the first page without turning it");
    const rows = await place(write(text, { charPosition: 900, narrationBefore: "so the whole sum is" }));
    assert.equal(rows.length, wanted, "every row of the equation is reserved");
    assert.equal(h.calls.filter(call => call.kind === "erase").length, 1, "one page turn, before the equation's first row, never inside it");
    const after = workRows(h.board.boardLayoutRef.current);
    const equation = after.filter(row => rows.some(placed => placed.text === row.text && placed.params[1] === row.y));
    assert.equal(equation.length, wanted, "the whole equation is on the new page");
    const carried = after.filter(row => row.boxed).map(row => row.text);
    if (spare <= 0) assert.deepEqual(carried, [...answer.map(row => row.text!), "R = √37"], "with room below them, the answers are carried");
    else assert.deepEqual(carried, [], "without room, the page turns without the answers rather than splitting the equation");
    assertNoOverlap(h.board.boardLayoutRef.current, `equation beside carried answers (${spare})`);
    console.log(`wrapped answers: a ${wanted} row equation stays whole on its page (${spare <= 0 ? "answers carried" : "answers left behind"})`);
  } finally { h.close(); }
}

async function main() {
  executorFramesGroups();
  const probe = mountBoardLayout();
  try { carryCap(probe); } finally { probe.close(); }
  const { stored, answerLines } = await live();
  await replay(stored, answerLines, false);
  await replay(stored, answerLines, true);
  await equationStaysWholeBesideCarriedAnswers(0);
  await equationStaysWholeBesideCarriedAnswers(1);
  console.log("verify-wrapped-answer-groups: passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
