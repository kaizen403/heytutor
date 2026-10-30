import { useCallback, useRef, type RefObject } from "react";
import {
  emphasisBoxPath,
  fitBoardText,
  snapToBoardTypeScale,
  BOARD_TYPE_SCALE,
  workRowFontSize,
  MIN_BOARD_FONT_SIZE,
  WORK_CONTINUATION_INDENT,
  type DrawCommand,
} from "@heytutor/drawing";
import type { WhiteboardHandle } from "@heytutor/whiteboard";
import { tutorDebug } from "@heytutor/tutor-core";
import type { NotesEpoch } from "@/lib/client/exportNotesPdf";
import { useBoardViewport, type BoardViewportMode } from "./useBoardViewport";
import { TEXT_LAYOUT, DIAGRAM_ZONE, WORK_ROW_FONT_SIZE, BOARD_WIDTH, BOARD_WORK_ROWS_PER_PAGE } from "../constants";
import type { BoardTextRect, BoardLayoutState } from "../types";
import type { IntroLayoutCheckpoint } from "../lib/board/introLayoutCheckpoint";
import {
  isInDiagramZone,
  estimateBoardTextWidthAtSize,
  textRectsOverlap,
  registerBoardAnchor,
  withWorkRowIdentity,
  getWorkAreaFlowStartY,
  findWorkTextSlot,
  overlapsWorkArea,
  recordedWorkWriteNeedsPageTurn,
  workColumnMaxWidth,
  workColumnRoom,
} from "../lib/board/boardLayout";
import { closeDoubtPageForNotes } from "../lib/board/doubtPage";

export interface UseBoardLayoutParams {
  whiteboardRef: RefObject<WhiteboardHandle | null>;
  cancelRef: RefObject<boolean>;
  fbdPhaseStartedRef: RefObject<boolean>;
  /** Question whose ink is on the board — tags each captured notes page. */
  liveQuestionRef: RefObject<string>;
  viewportMode?: BoardViewportMode;
  minimumVisibleFontSize?: number | null;
}

/**
 * The floor for a work row, from the board's type scale.
 *
 * A row only ever reaches it when a single unbreakable token — a long chemical
 * formula, one enormous symbol — is wider than the column at every step above.
 * Anything that *can* be broken is wrapped at the column's own size instead, so
 * this is the rare case rather than the normal one it used to be.
 */
export const MIN_WORK_ROW_FONT_SIZE = MIN_BOARD_FONT_SIZE;

/**
 * How long a finished page stays up before a live page turn wipes it.
 *
 * The wipe used to start on the next WRITE with no pause at all: in v3 p1e2
 * the answer box finished at 175,215 ms and the wipe began 11 ms later; 37 of
 * 160 page turns came within 3 s of a box. The turn is taken at the start of
 * the next segment, after the previous voice has finished, so this hold is
 * the time the student has with the finished page.
 */
export const PAGE_TURN_HOLD_MS = 1_500;

/**
 * Boxed answers a page turn carries to the top of the new page, the latest
 * first. Half a page at most, so the new page still has room for its work.
 */
export const MAX_CARRIED_ANSWER_ROWS = Math.max(1, Math.floor(BOARD_WORK_ROWS_PER_PAGE / 2));

let workRowGroupSequence = 0;

/** A fresh id for the rows one authored WRITE becomes. */
export function nextWorkRowGroup(): string {
  workRowGroupSequence += 1;
  return `g${workRowGroupSequence}`;
}

/**
 * What every wrapped piece of one WRITE copies from its tag: the tag's
 * position and the words before it. The same rule the ink planner uses to
 * keep a continuation behind its head (`continuesAuthoredWrite`); a zero
 * position or empty words are a default, not evidence of one tag.
 */
export function authoredWriteKey(command: Pick<DrawCommand, "type" | "charPosition" | "narrationBefore">): string | undefined {
  if (command.type !== "WRITE") return undefined;
  if (!Number.isSafeInteger(command.charPosition) || command.charPosition <= 0) return undefined;
  if (typeof command.narrationBefore !== "string" || command.narrationBefore.trim().length === 0) return undefined;
  return `${command.charPosition}\u0000${command.narrationBefore}`;
}

/**
 * The group a work row joins. The live reservation knows it (one call wraps
 * one WRITE). A replay, the lecture player and export see the stored pieces
 * one at a time, and persistence keeps no group id, so a piece joins the row
 * written just before it when both copy the same authored tag.
 */
export function workRowGroupFor(
  layout: BoardLayoutState,
  command: DrawCommand,
  y: number,
  explicit?: string,
): { rowGroup: string; authoredKey?: string } {
  const authoredKey = authoredWriteKey(command);
  if (explicit) return { rowGroup: explicit, ...(authoredKey ? { authoredKey } : {}) };
  let previous: BoardTextRect | undefined;
  for (const rect of layout.rects) {
    if (rect.workIndex != null && (previous === undefined || rect.workIndex > previous.workIndex!)) previous = rect;
  }
  // A continuation lies below its head on the same page, as in
  // `continuesAuthoredWrite`.
  if (authoredKey && previous?.rowGroup && previous.authoredKey === authoredKey && y > previous.y) {
    return { rowGroup: previous.rowGroup, authoredKey };
  }
  return { rowGroup: nextWorkRowGroup(), ...(authoredKey ? { authoredKey } : {}) };
}

/**
 * The visible rows `[EMPHASIZE]` frames when it resolves to `row`: every
 * written row of its WRITE, top to bottom. `[EMPHASIZE:last]` names the last
 * line of a wrapped answer; boxing that line alone carried "+ 2|A||B|cos θ"
 * onto every later page by itself (25 of 273 boxed rows in the v3 lessons
 * wrapped in a figure column).
 */
export function emphasisGroupRows(row: BoardTextRect, rects: readonly BoardTextRect[]): BoardTextRect[] {
  if (!row.rowGroup) return [row];
  const rows = rects
    .filter((rect) => rect.rowGroup === row.rowGroup && !rect.pendingInk && rect.x < DIAGRAM_ZONE.x &&
      (rect.text ?? "").trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return rows.includes(row) ? rows : [row];
}

/** One box around a group of rows. */
export function rowGroupBounds(rows: readonly BoardTextRect[]): { x: number; y: number; width: number; height: number } {
  const left = Math.min(...rows.map((row) => row.x));
  const top = Math.min(...rows.map((row) => row.y));
  const right = Math.max(...rows.map((row) => row.x + row.width));
  const bottom = Math.max(...rows.map((row) => row.y + row.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Mark the whole group boxed once its box is drawn. */
export function markEmphasisGroupBoxed(rows: readonly BoardTextRect[]): void {
  for (const row of rows) row.boxed = true;
}

/**
 * Boxed answers on the board, oldest first, each a whole group. The latest
 * groups are kept up to the carry cap; a group too tall for what is left of
 * the cap is skipped, never cut.
 */
export function boxedAnswerRowsToCarry(rects: readonly BoardTextRect[]): BoardTextRect[][] {
  const boxed = rects
    .filter((rect) => rect.boxed === true && !rect.pendingInk && rect.x < DIAGRAM_ZONE.x &&
      rect.y >= TEXT_LAYOUT.headingBottomY && (rect.text ?? "").trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: BoardTextRect[][] = [];
  const byId = new Map<string, BoardTextRect[]>();
  for (const rect of boxed) {
    const existing = rect.rowGroup ? byId.get(rect.rowGroup) : undefined;
    if (existing) {
      existing.push(rect);
      continue;
    }
    const group = [rect];
    groups.push(group);
    if (rect.rowGroup) byId.set(rect.rowGroup, group);
  }
  const kept: BoardTextRect[][] = [];
  let rows = 0;
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]!;
    if (rows + group.length > MAX_CARRIED_ANSWER_ROWS) continue;
    kept.unshift(group);
    rows += group.length;
  }
  return kept;
}

/**
 * Where carried answers land on a fresh page: the work column's first rows,
 * in order, at their own size. A group with a row too wide for the column is
 * not shrunk; the whole group is left behind (the board type scale never
 * shrinks a row, and half an answer is not an answer).
 */
export function placeCarriedAnswerRows(
  layout: BoardLayoutState,
  groups: readonly (readonly BoardTextRect[])[],
  diagramActive: boolean,
): BoardTextRect[][] {
  const placed: BoardTextRect[][] = [];
  const scratch: BoardLayoutState = { rects: [...layout.rects], nextY: layout.nextY };
  for (const group of groups) {
    const before = { rects: [...scratch.rects], nextY: scratch.nextY };
    const carriedGroup: BoardTextRect[] = [];
    for (const row of group) {
      const slot = findWorkTextSlot({
        layout: scratch,
        requestedX: TEXT_LAYOUT.marginX,
        requestedY: getWorkAreaFlowStartY(scratch),
        width: row.width,
        height: row.height,
        diagramActive,
        sequential: true,
        runtimeOwnsX: true,
      });
      if (!slot || row.width > slot.maxWidth) {
        carriedGroup.length = 0;
        break;
      }
      const carried: BoardTextRect = { ...row, x: slot.x, y: slot.y, pendingInk: false, boxed: true };
      scratch.rects.push(carried);
      scratch.nextY = Math.max(scratch.nextY, slot.y + TEXT_LAYOUT.lineHeight);
      carriedGroup.push(carried);
    }
    if (carriedGroup.length !== group.length) {
      scratch.rects = before.rects;
      scratch.nextY = before.nextY;
      continue;
    }
    placed.push(carriedGroup);
  }
  return placed;
}

/**
 * Base size for a row, decided by the column it lands in. Constant for a whole
 * turn — a figure is committed before narration starts and holds the right of
 * the board for the rest of the lesson — so the size never changes under the
 * student mid-lesson.
 */
export function workRowBaseFontSize(maxWidth: number): number {
  return workRowFontSize(maxWidth);
}

/**
 * The size this row is drawn at.
 *
 * Wrapping is the answer to a long line; this only reports the size the wrap
 * settled on, which is the column's own base unless a single token could not be
 * broken. Use `wrapWorkRow` when you need the rows themselves.
 */
export function fitWorkRowFontSize(text: string, maxWidth: number): number {
  return fitBoardText(text, { role: "work", maxWidth }).fontSize;
}

/** The rows this line becomes in a column of this width, and their shared size. */
export function wrapWorkRow(
  text: string,
  maxWidth: number,
): { fontSize: number; lines: string[] } {
  return fitBoardText(text, { role: "work", maxWidth });
}

export function useBoardLayout({
  whiteboardRef,
  cancelRef,
  fbdPhaseStartedRef,
  liveQuestionRef,
  viewportMode = "fit",
  minimumVisibleFontSize,
}: UseBoardLayoutParams) {
  const boardContainerRef = useRef<HTMLDivElement>(null);
  const boardViewport = useBoardViewport(boardContainerRef, viewportMode, minimumVisibleFontSize);
  const notesEpochsRef = useRef<NotesEpoch[]>([]);
  const narrationSinceEpochRef = useRef("");
  const boardLayoutRef = useRef<BoardLayoutState>({
    rects: [],
    nextY: TEXT_LAYOUT.topY,
  });
  /** After a work-area erase, ignore LLM y coords and fill rows top-down. */
  const forceSequentialWorkLayoutRef = useRef(false);

  const resetBoardLayout = useCallback((keepHeading = false, forceSequentialWorkLayout?: boolean): void => {
    const headingRects = keepHeading
      ? boardLayoutRef.current.rects.filter((rect) => rect.y < TEXT_LAYOUT.headingBottomY)
      : [];

    boardLayoutRef.current = {
      rects: headingRects,
      nextY: keepHeading && headingRects.length > 0 ? TEXT_LAYOUT.workTopY : TEXT_LAYOUT.topY,
    };

    if (forceSequentialWorkLayout !== undefined) {
      forceSequentialWorkLayoutRef.current = forceSequentialWorkLayout;
    }
  }, []);

  /**
   * Snapshot the board as one notes page before it is cleared or erased. The
   * page carries the question it belongs to and the narration spoken while it
   * was on screen, so Download notes can pair it with the right lesson text.
   */
  const captureNotesEpoch = useCallback((): boolean => {
    const wb = whiteboardRef.current;
    const snapshotDataUrl = wb?.captureSnapshot(2);
    if (!snapshotDataUrl) {
      return false;
    }
    notesEpochsRef.current.push({
      index: notesEpochsRef.current.length,
      question: liveQuestionRef.current,
      snapshotDataUrl,
      narrationText: narrationSinceEpochRef.current,
      timestampMs: Date.now(),
    });
    narrationSinceEpochRef.current = "";
    return true;
  }, [liveQuestionRef, whiteboardRef]);

  const beginBoardEpoch = useCallback(async (): Promise<void> => {
    const wb = whiteboardRef.current;
    // doubt-page-notes:begin
    // A doubt's fresh page holds the lesson's page (lane 9): a new question
    // abandons both, so each is a notes page, the doubt's first.
    if (!closeDoubtPageForNotes(wb, { capture: captureNotesEpoch, narration: narrationSinceEpochRef }) &&
      wb && boardLayoutRef.current.rects.length > 0) {
      captureNotesEpoch();
    }
    // doubt-page-notes:end
    narrationSinceEpochRef.current = "";
    if (wb) await wb.clearBoard();
    resetBoardLayout(false, true);
  }, [captureNotesEpoch, resetBoardLayout, whiteboardRef]);

  const forgetErasedTextRects = useCallback((eraseRect: BoardTextRect): void => {
    boardLayoutRef.current.rects = boardLayoutRef.current.rects.filter(
      (rect) => !textRectsOverlap(rect, eraseRect, 0),
    );
    const hasHeading = boardLayoutRef.current.rects.some(
      (rect) => rect.y < TEXT_LAYOUT.headingBottomY,
    );
    const remainingBottom = boardLayoutRef.current.rects.reduce(
      (bottom, rect) => Math.max(bottom, rect.y + TEXT_LAYOUT.lineHeight),
      TEXT_LAYOUT.topY,
    );
    let nextY = Math.max(remainingBottom, TEXT_LAYOUT.topY);
    if (hasHeading && nextY <= TEXT_LAYOUT.headingBottomY) {
      nextY = TEXT_LAYOUT.workTopY;
    }
    boardLayoutRef.current.nextY = nextY;
    if (overlapsWorkArea(eraseRect)) {
      forceSequentialWorkLayoutRef.current = true;
    }
  }, []);

  /**
   * The size a text command is actually drawn at.
   *
   * A work row arrives with the size its wrap settled on, stamped into
   * params[2] by the reservation; a row without one takes its column's base. A
   * diagram LABEL may ask for its own — the scene engine compiles those to fit
   * real geometry — but it is snapped onto the board's scale, so a figure can
   * never carry a size the rest of the board does not use.
   *
   * Registered rects are measured at this size rather than at a fixed 32, so
   * the box `[EMPHASIZE:last]` draws hugs the ink instead of a guess at it.
   */
  const textCommandFontSize = useCallback((command: DrawCommand): number => {
    const requested = command.params[2];
    if (Number.isFinite(requested) && requested > 0) return snapToBoardTypeScale(requested);
    return command.type === "WRITE" ? WORK_ROW_FONT_SIZE : BOARD_TYPE_SCALE.label;
  }, []);

  /**
   * Turn the work column to a fresh page. Resolves false, with the layout
   * untouched, when the turn stopped before its ink was wiped: the rows the
   * layout records are still the rows on the board, so Continue or a doubt
   * never writes over them. Once the wipe has run the page is fresh, and a
   * stop after that only leaves carried answers unwritten.
   */
  const eraseWorkColumnForNewPage = useCallback(async (
    text?: string,
    options: {
      /** Live turns hold the finished page; replay follows its recording. */
      hold?: boolean;
      /** A recorded row that starts the new page: carry only above it. */
      incoming?: BoardTextRect;
      /**
       * The turn that asked for this page. `cancelRef` is shared, and a quick
       * replacement turn clears it while an older turn is still holding; the
       * older turn must never wipe or reset the newer turn's board.
       */
      isCancelled?: () => boolean;
      /** False: turn the page without carrying boxed answers. */
      carry?: boolean;
    } = {},
  ): Promise<boolean> => {
    const wb = whiteboardRef.current;
    const stopped = () => cancelRef.current || options.isCancelled?.() === true;
    const boxedGroups = options.carry === false ? [] : boxedAnswerRowsToCarry(boardLayoutRef.current.rects);
    if (options.hold && wb && !stopped()) {
      const until = performance.now() + PAGE_TURN_HOLD_MS;
      while (!stopped() && performance.now() < until) {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, Math.max(until - performance.now(), 0))));
      }
    }
    if (stopped()) return false;
    if (wb) {
      tutorDebug("draw", "layout erasing work area", {
        text: text?.slice(0, 60),
        rect_count: boardLayoutRef.current.rects.length,
        carried_answers: boxedGroups.reduce((count, group) => count + group.length, 0),
      });
      captureNotesEpoch();
      // The wipe drops every work stroke before it animates, so once it has
      // started the board is a fresh page whether or not the sweep finishes.
      await wb.eraseWorkInk(700, stopped);
    }
    const diagramActive = fbdPhaseStartedRef.current;
    const survivingDiagramRects = diagramActive
      ? boardLayoutRef.current.rects.filter(
          (r) => r.x >= DIAGRAM_ZONE.x && r.y >= TEXT_LAYOUT.headingBottomY,
        )
      : [];
    resetBoardLayout(true, true);
    boardLayoutRef.current.rects.push(...survivingDiagramRects);
    if (boxedGroups.length === 0 || stopped()) return true;
    const carried = placeCarriedAnswerRows(boardLayoutRef.current, boxedGroups, diagramActive);
    // A recording made before answers were carried starts its page at the
    // top. Writing the answers there would stack two rows on one line.
    const incoming = options.incoming;
    if (incoming && carried.some((group) => group.some((row) => textRectsOverlap(row, incoming)))) return true;
    for (const group of carried) {
      if (stopped()) return true;
      // Recorded before its ink, so a stop part way through a group leaves
      // reserved space rather than unrecorded ink.
      for (const row of group) {
        registerBoardAnchor(boardLayoutRef.current, row);
        boardLayoutRef.current.nextY = Math.max(boardLayoutRef.current.nextY, row.y + TEXT_LAYOUT.lineHeight);
      }
      if (!wb) continue;
      const inkSettings = wb.getInkSettings();
      for (const row of group) {
        if (stopped()) return true;
        await wb.writeText(row.text!, row.x, row.y, 0, undefined, row.fontSize ?? WORK_ROW_FONT_SIZE, stopped, inkSettings);
      }
      if (stopped()) return true;
      // One frame around the whole answer, as `[EMPHASIZE]` drew it.
      const frame = rowGroupBounds(group);
      await wb.drawAnnotation("box", emphasisBoxPath(frame.x, frame.y, frame.width, frame.height), 0, {
        inkSettings,
        shouldCancel: stopped,
      });
    }
    return true;
  }, [captureNotesEpoch, cancelRef, fbdPhaseStartedRef, resetBoardLayout, whiteboardRef]);

  const resolveTextPlacement = useCallback(
    async (
      command: DrawCommand,
      x: number,
      y: number,
      applyLayout: boolean,
      introLayoutCheckpoint?: IntroLayoutCheckpoint,
      /**
       * Only the live segment runner holds a finished page before the wipe.
       * Replay, the lecture player, export and board restore flow the same
       * rows through here and follow their recording without a hold.
       */
      placement: {
        holdPageTurn?: boolean;
        /** The rows one live WRITE wraps into share this group. */
        rowGroup?: string;
        /** The turn placing this row; an older turn never turns a newer turn's page. */
        isCancelled?: () => boolean;
      } = {},
      /** `maxWidth` is the work column at this row — callers must fit ink to it. */
    ): Promise<{ x: number; y: number; maxWidth: number }> => {
      // A work row joins its WRITE's group: a box frames the whole group and a
      // page turn carries it whole or not at all.
      const asWorkRow = (rect: BoardTextRect): BoardTextRect => {
        const identified = withWorkRowIdentity(boardLayoutRef.current, rect);
        if (identified.x >= DIAGRAM_ZONE.x) return identified;
        return { ...identified, ...workRowGroupFor(boardLayoutRef.current, command, rect.y, placement.rowGroup) };
      };
      if (!applyLayout || !command.text) {
        if (command.text && Number.isFinite(x) && Number.isFinite(y)) {
          const rect = {
            x,
            y,
            width: estimateBoardTextWidthAtSize(command.text, textCommandFontSize(command)),
            height: TEXT_LAYOUT.textHeight,
            text: command.text,
            pendingInk: command.type === "WRITE",
            ...(command.type === "WRITE" ? { fontSize: textCommandFontSize(command) } : {}),
          };
          // Restore/replay keep the stored x,y, but a long lesson reuses those
          // y values after a live page-turn whose erase was never recorded.
          if (
            command.type === "WRITE" &&
            recordedWorkWriteNeedsPageTurn(
              boardLayoutRef.current,
              rect,
              fbdPhaseStartedRef.current,
            )
          ) {
            const turned = await eraseWorkColumnForNewPage(command.text, {
              incoming: rect,
              isCancelled: placement.isCancelled,
            });
            // Stopped before the wipe: the board still shows the old page,
            // so this row is not recorded over it.
            if (!turned) return { x, y, maxWidth: BOARD_WIDTH };
          }
          if (introLayoutCheckpoint) introLayoutCheckpoint.registerAnchor(rect);
          else registerBoardAnchor(
            boardLayoutRef.current,
            command.type === "WRITE" ? asWorkRow(rect) : rect,
          );
        }
        // Coordinates were supplied verbatim (replay, or a reserved row): the
        // column constraint has already been applied, so impose none here.
        return { x, y, maxWidth: BOARD_WIDTH };
      }

      if (command.type !== "WRITE" && isInDiagramZone(x, y)) {
        const width = estimateBoardTextWidthAtSize(command.text, textCommandFontSize(command));
        const height = TEXT_LAYOUT.textHeight;
        const rect = { x, y, width, height, text: command.text };
        registerBoardAnchor(boardLayoutRef.current, rect);
        // A diagram label is compiled to fit real geometry; it is not a work row.
        return { x, y, maxWidth: BOARD_WIDTH };
      }

      const fontSize = textCommandFontSize(command);
      const width = estimateBoardTextWidthAtSize(command.text, fontSize);
      const height = TEXT_LAYOUT.textHeight;
      let layout = boardLayoutRef.current;

      // A diagram claims the right half of the board. Keep the solution in a clean
      // left column that stops short of the figure, so lines flow straight down
      // the left instead of hopping around the diagram (which used to leave big
      // vertical gaps). When there is no diagram, the solution uses the full width.
      const diagramActive = fbdPhaseStartedRef.current;
      const sequential = command.type === "WRITE" || forceSequentialWorkLayoutRef.current;
      const findSlot = () => findWorkTextSlot({
        layout,
        requestedX: x,
        requestedY: y,
        width,
        height,
        diagramActive,
        sequential,
        runtimeOwnsX: command.type === "WRITE",
      });

      let slot = findSlot();

      if (slot === null) {
        // Only the live reservation decides to carry boxed answers, and it
        // turns the page itself before an equation that would not fit below
        // them. Replay, the lecture player and export lay rows out again
        // without that decision, so they carry nothing, as on main: a carry
        // the live turn did not make would split an equation it kept whole.
        const turned = await eraseWorkColumnForNewPage(command.text, {
          hold: placement.holdPageTurn === true,
          isCancelled: placement.isCancelled,
          carry: placement.holdPageTurn === true,
        });
        const fallback = {
          x: TEXT_LAYOUT.marginX,
          y: getWorkAreaFlowStartY(boardLayoutRef.current),
          maxWidth: Math.max(DIAGRAM_ZONE.x - 28 - TEXT_LAYOUT.marginX, 40),
        };
        // Stopped before the wipe: the page and its records stay as they are,
        // and this row, which will never be written, reserves nothing.
        if (!turned) return fallback;
        layout = boardLayoutRef.current;
        slot = findSlot() ?? fallback;
      }

      const rect = {
        x: slot.x,
        y: slot.y,
        width: Math.min(width, slot.maxWidth),
        height,
        text: command.text,
        pendingInk: command.type === "WRITE",
        ...(command.type === "WRITE" ? { fontSize } : {}),
      };
      registerBoardAnchor(
        boardLayoutRef.current,
        command.type === "WRITE" ? asWorkRow(rect) : rect,
      );
      boardLayoutRef.current.nextY = Math.max(
        boardLayoutRef.current.nextY,
        slot.y + TEXT_LAYOUT.lineHeight,
      );

      return { x: rect.x, y: rect.y, maxWidth: slot.maxWidth };
    },
    [eraseWorkColumnForNewPage, fbdPhaseStartedRef, textCommandFontSize],
  );

  /**
   * Fit a work row to the column it is about to land in, and reserve a slot for
   * every line it becomes.
   *
   * This is the only place that knows the real column width — whether a figure
   * is holding the right of the board, and where its left edge actually is — so
   * it is the only place that can honestly decide the size. It picks one size
   * for the whole row and *wraps* to it. Shrinking a long line instead of
   * wrapping it is what used to put a 17px sentence under a 32px one.
   *
   * The teaching model's third parameter is discarded on the way through: it
   * says what to write, never how large.
   */
  const reserveTextCommandPlacements = useCallback(
    async (
      command: DrawCommand,
      options: {
        /** The live turn reserving this row; see `eraseWorkColumnForNewPage`. */
        isCancelled?: () => boolean;
      } = {},
    ): Promise<DrawCommand[]> => {
      if (cancelRef.current || options.isCancelled?.() === true) return [];
      if (command.type !== "WRITE" || !command.text) return [command];
      const [x, y] = command.params;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [command];

      const columnWidth = workColumnMaxWidth(
        boardLayoutRef.current,
        fbdPhaseStartedRef.current,
      );
      const { fontSize, lines } = wrapWorkRow(command.text, columnWidth);
      if (lines.length === 0) return [];

      // Reserve one authored equation together. Reserving its head at the
      // bottom and erasing while reserving its tail split the equation across
      // saved pages before the pen had drawn either part. A row larger than a
      // fresh page still uses ordinary bounded paging below.
      const layout = boardLayoutRef.current;
      const diagramActive = fbdPhaseStartedRef.current;
      if (lines.length > 1 && lines.length > workColumnRoom(layout, diagramActive).rowsLeft) {
        const headingRects = layout.rects.filter((rect) => rect.y < TEXT_LAYOUT.headingBottomY);
        const freshPage: BoardLayoutState = {
          rects: [
            ...headingRects,
            ...layout.rects.filter((rect) => diagramActive && rect.x >= DIAGRAM_ZONE.x &&
              rect.y >= TEXT_LAYOUT.headingBottomY),
          ],
          nextY: headingRects.length > 0 ? TEXT_LAYOUT.workTopY : TEXT_LAYOUT.topY,
        };
        if (lines.length <= workColumnRoom(freshPage, diagramActive).rowsLeft) {
          // Boxed answers ride to the new page only when the equation still
          // fits whole below them; otherwise the page turns without them, so
          // the equation is never split to make room for a carried answer.
          const carried = placeCarriedAnswerRows(freshPage, boxedAnswerRowsToCarry(layout.rects), diagramActive).flat();
          const withCarried: BoardLayoutState = {
            rects: [...freshPage.rects, ...carried],
            nextY: carried.reduce((next, row) => Math.max(next, row.y + TEXT_LAYOUT.lineHeight), freshPage.nextY),
          };
          const turned = await eraseWorkColumnForNewPage(command.text, {
            hold: true,
            isCancelled: options.isCancelled,
            carry: lines.length <= workColumnRoom(withCarried, diagramActive).rowsLeft,
          });
          // Stopped before the wipe: nothing is reserved over the old page.
          if (!turned) return [];
        }
      }

      const placed: DrawCommand[] = [];
      // Every row this WRITE wraps into is one answer.
      const rowGroup = nextWorkRowGroup();
      for (const [index, line] of lines.entries()) {
        const indent = index === 0 ? 0 : WORK_CONTINUATION_INDENT;
        const row: DrawCommand = {
          ...command,
          text: line,
          params: [TEXT_LAYOUT.marginX + indent, y, fontSize],
        };
        // Reservation is the live turn's own placement: a page turn here holds.
        const slot = await resolveTextPlacement(row, row.params[0]!, y, true, undefined, {
          holdPageTurn: true,
          rowGroup,
          isCancelled: options.isCancelled,
        });
        // A stopped turn writes nothing more; the rows it did not reserve
        // must not reach the pen.
        if (cancelRef.current || options.isCancelled?.() === true) return placed;
        placed.push({
          ...row,
          params: [slot.x, slot.y, fontSize],
        });
      }
      return placed;
    },
    [boardLayoutRef, cancelRef, eraseWorkColumnForNewPage, fbdPhaseStartedRef, resolveTextPlacement],
  );

  return {
    boardContainerRef,
    boardViewport,
    boardLayoutRef,
    notesEpochsRef,
    narrationSinceEpochRef,
    forceSequentialWorkLayoutRef,
    resetBoardLayout,
    beginBoardEpoch,
    captureNotesEpoch,
    forgetErasedTextRects,
    resolveTextPlacement,
    reserveTextCommandPlacements,
  };
}
