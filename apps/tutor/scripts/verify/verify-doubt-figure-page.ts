/**
 * DIAGRAM_DOUBT_FIGURES lane 9: a doubt figure over lesson text turns a fresh
 * page, and the lesson's resume returns the lesson's page exactly as it was.
 *
 * A text only lesson wraps its work at full board width, so its rows reach
 * the diagram zone and lane 2 refused every such doubt (`zone_occupied`).
 * Now the doubt's figure takes a fresh page: the whiteboard holds the lesson
 * page whole (`holdPage`, gated in packages/whiteboard verify-held-page), the
 * doubt draws and teaches on a blank page, and Continue puts the lesson page
 * back. The doubt is saved with `boardContinuation.freshPage`, and every stored
 * surface derives the same page turns from it (`storedPageTurnAt`).
 *
 * Rule for doubts in a row (one level): a doubt asked on the doubt page
 * continues the doubt page; only the lesson's resume returns the lesson page;
 * a later figure doubt on the lesson page turns a fresh page again.
 *
 * Checks, behavioural through the real server canonicalizer and a fake board
 * with the whiteboard's hold semantics, plus source slices of the live hook
 * (both anchors of every slice guarded):
 *   need/       an occupied empty zone asks the need check only with freshPage;
 *   record/     the marker's bytes, and off equals absent;
 *   server/     freshPage kept on a doubt (validated, or refused as text), dropped elsewhere;
 *   save/       the live save writes it only for the doubt that turned the page;
 *   derive/     hold and return over [L, D fresh, D2, R, D3 fresh, R2];
 *   surfaces/   live, sequential replay and seek catch up show the same page and layout at every turn;
 *   zone/       the server zone walk (F3) and the client reference after the return see the lesson's zone;
 *   restore/    a reload on the doubt page holds the lesson page, and Continue returns it whole;
 *   live/       the uQH swap and return anchors.
 *
 * Mutations this gate catches (each red, then green after revert):
 * (a) doubtFigureNeedSkip ignores freshPage;
 * (b) the server drops freshPage on a doubt too;
 * (c) the server keeps freshPage on any turn;
 * (d) liveTurnScene writes freshPage on every doubt;
 * (e) storedFreshPageOpen ignores the resume that closed the page;
 * (f) storedPageTurnAt never returns "return";
 * (g) syncStoredPageFigure skips the page step;
 * (h) the return to an empty lesson zone erases the zone after the page came back;
 * (i) turnDoubtPage keeps the lesson's layout on the fresh page;
 * (j) the uQH return reads the zone stash before returning the page;
 * (k) the uQH swap turns a page with a figure in the zone.
 *
 * Run: pnpm exec tsx scripts/verify/verify-doubt-figure-page.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isStoredCommandTrustedGeometry, parseStoredSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import {
  BOARD_CONTINUATION_VERSION,
  boardContinuationArtifacts,
  boardContinuationOf,
  storedFreshPageOpen,
  storedPageTurnAt,
} from "../../lib/boards/boardContinuation";
import { doubtFigureArtifacts, doubtFigureOf } from "../../lib/boards/doubtFigure";
import { pageFigureAt } from "../../lib/boards/pageFigure";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { memoryPageFigureStore, storedPageZone, type PageFigureTurn } from "../../lib/scene/pageFigureLoader";
import { syncStoredPageFigure } from "../../features/tutor-session/lib/replay/pageFigureSync";
import { returnLessonPage, turnDoubtPage } from "../../features/tutor-session/lib/board/doubtPage";
import { doubtFigureNeedSkip, zoneInkOccupied } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { doubtFigureRefFor, doubtFigureTurnScene, doubtPageRecord, type PersistedTurnScene } from "../../features/tutor-session/lib/turn/doubtTurn";
import { liveTurnScene } from "../../features/tutor-session/lib/turn/liveTurnSave";
import { pausedLessonFromStoredTurns } from "../../features/tutor-session/lib/turn/pausedLessonRestore";
import type { BoardLayoutState } from "../../features/tutor-session/types";
import { DOUBT_FIGURE_TURN_ID, DOUBT_TITLE, LESSON_TURN_ID, doubtFigurePageFixture, doubtPageCheck, stored, teachingRow } from "./fixtures/doubtFigureScene";

let checks = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`verify-doubt-figure-page: ${message}`);
  checks += 1;
}

const root = resolve(import.meta.dirname, "../..");
function between(source: string, file: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone. Repoint this gate; do not relax it.`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone after "${start}". Repoint this gate; do not relax it.`);
  return source.slice(from, to + end.length);
}
function anchored(file: string, name: string): string {
  return between(readFileSync(resolve(root, file), "utf8"), file, `// ${name}:begin`, `// ${name}:end`);
}
/** Index of `needle`, asserted present: an order check on a missing string (-1) must never pass. */
function at(haystack: string, needle: string, from = 0): number {
  const index = haystack.indexOf(needle, from);
  assert(index >= 0, `present in the slice: ${needle.slice(0, 80)}`);
  return index;
}

/** A row that runs across the zone, as a text only lesson writes at full width. */
const LONG_ROW = { x: 40, y: 120, width: 1100, height: 30 };
const SHORT_ROW = { x: 40, y: 120, width: 200, height: 30 };
const writeAt = (text: string, y: number): DrawCommand => ({ type: "WRITE", params: [90, y], text, charPosition: 0, narrationBefore: "" });

/**
 * A board with the whiteboard's hold semantics (verify-held-page gates the
 * real one): one held page, a second hold blanks the board and keeps the
 * first, clearBoard drops it. Ink is "scene:<turn>" or "work:<text>".
 */
function pageBoard() {
  let ink: string[] = [];
  let held: { ink: string[]; meta: unknown } | null = null;
  const events: string[] = [];
  const wb = {
    eraseSceneInk: async () => { events.push("eraseSceneInk"); ink = ink.filter((entry) => !entry.startsWith("scene:")); },
    erasePinnedInk: () => { events.push("erasePinnedInk"); },
    holdPage: (meta?: unknown) => {
      events.push("holdPage");
      if (!held) held = { ink, meta };
      ink = [];
    },
    returnHeldPage: () => {
      events.push("returnHeldPage");
      if (!held) return null;
      const back = held;
      held = null;
      ink = back.ink;
      return { meta: back.meta };
    },
    hasHeldPage: () => held !== null,
    clearBoard: async () => { ink = []; held = null; },
  };
  return {
    wb: wb as unknown as WhiteboardHandle,
    events,
    ink: () => [...ink],
    held: () => held !== null,
    /** A turn's own rows: its figure ink (trusted rows) and each WRITE, laid out as replay registers them. */
    draw(turn: StoredTurn, layout: BoardLayoutState) {
      for (const segment of [...turn.segments].sort((a, b) => a.orderIndex - b.orderIndex)) {
        const commands = parseStoredSegmentCommands(segment.command);
        if (isStoredCommandTrustedGeometry(segment.command)) {
          if (!ink.includes(`scene:${turn.id}`)) ink.push(`scene:${turn.id}`);
        }
        for (const command of commands) {
          if (command.type !== "WRITE" || !command.text) continue;
          ink.push(`work:${command.text}`);
          layout.rects.push({ x: command.params[0]!, y: command.params[1]!, width: 1100, height: 30, text: command.text });
          layout.nextY = Math.max(layout.nextY, command.params[1]! + 40);
        }
      }
    },
  };
}

type Frame = { ink: string[]; rects: string };
const frameOf = (board: ReturnType<typeof pageBoard>, layout: BoardLayoutState): Frame =>
  ({ ink: board.ink(), rects: JSON.stringify(layout.rects.map((rect) => rect.text ?? `${rect.x},${rect.y}`)) });

/** What a stored surface shows after each turn, walking turns[from..to] after a clear (seek) or from the start (replay). */
async function storedFrames(turns: readonly StoredTurn[], from = 0, to = turns.length - 1) {
  const board = pageBoard();
  const layout: BoardLayoutState = { rects: [], nextY: 0 };
  const frames: Frame[] = [];
  for (let index = from; index <= to; index += 1) {
    if (index > from) {
      await syncStoredPageFigure({
        turns, turnIndex: index, whiteboard: board.wb, layout,
        executeCommand: async () => {}, shouldCancel: () => false,
      });
    }
    board.draw(turns[index]!, layout);
    frames.push(frameOf(board, layout));
  }
  return { frames, board };
}

async function main(): Promise<void> {
  const fixture = await doubtFigurePageFixture();
  const { lesson } = fixture;
  const resumeOf = fixture.turns[3]!;

  // --- need/ --------------------------------------------------------------
  {
    const empty = { granted: true, codeBoard: false, markedFigureIds: [] as string[], zoneFigure: null, zoneReturnable: false, zoneEmpty: true };
    const occupied = zoneInkOccupied({ rects: [LONG_ROW], nextY: 160 });
    assert(occupied && !zoneInkOccupied({ rects: [SHORT_ROW], nextY: 160 }), "need/a full width row occupies the zone, a short one does not");
    assert(doubtFigureNeedSkip({ ...empty, zoneOccupied: occupied, freshPage: true }) === null,
      "need/an occupied empty zone asks the need check when a fresh page may turn (mutation a)");
    assert(doubtFigureNeedSkip({ ...empty, zoneOccupied: occupied }) === "zone_occupied" &&
      doubtFigureNeedSkip({ ...empty, zoneOccupied: occupied, freshPage: false }) === "zone_occupied",
    "need/without freshPage it is refused as before (off equals absent)");
    assert(doubtFigureNeedSkip({ ...empty, granted: false, zoneOccupied: occupied, freshPage: true }) === "flag_off",
      "need/flag off: no figure and no page turn, whatever freshPage says");
    assert(doubtFigureNeedSkip({ ...empty, codeBoard: true, zoneOccupied: occupied, freshPage: true }) === "code_board",
      "need/a code board never turns a page");
  }

  // --- record/ ------------------------------------------------------------
  {
    const plain = boardContinuationArtifacts(lesson.question);
    const legacy = { boardContinuation: { schemaVersion: BOARD_CONTINUATION_VERSION, lessonQuestion: lesson.question.trim() } };
    assert(JSON.stringify(plain) === JSON.stringify(legacy), "record/the marker's bytes are today's without freshPage");
    assert(JSON.stringify(boardContinuationArtifacts(lesson.question, { freshPage: false })) === JSON.stringify(legacy) &&
      JSON.stringify(boardContinuationArtifacts(lesson.question, {})) === JSON.stringify(legacy),
    "record/freshPage false or absent: the same bytes");
    const fresh = boardContinuationArtifacts(lesson.question, { freshPage: true });
    assert(boardContinuationOf(fresh)?.freshPage === true, "record/freshPage reads back");
    assert(!("freshPage" in (boardContinuationOf({ boardContinuation: { ...legacy.boardContinuation, freshPage: "yes" } }) ?? {})),
      "record/only freshPage === true is a page turn");
    assert(JSON.stringify(boardContinuationOf(legacy)) === JSON.stringify(legacy.boardContinuation), "record/a stored marker reads back with today's keys");
  }

  // --- server/ ------------------------------------------------------------
  const textLesson = stored(LESSON_TURN_ID, 0, lesson.question, {
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only", sceneArtifacts: null,
    segments: [teachingRow(0, "Start with two.", [writeAt("2 is where we start on the number line, and we move right", 142)])],
  }, { opensOnClear: true, kind: "lesson" });
  const freshMarker = boardContinuationArtifacts(lesson.question, { freshPage: true });
  const freshDoubtMetadata = () => fixture.doubtMetadata(fixture.doubtSegments, { ...doubtFigureArtifacts(null), ...freshMarker });
  const freshSaved = await canonicalizeTurnSceneMetadata(freshDoubtMetadata(),
    { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck([textLesson]) });
  assert(freshSaved.ok && freshSaved.value.visualStatus === "validated" &&
    doubtFigureOf(freshSaved.value.sceneArtifacts)?.replacedTurnId === null &&
    boardContinuationOf(freshSaved.value.sceneArtifacts)?.freshPage === true,
  `server/a doubt figure on a fresh page saves validated with freshPage kept (mutation b): ${freshSaved.ok ? "" : freshSaved.error}`);
  const refusedSaved = await canonicalizeTurnSceneMetadata(freshDoubtMetadata(),
    { kind: "doubt", doubtFiguresEnabled: false, checkDoubtFigurePage: doubtPageCheck([textLesson]) });
  assert(refusedSaved.ok && refusedSaved.value.visualStatus === "text_only" &&
    boardContinuationOf(refusedSaved.value.sceneArtifacts)?.freshPage === true,
  "server/a figure refused at save keeps its page turn: its rows were laid out on the blank page");
  const offPage = await canonicalizeTurnSceneMetadata(freshDoubtMetadata(),
    { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: async () => false });
  assert(offPage.ok && offPage.value.visualStatus === "text_only" && boardContinuationOf(offPage.value.sceneArtifacts)?.freshPage === true,
    "server/a figure off its page keeps the page turn too");
  const textResumeSaved = await canonicalizeTurnSceneMetadata({
    question: lesson.question, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: freshMarker, segments: [teachingRow(0, "Back to it.", [writeAt("so 2 + 3", 190)])],
  }, { kind: "resume" });
  assert(textResumeSaved.ok && boardContinuationOf(textResumeSaved.value.sceneArtifacts) !== null &&
    boardContinuationOf(textResumeSaved.value.sceneArtifacts)?.freshPage === undefined,
  "server/a resume never turns a page: freshPage is dropped, the marker kept (mutation c)");
  const legacyRoute = await canonicalizeTurnSceneMetadata({
    question: DOUBT_TITLE, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: freshMarker, segments: [teachingRow(0, "Why.", [writeAt("why", 142)])],
  });
  assert(legacyRoute.ok && boardContinuationOf(legacyRoute.value.sceneArtifacts)?.freshPage === undefined,
    "server/a save with no kind never keeps a page turn");
  const plainSaved = await canonicalizeTurnSceneMetadata({
    question: DOUBT_TITLE, sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: boardContinuationArtifacts(lesson.question), segments: [teachingRow(0, "Why.", [writeAt("why", 142)])],
  }, { kind: "doubt" });
  assert(plainSaved.ok && JSON.stringify((plainSaved.value.sceneArtifacts as unknown as Record<string, unknown>).boardContinuation) ===
    JSON.stringify(boardContinuationArtifacts(lesson.question).boardContinuation),
  "server/a doubt without the marker saves today's continuation bytes (off equals absent)");

  // --- save/ --------------------------------------------------------------
  {
    const record = doubtPageRecord({ boardId: "b1", lessonQuestion: lesson.question, title: DOUBT_TITLE, continuesBoard: true,
      figureDrawn: true, turnPlan: null, solverProjection: null });
    record.turn.scene = doubtFigureTurnScene({ ...freshSaved.value } as unknown as PersistedTurnScene, lesson.question, null);
    const input = { page: record, kind: "doubt" as const, preview: lesson.question, opensPage: false, status: "complete" as const, textOnly: false };
    const off = liveTurnScene(input);
    const absent = JSON.stringify(off);
    record.turnedFreshPage = false;
    assert(JSON.stringify(liveTurnScene(input)) === absent && !absent.includes("freshPage"),
      "save/turnedFreshPage false equals absent: today's bytes (mutation d)");
    record.turnedFreshPage = true;
    assert(boardContinuationOf(liveTurnScene(input).sceneArtifacts)?.freshPage === true, "save/the doubt that turned the page saves freshPage");
    assert(boardContinuationOf(liveTurnScene({ ...input, textOnly: true }).sceneArtifacts)?.freshPage === true,
      "save/its text only fallback keeps the page turn");
    assert(boardContinuationOf(liveTurnScene({ ...input, status: "stopped" as never }).sceneArtifacts)?.freshPage === true,
      "save/a stopped checkpoint keeps the page turn");
    assert(boardContinuationOf(liveTurnScene({ ...input, opensPage: true }).sceneArtifacts)?.freshPage === undefined,
      "save/a doubt saved on a page of its own turns nothing");
    const next = doubtPageRecord({ boardId: "b1", lessonQuestion: lesson.question, title: "Doubt: and then?", continuesBoard: true,
      figureDrawn: false, turnPlan: null, solverProjection: null, replaces: record });
    assert(next.turnedFreshPage === undefined &&
      boardContinuationOf(liveTurnScene({ ...input, page: next }).sceneArtifacts)?.freshPage === undefined,
    "save/a doubt on the doubt page continues it: no page turn of its own");
  }

  // --- derive/ ------------------------------------------------------------
  const D = stored(DOUBT_FIGURE_TURN_ID, 1, DOUBT_TITLE, freshSaved.value, { opensOnClear: false, kind: "doubt" });
  const plainOn = (id: string, orderIndex: number, title: string, text: string, y: number) => stored(id, orderIndex, title, {
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: boardContinuationArtifacts(lesson.question),
    segments: [teachingRow(0, text, [writeAt(text, y)])],
  }, { opensOnClear: false, kind: "doubt" });
  const D2 = plainOn("33333333-3333-4333-8333-333333333333", 2, "Doubt: and then?", "then we read five", 260);
  const R = stored("44444444-4444-4444-8444-444444444444", 3, lesson.question, textResumeSaved.value, { opensOnClear: false, kind: "resume" });
  const D3 = stored("55555555-5555-4555-8555-555555555555", 4, DOUBT_TITLE, freshSaved.value, { opensOnClear: false, kind: "doubt" });
  const R2 = { ...R, id: "66666666-6666-4666-8666-666666666666", orderIndex: 5 } as StoredTurn;
  const R3 = { ...R, id: "77777777-7777-4777-8777-777777777777", orderIndex: 6 } as StoredTurn;
  const page = [textLesson, D, D2, R, D3, R2, R3];
  {
    const turnsAt = page.map((_, index) => storedPageTurnAt(page, index));
    assert(JSON.stringify(turnsAt) === JSON.stringify([null, "hold", null, "return", "hold", "return", null]),
      `derive/[L, D fresh, D2, R, D3 fresh, R2, R3] turns [-, hold, -, return, hold, return, -], got ${JSON.stringify(turnsAt)} (mutations e, f)`);
    assert(storedFreshPageOpen(page, 2) && storedFreshPageOpen(page, 3) && !storedFreshPageOpen(page, 4) && !storedFreshPageOpen(page, 7),
      "derive/the page is open on D2 and at R, closed after R and after R2");
    const abandoned = [textLesson, D, { ...textLesson, id: "88888888-8888-4888-8888-888888888888", orderIndex: 2 } as StoredTurn, { ...R, orderIndex: 3 } as StoredTurn];
    assert(storedPageTurnAt(abandoned, 3) === null, "derive/a new question abandons the doubt page: its resume returns nothing");
    const forged = [textLesson, { ...D, kind: "resume" } as StoredTurn];
    assert(storedPageTurnAt(forged, 1) === null, "derive/a resume carrying freshPage is no page turn");
    // Off equals absent: the lane 2 page with no marker turns nothing anywhere.
    const lane2 = fixture.turns;
    assert(lane2.every((_, index) => storedPageTurnAt(lane2, index) === null), "derive/a page with no marker turns no page (off equals absent)");
  }

  // --- surfaces/ ----------------------------------------------------------
  {
    // Live: the hook's own calls, turn by turn, on the same board model.
    const board = pageBoard();
    const layout: BoardLayoutState = { rects: [], nextY: 0 };
    const live: Frame[] = [];
    for (const [index, turn] of page.entries()) {
      if (turn.kind === "doubt" && boardContinuationOf(turn.sceneArtifacts)?.freshPage) {
        assert(zoneInkOccupied(layout) && !board.held(), `surfaces/live turns a page at ${index} only over lesson rows, from the lesson page`);
        assert(turnDoubtPage(board.wb, layout), "surfaces/the live board holds the lesson page");
      }
      if (turn.kind === "resume") returnLessonPage(board.wb, layout);
      board.draw(turn, layout);
      live.push(frameOf(board, layout));
    }
    const lessonFrame = live[0]!;
    assert(live[1]!.ink.every((entry) => !lessonFrame.ink.includes(entry)) && live[1]!.ink.includes(`scene:${D.id}`),
      "surfaces/the doubt page shows the doubt's figure and none of the lesson's ink");
    assert(live[3]!.ink.slice(0, lessonFrame.ink.length).join() === lessonFrame.ink.join() && !live[3]!.ink.some((entry) => entry.startsWith("scene:")),
      "surfaces/the resume shows the lesson page exactly as it was, then its own rows, and no doubt figure");
    const rowsOf = (frame: Frame) => JSON.parse(frame.rects) as string[];
    assert(rowsOf(live[1]!).every((row) => !rowsOf(lessonFrame).includes(row)) && rowsOf(live[2]!).length === rowsOf(live[1]!).length + 1,
      "surfaces/the fresh page lays the doubt out from a blank layout: no lesson row is on it (mutation i)");
    assert(JSON.stringify(rowsOf(live[3]!).slice(0, rowsOf(lessonFrame).length)) === lessonFrame.rects,
      "surfaces/the resume's layout is the lesson page's again, its rows first");

    const { frames: replay, board: replayBoard } = await storedFrames(page);
    for (const [index, frame] of replay.entries()) {
      assert(JSON.stringify(frame) === JSON.stringify(live[index]),
        `surfaces/replay, restore and export show what live showed after turn ${index}, ink and layout (mutations g, h, i): ${JSON.stringify(frame)} vs ${JSON.stringify(live[index])}`);
    }
    const afterReturn = replayBoard.events.slice(replayBoard.events.indexOf("returnHeldPage"));
    assert(!afterReturn.slice(0, afterReturn.indexOf("holdPage")).includes("eraseSceneInk"),
      "surfaces/the return to an empty lesson zone erases nothing on the returned page (mutation h)");
    // A seek clears the board and catches up from the page's first turn: every target matches.
    for (let target = 0; target < page.length; target += 1) {
      const { frames: seek } = await storedFrames(page, 0, target);
      assert(JSON.stringify(seek.at(-1)) === JSON.stringify(live[target]), `surfaces/a seek to turn ${target} lands on the live page`);
    }
    // The zone each surface reads is lane 2's: D's figure on the doubt page, the lesson's empty zone after.
    const zones = page.map((_, index) => pageFigureAt(page, index).sourceIndex);
    assert(JSON.stringify(zones) === JSON.stringify([null, 1, 1, null, 4, null, null]), `surfaces/the zone walk is unchanged: ${JSON.stringify(zones)}`);
    // The figure step reports what stands after a page turn.
    const synced = await syncStoredPageFigure({ turns: page, turnIndex: 3, whiteboard: pageBoard().wb, layout: { rects: [], nextY: 0 },
      executeCommand: async () => {}, shouldCancel: () => false });
    assert(synced.changed && !synced.cancelled && synced.diagram === null, "surfaces/the resume's step resolves to the lesson's empty zone");
    const textOnlyDoubt = [textLesson, stored(DOUBT_FIGURE_TURN_ID, 1, DOUBT_TITLE, refusedSaved.value, { opensOnClear: false, kind: "doubt" })];
    const textHold = await syncStoredPageFigure({ turns: textOnlyDoubt, turnIndex: 1, whiteboard: pageBoard().wb, layout: { rects: [], nextY: 0 },
      executeCommand: async () => {}, shouldCancel: () => false });
    assert(textHold.changed && textHold.diagram === null, "surfaces/a page turned for a refused figure stands with no figure");
    // Off equals absent: on a page with no marker no surface holds or returns anything.
    const lane2 = await storedFrames(fixture.turns);
    assert(!lane2.board.events.includes("holdPage") && !lane2.board.events.includes("returnHeldPage"),
      "surfaces/a page with no marker never holds or returns (off equals absent)");
  }

  // --- zone/ (F3 still holds) ----------------------------------------------
  {
    const rows: PageFigureTurn[] = page.slice(0, 4).map((turn) => ({
      id: turn.id, boardId: "b1", userId: "u1", orderIndex: turn.orderIndex, question: turn.question,
      visualStatus: turn.visualStatus, sceneDocument: turn.sceneDocument, sceneArtifacts: turn.sceneArtifacts,
      segments: turn.segments.map((segment) => ({ orderIndex: segment.orderIndex, command: segment.command })), kind: turn.kind ?? null,
    }));
    const onDoubtPage = await storedPageZone({ boardId: "b1", userId: "u1", turnId: null }, memoryPageFigureStore(rows.slice(0, 3)), { kind: "doubt" });
    assert(onDoubtPage && onDoubtPage.at.sourceIndex !== null && onDoubtPage.turnIds[onDoubtPage.at.sourceIndex] === D.id,
      "zone/a doubt on the doubt page sees the doubt's figure");
    const onLessonPage = await storedPageZone({ boardId: "b1", userId: "u1", turnId: null }, memoryPageFigureStore(rows), { kind: "doubt" });
    assert(onLessonPage && onLessonPage.at.sourceIndex === null,
      "zone/a doubt after the resume sees the lesson page's empty zone, not the doubt page's figure");
    const again = await canonicalizeTurnSceneMetadata(freshDoubtMetadata(),
      { kind: "doubt", doubtFiguresEnabled: true, checkDoubtFigurePage: doubtPageCheck(page.slice(0, 4)) });
    assert(again.ok && again.value.visualStatus === "validated" && boardContinuationOf(again.value.sceneArtifacts)?.freshPage === true,
      "zone/a second fresh page doubt on the lesson page is admitted on the lesson's page");
    const ref = doubtFigureRefFor({ record: null, boardId: "b1", afterReplay: false, figureOnPage: false, storedTurns: page.slice(0, 4),
      activeDiagram: null, codeLessonFrameIndex: null });
    assert(ref === null, "zone/after the return the client names no figure: the doubt page's figure left with it");
  }

  // --- restore/ -----------------------------------------------------------
  {
    // A reload on the doubt page: the restore walk holds the lesson page at D.
    const { board, frames } = await storedFrames(page, 0, 2);
    assert(board.held() && frames.at(-1)!.ink.includes(`scene:${D.id}`), "restore/a reload on the doubt page shows it and holds the lesson page");
    const paused = pausedLessonFromStoredTurns(
      [{ ...textLesson, status: "stopped", persistedStatus: "stopped" }, { ...D, persistedStatus: "complete" }] as StoredTurn[],
      { boardId: "b1", ownerState: "inactive" },
    );
    assert(paused && paused.figureDrawn === false, "restore/Continue after the reload owes no lesson figure");
    const layout: BoardLayoutState = { rects: [], nextY: 0 };
    assert(returnLessonPage(board.wb, layout) && !board.held(), "restore/Continue returns the held page");
    assert(JSON.stringify(board.ink()) === JSON.stringify(frames[0]!.ink) && JSON.stringify(layout.rects.map((rect) => rect.text)) === frames[0]!.rects,
      "restore/the lesson page and its layout come back whole after the reload");
    assert(!returnLessonPage(board.wb, layout), "restore/nothing held, nothing returned");
  }

  // --- live/ (useQuestionHandler) ------------------------------------------
  {
    const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
    const handler = readFileSync(resolve(root, file), "utf8");
    const plan = between(handler, file, "// doubt-figure-plan:begin", "// doubt-figure-plan:end");
    assert(/zoneOccupied: zoneEmpty && zoneInkOccupied\(boardLayoutRef\.current\),\s*\/\/[^\n]*\n\s*freshPage: true,/.test(plan),
      "live/the plan asks the need check over lesson rows (freshPage)");
    const gated = between(handler, file, "if (doubt && doubtFiguresGranted) {", "// doubt-figure-plan:begin");
    assert(gated.length < 200, "live/the plan, and so every page turn, runs only with DIAGRAM_DOUBT_FIGURES granted");
    const swap = between(handler, file, "// doubt-figure-swap:begin", "// doubt-figure-swap:end");
    const fresh = anchored(file, "doubt-fresh-page");
    assert(swap.includes(fresh), "live/the fresh page sits inside the swap anchor");
    assert(/const turnsPage = !inkFree && stash !== null && stash\.diagram === null &&\s*Boolean\(doubtPage\?\.continuesBoard\) && isCurrentTurn\(\);/.test(fresh),
      "live/a page turns only over ink, for an empty zone stash, on the lesson's page (mutation k)");
    assert(at(swap, "const inkFree = zoneLive !== null") < at(swap, "const turnsPage"), "live/the zone is read before the page turns");
    assert(at(fresh, "turnDoubtPage(wb, boardLayoutRef.current,") < at(swap, "await swapFigureIn("), "live/the page turns before the figure draws");
    assert(/if \(freshPage\) \{\s*page\.turnedFreshPage = true;/.test(fresh), "live/only a page actually turned is saved as one");
    assert(swap.includes("const cleared = wb && stash && (inkFree || freshPage)"), "live/the swap draws only on a free zone or a fresh page: never over ink");
    const back = between(handler, file, "// doubt-figure-return:begin", "// doubt-figure-return:end");
    const pageBack = anchored(file, "doubt-fresh-page-return");
    assert(back.includes(pageBack), "live/the page return sits inside the return anchor");
    const returned = at(back, "const pageReturned = returnLessonPage(whiteboardRef.current, boardLayoutRef.current,");
    assert(returned < at(back, "const zoneStash = pageRecord?.boardId === sessionId && !pageReturned"),
      "live/the lesson page comes back before the zone stash is read (mutation j)");
    assert(returned < at(back, "await returnZoneStash(") && returned < at(back, "returnFigureToZone("),
      "live/the page returns before any zone return");
    assert(back.includes("let zoneEmptied = pageReturned;") && back.includes("} else if (resume.returnsFigure && !pageReturned) {"),
      "live/after the page return no reload zone return runs, and the zone counts as the lesson's empty zone");
    assert(/if \(pageReturned\) \{\s*activeVerifiedDiagramRef\.current = null;/.test(pageBack), "live/nothing points at the doubt's figure after the page return");
  }

  // --- surfaces read the step (every rebuild passes the layout) -------------
  {
    const sync = anchored("features/tutor-session/lib/replay/pageFigureSync.ts", "doubt-page-turn");
    assert(/if \(pageTurn === "hold"\) turnDoubtPage\(input\.whiteboard, input\.layout \?\? null, input\.notes\);\s*else returnLessonPage\(/.test(sync),
      "surfaces/the stored step holds at a hold and returns at a return");
    const syncFile = readFileSync(resolve(root, "features/tutor-session/lib/replay/pageFigureSync.ts"), "utf8");
    assert(at(syncFile, "// doubt-page-turn:end") < at(syncFile, "const change = storedPageFigureChange(input.turns, input.turnIndex);"),
      "surfaces/the page step runs before the zone step");
    for (const [file, needle] of [
      ["features/tutor-session/hooks/useBoardSession.ts", "layout: boardLayoutRef?.current ?? null,"],
      ["features/tutor-session/hooks/useReplay.ts", "layout: boardLayoutRef?.current ?? null,"],
      ["features/tutor-session/hooks/useLecturePlayer.ts", "layout: boardLayoutRef.current,"],
      ["lib/lecture-export/exportLectureMp4.ts", "layout: options.getLayout?.() ?? null,"],
      ["features/tutor-session/hooks/useLectureExport.ts", "getLayout: () => boardLayoutRef.current,"],
    ] as const) {
      assert(readFileSync(resolve(root, file), "utf8").includes(needle), `surfaces/${file} hands its layout to the page step`);
    }
    const shell = readFileSync(resolve(root, "features/tutor-session/TutorSessionShell.tsx"), "utf8");
    assert(/useBoardSession\(\{[\s\S]*?boardLayoutRef,\s*\}\);/.test(shell) && /useReplay\(\{\s*whiteboardRef,\s*boardLayoutRef,/.test(shell),
      "surfaces/the shell hands the layout to restore and replay");
    const workPages = readFileSync(resolve(root, "lib/replay/lecturePlayer.ts"), "utf8");
    assert(workPages.includes("const pageTurn = storedPageTurnAt(turns, turnIndex);") &&
      workPages.includes("workPages: recordedLectureWorkPages(cues, pageStartTurnIndex, installedDiagramByTurn, pageTurnByTurn),"),
    "surfaces/the lecture player's work pages follow the same page turns");
  }

  // A new question while the doubt page is up: both pages become notes pages before the clear.
  {
    const notes = anchored("features/tutor-session/hooks/useBoardLayout.ts", "doubt-page-notes");
    assert(/if \(returnLessonPage\(wb, null, \{ capture: captureNotesEpoch, narration: narrationSinceEpochRef \}\)\) \{\s*captureNotesEpoch\(\);/.test(notes),
      "notes/a new question captures the doubt page, then the held lesson page, before it clears");
    const layoutFile = readFileSync(resolve(root, "features/tutor-session/hooks/useBoardLayout.ts"), "utf8");
    assert(at(layoutFile, "// doubt-page-notes:end") < at(layoutFile, "if (wb) await wb.clearBoard();"), "notes/before the clear drops the held page");
  }

  void resumeOf;
  console.log(`verify-doubt-figure-page: ${checks} checks passed`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
