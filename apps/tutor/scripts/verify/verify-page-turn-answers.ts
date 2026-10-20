/**
 * A page turn holds the finished page and carries its boxed answers.
 *
 * v3 p1e2: the answer box finished at 175,215 ms and the wipe began 11 ms
 * later; p3e2 had a row up for about 150 ms. 37 of 160 page turns came
 * within 3 s of a box, in 34 of 83 lessons. This mounts the real
 * useBoardLayout hook against a recording whiteboard and a virtual clock:
 * live turns hold at least PAGE_TURN_HOLD_MS before the wipe, every boxed
 * answer (up to the carry cap) reappears at the top of the new page at its
 * own size and boxed, new work flows below it, and a replay of the recorded
 * rows rebuilds the same pages without a hold. An older recording whose page
 * starts at the top is never overdrawn by a carried row.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { DrawCommand } from "@heytutor/drawing";
import { resolveVisibleEmphasisRow, textRectsOverlap } from "../../features/tutor-session/lib/board/boardLayout";
import { TEXT_LAYOUT } from "../../features/tutor-session/constants";
import type { BoardLayoutState, BoardTextRect } from "../../features/tutor-session/types";

const app = fileURLToPath(new URL("../../", import.meta.url));
const requireApp = createRequire(new URL("../../package.json", import.meta.url));
const hookPath = path.join(app, "features/tutor-session/hooks/useBoardLayout.ts");
const executorPath = path.join(app, "features/tutor-session/hooks/useCommandExecution.ts");
const HOLD_MS = 1_500;

type Call = { kind: "erase" | "write" | "box" | "snapshot"; at: number; text?: string; x?: number; y?: number; fontSize?: number };

function mount() {
  let now = 10_000, sequence = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const original = new Map<string, PropertyDescriptor | undefined>();
  const replace = (key: string, value: unknown) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  replace("performance", { now: () => now });
  replace("setTimeout", (run: () => void, delay = 0) => { const id = ++sequence; timers.set(id, { at: now + delay, run }); return id; });
  replace("clearTimeout", (id: number) => { timers.delete(id); });
  const settle = async <T,>(work: Promise<T>): Promise<T> => {
    let done = false; let value: T | undefined; let failure: unknown; let failed = false;
    work.then((result) => { done = true; value = result; }, (error) => { done = true; failed = true; failure = error; });
    for (let guard = 0; guard < 10_000 && !done; guard++) {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      if (done) break;
      const next = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) continue;
      timers.delete(next[0]); now = Math.max(now, next[1].at); next[1].run();
    }
    assert(done, "board work settles on the virtual clock");
    if (failed) throw failure;
    return value as T;
  };
  const calls: Call[] = [];
  const wb = {
    captureSnapshot: () => { calls.push({ kind: "snapshot", at: now }); return "data:image/png;base64,"; },
    eraseWorkInk: async () => { calls.push({ kind: "erase", at: now }); },
    clearBoard: async () => {},
    getInkSettings: () => ({}),
    writeText: async (text: string, x: number, y: number, _duration: number, _schedule: unknown, fontSize: number) => {
      calls.push({ kind: "write", at: now, text, x, y, fontSize });
    },
    drawAnnotation: async (kind: string) => { if (kind === "box") calls.push({ kind: "box", at: now }); },
  };
  const ref = <T,>(current: T) => ({ current });
  const source = process.env.PAGE_TURN_HOOK_SOURCE ?? hookPath;
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", compiled)((specifier: string) => {
    if (specifier === "react") return { useRef: ref, useCallback: <T,>(fn: T) => fn };
    if (specifier === "./useBoardViewport") return { useBoardViewport: () => ({}) };
    if (specifier === "@heytutor/tutor-core") return { tutorDebug: () => {} };
    return requireApp(specifier.startsWith("@/") ? path.join(app, specifier.slice(2))
      : specifier.startsWith(".") ? path.resolve(path.dirname(hookPath), specifier) : specifier);
  }, mod, mod.exports);
  const hooks = mod.exports as unknown as typeof import("../../features/tutor-session/hooks/useBoardLayout");
  const cancelRef = ref(false);
  const board = hooks.useBoardLayout({
    whiteboardRef: ref(wb) as never, cancelRef, fbdPhaseStartedRef: ref(false), liveQuestionRef: ref("Relative velocity"),
  });
  return {
    board, calls, settle, now: () => now,
    close: () => { for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    } },
  };
}

type Mounted = ReturnType<typeof mount>;
const write = (text: string): DrawCommand => ({ type: "WRITE", text, params: [TEXT_LAYOUT.marginX, 200], charPosition: 0, narrationBefore: "" });

/** The executor's own EMPHASIZE resolution, then its mark once the box is drawn. */
function box(h: Mounted, selector: string): BoardTextRect {
  const row = resolveVisibleEmphasisRow(selector, h.board.boardLayoutRef.current.rects);
  assert(row, `${selector} resolves to a visible row`);
  row.boxed = true;
  return row;
}

/** The pen finishing a reserved row: the row becomes board context. */
function finishInk(layout: BoardLayoutState) { for (const rect of layout.rects) rect.pendingInk = false; }

function workRows(layout: BoardLayoutState) {
  return layout.rects.filter(rect => rect.x < 400 && (rect.text ?? "").length > 0).sort((a, b) => a.y - b.y);
}

/** Live lesson: 4 pages, answers boxed on every page. */
async function live() {
  const h = mount();
  const recorded: Array<{ text: string; x: number; y: number; fontSize: number; boxedAfter: boolean }> = [];
  try {
    const boxedSoFar: string[] = [];
    let pageTurns = 0;
    for (let index = 1; index <= 26; index++) {
      const text = `row ${index}: v = ${index} m/s`;
      const erasesBefore = h.calls.filter(call => call.kind === "erase").length;
      const boxedBefore = workRows(h.board.boardLayoutRef.current).filter(row => row.boxed).map(row => row.text!);
      const startedAt = h.now();
      const placed = await h.settle(h.board.reserveTextCommandPlacements(write(text)));
      const erases = h.calls.filter(call => call.kind === "erase");
      if (erases.length > erasesBefore) {
        pageTurns++;
        const erase = erases.at(-1)!;
        assert(erase.at - startedAt >= HOLD_MS, `page turn ${pageTurns}: the finished page stays up ${HOLD_MS} ms before the wipe (held ${erase.at - startedAt} ms)`);
        const after = workRows(h.board.boardLayoutRef.current);
        const carried = after.filter(row => row.boxed).map(row => row.text!);
        const expected = boxedBefore.slice(-3);
        assert.deepEqual(carried, expected, `page turn ${pageTurns}: every boxed answer is carried, not erased`);
        const writes = h.calls.filter(call => call.kind === "write" && call.at >= erase.at);
        assert.deepEqual(writes.map(call => call.text), expected, "the carried answers are written again after the wipe");
        assert.equal(h.calls.filter(call => call.kind === "box" && call.at >= erase.at).length, expected.length, "and boxed again");
        const firstTop = after.find(row => row.text === expected[0]);
        const pageWork = after.filter(row => row.y >= TEXT_LAYOUT.headingBottomY);
        assert.equal(firstTop?.y, Math.min(...pageWork.map(row => row.y)), "the carried answers start the new page, under its heading");
        for (const call of writes) {
          const source = recorded.find(row => row.text === call.text);
          assert.equal(call.fontSize, source?.fontSize, "a carried row keeps its own size on the type scale");
        }
        assert(placed[0]!.params[1]! > after.filter(row => row.boxed).reduce((max, row) => Math.max(max, row.y), 0),
          "the new page's work flows below its carried answers");
      }
      finishInk(h.board.boardLayoutRef.current);
      for (const row of placed) recorded.push({ text: row.text!, x: row.params[0]!, y: row.params[1]!, fontSize: row.params[2]!, boxedAfter: false });
      // Box an answer on every page: the 3rd and 6th row of each run.
      if (index % 3 === 0) { box(h, "last"); boxedSoFar.push(text); recorded.at(-1)!.boxedAfter = true; }
      const rects = workRows(h.board.boardLayoutRef.current);
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        assert(!textRectsOverlap(rects[i]!, rects[j]!), `no two work rows share a line (${rects[i]!.text} / ${rects[j]!.text})`);
      }
    }
    assert(pageTurns >= 3, `the fixture turns several pages (${pageTurns})`);
    const finalBoxed = workRows(h.board.boardLayoutRef.current).filter(row => row.boxed).map(row => row.text!);
    assert.deepEqual(finalBoxed, boxedSoFar.slice(-3), "the final page holds the latest boxed answers");
    console.log(`page turn answers live: ${pageTurns} page turns, each held >= ${HOLD_MS} ms, boxed answers carried`);
    return recorded;
  } finally { h.close(); }
}

/** Replay the stored rows: same pages, no hold, no overlaps. */
async function replay(recorded: Awaited<ReturnType<typeof live>>, legacy: boolean) {
  const h = mount();
  try {
    let pageTurns = 0;
    let rows = recorded;
    if (legacy) {
      // A recording made before answers were carried: each later page
      // restarts at the first work row under the heading.
      let page = 0, y = 0, previous = -Infinity;
      rows = recorded.map(row => {
        if (row.y <= previous) { page++; y = TEXT_LAYOUT.workTopY; }
        previous = row.y;
        if (page === 0) return row;
        const at = y; y += TEXT_LAYOUT.lineHeight;
        return { ...row, y: at };
      });
    }
    for (const row of rows) {
      const erasesBefore = h.calls.filter(call => call.kind === "erase").length;
      const startedAt = h.now();
      await h.settle(h.board.resolveTextPlacement({ type: "WRITE", text: row.text, params: [row.x, row.y, row.fontSize], charPosition: 0, narrationBefore: "" }, row.x, row.y, false));
      if (h.calls.filter(call => call.kind === "erase").length > erasesBefore) {
        pageTurns++;
        assert.equal(h.now() - startedAt, 0, "replay follows its recording and adds no hold");
      }
      finishInk(h.board.boardLayoutRef.current);
      if (row.boxedAfter) box(h, "last");
      const rects = workRows(h.board.boardLayoutRef.current);
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        assert(!textRectsOverlap(rects[i]!, rects[j]!), `replay${legacy ? " of an older recording" : ""}: no carried answer is drawn over a recorded row`);
      }
    }
    assert(pageTurns >= 3, "replay finds the same page turns");
    if (!legacy) {
      assert.deepEqual(workRows(h.board.boardLayoutRef.current).filter(row => row.boxed).map(row => row.text),
        recorded.filter(row => row.boxedAfter).map(row => row.text).slice(-3), "replay ends on the same final page of answers");
    }
    console.log(`page turn answers replay${legacy ? " (older recording)" : ""}: ${pageTurns} page turns, no hold, no overlaps`);
  } finally { h.close(); }
}

/** The EMPHASIZE executor marks the row it boxed, after the box is drawn. */
function executorMarksBoxedRows() {
  const source = readFileSync(executorPath, "utf8");
  const start = source.indexOf('case "EMPHASIZE": {');
  const end = source.indexOf('case "SUPERSEDE":', start);
  assert(start >= 0 && end > start, "found the EMPHASIZE executor");
  const body = source.slice(start, end);
  const boxAt = body.indexOf('"box"');
  const markAt = body.indexOf("row.boxed = true");
  assert(boxAt >= 0 && markAt > boxAt, "the executor marks a row boxed once its box is drawn");
  console.log("page turn answers: EMPHASIZE marks the row it boxed");
}

async function main() {
  executorMarksBoxedRows();
  const recorded = await live();
  await replay(recorded, false);
  await replay(recorded, true);
  console.log("verify-page-turn-answers: passed");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
